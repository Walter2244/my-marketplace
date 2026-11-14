const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { publicStock } = require("../lib/stock");

const router = express.Router();
const prisma = new PrismaClient();

const SORTS = {
  relevance: null,
  newest: 'p."createdAt" DESC',
  price_asc: 'p."priceCents" ASC',
  price_desc: 'p."priceCents" DESC',
};

function parseWholeNumber(value) {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

// Searches published products by title and description, with optional filters.
// The search text is built in the query, so no extra column or index is needed yet.
router.get("/", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const sort = req.query.sort || "relevance";
    if (!(sort in SORTS)) {
      return res.status(400).json({ error: "sort must be relevance, newest, price_asc or price_desc" });
    }

    const categoryId = parseWholeNumber(req.query.categoryId);
    const minPrice = parseWholeNumber(req.query.minPriceCents);
    const maxPrice = parseWholeNumber(req.query.maxPriceCents);
    if ([categoryId, minPrice, maxPrice].some((v) => Number.isNaN(v))) {
      return res.status(400).json({ error: "categoryId, minPriceCents and maxPriceCents must be whole numbers" });
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      return res.status(400).json({ error: "minPriceCents cannot be more than maxPriceCents" });
    }

    const take = Math.min(parseWholeNumber(req.query.limit) || 20, 100);
    const skip = parseWholeNumber(req.query.skip) || 0;

    const conditions = [`p."status" = 'PUBLISHED'`];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };

    if (q) {
      add(
        `to_tsvector('english', coalesce(p."title", '') || ' ' || coalesce(p."description", '')) @@ plainto_tsquery('english', ?)`,
        q
      );
    }
    if (categoryId !== null) add(`p."categoryId" = ?`, categoryId);
    if (minPrice !== null) add(`p."priceCents" >= ?`, minPrice);
    if (maxPrice !== null) add(`p."priceCents" <= ?`, maxPrice);
    if (req.query.inStock === "true") conditions.push(`p."quantity" > 0`);
    if (req.query.province) add(`p."province" = ?`, String(req.query.province));
    if (req.query.district) add(`p."district" = ?`, String(req.query.district));

    let order = SORTS[sort];
    if (sort === "relevance") {
      order = q
        ? `ts_rank(to_tsvector('english', coalesce(p."title", '') || ' ' || coalesce(p."description", '')), plainto_tsquery('english', $1)) DESC, p."createdAt" DESC`
        : `p."createdAt" DESC`;
    }

    params.push(take, skip);
    const sql = `
      SELECT p."id"
      FROM "Product" p
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${order}
      LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const idRows = await prisma.$queryRawUnsafe(sql, ...params);
    const ids = idRows.map((row) => row.id);

    // Load the full products in the same order as the search ranked them
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        vendor: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, slug: true, level: true } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    res.json(ids.map((id) => publicStock(byId.get(id))));
  } catch (err) {
    console.error("Search failed:", err);
    res.status(500).json({ error: "Could not search products" });
  }
});

module.exports = router;

