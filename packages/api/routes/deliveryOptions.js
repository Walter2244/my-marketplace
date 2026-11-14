const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { isLivestockCategory } = require("../lib/unitRules");

const router = express.Router();
const prisma = new PrismaClient();

const KINDS = ["COLLECTION", "FLAT_FEE", "QUOTE"];

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The vendor sets the delivery options for one of their listings. Each kind appears at most once.
// Livestock can't offer a flat fee, because live animals need a transporter who handles them.
router.put("/:id/delivery-options", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });
    const options = Array.isArray(req.body.options) ? req.body.options : null;
    if (!options || options.length === 0) {
      return res.status(400).json({ error: "options must be a list with at least one delivery option" });
    }

    const product = await prisma.product.findFirst({ where: { id, vendorId: req.vendor.id } });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const kinds = options.map((o) => o.kind);
    if (!kinds.every((k) => KINDS.includes(k))) {
      return res.status(400).json({ error: "kind must be COLLECTION, FLAT_FEE or QUOTE" });
    }
    if (new Set(kinds).size !== kinds.length) {
      return res.status(400).json({ error: "each delivery option can appear only once" });
    }
    for (const o of options) {
      if (o.kind === "FLAT_FEE" && (!Number.isInteger(o.feeCents) || o.feeCents < 0)) {
        return res.status(400).json({ error: "a flat fee needs feeCents, a whole number of 0 or more" });
      }
      if (o.kind !== "FLAT_FEE" && o.feeCents !== undefined && o.feeCents !== 0) {
        return res.status(400).json({ error: "only a flat fee can have a fee" });
      }
    }

    const livestock = product.categoryId ? await isLivestockCategory(prisma, product.categoryId) : false;
    if (livestock && kinds.includes("FLAT_FEE")) {
      return res.status(400).json({ error: "livestock needs a transporter who handles animals; use QUOTE for delivery" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.deliveryOption.deleteMany({ where: { productId: id } });
      await tx.deliveryOption.createMany({
        data: options.map((o) => ({
          productId: id,
          kind: o.kind,
          feeCents: o.kind === "FLAT_FEE" ? o.feeCents : 0,
          note: typeof o.note === "string" ? o.note.trim().slice(0, 200) : null,
        })),
      });
    });
    res.json(await prisma.deliveryOption.findMany({ where: { productId: id }, orderBy: { kind: "asc" } }));
  } catch (err) {
    console.error("Set delivery options failed:", err);
    res.status(500).json({ error: "Could not save delivery options" });
  }
});

// Anyone can see a published listing's delivery options
router.get("/:id/delivery-options", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });
    const product = await prisma.product.findFirst({ where: { id, status: "PUBLISHED" } });
    if (!product) return res.status(404).json({ error: "Listing not found" });
    res.json(await prisma.deliveryOption.findMany({ where: { productId: id }, select: { kind: true, feeCents: true, note: true } }));
  } catch (err) {
    console.error("Load delivery options failed:", err);
    res.status(500).json({ error: "Could not load delivery options" });
  }
});

module.exports = router;
