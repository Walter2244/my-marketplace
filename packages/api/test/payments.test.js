const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let buyer;
let otherBuyer;
let product;
let paidOrderId;

const delivery = {
  name: "Pay Buyer",
  phone: "+263770000001",
  line1: "5 Pay Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

// The same signature the provider would compute over the exact body it sends
function sign(raw) {
  return crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(raw).digest("hex");
}

async function postWebhook(payload, signature) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${h.BASE}/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-payment-signature": signature ?? sign(raw) },
    body: raw,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// Places an order for the buyer and starts its payment
async function orderWithPayment(quantity = 2) {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery } });
  assert.equal(checkout.status, 201);
  const start = await h.api("POST", `/payments/orders/${checkout.data.id}`, { token: buyer });
  assert.equal(start.status, 201);
  return {
    orderId: checkout.data.id,
    providerReference: start.data.providerReference,
    amountCents: start.data.amountCents,
  };
}

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  const vendor = await createVendor("Pay Vendor", "pay.vendor@example.com", "Pay-Vendor-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Pay Shop", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Paid", slug: "paid", level: 1 } });
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Paid item", priceCents: 1000, quantity: 20, status: "PUBLISHED", categoryId: category.id },
  });
  product = created.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Pay Buyer", email: "pay.buyer@example.com", password: "Pay-Buyer-2026!" },
  });
  buyer = reg.data.token;
  const other = await h.api("POST", "/buyers/register", {
    body: { name: "Other Pay", email: "other.pay@example.com", password: "Other-Pay-2026!" },
  });
  otherBuyer = other.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("the webhook refuses a request with a bad signature", async () => {
  const res = await postWebhook({ providerReference: "x", status: "SUCCEEDED", amountCents: 1 }, "bad");
  assert.equal(res.status, 401);
});

test("a valid success marks the order paid and records commission and vendor share", async () => {
  const p = await orderWithPayment(2);
  paidOrderId = p.orderId;
  const res = await postWebhook({ providerReference: p.providerReference, status: "SUCCEEDED", amountCents: p.amountCents });
  assert.equal(res.status, 200);
  assert.equal(res.data.paymentStatus, "SUCCEEDED");
  const order = await h.prisma.order.findUnique({ where: { id: p.orderId }, include: { subOrders: true } });
  assert.equal(order.status, "PAID");
  assert.equal(order.subOrders[0].status, "PAID");
  assert.equal(order.subOrders[0].commissionCents, 200);
  assert.equal(order.subOrders[0].vendorShareCents, 1800);
});

test("a repeated success callback changes nothing", async () => {
  const p = await orderWithPayment(1);
  const payload = { providerReference: p.providerReference, status: "SUCCEEDED", amountCents: p.amountCents };
  await postWebhook(payload);
  const again = await postWebhook(payload);
  assert.equal(again.status, 200);
  assert.equal(again.data.ignored, true);
  const sub = await h.prisma.subOrder.findFirst({ where: { orderId: p.orderId } });
  assert.equal(sub.commissionCents, 100);
});

test("a callback with the wrong amount is refused and the payment stays pending", async () => {
  const p = await orderWithPayment(1);
  const res = await postWebhook({ providerReference: p.providerReference, status: "SUCCEEDED", amountCents: 1 });
  assert.equal(res.status, 400);
  const payment = await h.prisma.payment.findUnique({ where: { providerReference: p.providerReference } });
  assert.equal(payment.status, "PENDING");
});

test("a failed payment leaves the order unpaid", async () => {
  const p = await orderWithPayment(1);
  const res = await postWebhook({ providerReference: p.providerReference, status: "FAILED", amountCents: p.amountCents });
  assert.equal(res.status, 200);
  const payment = await h.prisma.payment.findUnique({ where: { providerReference: p.providerReference } });
  assert.equal(payment.status, "FAILED");
  const order = await h.prisma.order.findUnique({ where: { id: p.orderId } });
  assert.equal(order.status, "PENDING_PAYMENT");
});

test("a payment that arrives after the order was cancelled needs a refund", async () => {
  const p = await orderWithPayment(1);
  const cancel = await h.api("POST", `/orders/${p.orderId}/cancel`, { token: buyer });
  assert.equal(cancel.status, 200);
  const res = await postWebhook({ providerReference: p.providerReference, status: "SUCCEEDED", amountCents: p.amountCents });
  assert.equal(res.data.orderOutcome, "NEEDS_REFUND");
  const payment = await h.prisma.payment.findUnique({ where: { providerReference: p.providerReference } });
  assert.equal(payment.status, "NEEDS_REFUND");
  const order = await h.prisma.order.findUnique({ where: { id: p.orderId } });
  assert.equal(order.status, "CANCELLED");
});

test("only the buyer who placed the order can start its payment", async () => {
  const p = await orderWithPayment(1);
  const res = await h.api("POST", `/payments/orders/${p.orderId}`, { token: otherBuyer });
  assert.equal(res.status, 404);
});

test("an order that is already paid cannot start another payment", async () => {
  const res = await h.api("POST", `/payments/orders/${paidOrderId}`, { token: buyer });
  assert.equal(res.status, 409);
});
