const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads-test");
let owner;
let stranger;
let product;
let draft;

async function makePng(width = 800) {
  return sharp({ create: { width, height: 600, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toBuffer();
}

async function upload(token, productId, buffer, filename = "photo.png", type = "image/png") {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type }), filename);
  const res = await fetch(`${h.BASE}/products/${productId}/images`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

before(async () => {
  await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
  await h.startServer();
  await h.resetDatabase();
  owner = await createVendor("Image Owner", "image.owner@example.com", "Image-Owner-2026!");
  stranger = await createVendor("Image Stranger", "image.stranger@example.com", "Image-Stranger-2026!");
  await h.api("POST", "/stores", { token: owner.token, body: { name: "Image Shop", city: "Harare" } });
  const category = await h.prisma.category.create({ data: { name: "Photos", slug: "photos", level: 1 } });
  const published = await h.api("POST", "/products", {
    token: owner.token,
    body: { title: "Lamp", priceCents: 4000, quantity: 2, status: "PUBLISHED", categoryId: category.id },
  });
  product = published.data;
  const drafted = await h.api("POST", "/products", {
    token: owner.token,
    body: { title: "Lamp draft", priceCents: 4000 },
  });
  draft = drafted.data;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
  await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
});

test("the owner uploads an image, converted to WebP at position 0", async () => {
  const res = await upload(owner.token, product.id, await makePng());
  assert.equal(res.status, 201);
  assert.equal(res.data.position, 0);
  assert.equal(res.data.mimeType, "image/webp");
});

test("a second image gets the next position", async () => {
  const res = await upload(owner.token, product.id, await makePng(400));
  assert.equal(res.status, 201);
  assert.equal(res.data.position, 1);
});

test("a file that isn't an image is refused", async () => {
  const res = await upload(owner.token, product.id, Buffer.from("plain text"), "notes.txt", "text/plain");
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "file is not a readable image");
});

test("another vendor cannot add images to someone else's product", async () => {
  const res = await upload(stranger.token, product.id, await makePng());
  assert.equal(res.status, 403);
});

test("uploads need a vendor token", async () => {
  const res = await upload(null, product.id, await makePng());
  assert.equal(res.status, 401);
});

test("a product holds at most 8 images", async () => {
  const full = await h.api("POST", "/products", { token: owner.token, body: { title: "Full set", priceCents: 1000 } });
  for (let i = 0; i < 8; i++) {
    const res = await upload(owner.token, full.data.id, await makePng(300));
    assert.equal(res.status, 201);
  }
  const ninth = await upload(owner.token, full.data.id, await makePng(300));
  assert.equal(ninth.status, 409);
});

test("published product images are visible to buyers and served as WebP", async () => {
  const list = await h.api("GET", `/products/${product.id}/images`);
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 2);
  const file = await fetch(`${h.BASE}/products/${product.id}/images/${list.data[0].id}/thumb`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/webp");
});

test("draft images are hidden from the public but visible to the owner", async () => {
  await upload(owner.token, draft.id, await makePng(300));
  const publicList = await h.api("GET", `/products/${draft.id}/images`);
  assert.equal(publicList.status, 404);
  const ownerList = await h.api("GET", `/products/${draft.id}/images`, { token: owner.token });
  assert.equal(ownerList.status, 200);
  assert.equal(ownerList.data.length, 1);
});

test("deleting an image renumbers the rest so positions stay in order", async () => {
  const list = await h.api("GET", `/products/${product.id}/images`);
  const first = list.data[0];
  const res = await fetch(`${h.BASE}/products/${product.id}/images/${first.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(res.status, 200);
  const after = await h.api("GET", `/products/${product.id}/images`);
  assert.deepEqual(after.data.map((image) => image.position), [0]);
});
