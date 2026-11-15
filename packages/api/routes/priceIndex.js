const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

// A district's price is shown only once it has this many completed sales in the category
const MIN_SALES = 5;

// The middle price of a sorted list: the median, so one extreme sale doesn't distort it
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

// Completed sales are those on sub-orders that were collected or delivered
async function completedUnitPrices(categoryId, province, district) {
  const items = await prisma.orderItem.findMany({
    where: {
      subOrder: { status: "FULFILLED" },
      product: {
        categoryId,
        ...(province ? { province } : {}),
        ...(district ? { district } : {}),
      },
    },
    select: { unitCents: true, product: { select: { province: true, district: true } } },
  });
  return items;
}

// Public: the price guide for a category, by district. Shows "not enough data" below the minimum.
router.get("/", async (req, res) => {
  try {
    const categoryId = Number(req.query.categoryId);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: "categoryId is required" });
    }
    const items = await completedUnitPrices(categoryId, req.query.province, req.query.district);

    const byDistrict = new Map();
    for (const item of items) {
      const key = `${item.product.province ?? "Unknown"}|${item.product.district ?? "Unknown"}`;
      if (!byDistrict.has(key)) byDistrict.set(key, []);
      byDistrict.get(key).push(item.unitCents);
    }

    const guide = [...byDistrict.entries()].map(([key, prices]) => {
      const [province, district] = key.split("|");
      if (prices.length < MIN_SALES) {
        return { province, district, status: "NOT_ENOUGH_DATA", sales: prices.length };
      }
      return { province, district, status: "OK", sales: prices.length, medianUnitCents: median(prices) };
    });

    guide.sort((a, b) => (a.province + a.district).localeCompare(b.province + b.district));
    res.json({ categoryId, minimumSales: MIN_SALES, districts: guide });
  } catch (err) {
    console.error("Price index failed:", err);
    res.status(500).json({ error: "Could not load price index" });
  }
});

module.exports = router;
