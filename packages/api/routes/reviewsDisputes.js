const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyBuyerToken } = require("../middleware/buyerAuth");
const { verifyAdminToken } = require("../middleware/admin");

const router = express.Router();
const prisma = new PrismaClient();

const DISPUTE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The buyer reviews a sub-order that has been fulfilled. One review per sub-order, and it can't be changed.
router.post("/sub-orders/:id/review", verifyBuyerToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid sub-order id" });
    const { rating, comment } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be a whole number from 1 to 5" });
    }
    if (comment !== undefined && comment !== null && (typeof comment !== "string" || comment.length > 500)) {
      return res.status(400).json({ error: "comment must be text, up to 500 characters" });
    }

    const sub = await prisma.subOrder.findFirst({ where: { id, order: { userId: req.user.id } } });
    if (!sub) return res.status(404).json({ error: "Order not found" });
    if (sub.status !== "FULFILLED") {
      return res.status(409).json({ error: "you can review an order only after it has been collected or delivered" });
    }
    const existing = await prisma.review.findUnique({ where: { subOrderId: id } });
    if (existing) return res.status(409).json({ error: "you have already reviewed this order" });

    const review = await prisma.review.create({
      data: {
        subOrderId: id,
        reviewerId: req.user.id,
        rating,
        comment: comment ? comment.trim() : null,
      },
    });
    res.status(201).json({ id: review.id, rating: review.rating, comment: review.comment });
  } catch (err) {
    console.error("Create review failed:", err);
    res.status(500).json({ error: "Could not save review" });
  }
});

// The buyer opens a dispute on a fulfilled sub-order, within 14 days of fulfilment
router.post("/sub-orders/:id/dispute", verifyBuyerToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid sub-order id" });
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (!reason || reason.length > 1000) {
      return res.status(400).json({ error: "reason is required, up to 1000 characters" });
    }

    const sub = await prisma.subOrder.findFirst({ where: { id, order: { userId: req.user.id } } });
    if (!sub) return res.status(404).json({ error: "Order not found" });
    if (sub.status !== "FULFILLED") {
      return res.status(409).json({ error: "a dispute can be opened only after the order has been collected or delivered" });
    }
    if (Date.now() - sub.updatedAt.getTime() > DISPUTE_WINDOW_MS) {
      return res.status(409).json({ error: "the 14-day window for opening a dispute has passed" });
    }
    const existing = await prisma.dispute.findUnique({ where: { subOrderId: id } });
    if (existing) return res.status(409).json({ error: "a dispute is already open for this order" });

    const dispute = await prisma.dispute.create({
      data: { subOrderId: id, openedById: req.user.id, reason },
    });
    res.status(201).json({ id: dispute.id, status: dispute.status });
  } catch (err) {
    console.error("Open dispute failed:", err);
    res.status(500).json({ error: "Could not open dispute" });
  }
});

// Admin records the decision on a dispute. A decided dispute can't be changed.
router.post("/disputes/:id/decide", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid dispute id" });
    const { decision, note } = req.body;
    if (!["RESOLVED_FOR_BUYER", "RESOLVED_FOR_VENDOR"].includes(decision)) {
      return res.status(400).json({ error: "decision must be RESOLVED_FOR_BUYER or RESOLVED_FOR_VENDOR" });
    }
    if (!note || typeof note !== "string" || !note.trim()) {
      return res.status(400).json({ error: "a note explaining the decision is required" });
    }

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) return res.status(404).json({ error: "Dispute not found" });
    if (dispute.status !== "OPEN") {
      return res.status(409).json({ error: `this dispute is already ${dispute.status}` });
    }

    const updated = await prisma.dispute.updateMany({
      where: { id, status: "OPEN" },
      data: { status: decision, decisionNote: note.trim(), decidedById: req.admin.id, decidedAt: new Date() },
    });
    if (updated.count === 0) return res.status(409).json({ error: "this dispute was decided by another request" });
    res.json({ id, status: decision });
  } catch (err) {
    console.error("Decide dispute failed:", err);
    res.status(500).json({ error: "Could not record decision" });
  }
});

// Public: a vendor's average rating and number of reviews. Disputes are never shown.
router.get("/vendors/:id/rating", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid vendor id" });
    const reviews = await prisma.review.findMany({
      where: { subOrder: { vendorId: id } },
      select: { rating: true },
    });
    const count = reviews.length;
    const average = count === 0 ? null : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10;
    res.json({ vendorId: id, reviewCount: count, averageRating: average });
  } catch (err) {
    console.error("Load rating failed:", err);
    res.status(500).json({ error: "Could not load rating" });
  }
});

module.exports = router;
