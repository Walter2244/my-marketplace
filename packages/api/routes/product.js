const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

const STATUSES = ["DRAFT", "PUBLISHED"];

const productInclude = {
  vendor: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, slug: true, level: true } },
};

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Products belong to the most specific category only, so a parent category can't hold products directly.
// Returns an error message, or null if the category can be used.
async function checkCategory(categoryId) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { children: true } } },
  });
  if (!category) return "category not found";
  if (category._count.children > 0) return "choose the most specific category, not a parent category";
  return null;
}

// Create product (vendor only)
router.post("/", verifyVendorToken, async (req, res) => {
  try {
    const { title, description, priceCents, currency, quantity, categoryId, status } = req.body;

    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "title is required" });
    }
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      return res.status(400).json({ error: "priceCents must be a whole number of 0 or more" });
    }
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) {
      return res.status(400).json({ error: "quantity must be a whole number of 0 or more" });
    }

    const productStatus = status ?? "DRAFT";
    if (!STATUSES.includes(productStatus)) {
      return res.status(400).json({ error: "status must be DRAFT or PUBLISHED" });
    }

    let finalCategory = null;
    if (categoryId !== undefined && categoryId !== null) {
      if (!Number.isInteger(categoryId)) {
        return res.status(400).json({ error: "categoryId must be a whole number" });
      }
      const problem = await checkCategory(categoryId);
      if (problem) return res.status(400).json({ error: problem });
      finalCategory = categoryId;
    }

    if (productStatus === "PUBLISHED" && finalCategory === null) {
      return res.status(400).json({ error: "a product needs a category before it can be published" });
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
        status: productStatus,
        categoryId: finalCategory,
      },
      include: productInclude,
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("Create product failed:", err);
    res.status(500).json({ error: "Could not create product" });
  }
});

// The logged-in vendor's own products, including drafts (vendor only)
router.get("/mine", verifyVendorToken, async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = parseInt(req.query.skip, 10) || 0;

    const products = await prisma.product.findMany({
      where: { vendorId: req.vendor.id },
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: productInclude,
    });
    res.json(products);
  } catch (err) {
    console.error("List own products failed:", err);
    res.status(500).json({ error: "Could not load products" });
  }
});

// List published products (public), with optional vendor and category filters
router.get("/", async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = parseInt(req.query.skip, 10) || 0;

    const where = { status: "PUBLISHED" };
    if (req.query.vendorId) {
      const vendorId = parseId(req.query.vendorId);
      if (!vendorId) return res.status(400).json({ error: "vendorId must be a whole number" });
      where.vendorId = vendorId;
    }
    if (req.query.categoryId) {
      const categoryId = parseId(req.query.categoryId);
      if (!categoryId) return res.status(400).json({ error: "categoryId must be a whole number" });
      where.categoryId = categoryId;
    }

    const products = await prisma.product.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: productInclude,
    });
    res.json(products);
  } catch (err) {
    console.error("List products failed:", err);
    res.status(500).json({ error: "Could not load products" });
  }
});

// One published product (public). Drafts return 404 to everyone except through /products/mine.
router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const product = await prisma.product.findFirst({
      where: { id, status: "PUBLISHED" },
      include: productInclude,
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

    const { title, description, priceCents, currency, quantity, categoryId, status } = req.body;
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
    if (categoryId !== undefined) {
      if (categoryId === null) {
        data.categoryId = null;
      } else if (!Number.isInteger(categoryId)) {
        return res.status(400).json({ error: "categoryId must be a whole number" });
      } else {
        const problem = await checkCategory(categoryId);
        if (problem) return res.status(400).json({ error: problem });
        data.categoryId = categoryId;
      }
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: "status must be DRAFT or PUBLISHED" });
      }
      data.status = status;
    }

    // vendorId is deliberately not accepted here, so ownership can't be transferred
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const finalStatus = data.status ?? existing.status;
    const finalCategory = data.categoryId !== undefined ? data.categoryId : existing.categoryId;
    if (finalStatus === "PUBLISHED" && finalCategory === null) {
      return res.status(400).json({ error: "a product needs a category before it can be published" });
    }

    const product = await prisma.product.update({ where: { id }, data, include: productInclude });
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
