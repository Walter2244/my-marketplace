const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { verifyVendorToken } = require("../middleware/auth");
const { JWT_SECRET } = require("../lib/config");
const storage = require("../lib/storage");

const router = express.Router();
const prisma = new PrismaClient();

const MAX_IMAGES = 8;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FORMATS = ["jpeg", "png", "webp"];
const SIZES = ["large", "thumb"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Returns the vendor id from a valid vendor token, or null. Lets a vendor see their own drafts' images.
function optionalVendorId(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    return payload.role === "vendor" ? payload.id : null;
  } catch {
    return null;
  }
}

// Published products are visible to everyone. Drafts only to their owner.
function canSee(product, vendorId) {
  return product.status === "PUBLISHED" || (vendorId !== null && product.vendorId === vendorId);
}

function imageResponse(productId, image) {
  return {
    id: image.id,
    position: image.position,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    urls: {
      large: `/products/${productId}/images/${image.id}/large`,
      thumb: `/products/${productId}/images/${image.id}/thumb`,
    },
  };
}

// Upload one image (owner only). Position 0 is the main image.
router.post(
  "/:id/images",
  verifyVendorToken,
  (req, res, next) =>
    upload.single("image")(req, res, (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? "image must be 10 MB or smaller" : "upload failed";
        return res.status(400).json({ error: message });
      }
      next();
    }),
  async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid product id" });

      const product = await prisma.product.findUnique({ where: { id } });
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (product.vendorId !== req.vendor.id) {
        return res.status(403).json({ error: "You can only add images to your own products" });
      }
      if (!req.file) return res.status(400).json({ error: "send the image in a field named image" });

      let format;
      try {
        ({ format } = await sharp(req.file.buffer).metadata());
      } catch {
        return res.status(400).json({ error: "file is not a readable image" });
      }
      if (!ACCEPTED_FORMATS.includes(format)) {
        return res.status(400).json({ error: "only JPEG, PNG and WebP images are accepted" });
      }

      const count = await prisma.productImage.count({ where: { productId: id } });
      if (count >= MAX_IMAGES) {
        return res.status(409).json({ error: `a product can have up to ${MAX_IMAGES} images` });
      }

      const large = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const thumb = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 300, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const key = await storage.saveImage(id, large, thumb);
      const image = await prisma.productImage.create({
        data: { productId: id, position: count, filePath: key, mimeType: "image/webp", sizeBytes: large.length },
      });
      res.status(201).json(imageResponse(id, image));
    } catch (err) {
      console.error("Upload image failed:", err);
      res.status(500).json({ error: "Could not save image" });
    }
  }
);

// List a product's images in order (public for published products, owner for drafts)
router.get("/:id/images", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product id" });

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || !canSee(product, optionalVendorId(req))) {
      return res.status(404).json({ error: "Product not found" });
    }

    const images = await prisma.productImage.findMany({ where: { productId: id }, orderBy: { position: "asc" } });
    res.json(images.map((image) => imageResponse(id, image)));
  } catch (err) {
    console.error("List images failed:", err);
    res.status(500).json({ error: "Could not load images" });
  }
});

// Serve one image file, large or thumb, with the same visibility rules
router.get("/:id/images/:imageId/:size", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const imageId = parseId(req.params.imageId);
    if (!id || !imageId || !SIZES.includes(req.params.size)) {
      return res.status(400).json({ error: "Invalid image request" });
    }

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || !canSee(product, optionalVendorId(req))) {
      return res.status(404).json({ error: "Image not found" });
    }
    const image = await prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!image) return res.status(404).json({ error: "Image not found" });

    res.type(image.mimeType);
    if (product.status === "PUBLISHED") res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(storage.absolutePath(id, image.filePath, req.params.size));
  } catch (err) {
    console.error("Serve image failed:", err);
    res.status(500).json({ error: "Could not load image" });
  }
});

// Delete an image (owner only). Remaining images are renumbered so positions stay 0, 1, 2...
router.delete("/:id/images/:imageId", verifyVendorToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const imageId = parseId(req.params.imageId);
    if (!id || !imageId) return res.status(400).json({ error: "Invalid image request" });

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (product.vendorId !== req.vendor.id) {
      return res.status(403).json({ error: "You can only delete images from your own products" });
    }
    const image = await prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!image) return res.status(404).json({ error: "Image not found" });

    await prisma.productImage.delete({ where: { id: image.id } });
    await storage.deleteImage(id, image.filePath);

    // Renumber in ascending order, so each new position is free when it's assigned
    const remaining = await prisma.productImage.findMany({ where: { productId: id }, orderBy: { position: "asc" } });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i) {
        await prisma.productImage.update({ where: { id: remaining[i].id }, data: { position: i } });
      }
    }

    res.json({ message: "Image deleted", id: image.id });
  } catch (err) {
    console.error("Delete image failed:", err);
    res.status(500).json({ error: "Could not delete image" });
  }
});

module.exports = router;
