const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { verifyAdminToken } = require("../middleware/admin");
const { PROVINCES } = require("../lib/locations");

const router = express.Router();
const prisma = new PrismaClient();

// The ten provinces, so buyers and vendors can pick from a fixed list
router.get("/provinces", (req, res) => {
  res.json(PROVINCES);
});

// Districts for one province, or all of them if no province is given (public)
router.get("/", async (req, res) => {
  try {
    const where = {};
    if (req.query.province) {
      if (!PROVINCES.includes(req.query.province)) {
        return res.status(400).json({ error: "province must be one of the ten provinces" });
      }
      where.province = req.query.province;
    }
    const districts = await prisma.district.findMany({
      where,
      orderBy: [{ province: "asc" }, { name: "asc" }],
      select: { id: true, name: true, province: true },
    });
    res.json(districts);
  } catch (err) {
    console.error("List districts failed:", err);
    res.status(500).json({ error: "Could not load districts" });
  }
});

// Admin adds a district from the official ZIMSTAT list
router.post("/", verifyAdminToken, async (req, res) => {
  try {
    const { name, province } = req.body;
    if (!PROVINCES.includes(province)) {
      return res.status(400).json({ error: "province must be one of the ten provinces" });
    }
    if (!name || typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      return res.status(400).json({ error: "name is required, up to 80 characters" });
    }
    const district = await prisma.district.create({
      data: { name: name.trim(), province },
      select: { id: true, name: true, province: true },
    });
    res.status(201).json(district);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "that district is already in the list for this province" });
    console.error("Add district failed:", err);
    res.status(500).json({ error: "Could not add district" });
  }
});

module.exports = router;
