const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { verifyAdminToken } = require("../middleware/admin");

const router = express.Router();
const prisma = new PrismaClient();

const AGENT_SHARE = 0.02;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Admin registers an agent
router.post("/", verifyAdminToken, async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
    if (!name || name.length > 120) return res.status(400).json({ error: "name is required, up to 120 characters" });
    if (!/^\+?[0-9]{7,15}$/.test(phone)) return res.status(400).json({ error: "phone must be a valid number" });
    const agent = await prisma.agent.create({ data: { name, phone } });
    res.status(201).json(agent);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "an agent with that phone number already exists" });
    console.error("Create agent failed:", err);
    res.status(500).json({ error: "Could not create agent" });
  }
});

// Admin suspends or reinstates an agent. A suspended agent can't take on new vendors.
router.post("/:id/status", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid agent id" });
    const { status } = req.body;
    if (!["ACTIVE", "SUSPENDED"].includes(status)) {
      return res.status(400).json({ error: "status must be ACTIVE or SUSPENDED" });
    }
    const agent = await prisma.agent.update({ where: { id }, data: { status } });
    res.json(agent);
  } catch (err) {
    console.error("Change agent status failed:", err);
    res.status(500).json({ error: "Could not change agent status" });
  }
});

// Vendor chooses an agent to help them. Only one active agent at a time.
router.post("/link", verifyVendorToken, async (req, res) => {
  try {
    const agentId = parseId(req.body.agentId);
    if (!agentId) return res.status(400).json({ error: "agentId is required" });

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (agent.status !== "ACTIVE") return res.status(409).json({ error: "this agent is not available" });

    const active = await prisma.agentLink.findFirst({ where: { vendorId: req.vendor.id, endedAt: null } });
    if (active) return res.status(409).json({ error: "you already have an agent; end that link first" });

    const link = await prisma.agentLink.create({ data: { agentId, vendorId: req.vendor.id } });
    res.status(201).json(link);
  } catch (err) {
    console.error("Link agent failed:", err);
    res.status(500).json({ error: "Could not link agent" });
  }
});

// Vendor ends the link at any time
router.post("/unlink", verifyVendorToken, async (req, res) => {
  try {
    const active = await prisma.agentLink.findFirst({ where: { vendorId: req.vendor.id, endedAt: null } });
    if (!active) return res.status(404).json({ error: "you have no active agent" });
    const ended = await prisma.agentLink.update({
      where: { id: active.id },
      data: { endedAt: new Date(), endedBy: "vendor" },
    });
    res.json(ended);
  } catch (err) {
    console.error("Unlink agent failed:", err);
    res.status(500).json({ error: "Could not end the link" });
  }
});

// Vendor sees their current agent, if any
router.get("/me", verifyVendorToken, async (req, res) => {
  try {
    const active = await prisma.agentLink.findFirst({
      where: { vendorId: req.vendor.id, endedAt: null },
      include: { agent: { select: { id: true, name: true } } },
    });
    res.json(active ? { agent: active.agent, startedAt: active.startedAt } : { agent: null });
  } catch (err) {
    console.error("Load agent failed:", err);
    res.status(500).json({ error: "Could not load agent" });
  }
});

// Records the agent's 2% commission when a sub-order is paid, if the vendor has an active agent.
// Written once per sub-order. Called from the payment webhook.
async function recordAgentCommission(tx, subOrder) {
  const active = await tx.agentLink.findFirst({
    where: { vendorId: subOrder.vendorId, endedAt: null, startedAt: { lte: new Date() } },
  });
  if (!active) return null;
  const existing = await tx.agentCommission.findUnique({ where: { subOrderId: subOrder.id } });
  if (existing) return existing;
  return tx.agentCommission.create({
    data: {
      agentId: active.agentId,
      subOrderId: subOrder.id,
      saleCents: subOrder.totalCents,
      commissionCents: Math.floor(subOrder.totalCents * AGENT_SHARE),
    },
  });
}

// Admin marks an agent commission as paid out
router.post("/commissions/:id/paid", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid commission id" });
    const updated = await prisma.agentCommission.updateMany({
      where: { id, paidOut: false },
      data: { paidOut: true },
    });
    if (updated.count === 0) return res.status(409).json({ error: "commission not found, or already paid out" });
    res.json({ id, paidOut: true });
  } catch (err) {
    console.error("Mark commission paid failed:", err);
    res.status(500).json({ error: "Could not record payout" });
  }
});

module.exports = { router, recordAgentCommission };
