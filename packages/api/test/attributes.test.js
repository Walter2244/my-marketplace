const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let vendor;
let goats;
let produce;
let tractors;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Attr Vendor", "attr.vendor@example.com", "Attr-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Attr Farm", city: "Harare" } });
  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: live.id } });
  const pro = await h.prisma.category.create({ data: { name: "Farm produce", slug: "farm-produce", level: 2, parentId: agri.id } });
  produce = await h.prisma.category.create({ data: { name: "Fruit", slug: "fruit", level: 3, parentId: pro.id } });
  const eq = await h.prisma.category.create({ data: { name: "Equipment", slug: "equipment", level: 2, parentId: agri.id } });
  tractors = await h.prisma.category.create({ data: { name: "Tractors", slug: "tractors", level: 3, parentId: eq.id } });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

const goatBase = { title: "Goat", priceCents: 45000, quantity: 2, unitOfSale: "PER_HEAD", status: "PUBLISHED" };

test("a livestock listing without its required breed is refused", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { ...goatBase, categoryId: goats.id, attributes: { sex: "female", ageMonths: 18 } },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "breed is required for this category");
});

test("a livestock sex must be one of the listed choices", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { ...goatBase, categoryId: goats.id, attributes: { breed: "Boer", sex: "unknown", ageMonths: 18 } },
  });
  assert.equal(res.status, 400);
});

test("a complete livestock listing is saved with its attributes", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { ...goatBase, categoryId: goats.id, attributes: { breed: "Boer", sex: "female", ageMonths: 18, weightKg: 42 } },
  });
  assert.equal(res.status, 201);
  const saved = await h.prisma.productAttribute.findMany({ where: { productId: res.data.id } });
  assert.equal(saved.length, 4);
});

test("an age in months must be a number", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { ...goatBase, categoryId: goats.id, attributes: { breed: "Boer", sex: "male", ageMonths: "eighteen" } },
  });
  assert.equal(res.status, 400);
});

test("produce needs a harvest date, which must be a real date", async () => {
  const missing = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mangoes", priceCents: 300, quantity: 9, categoryId: produce.id, attributes: {} },
  });
  assert.equal(missing.status, 400);

  const bad = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mangoes", priceCents: 300, quantity: 9, categoryId: produce.id, attributes: { harvestDate: "not a date" } },
  });
  assert.equal(bad.status, 400);

  const valid = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mangoes", priceCents: 300, quantity: 9, categoryId: produce.id, attributes: { harvestDate: "2026-11-01" } },
  });
  assert.equal(valid.status, 201);
});

test("equipment needs make, model and condition", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Tractor", priceCents: 9000000, quantity: 1, categoryId: tractors.id, attributes: { make: "Massey" } },
  });
  assert.equal(res.status, 400);
});

test("hours used applies to used equipment, and is ignored for new equipment", async () => {
  const used = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Used tractor", priceCents: 5000000, quantity: 1, categoryId: tractors.id, attributes: { make: "Massey", model: "135", condition: "used", hoursUsed: 4200 } },
  });
  assert.equal(used.status, 201);

  const brandNew = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "New tractor", priceCents: 9000000, quantity: 1, categoryId: tractors.id, attributes: { make: "Massey", model: "135", condition: "new", hoursUsed: "nonsense" } },
  });
  assert.equal(brandNew.status, 201);
});

test("updating a listing's attributes replaces the old values, and checks the rules", async () => {
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { ...goatBase, categoryId: goats.id, attributes: { breed: "Boer", sex: "female", ageMonths: 18 } },
  });
  const refused = await h.api("PATCH", `/products/${created.data.id}`, {
    token: vendor.token,
    body: { attributes: { sex: "female", ageMonths: 20 } },
  });
  assert.equal(refused.status, 400);

  const updated = await h.api("PATCH", `/products/${created.data.id}`, {
    token: vendor.token,
    body: { attributes: { breed: "Kalahari Red", sex: "male", ageMonths: 20 } },
  });
  assert.equal(updated.status, 200);
  const saved = await h.prisma.productAttribute.findMany({ where: { productId: created.data.id } });
  assert.equal(saved.find((a) => a.name === "breed").value, "Kalahari Red");
});
