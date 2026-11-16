const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let vendor;
let produce;
let fruit;
let goats;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Update Vendor", "update.vendor@example.com", "Update-Vendor-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Update Farm", city: "Harare" } });
  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const pro = await h.prisma.category.create({ data: { name: "Farm produce", slug: "farm-produce", level: 2, parentId: agri.id } });
  fruit = await h.prisma.category.create({ data: { name: "Fruit", slug: "fruit-upd", level: 3, parentId: pro.id } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats-upd", level: 3, parentId: live.id } });
  produce = (await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mango crate", priceCents: 800, quantity: 5, categoryId: fruit.id, attributes: { harvestDate: "2026-11-01" }, status: "PUBLISHED" },
  })).data;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a product can be updated in place without changing its category", async () => {
  const res = await h.api("PATCH", `/products/${produce.id}`, { token: vendor.token, body: { priceCents: 900 } });
  assert.equal(res.status, 200);
  assert.equal(res.data.priceCents, 900);
});

test("changing a category to one that needs attributes requires those attributes", async () => {
  const res = await h.api("PATCH", `/products/${produce.id}`, { token: vendor.token, body: { categoryId: goats.id } });
  assert.notEqual(res.status, 500);
  assert.equal(res.status, 403);
});

test("a parent category cannot hold a product", async () => {
  const res = await h.api("PATCH", `/products/${produce.id}`, {
    token: vendor.token,
    body: { categoryId: (await h.prisma.category.findUnique({ where: { slug: "farm-produce" } })).id },
  });
  assert.equal(res.status, 400);
});

test("moving a product to another valid category succeeds", async () => {
  const other = await h.prisma.category.create({ data: { name: "Citrus", slug: "citrus-upd", level: 3, parentId: fruit.parentId } });
  const res = await h.api("PATCH", `/products/${produce.id}`, { token: vendor.token, body: { categoryId: other.id, attributes: { harvestDate: "2026-11-02" } } });
  assert.equal(res.status, 200);
  assert.equal(res.data.categoryId, other.id);
});

