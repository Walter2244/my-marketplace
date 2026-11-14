const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { verifyAdminToken } = require("../middleware/admin");

const router = express.Router();
const prisma = new PrismaClient();

const DOCUMENT_TYPES = ["FARM_OWNERSHIP", "OFFER_LETTER", "PERMIT", "LEASE_AGREEMENT", "AFFIDAVIT", "DEALER_LICENCE"];

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Stub ID check. Replaced by the real provider once one is chosen and signed up.
// It only checks the shape of the number and is recorded as a stub, never a real check.
function stubIdCheck(idNumber) {
  return /^[0-9]{2}-?[0-9]{6,7}[A-Z][0-9]{2}$/i.test(idNumber) ? "STUB_PASS" : "STUB_FAIL";
}

// Vendor applies for verification
router.post("/apply", verifyVendorToken, async (req, res) => {
  try {
    const { idNumber, holderName, relationshipNote, documentType, documentRef, affidavitCommissioned, licenceNumber, farmName, province, district, saleLocation } = req.body;

    if (!idNumber || typeof idNumber !== "string") return res.status(400).json({ error: "idNumber is required" });
    if (!holderName || typeof holderName !== "string") return res.status(400).json({ error: "holderName is required" });
    if (!DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ error: "documentType must be one of: " + DOCUMENT_TYPES.join(", ") });
    }
    if (!documentRef || typeof documentRef !== "string") return res.status(400).json({ error: "documentRef is required" });

    // The holder named on the document must be the vendor, unless the affidavit explains the relationship
    const holderIsVendor = holderName.trim().toLowerCase() === req.vendor.name.trim().toLowerCase();
    if (!holderIsVendor && !(relationshipNote && relationshipNote.trim())) {
      return res.status(400).json({ error: "the holder is not the vendor; explain the relationship in relationshipNote" });
    }

    if (documentType === "AFFIDAVIT") {
      if (affidavitCommissioned !== true) {
        return res.status(400).json({ error: "an affidavit must be sworn before a Commissioner of Oaths" });
      }
      if (!farmName || !province || !district || !saleLocation) {
        return res.status(400).json({ error: "an affidavit must give farmName, province, district and saleLocation" });
      }
    }
    if (documentType === "DEALER_LICENCE" && (!licenceNumber || typeof licenceNumber !== "string")) {
      return res.status(400).json({ error: "a dealer licence needs its licenceNumber" });
    }

    // A vendor can have one application waiting for review at a time
    const pending = await prisma.verificationApplication.findFirst({
      where: { vendorId: req.vendor.id, status: "PENDING_REVIEW" },
    });
    if (pending) return res.status(409).json({ error: "you already have an application waiting for review" });

    const application = await prisma.verificationApplication.create({
      data: {
        vendorId: req.vendor.id,
        idNumber: idNumber.trim(),
        idCheckStatus: stubIdCheck(idNumber.trim()),
        holderName: holderName.trim(),
        relationshipNote: relationshipNote ? relationshipNote.trim() : null,
        documentType,
        documentRef: documentRef.trim(),
        affidavitCommissioned: documentType === "AFFIDAVIT" ? true : false,
        licenceNumber: licenceNumber ? licenceNumber.trim() : null,
        farmName: farmName ? farmName.trim() : null,
        province: province ? province.trim() : null,
        district: district ? district.trim() : null,
        saleLocation: saleLocation ? saleLocation.trim() : null,
      },
    });
    res.status(201).json(application);
  } catch (err) {
    console.error("Apply for verification failed:", err);
    res.status(500).json({ error: "Could not submit application" });
  }
});

// The vendor's own applications and their outcomes
router.get("/me", verifyVendorToken, async (req, res) => {
  try {
    const applications = await prisma.verificationApplication.findMany({
      where: { vendorId: req.vendor.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, documentType: true, idCheckStatus: true, reviewerNote: true, reviewedAt: true, createdAt: true },
    });
    res.json({ verified: req.vendor.verified, applications });
  } catch (err) {
    console.error("Load verification failed:", err);
    res.status(500).json({ error: "Could not load verification" });
  }
});

// Admin: applications waiting for review
router.get("/pending", verifyAdminToken, async (req, res) => {
  try {
    const applications = await prisma.verificationApplication.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      include: { vendor: { select: { id: true, name: true, email: true } } },
    });
    res.json(applications);
  } catch (err) {
    console.error("Load pending applications failed:", err);
    res.status(500).json({ error: "Could not load applications" });
  }
});

// Admin: approve or reject an application with a reason
router.post("/:id/decide", verifyAdminToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid application id" });
    const { decision, reason } = req.body;
    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ error: "decision must be APPROVED or REJECTED" });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ error: "a reason is required" });
    }

    const application = await prisma.verificationApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ error: "Application not found" });
    if (application.status !== "PENDING_REVIEW") {
      return res.status(409).json({ error: `this application is already ${application.status}` });
    }

    // The decision and the vendor's flag change together, so a vendor is never half-verified
    await prisma.$transaction(async (tx) => {
      await tx.verificationApplication.update({
        where: { id },
        data: { status: decision, reviewerNote: reason.trim(), reviewedBy: req.admin.id, reviewedAt: new Date() },
      });
      await tx.vendor.update({
        where: { id: application.vendorId },
        data: { verified: decision === "APPROVED" },
      });
    });
    res.json({ id, status: decision });
  } catch (err) {
    console.error("Decide verification failed:", err);
    res.status(500).json({ error: "Could not record decision" });
  }
});

module.exports = router;
