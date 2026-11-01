const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { verifyAdminToken } = require("../middleware/admin");

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Admin login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ role: "admin", id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: "2h" });
    res.json({ token });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Platform totals, read from the database
router.get("/stats", verifyAdminToken, async (req, res) => {
  try {
    const [total_vendors, total_products, total_orders] = await Promise.all([
      prisma.vendor.count(),
      prisma.product.count(),
      prisma.order.count(),
    ]);
    res.json({ total_vendors, total_products, total_orders });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Could not load stats" });
  }
});

module.exports = router;