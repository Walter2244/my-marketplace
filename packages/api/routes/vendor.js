const express = require("express")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

const router = express.Router()
const SECRET = process.env.JWT_SECRET || "supersecretkey"

// In-memory vendor store (replace with DB later)
const vendors = []

// Register vendor
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: "Missing fields" })

  const hashed = await bcrypt.hash(password, 10)
  const vendor = { id: vendors.length + 1, name, email, password: hashed }
  vendors.push(vendor)
  res.json({ message: "Vendor registered", vendor })
})

// Login vendor
router.post("/login", async (req, res) => {
  const { email, password } = req.body
  const vendor = vendors.find(v => v.email === email)
  if (!vendor) return res.status(404).json({ error: "Vendor not found" })

  const valid = await bcrypt.compare(password, vendor.password)
  if (!valid) return res.status(401).json({ error: "Invalid credentials" })

  const token = jwt.sign({ id: vendor.id, email: vendor.email }, SECRET, { expiresIn: "2h" })
  res.json({ token })
})

// Protected route
router.get("/me", (req, res) => {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: "Missing token" })

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SECRET)
    const vendor = vendors.find(v => v.id === decoded.id)
    res.json(vendor)
  } catch {
    res.status(401).json({ error: "Invalid token" })
  }
})

module.exports = router