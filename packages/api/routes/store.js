const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

// Fields returned to everyone. The vendor's login details are never included.
const storeSelect = {
  id: true,
  name: true,
  city: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  vendor: { select: { id: true, name: true } },
};

// Turn the :id parameter into a positive whole number, or null if it isn't one
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Returns a list of problems with the store fields, or an empty list if they're valid
function validateStoreFields(body, requireAll) {
  const errors = [];
  const { name, city, description } = body;

  if (requireAll || name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
      errors.push("name must be 1 to 120 characters");
    }
  }
  if (requireAll || city !== undefined) {
    if (typeof city !== "string" || !city.trim() || city.trim().length > 80) {
      errors.push("city must be 1 to 80 characters");
    }
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== "string" || description.length > 2000) {
      errors.push("description must be text up to 2000 characters");
    }
  }
  return errors;
}

// Keeps only the fields that were sent, trimmed
function pickStoreData(body) {
  const data = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.city !== undefined) data.city = body.city.trim();
  if (body.description !== undefined) {
    data.description = body.description === null ? null : body.description.trim();
  }
  return data;
}

// Create the logged-in vendor's store (one per vendor)
router.post("/", verifyVendorToken, async (req, res) => {
  try {
    const errors = validateStoreFields(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const existing = await prisma.store.findUnique({ where: { vendorId: req.vendor.id } });
    if (existing) return res.status(409).json({ error: "This vendor already has a store" });

    const store = await prisma.store.create({
      data: { vendorId: req.vendor.id, ...pickStoreData(req.body) },
      select: storeSelect,
    });
    res.status(201).json(store);
  } catch (err) {
    // P2002 means a store for this vendor was created at the same moment
    if (err.code === "P2002") return res.status(409).json({ error: "This vendor already has a store" });
    console.error("Create store failed:", err);
    res.status(500).json({ error: "Could not create store" });
  }
});

// Get the logged-in vendor's store
router.get("/me", verifyVendorToken, async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { vendorId: req.vendor.id }, select: storeSelect });
    if (!store) return res.status(404).json({ error: "You have not created a store yet" });
    res.json(store);
  } catch (err) {
    console.error("Get own store failed:", err);
    res.status(500).json({ error: "Could not load store" });
  }
});

// Update the logged-in vendor's store. Only the owner can reach this, because the store is found by the token's vendor.
router.patch("/me", verifyVendorToken, async (req, res) => {
  try {
    const errors = validateStoreFields(req.body, false);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const data = pickStoreData(req.body);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const existing = await prisma.store.findUnique({ where: { vendorId: req.vendor.id } });
    if (!existing) return res.status(404).json({ error: "You have not created a store yet" });

    const store = await prisma.store.update({ where: { id: existing.id }, data, select: storeSelect });
    res.json(store);
  } catch (err) {
    console.error("Update store failed:", err);
    res.status(500).json({ error: "Could not update store" });
  }
});

// List stores (public), with an optional city filter that ignores capitals
router.get("/", async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = parseInt(req.query.skip, 10) || 0;

    const where = {};
    if (req.query.city) {
      where.city = { equals: String(req.query.city).trim(), mode: "insensitive" };
    }

    const stores = await prisma.store.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      select: storeSelect,
    });
    res.json(stores);
  } catch (err) {
    console.error("List stores failed:", err);
    res.status(500).json({ error: "Could not load stores" });
  }
});

// Get one store (public)
router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid store id" });

    const store = await prisma.store.findUnique({ where: { id }, select: storeSelect });
    if (!store) return res.status(404).json({ error: "Store not found" });
    res.json(store);
  } catch (err) {
    console.error("Get store failed:", err);
    res.status(500).json({ error: "Could not load store" });
  }
});

module.exports = router;
