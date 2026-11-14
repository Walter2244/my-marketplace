const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// What a vendor may see about a sub-order: their own items and totals only.
// The buyer's name, email and other sub-orders are never included.
const subOrderSelect = {
  id: true,
  orderId: true,
  status: true,
  totalCents: true,
  currency: true,
  createdAt: true,
  items: {
    select: {
      productId: true,
      quantity: true,
      unitCents: true, unitOfSale: true,
      product: { select: { title: true } },
    },
  },
};

// The vendor's own sub-orders, newest first
router.get("/", verifyVendorToken, async (req, res) => {
  try {
    const subOrders = await prisma.subOrder.findMany({
      where: { vendorId: req.vendor.id },
      orderBy: { createdAt: "desc" },
      select: subOrderSelect,
    });
    res.json(subOrders);
  } catch (err) {
    console.error("List vendor sub-orders failed:", err);
    res.status(500).json({ error: "Could not load orders" });
  }
});

// One of the vendor's sub-orders
router.get("/:id", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id" });
    const subOrder = await prisma.subOrder.findFirst({
      where: { id, vendorId: req.vendor.id },
      select: subOrderSelect,
    });
    if (!subOrder) return res.status(404).json({ error: "Order not found" });
    res.json(subOrder);
  } catch (err) {
    console.error("Get vendor sub-order failed:", err);
    res.status(500).json({ error: "Could not load order" });
  }
});

// Mark one of the vendor's paid sub-orders as shipped. This is one-way, and it stops the buyer cancelling it.
router.post("/:id/ship", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id" });

    const subOrder = await prisma.subOrder.findFirst({ where: { id, vendorId: req.vendor.id } });
    if (!subOrder) return res.status(404).json({ error: "Order not found" });
    if (subOrder.status === "FULFILLED") {
      return res.status(409).json({ error: "this order has already been marked as shipped" });
    }
    if (subOrder.status !== "PAID") {
      return res.status(409).json({ error: `only a paid order can be marked as shipped; this order is ${subOrder.status}` });
    }

    const updated = await prisma.subOrder.update({
      where: { id },
      data: { status: "FULFILLED" },
      select: subOrderSelect,
    });
    res.json(updated);
  } catch (err) {
    console.error("Ship sub-order failed:", err);
    res.status(500).json({ error: "Could not mark order as shipped" });
  }
});

module.exports = router;

