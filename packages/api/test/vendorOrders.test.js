const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, address } = require("./fixtures");

let vendorA;
let vendorB;
let buyer;
let orderId;
let subA;
let subB;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendorA = await createVendor("Shop A", "shop.a@example.com", "Shop-A-2026!");
  vendorB = await createVendor("Shop B", "shop.b@example.com", "Shop-B-2026!");
  await h.api("POST", "/stores", { token: vendorA.token, body: { name: "A", city: "Harare" } });
  await h.api("POST", "/stores", { token: vendorB.token, body: { name: "B", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Mixed", slug: "mixed", level: 1 } });
  const pa = await h.api("POST", "/products", {
    token: vendorA.token,
    body: { title: "A item", priceCents: 1000, quantity: 5, status: "PUBLISHED", categoryId: category.id },
  });
  const pb = await h.api("POST", "/products", {
    token: vendorB.token,
    body: { title: "B item", priceCents: 2000, quantity: 5, status: "PUBLISHED", categoryId: category.id },
  });
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Mixed Buyer", email: "mixed.buyer@example.com", password: "Mixed-Buyer-2026!" },
  });
  buyer = reg.data.token;
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: pa.data.id, quantity: 1 } });
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: pb.data.id, quantity: 1 } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery: address } });
  orderId = checkout.data.id;
  subA = checkout.data.subOrders.find((s) => s.vendor.id === vendorA.id).id;
  subB = checkout.data.subOrders.find((s) => s.vendor.id === vendorB.id).id;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a vendor sees only their own sub-orders", async () => {
  const res = await h.api("GET", "/vendor-orders", { token: vendorA.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].id, subA);
});

test("a vendor's order view does not include the buyer's details", async () => {
  const res = await h.api("GET", "/vendor-orders", { token: vendorA.token });
  const text = JSON.stringify(res.data);
  assert.ok(!text.includes("mixed.buyer@example.com"));
  assert.ok(!text.includes("Mixed Buyer"));
});

test("a vendor cannot open another vendor's sub-order", async () => {
  const res = await h.api("GET", `/vendor-orders/${subB}`, { token: vendorA.token });
  assert.equal(res.status, 404);
});

test("shipping is refused until the order is paid", async () => {
  const res = await h.api("POST", `/vendor-orders/${subA}/ship`, { token: vendorA.token });
  assert.equal(res.status, 409);
});

test("a vendor cannot ship another vendor's order", async () => {
  await h.prisma.subOrder.update({ where: { id: subB }, data: { status: "PAID" } });
  const res = await h.api("POST", `/vendor-orders/${subB}/ship`, { token: vendorA.token });
  assert.equal(res.status, 404);
});

test("a paid order ships once, and then the buyer cannot cancel the order", async () => {
  await h.prisma.subOrder.update({ where: { id: subA }, data: { status: "PAID" } });
  const shipped = await h.api("POST", `/vendor-orders/${subA}/ship`, { token: vendorA.token });
  assert.equal(shipped.status, 200);
  assert.equal(shipped.data.status, "FULFILLED");

  const again = await h.api("POST", `/vendor-orders/${subA}/ship`, { token: vendorA.token });
  assert.equal(again.status, 409);

  const cancel = await h.api("POST", `/orders/${orderId}/cancel`, { token: buyer });
  assert.equal(cancel.status, 409);
});

