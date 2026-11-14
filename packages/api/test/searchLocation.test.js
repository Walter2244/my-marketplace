const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  const vendor = await createVendor("Search Location", "search.location@example.com", "Search-Location-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Location Search", city: "Harare" } });
  const admin = await adminToken("admin.searchloc@example.com", "Admin-SearchLoc-2026!");
  await h.api("POST", "/districts", { token: admin, body: { name: "Marondera", province: "Mashonaland East" } });
  await h.api("POST", "/districts", { token: admin, body: { name: "Bindura", province: "Mashonaland Central" } });
  const cat = await h.prisma.category.create({ data: { name: "Produce", slug: "produce", level: 1 } });

  const listings = [
    { title: "Maize sacks", priceCents: 800, province: "Mashonaland East", district: "Marondera" },
    { title: "Maize seed", priceCents: 1200, province: "Mashonaland Central", district: "Bindura" },
    { title: "Maize flour", priceCents: 500, province: "Mashonaland East", district: "Marondera", quantity: 0 },
  ];
  for (const l of listings) {
    await h.api("POST", "/products", {
      token: vendor.token,
      body: { quantity: 5, categoryId: cat.id, status: "PUBLISHED", ...l },
    });
  }
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

async function titles(query) {
  const res = await h.api("GET", `/search?${query}`);
  assert.equal(res.status, 200);
  return res.data.map((p) => p.title).sort();
}

test("with no location given, search finds listings from every province", async () => {
  assert.deepEqual(await titles("q=maize"), ["Maize flour", "Maize sacks", "Maize seed"]);
});

test("a province narrows results to that province", async () => {
  assert.deepEqual(await titles("q=maize&province=Mashonaland%20Central"), ["Maize seed"]);
});

test("a district narrows results to that district", async () => {
  assert.deepEqual(await titles("q=maize&district=Marondera&inStock=true"), ["Maize sacks"]);
});

test("a province and a district together narrow to both", async () => {
  assert.deepEqual(await titles("province=Mashonaland%20East&district=Marondera&inStock=true"), ["Maize sacks"]);
});

test("a district that is not in the province returns nothing", async () => {
  assert.deepEqual(await titles("province=Mashonaland%20Central&district=Marondera"), []);
});

test("an unknown province returns nothing, without an error", async () => {
  assert.deepEqual(await titles("province=Atlantis"), []);
});



