const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyBuyerToken } = require("../middleware/buyerAuth");

const router = express.Router();
const prisma = new PrismaClient();

const EXPIRY_MS = 24 * 60 * 60 * 1000;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Lines that can't be bought right now: unpublished, out of stock, or short of the cart quantity
function unavailableLines(items) {
  return items.filter((item) => {
    const p = item.product;
    return p.status !== "PUBLISHED" || p.quantity < item.quantity;
  });
}

// Shapes an order for the buyer, with its sub-orders grouped by vendor
function orderView(order) {
  return {
    id: order.id,
    status: order.status,
    currency: order.currency,
    totalCents: order.totalCents,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    subOrders: order.subOrders.map((s) => ({
      id: s.id,
      status: s.status,
      totalCents: s.totalCents,
      vendor: s.vendor,
      items: s.items.map((i) => ({
        productId: i.productId,
        title: i.product ? i.product.title : null,
        quantity: i.quantity,
        unitCents: i.unitCents, unitOfSale: i.unitOfSale,
      })),
    })),
  };
}

const orderInclude = {
  subOrders: {
    include: {
      vendor: { select: { id: true, name: true } },
      items: { include: { product: { select: { title: true } } } },
    },
  },
};

// Turn the buyer's cart into an order. The stock reduction and the order are written together.
router.post("/checkout", verifyBuyerToken, async (req, res) => {
  try {
    const address = req.body && req.body.delivery;
    const requiredFields = ["name", "phone", "line1", "city", "postalCode", "country"];
    if (!address || typeof address !== "object") {
      return res.status(400).json({ error: "a delivery address is required" });
    }
    const missing = requiredFields.filter((k) => typeof address[k] !== "string" || !address[k].trim());
    if (missing.length > 0) {
      return res.status(400).json({ error: `delivery address is missing: ${missing.join(", ")}` });
    }
    const optionalLength = (value, max) => value === undefined || value === null || (typeof value === "string" && value.length <= max);
    if (!optionalLength(address.line2, 200) || address.name.length > 120 || address.phone.length > 30) {
      return res.status(400).json({ error: "delivery address has a field that is too long" });
    }

    const choices = (req.body && req.body.deliveryChoices) || {};

    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: { items: { include: { product: { include: { deliveryOptions: true } } } } },
    });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: "your cart is empty" });
    }

    const blocked = unavailableLines(cart.items);
    if (blocked.length > 0) {
      return res.status(409).json({
        error: "some items are no longer available in the quantity you asked for",
        items: blocked.map((i) => ({ productId: i.productId, title: i.product.title, quantity: i.quantity })),
      });
    }

    const currencies = [...new Set(cart.items.map((i) => i.product.currency))];
    if (currencies.length > 1) {
      return res.status(400).json({ error: "your cart mixes currencies" });
    }
    const currency = currencies[0];

    // Group the lines by vendor, so each vendor gets their own sub-order
    const byVendor = new Map();
    for (const item of cart.items) {
      const vendorId = item.product.vendorId;
      if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
      byVendor.get(vendorId).push(item);
    }

    // Each vendor's delivery choice must be one that every product in their part of the basket offers
    const deliveryFor = new Map();
    for (const [vendorId, items] of byVendor.entries()) {
      const picked = choices[String(vendorId)];
      const offeredEverywhere = (kind) => items.every((i) => i.product.deliveryOptions.some((o) => o.kind === kind));
      if (!picked || !picked.method || picked.method === "NONE") {
        const offered = items[0].product.deliveryOptions.map((o) => o.kind);
        if (offered.length > 0) {
          return res.status(400).json({ error: `choose a delivery method for vendor ${vendorId}`, offered });
        }
        deliveryFor.set(vendorId, { method: "NONE", feeCents: 0, quoteRef: null });
        continue;
      }
      if (!offeredEverywhere(picked.method)) {
        return res.status(400).json({ error: `vendor ${vendorId} does not offer ${picked.method} for every item in the basket` });
      }
      const feeCents = picked.method === "FLAT_FEE"
        ? items.reduce((max, i) => Math.max(max, i.product.deliveryOptions.find((o) => o.kind === "FLAT_FEE").feeCents), 0)
        : 0;
      deliveryFor.set(vendorId, { method: picked.method, feeCents, quoteRef: picked.method === "QUOTE" ? (typeof picked.quoteRef === "string" ? picked.quoteRef.trim() : null) : null });
    }

    const subTotals = [...byVendor.entries()].map(([vendorId, items]) => {
      const goods = items.reduce((sum, i) => sum + i.product.priceCents * i.quantity, 0);
      return { vendorId, goods, delivery: deliveryFor.get(vendorId) };
    });
    const totalCents = subTotals.reduce((sum, s) => sum + s.goods + s.delivery.feeCents, 0);

    const order = await prisma.$transaction(async (tx) => {
      for (const item of cart.items) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, quantity: { gte: item.quantity }, status: "PUBLISHED" },
          data: { quantity: { decrement: item.quantity } },
        });
        if (updated.count === 0) throw new Error(`stock changed for product ${item.productId}`);
      }

      const created = await tx.order.create({
        data: {
          userId: req.user.id,
          status: "PENDING_PAYMENT",
          totalCents,
          currency,
          expiresAt: new Date(Date.now() + EXPIRY_MS),
          deliveryName: address.name.trim(),
          deliveryPhone: address.phone.trim(),
          deliveryLine1: address.line1.trim(),
          deliveryLine2: address.line2 ? address.line2.trim() : null,
          deliveryCity: address.city.trim(),
          deliveryPostalCode: address.postalCode.trim(),
          deliveryCountry: address.country.trim(),
        },
      });

      for (const s of subTotals) {
        await tx.subOrder.create({
          data: {
            orderId: created.id,
            vendorId: s.vendorId,
            status: "PENDING_PAYMENT",
            currency,
            totalCents: s.goods + s.delivery.feeCents,
            deliveryMethod: s.delivery.method,
            deliveryFeeCents: s.delivery.feeCents,
            deliveryQuoteRef: s.delivery.quoteRef,
            items: {
              create: byVendor.get(s.vendorId).map((i) => ({
                orderId: created.id,
                productId: i.productId,
                quantity: i.quantity,
                unitCents: i.product.priceCents,
                unitOfSale: i.product.unitOfSale,
              })),
            },
          },
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return tx.order.findUnique({ where: { id: created.id }, include: orderInclude });
    });

    res.status(201).json(orderView(order));
  } catch (err) {
    if (err.message && err.message.startsWith("stock changed")) {
      return res.status(409).json({ error: "stock changed while you were checking out. Please review your cart." });
    }
    console.error("Checkout failed:", err);
    res.status(500).json({ error: "Could not place order" });
  }
});
// The buyer's own orders, newest first
router.get("/", verifyBuyerToken, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: orderInclude,
    });
    res.json(orders.map(orderView));
  } catch (err) {
    console.error("List orders failed:", err);
    res.status(500).json({ error: "Could not load orders" });
  }
});

// One of the buyer's orders
router.get("/:id", verifyBuyerToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id" });
    const order = await prisma.order.findFirst({ where: { id, userId: req.user.id }, include: orderInclude });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(orderView(order));
  } catch (err) {
    console.error("Get order failed:", err);
    res.status(500).json({ error: "Could not load order" });
  }
});

// Cancel one of the buyer's orders. Allowed before any vendor has shipped it.
// The reserved stock goes back to the products in the same transaction.
router.post("/:id/cancel", verifyBuyerToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id" });

    const order = await prisma.order.findFirst({ where: { id, userId: req.user.id }, include: { subOrders: { include: { items: true } } } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!["PENDING_PAYMENT", "PAID"].includes(order.status)) {
      return res.status(409).json({ error: `an order that is ${order.status} cannot be cancelled` });
    }
    if (order.subOrders.some((s) => s.status === "FULFILLED")) {
      return res.status(409).json({ error: "part of this order has already shipped and cannot be cancelled" });
    }

    await prisma.$transaction(async (tx) => {
      for (const sub of order.subOrders) {
        for (const item of sub.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { increment: item.quantity } },
          });
        }
        await tx.subOrder.update({ where: { id: sub.id }, data: { status: "CANCELLED" } });
      }
      await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    });

    const updated = await prisma.order.findUnique({ where: { id: order.id }, include: orderInclude });
    res.json(orderView(updated));
  } catch (err) {
    console.error("Cancel order failed:", err);
    res.status(500).json({ error: "Could not cancel order" });
  }
});
module.exports = router;








