const express = require("express");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { verifyBuyerToken } = require("../middleware/buyerAuth");
const { verifyVendorToken } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// A six-digit code, hashed before it's stored so it can't be read back from the database
function newCode() {
  return String(crypto.randomInt(100000, 1000000));
}
function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// Buyer chooses collection for a paid sub-order that contains collectable products
router.post("/sub-orders/:id/choose", verifyBuyerToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid sub-order id" });
    const preferredTime = typeof req.body.preferredTime === "string" ? req.body.preferredTime.trim() : "";
    if (!preferredTime || preferredTime.length > 100) {
      return res.status(400).json({ error: "preferredTime is required, up to 100 characters" });
    }

    const sub = await prisma.subOrder.findFirst({
      where: { id, order: { userId: req.user.id } },
      include: { items: { include: { product: { select: { collectable: true } } } } },
    });
    if (!sub) return res.status(404).json({ error: "Order not found" });
    if (sub.status !== "PAID") {
      return res.status(409).json({ error: "collection can be chosen only after payment" });
    }
    if (sub.fulfilment === "COLLECTION") {
      return res.status(409).json({ error: "collection is already chosen for this order" });
    }
    if (!sub.items.every((i) => i.product.collectable)) {
      return res.status(409).json({ error: "this order contains products that are not collectable" });
    }

    const updated = await prisma.subOrder.update({
      where: { id },
      data: { fulfilment: "COLLECTION", collectionPreferredTime: preferredTime },
    });
    res.json({ id: updated.id, fulfilment: updated.fulfilment, collectionPreferredTime: updated.collectionPreferredTime });
  } catch (err) {
    console.error("Choose collection failed:", err);
    res.status(500).json({ error: "Could not choose collection" });
  }
});

// Vendor marks a collection order ready. Returns the one-time code once, for the buyer.
router.post("/sub-orders/:id/ready", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid sub-order id" });

    const sub = await prisma.subOrder.findFirst({ where: { id, vendorId: req.vendor.id } });
    if (!sub) return res.status(404).json({ error: "Order not found" });
    if (sub.fulfilment !== "COLLECTION" || sub.status !== "PAID") {
      return res.status(409).json({ error: "only a paid collection order can be marked ready" });
    }
    if (sub.collectionCode) {
      return res.status(409).json({ error: "a collection code has already been issued for this order" });
    }

    const code = newCode();
    await prisma.subOrder.update({
      where: { id },
      data: { collectionCode: hashCode(code), readyAt: new Date() },
    });
    res.json({ id, readyAt: new Date(), collectionCode: code, note: "Give this code to the buyer. It will not be shown again." });
  } catch (err) {
    console.error("Mark ready failed:", err);
    res.status(500).json({ error: "Could not mark ready" });
  }
});

// Vendor completes the handover by entering the buyer's code
router.post("/sub-orders/:id/handover", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid sub-order id" });
    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";

    const sub = await prisma.subOrder.findFirst({ where: { id, vendorId: req.vendor.id } });
    if (!sub) return res.status(404).json({ error: "Order not found" });
    if (sub.fulfilment !== "COLLECTION" || !sub.collectionCode) {
      return res.status(409).json({ error: "this order is not ready for collection" });
    }
    if (sub.status === "FULFILLED") {
      return res.status(409).json({ error: "this order has already been collected" });
    }
    if (hashCode(code) !== sub.collectionCode) {
      return res.status(400).json({ error: "the collection code does not match" });
    }

    const updated = await prisma.subOrder.update({
      where: { id },
      data: { status: "FULFILLED" },
    });
    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    console.error("Handover failed:", err);
    res.status(500).json({ error: "Could not complete handover" });
  }
});

module.exports = router;
