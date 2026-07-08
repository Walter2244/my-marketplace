const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();
const SECRET = process.env.JWT_SECRET || "supersecretkey";

// Simple admin login (stub)
router.post('/login', (req, res) => {
  const { username, email, password } = req.body;
  const id = username || email;
  if (id !== 'admin' || password !== 'admin123') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '2h' });
  res.json({ token });
});

// Protected stats route
router.get("/stats", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    jwt.verify(auth.split(" ")[1], SECRET);
    res.json({ total_vendors: 3, total_products: 27, total_orders: 12 });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;