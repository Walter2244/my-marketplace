const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { withStock } = require("../lib/stock");

const router = express.Router();
const prisma = new PrismaClient();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Set the stock level to an exact number (vendor only, owner only)
router.put("/:id/stock", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const { quantity } = req.body;
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: "quantity must be a whole number of 0 or more" });
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    if (existing.vendorId !== req.vendor.id) {
      return res.status(403).json({ error: "You can only change stock for your own products" });
    }

    const product = await prisma.product.update({
      where: { id },
      data: { quantity },
      select: { id: true, title: true, quantity: true, status: true, updatedAt: true },
    });
    res.json(withStock(product));
  } catch (err) {
    console.error("Set stock failed:", err);
    res.status(500).json({ error: "Could not update stock" });
  }
});

// Change stock by a positive or negative amount, refused if it would go below zero (vendor only, owner only)
router.post("/:id/adjust", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const { change } = req.body;
    if (!Number.isInteger(change) || change === 0) {
      return res.status(400).json({ error: "change must be a whole number other than 0" });
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    if (existing.vendorId !== req.vendor.id) {
      return res.status(403).json({ error: "You can only change stock for your own products" });
    }

    // The check and the update happen in one statement, so two adjustments at once can't take stock below zero
    const result = await prisma.product.updateMany({
      where: { id, quantity: { gte: change < 0 ? -change : 0 } },
      data: { quantity: { increment: change } },
    });
    if (result.count === 0) {
      return res.status(409).json({ error: "not enough stock for that change" });
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, title: true, quantity: true, status: true, updatedAt: true },
    });
    res.json(withStock(product));
  } catch (err) {
    console.error("Adjust stock failed:", err);
    res.status(500).json({ error: "Could not adjust stock" });
  }
});

module.exports = router;

