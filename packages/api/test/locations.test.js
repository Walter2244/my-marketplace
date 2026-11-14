const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let vendor;
let admin;
let goats;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  vendor = await createVendor("Location Vendor", "location.vendor@example.com", "Location-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Location Farm", city: "Harare" } });
  admin = await adminToken("admin.locations@example.com", "Admin-Locations-2026!");
  const agri = await h.prisma.category.create({ data: { name: "Agriculture", slug: "agriculture", level: 1 } });
  const live = await h.prisma.category.create({ data: { name: "Livestock", slug: "livestock", level: 2, parentId: agri.id } });
  goats = await h.prisma.category.create({ data: { name: "Goats", slug: "goats", level: 3, parentId: live.id } });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("the ten provinces are listed", async () => {
  const res = await h.api("GET", "/districts/provinces");
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 10);
  assert.ok(res.data.includes("Mashonaland East"));
});

test("only an admin can add a district", async () => {
  const res = await h.api("POST", "/districts", {
    token: vendor.token,
    body: { name: "Marondera", province: "Mashonaland East" },
  });
  assert.equal(res.status, 403);
});

test("a district must belong to one of the ten provinces", async () => {
  const res = await h.api("POST", "/districts", {
    token: admin,
    body: { name: "Somewhere", province: "Atlantis" },
  });
  assert.equal(res.status, 400);
});

test("an admin adds a district, and it cannot be added twice", async () => {
  const added = await h.api("POST", "/districts", {
    token: admin,
    body: { name: "Marondera", province: "Mashonaland East" },
  });
  assert.equal(added.status, 201);
  const again = await h.api("POST", "/districts", {
    token: admin,
    body: { name: "Marondera", province: "Mashonaland East" },
  });
  assert.equal(again.status, 409);
});

test("a listing's district must be in the list for its province", async () => {
  const wrongProvince = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat", priceCents: 45000, quantity: 2, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", attributes: { breed: "Boer", sex: "female", ageMonths: 18 }, province: "Harare", district: "Marondera" },
  });
  assert.equal(wrongProvince.status, 400);

  const right = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat", priceCents: 45000, quantity: 2, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", attributes: { breed: "Boer", sex: "female", ageMonths: 18 }, province: "Mashonaland East", district: "Marondera" },
  });
  assert.equal(right.status, 201);
  assert.equal(right.data.province, "Mashonaland East");
});

test("a listing can be moved to another district, and the change is saved", async () => {
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Goat two", priceCents: 45000, quantity: 1, unitOfSale: "PER_HEAD", categoryId: goats.id, status: "PUBLISHED", attributes: { breed: "Boer", sex: "male", ageMonths: 20 }, province: "Mashonaland East", district: "Marondera" },
  });
  const moved = await h.api("PATCH", `/products/${created.data.id}`, {
    token: vendor.token,
    body: { province: "Mashonaland East", district: "Nowhere" },
  });
  assert.equal(moved.status, 400);
});
