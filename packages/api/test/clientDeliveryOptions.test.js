const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

const clientPath = path.join(__dirname, "..", "..", "client", "dist", "index.js");
const { createApi, ApiError } = require(clientPath);

let api;
let vendorToken;
let publishedId;
let draftId;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  api = createApi(h.BASE);
  const vendor = await createVendor("Delivery Vendor", "delivery.vendor@example.com", "Delivery-Vendor-2026!");
  vendorToken = vendor.token;
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendorToken, body: { name: "Delivery Farm", city: "Harare" } });
  const cat = await h.prisma.category.create({ data: { name: "Delivery goods", slug: "delivery-goods", level: 1 } });
  const published = await h.api("POST", "/products", {
    token: vendorToken,
    body: { title: "Delivery item", priceCents: 1000, quantity: 5, status: "PUBLISHED", categoryId: cat.id },
  });
  publishedId = published.data.id;
  assert.ok(publishedId, "published product was not created");
  const draft = await h.api("POST", "/products", {
    token: vendorToken,
    body: { title: "Draft item", priceCents: 1000, quantity: 5, status: "DRAFT", categoryId: cat.id },
  });
  draftId = draft.data.id;
  assert.ok(draftId, "draft product was not created");
  const set = await h.api("PUT", `/products/${publishedId}/delivery-options`, {
    token: vendorToken,
    body: { options: [{ kind: "COLLECTION" }, { kind: "FLAT_FEE", feeCents: 500, note: "Harare only" }] },
  });
  assert.equal(set.status, 200);
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("client: a published listing returns its delivery options", async () => {
  const options = await api.catalogue.products.deliveryOptions(publishedId);
  assert.equal(options.length, 2);
  assert.ok(options.some((o) => o.kind === "COLLECTION"));
  const flat = options.find((o) => o.kind === "FLAT_FEE");
  assert.equal(flat.feeCents, 500);
  assert.equal(flat.note, "Harare only");
});

test("client: a draft listing is not found", async () => {
  await assert.rejects(
    () => api.catalogue.products.deliveryOptions(draftId),
    (err) => err instanceof ApiError && err.status === 404
  );
});

test("client: an unknown id is not found", async () => {
  await assert.rejects(
    () => api.catalogue.products.deliveryOptions(999999),
    (err) => err instanceof ApiError && err.status === 404
  );
});
