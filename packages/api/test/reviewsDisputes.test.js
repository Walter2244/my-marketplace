const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let vendor;
let buyer;
let stranger;
let admin;
let fulfilledSub;
let openSub;

const delivery = {
  name: "Review Buyer",
  phone: "+263770000008",
  line1: "6 Review Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

// Places an order and returns the sub-order's id, for a given state
async function subOrderIn(status) {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 1 } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery } });
  assert.equal(checkout.status, 201);
  const sub = checkout.data.subOrders[0];
  await h.prisma.subOrder.update({ where: { id: sub.id }, data: { status } });
  return sub.id;
}

let product;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Rated Vendor", "rated.vendor@example.com", "Rated-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Rated Farm", city: "Harare" } });
  admin = await adminToken("admin.disputes@example.com", "Admin-Disputes-2026!");
  const cat = await h.prisma.category.create({ data: { name: "Rated", slug: "rated", level: 1 } });
  const p = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Rated item", priceCents: 1000, quantity: 50, status: "PUBLISHED", categoryId: cat.id },
  });
  product = p.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Review Buyer", email: "review.buyer@example.com", password: "Review-Buyer-2026!" },
  });
  buyer = reg.data.token;
  const other = await h.api("POST", "/buyers/register", {
    body: { name: "Stranger", email: "stranger.review@example.com", password: "Stranger-2026!" },
  });
  stranger = other.data.token;
  fulfilledSub = await subOrderIn("FULFILLED");
  openSub = await subOrderIn("PAID");
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a review needs a rating from 1 to 5", async () => {
  const res = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/review`, { token: buyer, body: { rating: 6 } });
  assert.equal(res.status, 400);
});

test("a review is refused before the order has been fulfilled", async () => {
  const res = await h.api("POST", `/reviews/sub-orders/${openSub}/review`, { token: buyer, body: { rating: 4 } });
  assert.equal(res.status, 409);
});

test("a buyer cannot review someone else's order", async () => {
  const res = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/review`, { token: stranger, body: { rating: 1 } });
  assert.equal(res.status, 404);
});

test("a fulfilled order can be reviewed once", async () => {
  const first = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/review`, { token: buyer, body: { rating: 5, comment: "Excellent" } });
  assert.equal(first.status, 201);
  const second = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/review`, { token: buyer, body: { rating: 1 } });
  assert.equal(second.status, 409);
});

test("the vendor's public rating reflects the reviews", async () => {
  const res = await h.api("GET", `/reviews/vendors/${vendor.id}/rating`);
  assert.equal(res.status, 200);
  assert.equal(res.data.reviewCount, 1);
  assert.equal(res.data.averageRating, 5);
});

test("a dispute is refused before the order has been fulfilled", async () => {
  const res = await h.api("POST", `/reviews/sub-orders/${openSub}/dispute`, { token: buyer, body: { reason: "Not what I ordered" } });
  assert.equal(res.status, 409);
});

test("a dispute needs a reason, and can be opened once", async () => {
  const noReason = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/dispute`, { token: buyer, body: {} });
  assert.equal(noReason.status, 400);
  const opened = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/dispute`, { token: buyer, body: { reason: "Item arrived damaged" } });
  assert.equal(opened.status, 201);
  const again = await h.api("POST", `/reviews/sub-orders/${fulfilledSub}/dispute`, { token: buyer, body: { reason: "Again" } });
  assert.equal(again.status, 409);
});

test("disputes are never shown in the public rating", async () => {
  const res = await h.api("GET", `/reviews/vendors/${vendor.id}/rating`);
  assert.equal(res.data.reviewCount, 1);
  assert.equal(JSON.stringify(res.data).includes("damaged"), false);
});

test("only an admin can decide a dispute", async () => {
  const dispute = await h.prisma.dispute.findUnique({ where: { subOrderId: fulfilledSub } });
  const res = await h.api("POST", `/reviews/disputes/${dispute.id}/decide`, {
    token: buyer,
    body: { decision: "RESOLVED_FOR_BUYER", note: "Refund agreed" },
  });
  assert.equal(res.status, 403);
});

test("a decision needs a note, and is recorded once", async () => {
  const dispute = await h.prisma.dispute.findUnique({ where: { subOrderId: fulfilledSub } });
  const noNote = await h.api("POST", `/reviews/disputes/${dispute.id}/decide`, {
    token: admin,
    body: { decision: "RESOLVED_FOR_BUYER" },
  });
  assert.equal(noNote.status, 400);

  const decided = await h.api("POST", `/reviews/disputes/${dispute.id}/decide`, {
    token: admin,
    body: { decision: "RESOLVED_FOR_BUYER", note: "Photos confirm the damage" },
  });
  assert.equal(decided.status, 200);

  const again = await h.api("POST", `/reviews/disputes/${dispute.id}/decide`, {
    token: admin,
    body: { decision: "RESOLVED_FOR_VENDOR", note: "Changing my mind" },
  });
  assert.equal(again.status, 409);
});
