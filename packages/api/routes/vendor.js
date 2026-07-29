const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const TOKEN_EXPIRY = "2h";

// Helper: create JWT for vendor
function createToken(vendor) {
  return jwt.sign({ role: "vendor", id: vendor.id, email: vendor.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Middleware: protect vendor routes
async function verifyVendorToken(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "vendor") return res.status(403).json({ error: "Forbidden" });
    const vendor = await prisma.vendor.findUnique({ where: { id: payload.id } });
    if (!vendor) return res.status(401).json({ error: "Invalid token" });
    req.vendor = vendor;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Register vendor
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "name, email and password are required" });

    const existing = await prisma.vendor.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Vendor already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const vendor = await prisma.vendor.create({
      data: { name, email, password: hashed }
    });

    const token = createToken(vendor);
    res.status(201).json({ token, vendor: { id: vendor.id, name: vendor.name, email: vendor.email, createdAt: vendor.createdAt } });
  } catch (err) {
    console.error("Vendor register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Vendor login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const vendor = await prisma.vendor.findUnique({ where: { email } });
    if (!vendor) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, vendor.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = createToken(vendor);
    res.json({ token });
  } catch (err) {
    console.error("Vendor login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Protected: get current vendor
router.get("/me", verifyVendorToken, async (req, res) => {
  const v = req.vendor;
  res.json({ id: v.id, name: v.name, email: v.email, createdAt: v.createdAt, updatedAt: v.updatedAt });
});

module.exports = router;


