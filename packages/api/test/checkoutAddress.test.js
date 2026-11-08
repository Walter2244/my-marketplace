const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let buyer;
let product;

const fullAddress = {
  name: "Ada Buyer",
  phone: "+263771234567",
  line1: "1 Second Street",
  city: "Bulawayo",
  postalCode: "00263",
  country: "Zimbabwe",
};

async function stockOf(id) {
  return (await h.prisma.product.findUnique({ where: { id } })).quantity;
}

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  const vendor = await createVendor("Address Vendor", "address.vendor@example.com", "Address-Vendor-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Address Shop", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Addressed", slug: "addressed", level: 1 } });
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Address item", priceCents: 900, quantity: 3, status: "PUBLISHED", categoryId: category.id },
  });
  product = created.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Address Buyer", email: "address.buyer@example.com", password: "Address-Buyer-2026!" },
  });
  buyer = reg.data.token;
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 1 } });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("checkout without a delivery address is refused", async () => {
  const res = await h.api("POST", "/orders/checkout", { token: buyer });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "a delivery address is required");
});

test("a refused checkout reserves no stock and keeps the cart", async () => {
  assert.equal(await stockOf(product.id), 3);
  const cart = await h.api("GET", "/cart", { token: buyer });
  assert.equal(cart.data.items.length, 1);
});

test("an address missing a required field is refused, naming the field", async () => {
  const { city, ...incomplete } = fullAddress;
  const res = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery: incomplete } });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /city/);
});

test("a complete address is saved on the order", async () => {
  const res = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery: fullAddress } });
  assert.equal(res.status, 201);
  const order = await h.prisma.order.findUnique({ where: { id: res.data.id } });
  assert.equal(order.deliveryName, "Ada Buyer");
  assert.equal(order.deliveryCity, "Bulawayo");
  assert.equal(order.deliveryCountry, "Zimbabwe");
  assert.equal(order.deliveryLine2, null);
});
