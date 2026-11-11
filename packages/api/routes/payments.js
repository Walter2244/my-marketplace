const express = require("express");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { verifyBuyerToken } = require("../middleware/buyerAuth");
const { splitAmount, verifySignature } = require("../lib/payments");

const router = express.Router();
const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The buyer starts payment for one of their unpaid orders. This creates a pending payment record.
router.post("/orders/:id", verifyBuyerToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid order id" });

    const order = await prisma.order.findFirst({ where: { id, userId: req.user.id } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "PENDING_PAYMENT") {
      return res.status(409).json({ error: `this order is ${order.status}` });
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      return res.status(409).json({ error: "this order has expired" });
    }

    const providerReference = `test_${crypto.randomUUID()}`;
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "TEST",
        providerReference,
        amountCents: order.totalCents,
        currency: order.currency,
      },
    });
    res.status(201).json({
      paymentId: payment.id,
      providerReference,
      amountCents: payment.amountCents,
      currency: payment.currency,
    });
  } catch (err) {
    console.error("Start payment failed:", err);
    res.status(500).json({ error: "Could not start payment" });
  }
});

// The provider's callback. Only a request with a valid signature can change an order.
router.post("/webhook", async (req, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const signature = req.get("x-payment-signature");
  if (!verifySignature(req.rawBody || Buffer.alloc(0), signature, secret)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const { providerReference, status, amountCents } = req.body || {};
  if (typeof providerReference !== "string" || !["SUCCEEDED", "FAILED"].includes(status)) {
    return res.status(400).json({ error: "providerReference and a status of SUCCEEDED or FAILED are required" });
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { providerReference } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    // A repeated callback for a payment that's already settled changes nothing
    if (payment.status !== "PENDING") {
      return res.json({ received: true, ignored: true });
    }

    if (status === "FAILED") {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      return res.json({ received: true, paymentStatus: "FAILED" });
    }

    if (amountCents !== payment.amountCents) {
      return res.status(400).json({ error: "amount does not match the payment" });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: payment.orderId }, include: { subOrders: true } });

      // If the order was cancelled or expired before payment arrived, the money must be returned
      if (order.status !== "PENDING_PAYMENT") {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "NEEDS_REFUND" } });
        return "NEEDS_REFUND";
      }

      await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED" } });
      await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
      for (const sub of order.subOrders) {
        const split = splitAmount(sub.totalCents);
        await tx.subOrder.update({
          where: { id: sub.id },
          data: {
            status: "PAID",
            commissionCents: split.commissionCents,
            vendorShareCents: split.vendorShareCents,
            payoutStatus: "UNPAID",
          },
        });
      }
      return "PAID";
    });

    res.json({ received: true, paymentStatus: outcome === "PAID" ? "SUCCEEDED" : "NEEDS_REFUND", orderOutcome: outcome });
  } catch (err) {
    console.error("Payment webhook failed:", err);
    res.status(500).json({ error: "Could not record payment" });
  }
});

module.exports = router;
