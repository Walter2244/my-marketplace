const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

before(async () => {
  await h.startServer();
  await h.resetDatabase();
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

// Admin

test("admin login refuses a wrong password", async () => {
  await adminToken("admin.one@example.com", "Admin-One-2026!");
  const res = await h.api("POST", "/auth/login", {
    body: { email: "admin.one@example.com", password: "not-the-password" },
  });
  assert.equal(res.status, 401);
});

test("admin stats match the database counts", async () => {
  const token = await adminToken("admin.stats@example.com", "Admin-Stats-2026!");
  await createVendor("Stats Vendor", "stats.vendor@example.com", "Stats-Vendor-2026!");
  const res = await h.api("GET", "/auth/stats", { token });
  assert.equal(res.status, 200);
  assert.equal(res.data.total_vendors, await h.prisma.vendor.count());
  assert.equal(res.data.total_products, await h.prisma.product.count());
  assert.equal(res.data.total_orders, await h.prisma.order.count());
});

// Vendor accounts

test("vendor registration requires name, email and password", async () => {
  const res = await h.api("POST", "/vendor/register", {
    body: { name: "No Password", email: "no.password@example.com" },
  });
  assert.equal(res.status, 400);
});

test("vendor registration returns a token and never returns the password", async () => {
  const res = await h.api("POST", "/vendor/register", {
    body: { name: "Ada Vendor", email: "ada@example.com", password: "Ada-Pass-2026!" },
  });
  assert.equal(res.status, 201);
  assert.ok(res.data.token);
  assert.equal(res.data.vendor.password, undefined);
});

test("a duplicate vendor email is refused", async () => {
  await createVendor("First", "duplicate@example.com", "Dup-Pass-2026!");
  const res = await h.api("POST", "/vendor/register", {
    body: { name: "Second", email: "duplicate@example.com", password: "Dup-Pass-2026!" },
  });
  assert.equal(res.status, 409);
});

test("vendor login refuses a wrong password", async () => {
  await createVendor("Login Vendor", "login.vendor@example.com", "Right-Pass-2026!");
  const res = await h.api("POST", "/vendor/login", {
    body: { email: "login.vendor@example.com", password: "Wrong-Pass-2026!" },
  });
  assert.equal(res.status, 401);
});

test("the vendor profile needs a vendor token, and an admin token is refused", async () => {
  const vendor = await createVendor("Profile Vendor", "profile.vendor@example.com", "Profile-2026!");

  const none = await h.api("GET", "/vendor/me");
  assert.equal(none.status, 401);

  const admin = await adminToken("admin.profile@example.com", "Admin-Profile-2026!");
  const wrongRole = await h.api("GET", "/vendor/me", { token: admin });
  assert.equal(wrongRole.status, 403);

  const own = await h.api("GET", "/vendor/me", { token: vendor.token });
  assert.equal(own.status, 200);
  assert.equal(own.data.email, "profile.vendor@example.com");
  assert.equal(own.data.password, undefined);
});

// Stores

test("creating a store needs a vendor token", async () => {
  const res = await h.api("POST", "/stores", { body: { name: "Anon", city: "Harare" } });
  assert.equal(res.status, 401);
});

test("a vendor creates one store, returned with the vendor's name but no login details", async () => {
  const vendor = await createVendor("Store Owner", "store.owner@example.com", "Store-Owner-2026!");
  const res = await h.api("POST", "/stores", {
    token: vendor.token,
    body: { name: "Owner Shop", city: "Harare" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.city, "Harare");
  assert.equal(res.data.vendor.name, "Store Owner");
  assert.equal(res.data.vendor.email, undefined);
  assert.equal(res.data.vendor.password, undefined);
});

test("a second store for the same vendor is refused", async () => {
  const vendor = await createVendor("Double Store", "double.store@example.com", "Double-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "One", city: "Harare" } });
  const res = await h.api("POST", "/stores", { token: vendor.token, body: { name: "Two", city: "Harare" } });
  assert.equal(res.status, 409);
});

test("a store needs a name and a city", async () => {
  const vendor = await createVendor("Incomplete", "incomplete@example.com", "Incomplete-2026!");
  const res = await h.api("POST", "/stores", { token: vendor.token, body: { name: "No City" } });
  assert.equal(res.status, 400);
});

test("a vendor with no store gets 404 from /stores/me", async () => {
  const vendor = await createVendor("No Store Yet", "no.store@example.com", "No-Store-2026!");
  const res = await h.api("GET", "/stores/me", { token: vendor.token });
  assert.equal(res.status, 404);
});

test("the owner can change the city, and the public filter ignores capitals", async () => {
  const vendor = await createVendor("City Vendor", "city.vendor@example.com", "City-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "City Shop", city: "Harare" } });

  const blank = await h.api("PATCH", "/stores/me", { token: vendor.token, body: { city: "   " } });
  assert.equal(blank.status, 400);

  const moved = await h.api("PATCH", "/stores/me", { token: vendor.token, body: { city: "Bulawayo" } });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.city, "Bulawayo");

  const found = await h.api("GET", "/stores?city=bulawayo");
  assert.ok(found.data.some((s) => s.name === "City Shop"));

  const notFound = await h.api("GET", "/stores?city=harare");
  assert.ok(!notFound.data.some((s) => s.name === "City Shop"));
});
