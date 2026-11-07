const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let vendor;
let kitchen;
let garden;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Search Vendor", "search.vendor@example.com", "Search-Vendor-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Search Shop", city: "Harare" } });

  kitchen = await h.prisma.category.create({ data: { name: "Kitchen", slug: "kitchen", level: 1 } });
  garden = await h.prisma.category.create({ data: { name: "Garden", slug: "garden", level: 1 } });

  const products = [
    { title: "Stainless steel pan", description: "Heavy base, dishwasher safe", priceCents: 2500, quantity: 3, categoryId: kitchen.id },
    { title: "Wooden spoon", description: "Carved from olive wood", priceCents: 600, quantity: 0, categoryId: kitchen.id },
    { title: "Garden hose", description: "Steel fittings, 20 metres", priceCents: 4500, quantity: 5, categoryId: garden.id },
  ];
  for (const p of products) {
    await h.api("POST", "/products", { token: vendor.token, body: { ...p, status: "PUBLISHED" } });
  }
  await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Steel draft", priceCents: 900, categoryId: kitchen.id },
  });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

async function titles(query) {
  const res = await h.api("GET", `/search?${query}`);
  assert.equal(res.status, 200);
  return res.data.map((p) => p.title);
}

test("a search matches words in the title and the description", async () => {
  const found = await titles("q=steel");
  assert.ok(found.includes("Stainless steel pan"));
  assert.ok(found.includes("Garden hose"));
});

test("drafts never appear in search results", async () => {
  const found = await titles("q=steel");
  assert.ok(!found.includes("Steel draft"));
});

test("the category filter limits results to that category", async () => {
  const found = await titles(`q=steel&categoryId=${garden.id}`);
  assert.deepEqual(found, ["Garden hose"]);
});

test("the price filter limits results to the range", async () => {
  const found = await titles("minPriceCents=1000&maxPriceCents=3000");
  assert.deepEqual(found, ["Stainless steel pan"]);
});

test("in stock hides products with zero quantity", async () => {
  const found = await titles("q=spoon");
  assert.deepEqual(found, ["Wooden spoon"]);
  const inStock = await titles("q=spoon&inStock=true");
  assert.deepEqual(inStock, []);
});

test("sorting by price puts the cheapest first", async () => {
  const found = await titles("sort=price_asc");
  assert.deepEqual(found, ["Wooden spoon", "Stainless steel pan", "Garden hose"]);
});

test("an unknown sort order is refused", async () => {
  const res = await h.api("GET", "/search?sort=random");
  assert.equal(res.status, 400);
});

test("a price range with the minimum above the maximum is refused", async () => {
  const res = await h.api("GET", "/search?minPriceCents=5000&maxPriceCents=1000");
  assert.equal(res.status, 400);
});

