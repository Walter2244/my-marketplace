const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

const clientPath = path.join(__dirname, "..", "..", "client", "dist", "index.js");
const { createApi, ApiError } = require(clientPath);

let api;
let vendor;
let buyerToken;
let categoryId;
let productId;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  api = createApi(h.BASE);
  vendor = await createVendor("Contract Vendor", "contract.vendor@example.com", "Contract-Vendor-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  const category = await h.prisma.category.create({ data: { name: "Contract", slug: "contract", level: 1 } });
  categoryId = category.id;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("client: vendor login returns a token the vendor profile accepts", async () => {
  const login = await api.accounts.vendor.login({ email: "contract.vendor@example.com", password: "Contract-Vendor-2026!" });
  assert.equal(typeof login.token, "string");
  const me = await api.accounts.vendor.me(login.token);
  assert.equal(me.email, "contract.vendor@example.com");
});

test("client: a wrong password raises an ApiError with the status and message", async () => {
  await assert.rejects(
    () => api.accounts.vendor.login({ email: "contract.vendor@example.com", password: "wrong-password-123" }),
    (err) => err instanceof ApiError && err.status === 401 && err.message === "Invalid credentials"
  );
});

test("client: buyer register and profile match the API", async () => {
  const reg = await api.accounts.buyer.register({ name: "Client Buyer", email: "client.buyer@example.com", password: "Client-Buyer-2026!" });
  buyerToken = reg.token;
  assert.equal(reg.user.email, "client.buyer@example.com");
  const me = await api.accounts.buyer.me(buyerToken);
  assert.equal(me.name, "Client Buyer");
});

test("client: admin stats match the API", async () => {
  const admin = await adminToken("admin.client@example.com", "Admin-Client-2026!");
  const stats = await api.accounts.admin.stats(admin);
  assert.equal(typeof stats.total_vendors, "number");
});

test("client: store is created, read and updated", async () => {
  const created = await api.catalogue.stores.create(vendor.token, { name: "Client Farm", city: "Harare" });
  assert.equal(created.name, "Client Farm");
  const mine = await api.catalogue.stores.mine(vendor.token);
  assert.equal(mine.city, "Harare");
  const updated = await api.catalogue.stores.update(vendor.token, { city: "Gweru" });
  assert.equal(updated.city, "Gweru");
  const listed = await api.catalogue.stores.list({ city: "gweru" });
  assert.equal(listed.length, 1);
});

test("client: product create, read, update and stock match the API", async () => {
  const created = await api.catalogue.products.create(vendor.token, {
    title: "Client item",
    priceCents: 1500,
    quantity: 4,
    categoryId,
    status: "PUBLISHED",
  });
  productId = created.id;
  assert.equal(created.priceCents, 1500);

  const fetched = await api.catalogue.products.get(productId);
  assert.equal(fetched.title, "Client item");

  const updated = await api.catalogue.products.update(vendor.token, productId, { priceCents: 1600 });
  assert.equal(updated.priceCents, 1600);

  const stock = await api.catalogue.products.setStock(vendor.token, productId, 9);
  assert.equal(stock.quantity, 9);
  const adjusted = await api.catalogue.products.adjustStock(vendor.token, productId, -3);
  assert.equal(adjusted.quantity, 6);
});

test("client: search returns the product and matches the filters", async () => {
  const results = await api.catalogue.search.products({ q: "client", sort: "price_asc", inStock: true });
  assert.ok(results.some((p) => p.id === productId));
});

test("client: categories tree and detail match the API", async () => {
  const tree = await api.catalogue.categories.tree();
  assert.ok(tree.some((c) => c.id === categoryId));
  const detail = await api.catalogue.categories.get(categoryId);
  assert.equal(detail.name, "Contract");
});

test("client: a refused request raises ApiError, not a silent failure", async () => {
  await assert.rejects(
    () => api.catalogue.products.adjustStock(vendor.token, productId, -999),
    (err) => err instanceof ApiError && err.status === 409
  );
});
