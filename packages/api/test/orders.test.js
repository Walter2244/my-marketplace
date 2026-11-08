const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken, address } = require("./fixtures");

let buyer;
let product;
let vendor;

async function stockOf(id) {
  return (await h.prisma.product.findUnique({ where: { id } })).quantity;
}

async function addAndCheckout(token, productId, quantity) {
  await h.api("POST", "/cart/items", { token, body: { productId, quantity } });
  return h.api("POST", "/orders/checkout", { token, body: { delivery: address } });
}

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Order Vendor", "order.vendor@example.com", "Order-Vendor-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Order Shop", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Order Goods", slug: "order-goods", level: 1 } });
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Order lamp", priceCents: 3000, quantity: 5, status: "PUBLISHED", categoryId: category.id },
  });
  product = created.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Order Buyer", email: "order.buyer@example.com", password: "Order-Buyer-2026!" },
  });
  buyer = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("checkout turns the cart into an order, reserves stock and empties the cart", async () => {
  const res = await addAndCheckout(buyer, product.id, 2);
  assert.equal(res.status, 201);
  assert.equal(res.data.status, "PENDING_PAYMENT");
  assert.equal(res.data.totalCents, 6000);
  assert.equal(await stockOf(product.id), 3);
  const cart = await h.api("GET", "/cart", { token: buyer });
  assert.equal(cart.data.items.length, 0);
});

test("checkout with an empty cart is refused", async () => {
  const res = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery: address } });
  assert.equal(res.status, 400);
});

test("an order holds the sub-order for its vendor", async () => {
  const res = await h.api("GET", "/orders", { token: buyer });
  assert.equal(res.data[0].subOrders.length, 1);
  assert.equal(res.data[0].subOrders[0].vendor.id, vendor.id);
});

test("a buyer cannot read another buyer's order", async () => {
  const orders = await h.api("GET", "/orders", { token: buyer });
  const other = await h.api("POST", "/buyers/register", {
    body: { name: "Snoop", email: "snoop.order@example.com", password: "Snoop-Order-2026!" },
  });
  const res = await h.api("GET", `/orders/${orders.data[0].id}`, { token: other.data.token });
  assert.equal(res.status, 404);
});

test("cancelling returns the reserved stock, and a second cancel is refused", async () => {
  const before = await stockOf(product.id);
  const orders = await h.api("GET", "/orders", { token: buyer });
  const orderId = orders.data[0].id;

  const cancelled = await h.api("POST", `/orders/${orderId}/cancel`, { token: buyer });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, "CANCELLED");
  assert.equal(await stockOf(product.id), before + 2);

  const again = await h.api("POST", `/orders/${orderId}/cancel`, { token: buyer });
  assert.equal(again.status, 409);
  assert.equal(await stockOf(product.id), before + 2);
});

test("checkout refuses a cart that asks for more than is in stock", async () => {
  const available = await stockOf(product.id);
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 1 } });
  await h.prisma.product.update({ where: { id: product.id }, data: { quantity: 0 } });
  const res = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery: address } });
  assert.equal(res.status, 409);
  await h.prisma.product.update({ where: { id: product.id }, data: { quantity: available } });
});

test("expiry releases the stock of an unpaid order past its deadline", async () => {
  const before = await stockOf(product.id);
  const res = await addAndCheckout(buyer, product.id, 1);
  assert.equal(res.status, 201);
  await h.prisma.order.update({
    where: { id: res.data.id },
    data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
  });

  const admin = await adminToken("admin.orders@example.com", "Admin-Orders-2026!");
  const run = await h.api("POST", "/auth/expire-orders", { token: admin });
  assert.equal(run.status, 200);
  assert.equal(run.data.expired, 1);
  assert.equal(await stockOf(product.id), before);

  const order = await h.prisma.order.findUnique({ where: { id: res.data.id } });
  assert.equal(order.status, "EXPIRED");
});

test("expiry leaves orders that are not yet due", async () => {
  const res = await addAndCheckout(buyer, product.id, 1);
  const admin = await adminToken("admin.orders2@example.com", "Admin-Orders2-2026!");
  const run = await h.api("POST", "/auth/expire-orders", { token: admin });
  assert.equal(run.data.expired, 0);
  const order = await h.prisma.order.findUnique({ where: { id: res.data.id } });
  assert.equal(order.status, "PENDING_PAYMENT");
});


