const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let vendor;
let buyer;
let collectable;
let plain;

const delivery = {
  name: "Collect Buyer",
  phone: "+263770000005",
  line1: "4 Collect Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

// Places an order and marks it paid, the way the webhook would
async function paidOrder(productId, quantity = 1) {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId, quantity } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery } });
  assert.equal(checkout.status, 201);
  const sub = checkout.data.subOrders[0];
  await h.prisma.subOrder.update({ where: { id: sub.id }, data: { status: "PAID" } });
  await h.prisma.order.update({ where: { id: checkout.data.id }, data: { status: "PAID" } });
  return sub.id;
}

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Collect Vendor", "collect.vendor@example.com", "Collect-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Collect Farm", city: "Harare" } });
  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  const goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: live.id } });
  const cats = await h.prisma.category.create({ data: { name: "Stools", slug: "stools", level: 1 } });

  const c = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Ewe, collectable", priceCents: 45000, quantity: 50, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", collectable: true },
  });
  collectable = c.data;
  const p = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Stool, not collectable", priceCents: 2000, quantity: 5, categoryId: cats.id, status: "PUBLISHED" },
  });
  plain = p.data;

  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Collect Buyer", email: "collect.buyer@example.com", password: "Collect-Buyer-2026!" },
  });
  buyer = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("collection is refused before payment", async () => {
  const sub = await paidOrder(collectable.id, 1);
  await h.prisma.subOrder.update({ where: { id: sub }, data: { status: "PENDING_PAYMENT" } });
  const res = await h.api("POST", `/collection/sub-orders/${sub}/choose`, {
    token: buyer,
    body: { preferredTime: "Saturday morning" },
  });
  assert.equal(res.status, 409);
});

test("collection is refused for products that are not collectable", async () => {
  const sub = await paidOrder(plain.id, 1);
  const res = await h.api("POST", `/collection/sub-orders/${sub}/choose`, {
    token: buyer,
    body: { preferredTime: "Saturday morning" },
  });
  assert.equal(res.status, 409);
});

test("after payment, the buyer chooses collection with a preferred time", async () => {
  const sub = await paidOrder(collectable.id, 1);
  const res = await h.api("POST", `/collection/sub-orders/${sub}/choose`, {
    token: buyer,
    body: { preferredTime: "Saturday morning" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.fulfilment, "COLLECTION");
});

test("a buyer cannot choose collection for someone else's order", async () => {
  const sub = await paidOrder(collectable.id, 1);
  const other = await h.api("POST", "/buyers/register", {
    body: { name: "Nosy", email: "nosy.collect@example.com", password: "Nosy-Collect-2026!" },
  });
  const res = await h.api("POST", `/collection/sub-orders/${sub}/choose`, {
    token: other.data.token,
    body: { preferredTime: "Sunday" },
  });
  assert.equal(res.status, 404);
});

test("the vendor sets ready and receives a code once", async () => {
  const sub = await paidOrder(collectable.id, 1);
  await h.api("POST", `/collection/sub-orders/${sub}/choose`, { token: buyer, body: { preferredTime: "Friday" } });
  const ready = await h.api("POST", `/collection/sub-orders/${sub}/ready`, { token: vendor.token });
  assert.equal(ready.status, 200);
  assert.match(ready.data.collectionCode, /^[0-9]{6}$/);

  const again = await h.api("POST", `/collection/sub-orders/${sub}/ready`, { token: vendor.token });
  assert.equal(again.status, 409);

  const stored = await h.prisma.subOrder.findUnique({ where: { id: sub } });
  assert.notEqual(stored.collectionCode, ready.data.collectionCode);
});

test("a wrong code is refused and the order stays open", async () => {
  const sub = await paidOrder(collectable.id, 1);
  await h.api("POST", `/collection/sub-orders/${sub}/choose`, { token: buyer, body: { preferredTime: "Friday" } });
  await h.api("POST", `/collection/sub-orders/${sub}/ready`, { token: vendor.token });
  const res = await h.api("POST", `/collection/sub-orders/${sub}/handover`, { token: vendor.token, body: { code: "000000" } });
  assert.equal(res.status, 400);
  const stored = await h.prisma.subOrder.findUnique({ where: { id: sub } });
  assert.equal(stored.status, "PAID");
});

test("the correct code completes the handover", async () => {
  const sub = await paidOrder(collectable.id, 1);
  await h.api("POST", `/collection/sub-orders/${sub}/choose`, { token: buyer, body: { preferredTime: "Friday" } });
  const ready = await h.api("POST", `/collection/sub-orders/${sub}/ready`, { token: vendor.token });
  const done = await h.api("POST", `/collection/sub-orders/${sub}/handover`, {
    token: vendor.token,
    body: { code: ready.data.collectionCode },
  });
  assert.equal(done.status, 200);
  assert.equal(done.data.status, "FULFILLED");
});

test("handover cannot be done twice", async () => {
  const sub = await paidOrder(collectable.id, 1);
  await h.api("POST", `/collection/sub-orders/${sub}/choose`, { token: buyer, body: { preferredTime: "Friday" } });
  const ready = await h.api("POST", `/collection/sub-orders/${sub}/ready`, { token: vendor.token });
  await h.api("POST", `/collection/sub-orders/${sub}/handover`, { token: vendor.token, body: { code: ready.data.collectionCode } });
  const again = await h.api("POST", `/collection/sub-orders/${sub}/handover`, { token: vendor.token, body: { code: ready.data.collectionCode } });
  assert.equal(again.status, 409);
});

