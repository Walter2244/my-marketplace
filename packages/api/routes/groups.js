const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Vendor creates a group, of which they are the lead
router.post("/", verifyVendorToken, async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 120) return res.status(400).json({ error: "name is required, up to 120 characters" });
    const existing = await prisma.producerGroup.findUnique({ where: { leadId: req.vendor.id } });
    if (existing) return res.status(409).json({ error: "you already lead a group" });
    const group = await prisma.producerGroup.create({ data: { name, leadId: req.vendor.id } });
    res.status(201).json(group);
  } catch (err) {
    console.error("Create group failed:", err);
    res.status(500).json({ error: "Could not create group" });
  }
});

// Lead adds a member: an existing verified vendor, with a share from 1 to 100.
// A member's share can't be changed once the group is listed.
router.post("/members", verifyVendorToken, async (req, res) => {
  try {
    const memberVendorId = parseId(req.body.vendorId);
    const sharePercent = req.body.sharePercent;
    if (!memberVendorId) return res.status(400).json({ error: "vendorId is required" });
    if (!Number.isInteger(sharePercent) || sharePercent < 1 || sharePercent > 100) {
      return res.status(400).json({ error: "sharePercent must be a whole number from 1 to 100" });
    }
    const group = await prisma.producerGroup.findUnique({ where: { leadId: req.vendor.id } });
    if (!group) return res.status(404).json({ error: "you do not lead a group" });
    if (group.listed) return res.status(409).json({ error: "the group is already listed; its members are fixed" });
    if (memberVendorId === req.vendor.id) return res.status(400).json({ error: "the lead is already part of the group" });

    const member = await prisma.vendor.findUnique({ where: { id: memberVendorId } });
    if (!member) return res.status(404).json({ error: "vendor not found" });
    if (!member.verified) return res.status(409).json({ error: "only verified vendors can join a group" });

    const members = await prisma.groupMember.findMany({ where: { groupId: group.id } });
    const total = members.reduce((sum, m) => sum + m.sharePercent, 0) + sharePercent;
    if (total > 100) return res.status(400).json({ error: `shares would total ${total}%; the maximum is 100%` });

    const added = await prisma.groupMember.create({
      data: { groupId: group.id, vendorId: memberVendorId, sharePercent },
    });
    res.status(201).json(added);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "that vendor is already in the group" });
    console.error("Add member failed:", err);
    res.status(500).json({ error: "Could not add member" });
  }
});

// Lead lists the group, once the member shares total exactly 100%
router.post("/list", verifyVendorToken, async (req, res) => {
  try {
    const group = await prisma.producerGroup.findUnique({ where: { leadId: req.vendor.id } });
    if (!group) return res.status(404).json({ error: "you do not lead a group" });
    if (group.listed) return res.status(409).json({ error: "the group is already listed" });
    const members = await prisma.groupMember.findMany({ where: { groupId: group.id } });
    if (members.length === 0) return res.status(400).json({ error: "add at least one member before listing" });
    const total = members.reduce((sum, m) => sum + m.sharePercent, 0);
    if (total !== 100) return res.status(400).json({ error: `member shares total ${total}%; they must total exactly 100%` });
    const listed = await prisma.producerGroup.update({ where: { id: group.id }, data: { listed: true } });
    res.json(listed);
  } catch (err) {
    console.error("List group failed:", err);
    res.status(500).json({ error: "Could not list group" });
  }
});

// A member sees what has been recorded for them, and nothing about other members
router.get("/my-shares", verifyVendorToken, async (req, res) => {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { vendorId: req.vendor.id },
      include: {
        group: { select: { name: true } },
        shares: { select: { amountCents: true, subOrderId: true, createdAt: true } },
      },
    });
    res.json(memberships.map((m) => ({
      group: m.group.name,
      sharePercent: m.sharePercent,
      totalCents: m.shares.reduce((sum, s) => sum + s.amountCents, 0),
      shares: m.shares,
    })));
  } catch (err) {
    console.error("Load shares failed:", err);
    res.status(500).json({ error: "Could not load shares" });
  }
});

// Records each member's share of a paid sub-order, once per member. Called from the payment webhook.
async function recordGroupShares(tx, subOrder) {
  const group = await tx.producerGroup.findUnique({
    where: { leadId: subOrder.vendorId },
    include: { members: true },
  });
  if (!group || !group.listed) return [];
  const written = [];
  for (const member of group.members) {
    const existing = await tx.groupShare.findUnique({
      where: { memberId_subOrderId: { memberId: member.id, subOrderId: subOrder.id } },
    });
    if (existing) continue;
    const amountCents = Math.floor((subOrder.totalCents * member.sharePercent) / 100);
    written.push(await tx.groupShare.create({
      data: { memberId: member.id, subOrderId: subOrder.id, amountCents },
    }));
  }
  return written;
}

module.exports = { router, recordGroupShares };
