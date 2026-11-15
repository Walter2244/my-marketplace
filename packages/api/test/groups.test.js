const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let lead;
let memberA;
let memberB;
let unverified;
let product;
let buyer;

const delivery = {
  name: "Group Buyer",
  phone: "+263770000010",
  line1: "10 Group Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  const admin = await adminToken("admin.groups@example.com", "Admin-Groups-2026!");
  lead = await createVendor("Group Lead", "group.lead@example.com", "Group-Lead-2026!");
  memberA = await createVendor("Member A", "member.a@example.com", "Member-A-2026!");
  memberB = await createVendor("Member B", "member.b@example.com", "Member-B-2026!");
  unverified = await createVendor("Not Verified", "not.verified@example.com", "Not-Verified-2026!");
  for (const v of [lead, memberA, memberB]) {
    await h.prisma.vendor.update({ where: { id: v.id }, data: { verified: true } });
    await h.api("POST", "/stores", { token: v.token, body: { name: `${v.email} farm`, city: "Harare" } });
  }
  void admin;
  const cat = await h.prisma.category.create({ data: { name: "Groupable", slug: "groupable", level: 1 } });
  const p = await h.api("POST", "/products", {
    token: lead.token,
    body: { title: "Group crate", priceCents: 10000, quantity: 50, status: "PUBLISHED", categoryId: cat.id },
  });
  product = p.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Group Buyer", email: "group.buyer@example.com", password: "Group-Buyer-2026!" },
  });
  buyer = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("a vendor creates a group, and leads only one", async () => {
  const created = await h.api("POST", "/groups", { token: lead.token, body: { name: "Hillside Growers" } });
  assert.equal(created.status, 201);
  assert.equal(created.data.listed, false);
  const again = await h.api("POST", "/groups", { token: lead.token, body: { name: "Second group" } });
  assert.equal(again.status, 409);
});

test("a member must be verified, and a share must be from 1 to 100", async () => {
  const notVerified = await h.api("POST", "/groups/members", { token: lead.token, body: { vendorId: unverified.id, sharePercent: 10 } });
  assert.equal(notVerified.status, 409);
  const badShare = await h.api("POST", "/groups/members", { token: lead.token, body: { vendorId: memberA.id, sharePercent: 0 } });
  assert.equal(badShare.status, 400);
});

test("members cannot total more than 100%", async () => {
  const a = await h.api("POST", "/groups/members", { token: lead.token, body: { vendorId: memberA.id, sharePercent: 60 } });
  assert.equal(a.status, 201);
  const over = await h.api("POST", "/groups/members", { token: lead.token, body: { vendorId: memberB.id, sharePercent: 50 } });
  assert.equal(over.status, 400);
});

test("the group cannot list until member shares total exactly 100%", async () => {
  const early = await h.api("POST", "/groups/list", { token: lead.token });
  assert.equal(early.status, 400);
  const b = await h.api("POST", "/groups/members", { token: lead.token, body: { vendorId: memberB.id, sharePercent: 40 } });
  assert.equal(b.status, 201);
  const listed = await h.api("POST", "/groups/list", { token: lead.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.listed, true);
});

test("members are fixed once the group is listed", async () => {
  const res = await h.api("POST", "/groups/members", { token: lead.token, body: { vendorId: unverified.id, sharePercent: 1 } });
  assert.equal(res.status, 409);
});

test("a member sees their own shares, and not the other members", async () => {
  const res = await h.api("GET", "/groups/my-shares", { token: memberA.token });
  assert.equal(res.status, 200);
  assert.equal(res.data[0].sharePercent, 60);
  assert.equal(JSON.stringify(res.data).includes("Member B"), false);
});

test("on payment, each member's share of the lead's sale is recorded once", async () => {
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 1 } });
  const checkout = await h.api("POST", "/orders/checkout", { token: buyer, body: { delivery } });
  assert.equal(checkout.status, 201);
  const sub = checkout.data.subOrders[0];
  const fresh = await h.prisma.subOrder.findUnique({ where: { id: sub.id } });
  const { recordGroupShares } = require("../routes/groups");
  await h.prisma.$transaction(async (tx) => {
    await recordGroupShares(tx, fresh);
    await recordGroupShares(tx, fresh);
  });
  const shares = await h.prisma.groupShare.findMany({ where: { subOrderId: sub.id }, orderBy: { amountCents: "desc" } });
  assert.equal(shares.length, 2);
  assert.equal(shares[0].amountCents, 6000);
  assert.equal(shares[1].amountCents, 4000);
});
