const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let category;
let vendor;

// Creates a product in a district, and a fulfilled sale of it at the given unit price
async function fulfilledSale(title, priceCents, province, district) {
  const product = await h.prisma.product.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title,
      priceCents,
      quantity: 10,
      status: "PUBLISHED",
      province,
      district,
    },
  });
  const order = await h.prisma.order.create({
    data: {
      userId: buyerId,
      status: "FULFILLED",
      totalCents: priceCents,
      deliveryName: "Price Buyer",
      deliveryPhone: "+263770000011",
      deliveryLine1: "1 Price Road",
      deliveryCity: "Harare",
      deliveryPostalCode: "00000",
      deliveryCountry: "Zimbabwe",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const sub = await h.prisma.subOrder.create({
    data: { orderId: order.id, vendorId: vendor.id, status: "FULFILLED", totalCents: priceCents },
  });
  await h.prisma.orderItem.create({
    data: { orderId: order.id, subOrderId: sub.id, productId: product.id, quantity: 1, unitCents: priceCents, unitOfSale: "EACH" },
  });
}

let buyerId;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Index Vendor", "index.vendor@example.com", "Index-Vendor-2026!");
  category = await h.prisma.category.create({ data: { name: "Goats", slug: "goats-index", level: 1 } });
  const buyer = await h.prisma.user.create({
    data: { name: "Price Buyer", email: "price.buyer@example.com", password: "not-used" },
  });
  buyerId = buyer.id;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a district with fewer than 5 completed sales shows not enough data", async () => {
  for (const p of [40000, 42000, 44000]) await fulfilledSale("Goat", p, "Mashonaland East", "Marondera");
  const res = await h.api("GET", `/price-index?categoryId=${category.id}`);
  const d = res.data.districts.find((x) => x.district === "Marondera");
  assert.equal(d.status, "NOT_ENOUGH_DATA");
  assert.equal(d.sales, 3);
  assert.equal(d.medianUnitCents, undefined);
});

test("with 5 or more completed sales, the median is shown", async () => {
  for (const p of [46000, 48000]) await fulfilledSale("Goat", p, "Mashonaland East", "Marondera");
  const res = await h.api("GET", `/price-index?categoryId=${category.id}`);
  const d = res.data.districts.find((x) => x.district === "Marondera");
  assert.equal(d.status, "OK");
  assert.equal(d.sales, 5);
  assert.equal(d.medianUnitCents, 44000);
});

test("one extreme sale does not distort the middle price", async () => {
  await fulfilledSale("Goat", 900000, "Mashonaland East", "Marondera");
  const res = await h.api("GET", `/price-index?categoryId=${category.id}`);
  const d = res.data.districts.find((x) => x.district === "Marondera");
  assert.equal(d.status, "OK");
  assert.equal(d.medianUnitCents, 45000);
});

test("sales that are not yet fulfilled are not counted", async () => {
  const product = await h.prisma.product.create({
    data: { vendorId: vendor.id, categoryId: category.id, title: "Pending goat", priceCents: 1, quantity: 1, status: "PUBLISHED", province: "Harare", district: "Harare" },
  });
  const order = await h.prisma.order.create({
    data: {
      userId: buyerId, status: "PENDING_PAYMENT", totalCents: 1,
      deliveryName: "x", deliveryPhone: "x", deliveryLine1: "x", deliveryCity: "x", deliveryPostalCode: "x", deliveryCountry: "x",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const sub = await h.prisma.subOrder.create({ data: { orderId: order.id, vendorId: vendor.id, status: "PENDING_PAYMENT", totalCents: 1 } });
  await h.prisma.orderItem.create({
    data: { orderId: order.id, subOrderId: sub.id, productId: product.id, quantity: 1, unitCents: 1, unitOfSale: "EACH" },
  });
  const res = await h.api("GET", `/price-index?categoryId=${category.id}`);
  assert.equal(res.data.districts.find((x) => x.district === "Harare"), undefined);
});

test("districts are kept apart, so one district's sales do not price another", async () => {
  for (const p of [9000, 9500, 10000, 10500, 11000]) await fulfilledSale("Goat", p, "Matabeleland South", "Gwanda");
  const res = await h.api("GET", `/price-index?categoryId=${category.id}`);
  const gwanda = res.data.districts.find((x) => x.district === "Gwanda");
  const marondera = res.data.districts.find((x) => x.district === "Marondera");
  assert.equal(gwanda.medianUnitCents, 10000);
  assert.equal(marondera.medianUnitCents, 45000);
});

test("a category id is required", async () => {
  const res = await h.api("GET", "/price-index");
  assert.equal(res.status, 400);
});

