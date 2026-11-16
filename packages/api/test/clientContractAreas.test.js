const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

const clientPath = path.join(__dirname, "..", "..", "client", "dist", "index.js");
const { createApi, ApiError } = require(clientPath);

let api;
let admin;
let vendor;
let applicant;
let goat;
let collectableGoat;
let buyerToken;
let paidSubOrderId;

const delivery = {
  name: "Area Buyer",
  phone: "+263770000020",
  line1: "5 Area Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  api = createApi(h.BASE);
  admin = await adminToken("admin.areas@example.com", "Admin-Areas-2026!");
  vendor = await createVendor("Area Vendor", "area.vendor@example.com", "Area-Vendor-2026!");
  applicant = await createVendor("Area Applicant", "area.applicant@example.com", "Area-Applicant-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Area Farm", city: "Harare" } });

  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  const goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: live.id } });

  const attrs = { breed: "Boer", sex: "female", ageMonths: 18 };
  goat = (await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Area goat", priceCents: 45000, quantity: 5, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", attributes: attrs, collectable: true },
  })).data;
  collectableGoat = goat;

  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Area Buyer", email: "area.buyer@example.com", password: "Area-Buyer-2026!" },
  });
  buyerToken = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

async function paidCollectableSubOrder() {
  await h.api("POST", "/cart/items", { token: buyerToken, body: { productId: collectableGoat.id, quantity: 1 } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyerToken, body: { delivery } });
  assert.equal(checkout.status, 201);
  const subId = checkout.data.subOrders[0].id;
  await h.prisma.subOrder.update({ where: { id: subId }, data: { status: "PAID" } });
  return subId;
}

test("client: verification apply, status and the admin queue match the API", async () => {
  const applied = await api.verification.apply(applicant.token, {
    idNumber: "63-123456A63",
    holderName: "Area Applicant",
    documentType: "LEASE_AGREEMENT",
    documentRef: "lease-area.pdf",
  });
  assert.equal(applied.status, "PENDING_REVIEW");
  assert.equal(applied.idCheckStatus, "STUB_PASS");

  const status = await api.verification.me(applicant.token);
  assert.equal(status.verified, false);
  assert.equal(status.applications[0].status, "PENDING_REVIEW");

  const queue = await api.verification.pending(admin);
  assert.ok(queue.some((a) => a.id === applied.id && a.vendor.email === "area.applicant@example.com"));
});

test("client: an admin decision is refused without a reason, and approval verifies the vendor", async () => {
  const queue = await api.verification.pending(admin);
  const app = queue.find((a) => a.vendor.email === "area.applicant@example.com");
  await assert.rejects(
    () => api.verification.decide(admin, app.id, "REJECTED", ""),
    (err) => err instanceof ApiError && err.status === 400
  );
  const decided = await api.verification.decide(admin, app.id, "APPROVED", "Lease matches the farm");
  assert.equal(decided.status, "APPROVED");
  const status = await api.verification.me(applicant.token);
  assert.equal(status.verified, true);
});

test("client: livestock identification, health record and declaration match the API", async () => {
  const tag = await api.livestock.identification.set(vendor.token, goat.id, "ZW-AREA-0001");
  assert.equal(tag.tagNumber, "ZW-AREA-0001");

  const record = await api.livestock.healthRecords.add(vendor.token, goat.id, {
    kind: "VACCINATION",
    description: "Foot and mouth",
    recordedOn: "2026-10-01",
  });
  assert.equal(record.kind, "VACCINATION");

  const declaration = await api.livestock.declaration.make(vendor.token, goat.id);
  assert.ok(declaration.statement.includes("healthy"));
});

test("client: the public livestock records omit vendor-only fields", async () => {
  const records = await api.livestock.records(goat.id);
  assert.equal(records.identification.tagNumber, "ZW-AREA-0001");
  assert.equal(records.healthRecords.length, 1);
  assert.equal(JSON.stringify(records).includes("vendorId"), false);
});

test("client: collection choose, ready and handover match the API, and the code is shown once", async () => {
  paidSubOrderId = await paidCollectableSubOrder();

  const chosen = await api.collection.choose(buyerToken, paidSubOrderId, "Saturday morning");
  assert.equal(chosen.fulfilment, "COLLECTION");

  const ready = await api.collection.markReady(vendor.token, paidSubOrderId);
  assert.match(ready.collectionCode, /^[0-9]{6}$/);

  await assert.rejects(
    () => api.collection.markReady(vendor.token, paidSubOrderId),
    (err) => err instanceof ApiError && err.status === 409
  );

  const done = await api.collection.handover(vendor.token, paidSubOrderId, ready.collectionCode);
  assert.equal(done.status, "FULFILLED");
});

test("client: a wrong collection code is refused with the API's message", async () => {
  const subId = await paidCollectableSubOrder();
  await api.collection.choose(buyerToken, subId, "Friday");
  await api.collection.markReady(vendor.token, subId);
  await assert.rejects(
    () => api.collection.handover(vendor.token, subId, "000000"),
    (err) => err instanceof ApiError && err.status === 400 && err.message === "the collection code does not match"
  );
});
