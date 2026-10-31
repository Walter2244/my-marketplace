const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const router = express.Router();
const prisma = new PrismaClient();

// Create product (vendor only)
router.post("/", verifyVendorToken, async (req, res) => {
  try {
    const { title, description, priceCents, currency, quantity } = req.body;

    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "title is required" });
    }
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      return res.status(400).json({ error: "priceCents must be a whole number of 0 or more" });
    }
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) {
      return res.status(400).json({ error: "quantity must be a whole number of 0 or more" });
    }

    // The vendor comes from the verified token, never from the request body
    const product = await prisma.product.create({
      data: {
        vendorId: req.vendor.id,
        title,
        description: description ?? null,
        priceCents,
        currency: currency || "USD",
        quantity: quantity ?? 0,
      },
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("Create product failed:", err);
    res.status(500).json({ error: "Could not create product" });
  }
});

// List products
router.get("/", async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = parseInt(req.query.skip, 10) || 0;

    const where = {};
    if (req.query.vendorId) {
      where.vendorId = parseInt(req.query.vendorId, 10);
    }

    const products = await prisma.product.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    res.json(products);
  } catch (err) {
    console.error("List products failed:", err);
    res.status(500).json({ error: "Could not load products" });
  }
});

// Get product (placeholder)
router.get("/:id", async (req, res) => {
  res.json({ message: "Get product not yet implemented" });
});

// Update product (placeholder)
router.patch("/:id", async (req, res) => {
  res.json({ message: "Update product not yet implemented" });
});

// Delete product (placeholder)
router.delete("/:id", async (req, res) => {
  res.json({ message: "Delete product not yet implemented" });
});

module.exports = router;