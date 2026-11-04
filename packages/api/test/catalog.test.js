const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let admin;
let vendor;
let other;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  admin = await adminToken("admin.catalog@example.com", "Admin-Catalog-2026!");
  vendor = await createVendor("Catalog Vendor", "catalog.vendor@example.com", "Catalog-2026!");
  other = await createVendor("Other Vendor", "other.vendor@example.com", "Other-2026!");
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Catalog Shop", city: "Harare" } });
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

async function makeCategory(name, parentId) {
  const body = parentId === undefined ? { name } : { name, parentId };
  const res = await h.api("POST", "/categories", { token: admin, body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

// Categories

test("only an admin can create a category", async () => {
  const res = await h.api("POST", "/categories", { token: vendor.token, body: { name: "Vendor Try" } });
  assert.equal(res.status, 403);
});

test("categories nest up to 3 levels, and a fourth level is refused", async () => {
  const home = await makeCategory("Home");
  const kitchen = await makeCategory("Kitchen", home.id);
  const cookware = await makeCategory("Cookware", kitchen.id);
  assert.equal(cookware.level, 3);

  const res = await h.api("POST", "/categories", {
    token: admin,
    body: { name: "Gadgets", parentId: cookware.id },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "categories can be nested up to 3 levels deep");
});

test("a category's parent cannot be changed", async () => {
  const a = await makeCategory("Parent A");
  const b = await makeCategory("Parent B");
  const child = await makeCategory("Movable", a.id);
  const res = await h.api("PATCH", `/categories/${child.id}`, {
    token: admin,
    body: { parentId: b.id },
  });
  assert.equal(res.status, 400);
});

test("a category with products cannot be deleted", async () => {
  const shelf = await makeCategory("Shelves");
  const shelfLeaf = await makeCategory("Wall shelves", shelf.id);
  await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Oak shelf", priceCents: 4000, status: "PUBLISHED", categoryId: shelfLeaf.id },
  });
  const res = await h.api("DELETE", `/categories/${shelfLeaf.id}`, { token: admin });
  assert.equal(res.status, 409);
});

// Publishing rules

test("a parent category cannot hold a product", async () => {
  const toys = await makeCategory("Toys");
  await makeCategory("Puzzles", toys.id);
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Parent product", priceCents: 500, categoryId: toys.id },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "choose the most specific category, not a parent category");
});

test("a product cannot be published without a category", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Unlisted", priceCents: 500, status: "PUBLISHED" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "a product needs a category before it can be published");
});

test("a draft without a category is allowed", async () => {
  const res = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Draft idea", priceCents: 500 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, "DRAFT");
});

// Visibility

test("drafts are hidden from the public, and visible to the vendor", async () => {
  const draft = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Hidden draft", priceCents: 900 },
  });
  const publicPage = await h.api("GET", `/products/${draft.data.id}`);
  assert.equal(publicPage.status, 404);

  const mine = await h.api("GET", "/products/mine", { token: vendor.token });
  assert.ok(mine.data.some((p) => p.id === draft.data.id));
});

test("buyers see out of stock as null quantity, while the vendor sees the real figure", async () => {
  const leaf = await makeCategory("Mugs", (await makeCategory("Kitchenware")).id);
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Empty mug", priceCents: 800, quantity: 0, status: "PUBLISHED", categoryId: leaf.id },
  });
  const id = created.data.id;

  const buyer = await h.api("GET", `/products/${id}`);
  assert.equal(buyer.status, 200);
  assert.equal(buyer.data.quantity, null);
  assert.equal(buyer.data.inStock, false);

  const owner = await h.api("GET", "/products/mine", { token: vendor.token });
  const own = owner.data.find((p) => p.id === id);
  assert.equal(own.quantity, 0);
  assert.equal(own.inStock, false);
});

// Stock

test("only the owner can change stock", async () => {
  const leaf = await makeCategory("Plates", (await makeCategory("Tableware")).id);
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Owned plate", priceCents: 600, quantity: 2, status: "PUBLISHED", categoryId: leaf.id },
  });
  const res = await h.api("POST", `/products/${created.data.id}/adjust`, {
    token: other.token,
    body: { change: 1 },
  });
  assert.equal(res.status, 403);
});

test("stock can be reduced but never below zero", async () => {
  const leaf = await makeCategory("Bowls", (await makeCategory("Dining")).id);
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Counted bowl", priceCents: 700, quantity: 3, status: "PUBLISHED", categoryId: leaf.id },
  });
  const id = created.data.id;

  const down = await h.api("POST", `/products/${id}/adjust`, { token: vendor.token, body: { change: -2 } });
  assert.equal(down.status, 200);
  assert.equal(down.data.quantity, 1);

  const refused = await h.api("POST", `/products/${id}/adjust`, { token: vendor.token, body: { change: -5 } });
  assert.equal(refused.status, 409);

  const after = await h.prisma.product.findUnique({ where: { id } });
  assert.equal(after.quantity, 1);
});

test("setting stock to a negative number is refused", async () => {
  const leaf = await makeCategory("Glasses", (await makeCategory("Drinkware")).id);
  const created = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Tumbler", priceCents: 500, quantity: 1, status: "PUBLISHED", categoryId: leaf.id },
  });
  const res = await h.api("PUT", `/products/${created.data.id}/stock`, {
    token: vendor.token,
    body: { quantity: -1 },
  });
  assert.equal(res.status, 400);
});
