const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

let vendor;
let otherVendor;
let goat;
let mango;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Record Vendor", "record.vendor@example.com", "Record-Vendor-2026!");
  otherVendor = await createVendor("Other Record", "other.record@example.com", "Other-Record-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.prisma.vendor.update({ where: { id: otherVendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Record Farm", city: "Harare" } });
  await h.api("POST", "/stores", { token: otherVendor.token, body: { name: "Other Farm", city: "Bulawayo" } });

  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  const goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: live.id } });
  const fruit = await h.prisma.category.create({ data: { name: "Fruit", slug: "fruit", level: 2, parentId: agri.id } });

  const g = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Boer goat", priceCents: 45000, quantity: 3, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", attributes: { breed: "Boer", sex: "female", ageMonths: 18 } },
  });
  goat = g.data;
  const m = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Mango", priceCents: 300, quantity: 9, categoryId: fruit.id, status: "PUBLISHED" },
  });
  mango = m.data;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a tag number is saved for a livestock listing", async () => {
  const res = await h.api("PUT", `/livestock/${goat.id}/identification`, {
    token: vendor.token,
    body: { tagNumber: "zw-2026-0042" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.tagNumber, "ZW-2026-0042");
});

test("a tag number must be letters, numbers and hyphens", async () => {
  const res = await h.api("PUT", `/livestock/${goat.id}/identification`, {
    token: vendor.token,
    body: { tagNumber: "bad tag!" },
  });
  assert.equal(res.status, 400);
});

test("a tag number already used on another listing is refused", async () => {
  const other = await h.api("POST", "/products", {
    token: otherVendor.token,
    body: { title: "Other goat", priceCents: 45000, quantity: 1, unitOfSale: "PER_HEAD", categoryId: goat.categoryId, status: "PUBLISHED", attributes: { breed: "Boer", sex: "male", ageMonths: 20 } },
  });
  const res = await h.api("PUT", `/livestock/${other.data.id}/identification`, {
    token: otherVendor.token,
    body: { tagNumber: "ZW-2026-0042" },
  });
  assert.equal(res.status, 409);
});

test("identification and records apply only to livestock listings", async () => {
  const res = await h.api("PUT", `/livestock/${mango.id}/identification`, {
    token: vendor.token,
    body: { tagNumber: "MANGO-1" },
  });
  assert.equal(res.status, 400);
});

test("a vendor cannot record for another vendor's listing", async () => {
  const res = await h.api("POST", `/livestock/${goat.id}/health-records`, {
    token: otherVendor.token,
    body: { kind: "VACCINATION", description: "Foot and mouth", recordedOn: "2026-10-01" },
  });
  assert.equal(res.status, 404);
});

test("a health record needs a kind, a description, and a past or present date", async () => {
  const badKind = await h.api("POST", `/livestock/${goat.id}/health-records`, {
    token: vendor.token,
    body: { kind: "SURGERY", description: "x", recordedOn: "2026-10-01" },
  });
  assert.equal(badKind.status, 400);

  const future = await h.api("POST", `/livestock/${goat.id}/health-records`, {
    token: vendor.token,
    body: { kind: "VACCINATION", description: "Foot and mouth", recordedOn: "2099-01-01" },
  });
  assert.equal(future.status, 400);
});

test("a valid health record is saved", async () => {
  const res = await h.api("POST", `/livestock/${goat.id}/health-records`, {
    token: vendor.token,
    body: { kind: "VACCINATION", description: "Foot and mouth", recordedOn: "2026-10-01" },
  });
  assert.equal(res.status, 201);
});

test("the health declaration needs agreement, and can be made only once", async () => {
  const notAgreed = await h.api("POST", `/livestock/${goat.id}/declaration`, { token: vendor.token, body: {} });
  assert.equal(notAgreed.status, 400);

  const made = await h.api("POST", `/livestock/${goat.id}/declaration`, { token: vendor.token, body: { agreed: true } });
  assert.equal(made.status, 201);

  const again = await h.api("POST", `/livestock/${goat.id}/declaration`, { token: vendor.token, body: { agreed: true } });
  assert.equal(again.status, 409);
});

test("buyers see the identification, records and declaration on a published listing", async () => {
  const res = await h.api("GET", `/livestock/${goat.id}/records`);
  assert.equal(res.status, 200);
  assert.equal(res.data.identification.tagNumber, "ZW-2026-0042");
  assert.equal(res.data.healthRecords.length, 1);
  assert.ok(res.data.declaration.statement.includes("healthy"));
});
