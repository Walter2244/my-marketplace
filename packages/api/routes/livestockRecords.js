const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { ruleSetFor } = require("../lib/attributes");
const { isLivestockCategory } = require("../lib/unitRules");

const router = express.Router();
const prisma = new PrismaClient();

const DECLARATION = "I confirm this animal is healthy, fit to travel, and that the records given are true.";

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Loads one of the vendor's livestock listings, or returns an error
async function ownLivestock(productId, vendorId) {
  const product = await prisma.product.findFirst({ where: { id: productId, vendorId } });
  if (!product) return { error: { status: 404, message: "Product not found" } };
  if (!(await isLivestockCategory(prisma, product.categoryId))) {
    return { error: { status: 400, message: "livestock records apply only to livestock listings" } };
  }
  return { product };
}

// Vendor sets the identification tag for a livestock listing. Tags are unique across all listings.
router.put("/:id/identification", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });
    const tagNumber = typeof req.body.tagNumber === "string" ? req.body.tagNumber.trim().toUpperCase() : "";
    if (!tagNumber || tagNumber.length > 40 || !/^[A-Z0-9-]+$/.test(tagNumber)) {
      return res.status(400).json({ error: "tagNumber is required: letters, numbers and hyphens, up to 40 characters" });
    }

    const { product, error } = await ownLivestock(id, req.vendor.id);
    if (error) return res.status(error.status).json({ error: error.message });

    const taken = await prisma.animalIdentification.findFirst({ where: { tagNumber, NOT: { productId: id } } });
    if (taken) return res.status(409).json({ error: "that tag number is already used on another listing" });

    const saved = await prisma.animalIdentification.upsert({
      where: { productId: id },
      update: { tagNumber },
      create: { productId: id, tagNumber },
    });
    res.json(saved);
  } catch (err) {
    console.error("Set identification failed:", err);
    res.status(500).json({ error: "Could not save identification" });
  }
});

// Vendor adds a vaccination or treatment record. The date can't be in the future.
router.post("/:id/health-records", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });
    const { kind, description, recordedOn } = req.body;
    if (!["VACCINATION", "TREATMENT", "CHECKUP"].includes(kind)) {
      return res.status(400).json({ error: "kind must be VACCINATION, TREATMENT or CHECKUP" });
    }
    if (!description || typeof description !== "string" || description.trim().length > 300) {
      return res.status(400).json({ error: "description is required, up to 300 characters" });
    }
    const date = new Date(recordedOn);
    if (Number.isNaN(date.getTime())) return res.status(400).json({ error: "recordedOn must be a date" });
    if (date > new Date()) return res.status(400).json({ error: "a health record cannot be dated in the future" });

    const { error } = await ownLivestock(id, req.vendor.id);
    if (error) return res.status(error.status).json({ error: error.message });

    const record = await prisma.healthRecord.create({
      data: { productId: id, kind, description: description.trim(), recordedOn: date },
    });
    res.status(201).json(record);
  } catch (err) {
    console.error("Add health record failed:", err);
    res.status(500).json({ error: "Could not add health record" });
  }
});

// Vendor makes the health declaration once. It can't be changed afterwards.
router.post("/:id/declaration", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });
    if (req.body.agreed !== true) {
      return res.status(400).json({ error: "the declaration must be agreed to" });
    }

    const { error } = await ownLivestock(id, req.vendor.id);
    if (error) return res.status(error.status).json({ error: error.message });

    const existing = await prisma.healthDeclaration.findUnique({ where: { productId: id } });
    if (existing) return res.status(409).json({ error: "the health declaration has already been made for this listing" });

    const declaration = await prisma.healthDeclaration.create({
      data: { productId: id, statement: DECLARATION },
    });
    res.status(201).json(declaration);
  } catch (err) {
    console.error("Health declaration failed:", err);
    res.status(500).json({ error: "Could not record declaration" });
  }
});

// Anyone can see a published livestock listing's records
router.get("/:id/records", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });
    const product = await prisma.product.findFirst({ where: { id, status: "PUBLISHED" } });
    if (!product) return res.status(404).json({ error: "Listing not found" });

    const [identification, healthRecords, declaration] = await Promise.all([
      prisma.animalIdentification.findUnique({ where: { productId: id }, select: { tagNumber: true } }),
      prisma.healthRecord.findMany({ where: { productId: id }, orderBy: { recordedOn: "desc" }, select: { kind: true, description: true, recordedOn: true } }),
      prisma.healthDeclaration.findUnique({ where: { productId: id }, select: { statement: true, declaredAt: true } }),
    ]);
    res.json({ identification, healthRecords, declaration });
  } catch (err) {
    console.error("Load records failed:", err);
    res.status(500).json({ error: "Could not load records" });
  }
});

module.exports = router;
