const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyBuyerToken } = require("../middleware/buyerAuth");
const { publicStock } = require("../lib/stock");

const router = express.Router();
const prisma = new PrismaClient();

const MAX_QUANTITY = 99;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Returns the buyer's cart with each line's product, stock and availability.
// A line is available only while its product is still published and in stock.
async function loadCart(userId) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              status: true,
              priceCents: true,
              currency: true, unitOfSale: true,
              quantity: true,
              vendor: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  const lines = (cart ? cart.items : []).map((item) => {
    const p = item.product;
    const available = p.status === "PUBLISHED" && p.quantity >= item.quantity;
    return {
      id: item.id,
      quantity: item.quantity,
      available,
      product: {
        id: p.id,
        title: p.title,
        priceCents: p.priceCents,
        currency: p.currency,
        vendor: p.vendor,
        ...publicStock(p),
      },
      lineTotalCents: p.priceCents * item.quantity,
    };
  });

  const currencies = [...new Set(lines.map((l) => l.product.currency))];
  const totalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  return {
    currency: currencies[0] ?? null,
    totalCents,
    allAvailable: lines.length > 0 && lines.every((l) => l.available),
    items: lines,
  };
}

// Get the buyer's cart
router.get("/", verifyBuyerToken, async (req, res) => {
  try {
    res.json(await loadCart(req.user.id));
  } catch (err) {
    console.error("Get cart failed:", err);
    res.status(500).json({ error: "Could not load cart" });
  }
});

// Add a product, or add to the quantity already in the cart
router.post("/items", verifyBuyerToken, async (req, res) => {
  try {
    const productId = parseId(req.body.productId);
    const quantity = Number.isInteger(req.body.quantity) ? req.body.quantity : 1;
    if (!productId) return res.status(400).json({ error: "productId must be a whole number" });
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be between 1 and ${MAX_QUANTITY}` });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.status !== "PUBLISHED") {
      return res.status(404).json({ error: "Product not found" });
    }

    const cart = await prisma.cart.upsert({
      where: { userId: req.user.id },
      update: {},
      create: { userId: req.user.id },
    });

    // One currency per cart, so totals never mix currencies
    const existingLines = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: { product: { select: { currency: true } } },
    });
    if (existingLines.some((l) => l.product.currency !== product.currency)) {
      return res.status(400).json({ error: "your cart already has products in another currency" });
    }

    const current = existingLines.find((l) => l.productId === productId);
    const newQuantity = (current ? current.quantity : 0) + quantity;
    if (newQuantity > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be between 1 and ${MAX_QUANTITY}` });
    }
    if (newQuantity > product.quantity) {
      return res.status(409).json({ error: "not enough stock for that quantity" });
    }

    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      update: { quantity: newQuantity },
      create: { cartId: cart.id, productId, quantity: newQuantity },
    });

    res.status(201).json(await loadCart(req.user.id));
  } catch (err) {
    console.error("Add to cart failed:", err);
    res.status(500).json({ error: "Could not add to cart" });
  }
});

// Set the exact quantity of a line in the cart
router.patch("/items/:itemId", verifyBuyerToken, async (req, res) => {
  try {
    const itemId = parseId(req.params.itemId);
    const quantity = req.body.quantity;
    if (!itemId) return res.status(400).json({ error: "Invalid cart item id" });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be between 1 and ${MAX_QUANTITY}` });
    }

    const cart = await prisma.cart.findUnique({ where: { userId: req.user.id } });
    const item = cart
      ? await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id }, include: { product: true } })
      : null;
    if (!item) return res.status(404).json({ error: "Cart item not found" });
    if (quantity > item.product.quantity) {
      return res.status(409).json({ error: "not enough stock for that quantity" });
    }

    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    res.json(await loadCart(req.user.id));
  } catch (err) {
    console.error("Update cart item failed:", err);
    res.status(500).json({ error: "Could not update cart" });
  }
});

// Remove one line from the cart
router.delete("/items/:itemId", verifyBuyerToken, async (req, res) => {
  try {
    const itemId = parseId(req.params.itemId);
    if (!itemId) return res.status(400).json({ error: "Invalid cart item id" });

    const cart = await prisma.cart.findUnique({ where: { userId: req.user.id } });
    const item = cart ? await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } }) : null;
    if (!item) return res.status(404).json({ error: "Cart item not found" });

    await prisma.cartItem.delete({ where: { id: itemId } });
    res.json(await loadCart(req.user.id));
  } catch (err) {
    console.error("Remove cart item failed:", err);
    res.status(500).json({ error: "Could not remove item" });
  }
});

module.exports = router;

