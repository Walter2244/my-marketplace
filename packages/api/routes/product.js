const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const router = express.Router();
const prisma = new PrismaClient();

// Turn the :id parameter into a positive whole number, or null if it isn't one
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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

// List products (public)
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

// Get one product (public)
router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const product = await prisma.product.findUnique({
      where: { id },
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json(product);
  } catch (err) {
    console.error("Get product failed:", err);
    res.status(500).json({ error: "Could not load product" });
  }
});

// Update product (owner only)
router.patch("/:id", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    if (existing.vendorId !== req.vendor.id) {
      return res.status(403).json({ error: "You can only change your own products" });
    }

    const { title, description, priceCents, currency, quantity } = req.body;
    const data = {};

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "title must be a non-empty string" });
      }
      data.title = title;
    }
    if (description !== undefined) {
      if (description !== null && typeof description !== "string") {
        return res.status(400).json({ error: "description must be a string or null" });
      }
      data.description = description;
    }
    if (priceCents !== undefined) {
      if (!Number.isInteger(priceCents) || priceCents < 0) {
        return res.status(400).json({ error: "priceCents must be a whole number of 0 or more" });
      }
      data.priceCents = priceCents;
    }
    if (currency !== undefined) {
      if (typeof currency !== "string" || !currency.trim()) {
        return res.status(400).json({ error: "currency must be a non-empty string" });
      }
      data.currency = currency;
    }
    if (quantity !== undefined) {
      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: "quantity must be a whole number of 0 or more" });
      }
      data.quantity = quantity;
    }

    // vendorId is deliberately not accepted here, so ownership can't be transferred
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const product = await prisma.product.update({ where: { id }, data });
    res.json(product);
  } catch (err) {
    console.error("Update product failed:", err);
    res.status(500).json({ error: "Could not update product" });
  }
});

// Delete product (owner only)
router.delete("/:id", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    if (existing.vendorId !== req.vendor.id) {
      return res.status(403).json({ error: "You can only delete your own products" });
    }

    await prisma.product.delete({ where: { id } });
    res.json({ message: "Product deleted", id });
  } catch (err) {
    // P2003 means an order item still references this product
    if (err.code === "P2003") {
      return res.status(409).json({ error: "Product is part of an order and cannot be deleted" });
    }
    console.error("Delete product failed:", err);
    res.status(500).json({ error: "Could not delete product" });
  }
});

module.exports = router;