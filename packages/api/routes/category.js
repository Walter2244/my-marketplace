const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyAdminToken } = require("../middleware/admin");

const router = express.Router();
const prisma = new PrismaClient();

const MAX_LEVEL = 3;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Turns a name into a URL-friendly slug, for example "Home & Garden" becomes "home-garden"
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Arranges a flat list of categories into a nested tree
function buildTree(rows) {
  const nodes = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    if (node.parentId !== null && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Full category tree (public)
router.get("/", async (req, res) => {
  try {
    const rows = await prisma.category.findMany({
      select: { id: true, name: true, slug: true, level: true, parentId: true },
      orderBy: [{ level: "asc" }, { name: "asc" }],
    });
    res.json(buildTree(rows));
  } catch (err) {
    console.error("List categories failed:", err);
    res.status(500).json({ error: "Could not load categories" });
  }
});

// One category with its direct subcategories (public)
router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid category id" });

    const category = await prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        level: true,
        parentId: true,
        children: { select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } },
      },
    });
    if (!category) return res.status(404).json({ error: "Category not found" });
    res.json(category);
  } catch (err) {
    console.error("Get category failed:", err);
    res.status(500).json({ error: "Could not load category" });
  }
});

// Create a category (admin only). Omit parentId for a top-level category.
router.post("/", verifyAdminToken, async (req, res) => {
  try {
    const { name, slug, parentId } = req.body;
    if (!name || typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      return res.status(400).json({ error: "name must be 1 to 80 characters" });
    }

    const finalSlug = slug !== undefined ? slug : slugify(name);
    if (typeof finalSlug !== "string" || !SLUG_PATTERN.test(finalSlug)) {
      return res.status(400).json({ error: "slug may only contain lowercase letters, numbers and single hyphens" });
    }

    let level = 1;
    let parent = null;
    if (parentId !== undefined && parentId !== null) {
      const parentIdNumber = parseId(parentId);
      if (!parentIdNumber) return res.status(400).json({ error: "parentId must be a whole number" });
      parent = await prisma.category.findUnique({ where: { id: parentIdNumber } });
      if (!parent) return res.status(400).json({ error: "parent category not found" });
      level = parent.level + 1;
    }
    if (level > MAX_LEVEL) {
      return res.status(400).json({ error: "categories can be nested up to 3 levels deep" });
    }

    const category = await prisma.category.create({
      data: { name: name.trim(), slug: finalSlug, level, parentId: parent ? parent.id : null },
      select: { id: true, name: true, slug: true, level: true, parentId: true },
    });
    res.status(201).json(category);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "That slug is already in use" });
    console.error("Create category failed:", err);
    res.status(500).json({ error: "Could not create category" });
  }
});

// Rename a category or change its slug (admin only). The parent cannot be changed.
router.patch("/:id", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid category id" });

    if (req.body.parentId !== undefined) {
      return res.status(400).json({ error: "a category's parent cannot be changed; create a new category under the right parent instead" });
    }

    const { name, slug } = req.body;
    const data = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
        return res.status(400).json({ error: "name must be 1 to 80 characters" });
      }
      data.name = name.trim();
    }
    if (slug !== undefined) {
      if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
        return res.status(400).json({ error: "slug may only contain lowercase letters, numbers and single hyphens" });
      }
      data.slug = slug;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Category not found" });

    const category = await prisma.category.update({
      where: { id },
      data,
      select: { id: true, name: true, slug: true, level: true, parentId: true },
    });
    res.json(category);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "That slug is already in use" });
    console.error("Update category failed:", err);
    res.status(500).json({ error: "Could not update category" });
  }
});

// Delete a category (admin only). Refused while it has subcategories or products.
router.delete("/:id", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid category id" });

    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { children: true, products: true } } },
    });
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (category._count.children > 0) {
      return res.status(409).json({ error: "remove or move its subcategories first" });
    }
    if (category._count.products > 0) {
      return res.status(409).json({ error: "products are still assigned to this category" });
    }

    await prisma.category.delete({ where: { id } });
    res.json({ message: "Category deleted", id });
  } catch (err) {
    console.error("Delete category failed:", err);
    res.status(500).json({ error: "Could not delete category" });
  }
});

module.exports = router;
