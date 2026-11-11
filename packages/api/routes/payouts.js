const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { verifyAdminToken } = require("../middleware/admin");

const router = express.Router();
const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Each vendor's own payout position: what has been sold and is still owed to them
router.get("/me", verifyVendorToken, async (req, res) => {
  try {
    const subOrders = await prisma.subOrder.findMany({
      where: { vendorId: req.vendor.id, status: "PAID", payoutStatus: "UNPAID" },
      select: { id: true, orderId: true, vendorShareCents: true, commissionCents: true, currency: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const owedCents = subOrders.reduce((sum, s) => sum + s.vendorShareCents, 0);
    res.json({ owedCents, subOrders });
  } catch (err) {
    console.error("Load payout position failed:", err);
    res.status(500).json({ error: "Could not load payouts" });
  }
});

// Admin view of every vendor still owed money, grouped by vendor and currency
router.get("/owed", verifyAdminToken, async (req, res) => {
  try {
    const subOrders = await prisma.subOrder.findMany({
      where: { status: "PAID", payoutStatus: "UNPAID" },
      include: { vendor: { select: { id: true, name: true } } },
    });
    const byVendor = new Map();
    for (const s of subOrders) {
      const key = `${s.vendor.id}:${s.currency}`;
      if (!byVendor.has(key)) {
        byVendor.set(key, { vendorId: s.vendor.id, vendorName: s.vendor.name, currency: s.currency, owedCents: 0, subOrderIds: [] });
      }
      const entry = byVendor.get(key);
      entry.owedCents += s.vendorShareCents;
      entry.subOrderIds.push(s.id);
    }
    res.json([...byVendor.values()]);
  } catch (err) {
    console.error("Load owed payouts failed:", err);
    res.status(500).json({ error: "Could not load payouts" });
  }
});

// Admin records that a vendor was paid for one sub-order, with the transfer reference.
// A sub-order can only be paid out once, and only after payment and before any cancellation.
router.post("/sub-orders/:id/paid-out", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid sub-order id" });

    const reference = typeof req.body.reference === "string" ? req.body.reference.trim() : "";
    if (!reference || reference.length > 100) {
      return res.status(400).json({ error: "reference is required, up to 100 characters" });
    }

    const subOrder = await prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) return res.status(404).json({ error: "Sub-order not found" });
    if (subOrder.status !== "PAID") {
      return res.status(409).json({ error: `only a paid sub-order can be paid out; this one is ${subOrder.status}` });
    }
    if (subOrder.payoutStatus === "PAID_OUT") {
      return res.status(409).json({ error: "this sub-order has already been paid out" });
    }

    // The status check is repeated in the update, so two requests at once can't both succeed
    const updated = await prisma.subOrder.updateMany({
      where: { id, status: "PAID", payoutStatus: "UNPAID" },
      data: { payoutStatus: "PAID_OUT", payoutReference: reference },
    });
    if (updated.count === 0) {
      return res.status(409).json({ error: "this sub-order was changed by another request" });
    }
    res.json(await prisma.subOrder.findUnique({ where: { id } }));
  } catch (err) {
    console.error("Record payout failed:", err);
    res.status(500).json({ error: "Could not record payout" });
  }
});

module.exports = router;
