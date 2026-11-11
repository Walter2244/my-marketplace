const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let vendor;
let otherVendor;
let admin;
let paidSub;
let unpaidSub;

const delivery = {
  name: "Payout Buyer",
  phone: "+263770000002",
  line1: "7 Payout Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

// Places an order for one product and marks its sub-order as paid, the way the webhook would
async function paidSubOrder(buyerToken, productId, quantity) {
  await h.api("POST", "/cart/items", { token: buyerToken, body: { productId, quantity } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyerToken, body: { delivery } });
  assert.equal(checkout.status, 201);
  const sub = checkout.data.subOrders[0];
  await h.prisma.subOrder.update({
    where: { id: sub.id },
    data: { status: "PAID", commissionCents: 100, vendorShareCents: 900, payoutStatus: "UNPAID" },
  });
  await h.prisma.order.update({ where: { id: checkout.data.id }, data: { status: "PAID" } });
  return sub.id;
}

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Payout Vendor", "payout.vendor@example.com", "Payout-Vendor-2026!");
  otherVendor = await createVendor("Other Payout", "other.payout@example.com", "Other-Payout-2026!");
  admin = await adminToken("admin.payouts@example.com", "Admin-Payouts-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Payout Shop", city: "Harare" } });
  await h.api("POST", "/stores", { token: otherVendor.token, body: { name: "Other Shop", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Payouts", slug: "payouts", level: 1 } });
  const mine = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Payout item", priceCents: 1000, quantity: 50, status: "PUBLISHED", categoryId: category.id },
  });
  const theirs = await h.api("POST", "/products", {
    token: otherVendor.token,
    body: { title: "Other item", priceCents: 1000, quantity: 50, status: "PUBLISHED", categoryId: category.id },
  });
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Payout Buyer", email: "payout.buyer@example.com", password: "Payout-Buyer-2026!" },
  });
  const buyer = reg.data.token;
  paidSub = await paidSubOrder(buyer, mine.data.id, 2);
  unpaidSub = await paidSubOrder(buyer, theirs.data.id, 1);
  await h.prisma.subOrder.update({ where: { id: unpaidSub }, data: { status: "PENDING_PAYMENT" } });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a vendor sees what they are owed, from paid sub-orders only", async () => {
  const res = await h.api("GET", "/payouts/me", { token: vendor.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.owedCents, 900);
  assert.equal(res.data.subOrders.length, 1);
  assert.equal(res.data.subOrders[0].id, paidSub);
});

test("the payout position needs a vendor token", async () => {
  const none = await h.api("GET", "/payouts/me");
  assert.equal(none.status, 401);
  const wrongRole = await h.api("GET", "/payouts/me", { token: admin });
  assert.equal(wrongRole.status, 403);
});

test("the admin owed list groups amounts by vendor", async () => {
  const res = await h.api("GET", "/payouts/owed", { token: admin });
  assert.equal(res.status, 200);
  const mine = res.data.find((row) => row.vendorId === vendor.id);
  assert.equal(mine.owedCents, 900);
  assert.equal(mine.currency, "USD");
  assert.ok(!res.data.some((row) => row.vendorId === otherVendor.id));
});

test("a vendor cannot record a payout", async () => {
  const res = await h.api("POST", `/payouts/sub-orders/${paidSub}/paid-out`, {
    token: vendor.token,
    body: { reference: "EcoCash-123" },
  });
  assert.equal(res.status, 403);
});

test("a payout needs a reference", async () => {
  const res = await h.api("POST", `/payouts/sub-orders/${paidSub}/paid-out`, { token: admin, body: {} });
  assert.equal(res.status, 400);
});

test("a sub-order that is not paid cannot be paid out", async () => {
  const res = await h.api("POST", `/payouts/sub-orders/${unpaidSub}/paid-out`, {
    token: admin,
    body: { reference: "Bank-999" },
  });
  assert.equal(res.status, 409);
});

test("recording a payout marks it paid out with its reference, once only", async () => {
  const res = await h.api("POST", `/payouts/sub-orders/${paidSub}/paid-out`, {
    token: admin,
    body: { reference: "EcoCash-REF-001" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.payoutStatus, "PAID_OUT");
  assert.equal(res.data.payoutReference, "EcoCash-REF-001");

  const again = await h.api("POST", `/payouts/sub-orders/${paidSub}/paid-out`, {
    token: admin,
    body: { reference: "EcoCash-REF-002" },
  });
  assert.equal(again.status, 409);
});

test("once paid out, the amount no longer appears as owed", async () => {
  const mine = await h.api("GET", "/payouts/me", { token: vendor.token });
  assert.equal(mine.data.owedCents, 0);
  const owed = await h.api("GET", "/payouts/owed", { token: admin });
  assert.ok(!owed.data.some((row) => row.vendorId === vendor.id));
});
