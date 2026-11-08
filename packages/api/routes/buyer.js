const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { verifyBuyerToken } = require("../middleware/buyerAuth");
const { loginLimiter } = require("../middleware/rateLimit");
const { JWT_SECRET } = require("../lib/config");

const router = express.Router();
const prisma = new PrismaClient();
const TOKEN_EXPIRY = "2h";
const MIN_PASSWORD_LENGTH = 8;

function createToken(user) {
  return jwt.sign({ role: "buyer", id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Only these fields are ever returned to the buyer. The password hash is never included.
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

// Register a buyer account
router.post("/register", loginLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "a valid email is required" });
    }
    if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (name !== undefined && (typeof name !== "string" || name.length > 120)) {
      return res.status(400).json({ error: "name must be text up to 120 characters" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const user = await prisma.user.create({
      data: { name: name ?? null, email, password: await bcrypt.hash(password, 10) },
    });
    res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "An account with this email already exists" });
    console.error("Buyer register failed:", err);
    res.status(500).json({ error: "Could not create account" });
  }
});

// Log in as a buyer
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ token: createToken(user) });
  } catch (err) {
    console.error("Buyer login failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// The logged-in buyer's own profile
router.get("/me", verifyBuyerToken, (req, res) => {
  res.json(publicUser(req.user));
});

module.exports = router;
