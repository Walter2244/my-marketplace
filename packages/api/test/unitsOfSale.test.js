const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let vendor;
let buyer;
let livestock;
let produce;
let goats;

const delivery = {
  name: "Unit Buyer",
  phone: "+263770000004",
  line1: "9 Unit Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Unit Vendor", "unit.vendor@example.com", "Unit-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Unit Shop", city: "Harare" } });

  const admin = await h.prisma.admin.create({
    data: { email: "admin.units@example.com", password: "not-used-here" },
  });
  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  livestock = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: livestock.id } });
  produce = await h.prisma.category.create({ data: { name: "Fruit", slug: "fruit", level: 2, parentId: agri.id } });

  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Unit Buyer", email: "unit.buyer@example.com", password: "Unit-Buyer-2026!" },
  });
  buyer = reg.data.token;
  void admin;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("per-head pricing is accepted under Livestock", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat, ewe", priceCents: 45000, quantity: 3, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.unitOfSale, "PER_HEAD");
});

test("per-head pricing is refused outside Livestock", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mango crate", priceCents: 800, quantity: 5, unitOfSale: "PER_HEAD", categoryId: produce.id },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "per-head pricing is only allowed for livestock categories");
});

test("per-head pricing needs a category", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Loose goat", priceCents: 45000, quantity: 1, unitOfSale: "PER_HEAD" },
  });
  assert.equal(res.status, 400);
});

test("an unknown unit is refused", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mystery", priceCents: 100, quantity: 1, unitOfSale: "BUCKET", categoryId: produce.id },
  });
  assert.equal(res.status, 400);
});

test("the cart and the order keep the unit, and the total is per head", async () => {
  const goat = await h.prisma.product.findFirst({ where: { title: "Goat, ewe" } });
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: goat.id, quantity: 2 } });
  const cart = await h.api("GET", "/cart", { token: buyer });
  assert.equal(cart.data.items[0].product.unitOfSale, "PER_HEAD");
  assert.equal(cart.data.totalCents, 90000);

  const checkout = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery } });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.data.totalCents, 90000);

  const order = await h.prisma.orderItem.findFirst({ where: { subOrder: { orderId: checkout.data.id } } });
  assert.equal(order.unitOfSale, "PER_HEAD");
  assert.equal(order.quantity, 2);
});

test("changing a listing to per-head outside Livestock is refused", async () => {
  const mango = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mango", priceCents: 300, quantity: 9, categoryId: produce.id, status: "PUBLISHED" },
  });
  const res = await h.api("PATCH", `/products/${mango.data.id}`, {
    token: vendor.token,
    body: { unitOfSale: "PER_HEAD" },
  });
  assert.equal(res.status, 400);
});

