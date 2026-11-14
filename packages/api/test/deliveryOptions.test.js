const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, address } = require("./fixtures");

let vendor;
let buyer;
let pan;
let goat;

const delivery = {
  name: "Delivery Buyer",
  phone: "+263770000007",
  line1: "8 Delivery Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Delivery Vendor", "delivery.vendor@example.com", "Delivery-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Delivery Farm", city: "Harare" } });
  const cat = await h.prisma.category.create({ data: { name: "Tools", slug: "tools", level: 1 } });
  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  const goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: live.id } });

  const p = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Spade", priceCents: 2500, quantity: 9, categoryId: cat.id, status: "PUBLISHED" },
  });
  pan = p.data;
  await h.api("PUT", `/products/${pan.id}/delivery-options`, {
    token: vendor.token,
    body: { options: [{ kind: "COLLECTION" }, { kind: "FLAT_FEE", feeCents: 500 }] },
  });

  const g = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat", priceCents: 45000, quantity: 3, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", attributes: { breed: "Boer", sex: "female", ageMonths: 18 } },
  });
  goat = g.data;

  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Delivery Buyer", email: "delivery.buyer@example.com", password: "Delivery-Buyer-2026!" },
  });
  buyer = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("the vendor's delivery options are saved, and each kind appears once", async () => {
  const dup = await h.api("PUT", `/products/${pan.id}/delivery-options`, {
    token: vendor.token,
    body: { options: [{ kind: "COLLECTION" }, { kind: "COLLECTION" }] },
  });
  assert.equal(dup.status, 400);
});

test("a flat fee is added to the order total", async () => {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: pan.id, quantity: 1 } });
  const res = await h.api("POST", "/orders/checkout", {
    token: buyer,
    body: { delivery, deliveryChoices: { [String(vendor.id)]: { method: "FLAT_FEE" } } },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.totalCents, 3000);
  const sub = await h.prisma.subOrder.findFirst({ where: { orderId: res.data.id } });
  assert.equal(sub.deliveryMethod, "FLAT_FEE");
  assert.equal(sub.deliveryFeeCents, 500);
});

test("a method the vendor does not offer is refused", async () => {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: pan.id, quantity: 1 } });
  const res = await h.api("POST", "/orders/checkout", {
    token: buyer,
    body: { delivery, deliveryChoices: { [String(vendor.id)]: { method: "QUOTE" } } },
  });
  assert.equal(res.status, 400);
});

test("a vendor's delivery choice is required, and the offered options are listed", async () => {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: pan.id, quantity: 1 } });
  const res = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.data.offered.sort(), ["COLLECTION", "FLAT_FEE"]);
});

test("a livestock listing cannot offer a flat fee", async () => {
  const res = await h.api("PUT", `/products/${goat.id}/delivery-options`, {
    token: vendor.token,
    body: { options: [{ kind: "FLAT_FEE", feeCents: 1000 }] },
  });
  assert.equal(res.status, 400);
});

test("a livestock listing can offer a quote", async () => {
  const res = await h.api("PUT", `/products/${goat.id}/delivery-options`, {
    token: vendor.token,
    body: { options: [{ kind: "QUOTE" }, { kind: "COLLECTION" }] },
  });
  assert.equal(res.status, 200);
});

test("buyers see a published listing's delivery options", async () => {
  const res = await h.api("GET", `/products/${pan.id}/delivery-options`);
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 2);
});
