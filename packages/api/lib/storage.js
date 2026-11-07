const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

// Files live under packages/api/uploads, which is excluded from Git
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");

function productDir(productId) {
  return path.join(UPLOAD_ROOT, "products", String(productId));
}

function filePathFor(productId, key, size) {
  return path.join(productDir(productId), `${key}-${size}.webp`);
}

// Saves the large and thumbnail versions and returns the key that identifies them
async function saveImage(productId, large, thumb) {
  const key = crypto.randomUUID();
  await fs.mkdir(productDir(productId), { recursive: true });
  await fs.writeFile(filePathFor(productId, key, "large"), large);
  await fs.writeFile(filePathFor(productId, key, "thumb"), thumb);
  return key;
}

async function deleteImage(productId, key) {
  await fs.rm(filePathFor(productId, key, "large"), { force: true });
  await fs.rm(filePathFor(productId, key, "thumb"), { force: true });
}

function absolutePath(productId, key, size) {
  return filePathFor(productId, key, size);
}

module.exports = { saveImage, deleteImage, absolutePath };

