const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let buyer;
let product;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  const vendor = await createVendor("Cart Vendor", "cart.vendor@example.com", "Cart-Vendor-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Cart Shop", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Cart Goods", slug: "cart-goods", level: 1 } });
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Cart kettle", priceCents: 1500, quantity: 4, status: "PUBLISHED", categoryId: category.id },
  });
  product = created.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Cart Buyer", email: "cart.buyer@example.com", password: "Cart-Buyer-2026!" },
  });
  buyer = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a new buyer has an empty cart", async () => {
  const res = await h.api("GET", "/cart", { token: buyer });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.items, []);
  assert.equal(res.data.totalCents, 0);
});

test("the cart needs a buyer token", async () => {
  const res = await h.api("GET", "/cart");
  assert.equal(res.status, 401);
});

test("adding a product gives the right total", async () => {
  const res = await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 2 } });
  assert.equal(res.status, 201);
  assert.equal(res.data.totalCents, 3000);
  assert.equal(res.data.allAvailable, true);
});

test("adding the same product again adds to the quantity", async () => {
  const res = await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 1 } });
  assert.equal(res.data.items.length, 1);
  assert.equal(res.data.items[0].quantity, 3);
});

test("a cart line can't exceed the stock", async () => {
  const res = await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 5 } });
  assert.equal(res.status, 409);
});

test("quantities must be between 1 and 99", async () => {
  const zero = await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 0 } });
  assert.equal(zero.status, 400);
  const tooMany = await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 100 } });
  assert.equal(tooMany.status, 400);
});

test("unpublished products can't be added", async () => {
  const res = await h.api("POST", "/cart/items", { token: buyer, body: { productId: 999999, quantity: 1 } });
  assert.equal(res.status, 404);
});

test("a line can be changed and removed", async () => {
  const cart = await h.api("GET", "/cart", { token: buyer });
  const lineId = cart.data.items[0].id;

  const changed = await h.api("PATCH", `/cart/items/${lineId}`, { token: buyer, body: { quantity: 1 } });
  assert.equal(changed.data.totalCents, 1500);

  const removed = await h.api("DELETE", `/cart/items/${lineId}`, { token: buyer });
  assert.equal(removed.data.items.length, 0);
});

test("one buyer cannot change another buyer's cart line", async () => {
  const other = await h.api("POST", "/buyers/register", {
    body: { name: "Other Buyer", email: "other.cart@example.com", password: "Other-Cart-2026!" },
  });
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 1 } });
  const mine = await h.api("GET", "/cart", { token: buyer });
  const lineId = mine.data.items[0].id;

  const res = await h.api("PATCH", `/cart/items/${lineId}`, { token: other.data.token, body: { quantity: 2 } });
  assert.equal(res.status, 404);
});

