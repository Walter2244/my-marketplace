const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

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

module.exports = { verifyVendorToken };