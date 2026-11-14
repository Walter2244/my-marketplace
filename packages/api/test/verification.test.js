const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let admin;
let vendor;
let other;
let livestock;
let goats;
let produce;

const farmDoc = { documentType: "FARM_OWNERSHIP", documentRef: "uploads/deed-001.pdf" };

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  admin = await adminToken("admin.verify@example.com", "Admin-Verify-2026!");
  vendor = await createVendor("Ada Farmer", "ada.farmer@example.com", "Ada-Farmer-2026!");
  other = await createVendor("Ben Farmer", "ben.farmer@example.com", "Ben-Farmer-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Ada Farm", city: "Harare" } });
  await h.api("POST", "/stores", { token: other.token, body: { name: "Ben Farm", city: "Bulawayo" } });

  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  livestock = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: livestock.id } });
  produce = await h.prisma.category.create({ data: { name: "Fruit", slug: "fruit", level: 2, parentId: agri.id } });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

const idNumber = "63-123456A63";

test("an unverified vendor cannot list livestock", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat", priceCents: 45000, quantity: 2, unitOfSale: "PER_HEAD", categoryId: goats.id, attributes: { breed: "Boer", sex: "female", ageMonths: 18 }, status: "PUBLISHED" },
  });
  assert.equal(res.status, 403);
});

test("an unverified vendor can still list produce", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mango", priceCents: 300, quantity: 9, categoryId: produce.id, status: "PUBLISHED" },
  });
  assert.equal(res.status, 201);
});

test("an application needs an accepted document type", async () => {
  const res = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", documentType: "BANK_STATEMENT", documentRef: "x" },
  });
  assert.equal(res.status, 400);
});

test("a holder who is not the vendor must have the relationship explained", async () => {
  const res = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Someone Else", ...farmDoc },
  });
  assert.equal(res.status, 400);
  const explained = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Someone Else", relationshipNote: "My late father's farm, I am his heir", ...farmDoc },
  });
  assert.equal(explained.status, 201);
  await h.prisma.verificationApplication.deleteMany({ where: { vendorId: vendor.id } });
});

test("an affidavit must be commissioned and give the farm and sale details", async () => {
  const notCommissioned = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", documentType: "AFFIDAVIT", documentRef: "aff.pdf", affidavitCommissioned: false, farmName: "Ada Farm", province: "Mashonaland East", district: "Marondera", saleLocation: "Marondera" },
  });
  assert.equal(notCommissioned.status, 400);

  const missingDetails = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", documentType: "AFFIDAVIT", documentRef: "aff.pdf", affidavitCommissioned: true, farmName: "Ada Farm" },
  });
  assert.equal(missingDetails.status, 400);
});

test("a dealer licence needs its licence number", async () => {
  const res = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", documentType: "DEALER_LICENCE", documentRef: "licence.pdf" },
  });
  assert.equal(res.status, 400);
});

test("a complete application is recorded for review, with the ID check result", async () => {
  const res = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", ...farmDoc },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, "PENDING_REVIEW");
  assert.equal(res.data.idCheckStatus, "STUB_PASS");
});

test("a second application cannot be sent while one is waiting", async () => {
  const res = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", ...farmDoc },
  });
  assert.equal(res.status, 409);
});

test("an admin sees applications waiting for review", async () => {
  const res = await h.api("GET", "/verification/pending", { token: admin });
  assert.equal(res.status, 200);
  assert.ok(res.data.some((a) => a.vendor.id === vendor.id));
});

test("a rejection needs a reason, and leaves the vendor unverified", async () => {
  const app = await h.prisma.verificationApplication.findFirst({ where: { vendorId: vendor.id } });
  const noReason = await h.api("POST", `/verification/${app.id}/decide`, { token: admin, body: { decision: "REJECTED" } });
  assert.equal(noReason.status, 400);

  const rejected = await h.api("POST", `/verification/${app.id}/decide`, {
    token: admin,
    body: { decision: "REJECTED", reason: "The deed does not match the farm named on the application" },
  });
  assert.equal(rejected.status, 200);
  const v = await h.prisma.vendor.findUnique({ where: { id: vendor.id } });
  assert.equal(v.verified, false);
});

test("a rejected vendor can re-apply with corrected documents", async () => {
  const res = await h.api("POST", "/verification/apply", {
    token: vendor.token,
    body: { idNumber, holderName: "Ada Farmer", documentType: "LEASE_AGREEMENT", documentRef: "lease-002.pdf" },
  });
  assert.equal(res.status, 201);
});

test("an approval sets the vendor as verified, and livestock listings are then allowed", async () => {
  const app = await h.prisma.verificationApplication.findFirst({
    where: { vendorId: vendor.id, status: "PENDING_REVIEW" },
  });
  const res = await h.api("POST", `/verification/${app.id}/decide`, {
    token: admin,
    body: { decision: "APPROVED", reason: "Lease matches the farm and the holder is the vendor" },
  });
  assert.equal(res.status, 200);
  const v = await h.prisma.vendor.findUnique({ where: { id: vendor.id } });
  assert.equal(v.verified, true);

  const listing = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat, ewe", priceCents: 45000, quantity: 2, unitOfSale: "PER_HEAD", categoryId: goats.id, attributes: { breed: "Boer", sex: "female", ageMonths: 18 }, status: "PUBLISHED" },
  });
  assert.equal(listing.status, 201);
});

test("a decision cannot be made twice on the same application", async () => {
  const app = await h.prisma.verificationApplication.findFirst({
    where: { vendorId: vendor.id, status: "APPROVED" },
  });
  const res = await h.api("POST", `/verification/${app.id}/decide`, {
    token: admin,
    body: { decision: "REJECTED", reason: "changed my mind" },
  });
  assert.equal(res.status, 409);
});

test("only an admin can make a decision", async () => {
  const res = await h.api("POST", "/verification/1/decide", {
    token: vendor.token,
    body: { decision: "APPROVED", reason: "self-approval" },
  });
  assert.equal(res.status, 403);
});

test("a vendor who is not verified still cannot move a produce listing into livestock", async () => {
  const notYet = await h.api("POST", "/products", {
    token: other.token,
    body: { title: "Other goat", priceCents: 45000, quantity: 1, unitOfSale: "PER_HEAD", categoryId: goats.id, attributes: { breed: "Boer", sex: "female", ageMonths: 18 } },
  });
  assert.equal(notYet.status, 403);
});

