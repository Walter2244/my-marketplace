const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

const clientPath = path.join(__dirname, "..", "..", "client", "dist", "index.js");
const { createApi, ApiError } = require(clientPath);

let api;
let vendor;
let buyerToken;
let buyerPassword = "Cart-Buyer-2026!";
let productA;
let productB;
let cartItemA;
let orderId;

const delivery = {
  name: "Cart Buyer",
  phone: "+263770000040",
  line1: "3 Cart Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  api = createApi(h.BASE);
  vendor = await createVendor("Cart Vendor", "cart.vendor@example.com", "Cart-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Cart Farm", city: "Harare" } });
  const cat = await h.prisma.category.create({ data: { name: "Cart goods", slug: "cart-goods", level: 1 } });
  productA = (await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Cart item A", priceCents: 1000, quantity: 5, status: "PUBLISHED", categoryId: cat.id },
  })).data;
  productB = (await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Cart item B", priceCents: 2500, quantity: 3, status: "PUBLISHED", categoryId: cat.id },
  })).data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Cart Buyer", email: "cart.buyer@example.com", password: buyerPassword },
  });
  buyerToken = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("client: a new buyer's cart is empty", async () => {
  const cart = await api.cart.get(buyerToken);
  assert.equal(cart.items.length, 0);
  assert.equal(cart.totalCents, 0);
  assert.equal(cart.allAvailable, false);
});

test("client: adding an item returns the whole cart, with its line total", async () => {
  const cart = await api.cart.addItem(buyerToken, productA.id, 2);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 2);
  assert.equal(cart.items[0].lineTotalCents, 2000);
  assert.equal(cart.totalCents, 2000);
  assert.equal(cart.allAvailable, true);
  cartItemA = cart.items[0].id;
});

test("client: adding the same product again adds to its quantity", async () => {
  const cart = await api.cart.addItem(buyerToken, productA.id, 1);
  assert.equal(cart.items[0].quantity, 3);
});

test("client: a quantity beyond stock is refused with ApiError 409", async () => {
  await assert.rejects(
    () => api.cart.addItem(buyerToken, productB.id, 50),
    (err) => err instanceof ApiError && err.status === 409
  );
  await assert.rejects(
    () => api.cart.addItem(buyerToken, productB.id, 100),
    (err) => err instanceof ApiError && err.status === 400
  );
});

test("client: a line's quantity can be set, and the total follows", async () => {
  const cart = await api.cart.setQuantity(buyerToken, cartItemA, 4);
  assert.equal(cart.items[0].quantity, 4);
  assert.equal(cart.totalCents, 4000);
});

test("client: a second product is added and both lines are in the cart", async () => {
  const cart = await api.cart.addItem(buyerToken, productB.id, 1);
  assert.equal(cart.items.length, 2);
  assert.equal(cart.totalCents, 4000 + 2500);
});

test("client: a line can be removed, and the cart updates", async () => {
  const before = await api.cart.get(buyerToken);
  const lineB = before.items.find((l) => l.product.id === productB.id);
  const cart = await api.cart.remove(buyerToken, lineB.id);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.totalCents, 4000);
});

test("client: checkout without an address is refused", async () => {
  await assert.rejects(
    () => api.orders.checkout(buyerToken, { delivery: { ...delivery, city: "" } }),
    (err) => err instanceof ApiError && err.status === 400
  );
});

test("client: checkout turns the cart into an order awaiting payment", async () => {
  const order = await api.orders.checkout(buyerToken, { delivery });
  orderId = order.id;
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.totalCents, 4000);
  assert.equal(order.subOrders.length, 1);
  assert.equal(order.subOrders[0].items[0].unitOfSale, "EACH");
  const cart = await api.cart.get(buyerToken);
  assert.equal(cart.items.length, 0);
});

test("client: the buyer's orders are listed and one is read back", async () => {
  const orders = await api.orders.list(buyerToken);
  assert.ok(orders.some((o) => o.id === orderId));
  const one = await api.orders.get(buyerToken, orderId);
  assert.equal(one.id, orderId);
});

test("client: an unpaid order can be cancelled, and cancelling again is refused", async () => {
  const cancelled = await api.orders.cancel(buyerToken, orderId);
  assert.equal(cancelled.status, "CANCELLED");
  await assert.rejects(
    () => api.orders.cancel(buyerToken, orderId),
    (err) => err instanceof ApiError && err.status === 409
  );
});

test("client: cart and orders need a buyer token", async () => {
  await assert.rejects(
    () => api.cart.get(""),
    (err) => err instanceof ApiError && err.status === 401
  );
});

