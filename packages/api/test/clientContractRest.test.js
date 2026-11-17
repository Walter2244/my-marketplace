const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

const clientPath = path.join(__dirname, "..", "..", "client", "dist", "index.js");
const { createApi, ApiError } = require(clientPath);

let api;
let admin;
let lead;
let memberVendor;
let agentVendor;
let product;
let buyerToken;
let fulfilledSubId;
let agent;

const delivery = {
  name: "Rest Buyer",
  phone: "+263770000030",
  line1: "7 Rest Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  api = createApi(h.BASE);
  admin = await adminToken("admin.rest@example.com", "Admin-Rest-2026!");
  lead = await createVendor("Rest Lead", "rest.lead@example.com", "Rest-Lead-2026!");
  memberVendor = await createVendor("Rest Member", "rest.member@example.com", "Rest-Member-2026!");
  agentVendor = await createVendor("Rest Agent Seller", "rest.agentseller@example.com", "Rest-Seller-2026!");
  for (const v of [lead, memberVendor, agentVendor]) {
    await h.prisma.vendor.update({ where: { id: v.id }, data: { verified: true } });
    await h.api("POST", "/stores", { token: v.token, body: { name: `${v.email} farm`, city: "Harare" } });
  }
  const cat = await h.prisma.category.create({ data: { name: "Rest", slug: "rest", level: 1 } });
  product = (await h.api("POST", "/products", {
    token: lead.token,
    body: { title: "Rest crate", priceCents: 10000, quantity: 50, status: "PUBLISHED", categoryId: cat.id },
  })).data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Rest Buyer", email: "rest.buyer@example.com", password: "Rest-Buyer-2026!" },
  });
  buyerToken = reg.data.token;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("client: admin registers an agent and suspends and reinstates them", async () => {
  agent = await api.agents.admin.register(admin, { name: "Client Agent", phone: "+263774444444" });
  assert.equal(agent.status, "ACTIVE");
  const suspended = await api.agents.admin.setStatus(admin, agent.id, "SUSPENDED");
  assert.equal(suspended.status, "SUSPENDED");
  const reinstated = await api.agents.admin.setStatus(admin, agent.id, "ACTIVE");
  assert.equal(reinstated.status, "ACTIVE");
});

test("client: a seller links an agent, sees them, and ends the link", async () => {
  const link = await api.agents.vendor.link(agentVendor.token, agent.id);
  assert.equal(link.endedAt, null);
  const current = await api.agents.vendor.current(agentVendor.token);
  assert.equal(current.agent.id, agent.id);
  const ended = await api.agents.vendor.unlink(agentVendor.token);
  assert.equal(ended.endedBy, "vendor");
  const after = await api.agents.vendor.current(agentVendor.token);
  assert.equal(after.agent, null);
});

test("client: a second agent link while one is active is refused", async () => {
  await api.agents.vendor.link(agentVendor.token, agent.id);
  await assert.rejects(
    () => api.agents.vendor.link(agentVendor.token, agent.id),
    (err) => err instanceof ApiError && err.status === 409
  );
  await api.agents.vendor.unlink(agentVendor.token);
});

test("client: a group is created, a verified member is added, and the group is listed", async () => {
  const group = await api.groups.create(lead.token, "Client Growers");
  assert.equal(group.listed, false);
  const member = await api.groups.addMember(lead.token, memberVendor.id, 100);
  assert.equal(member.sharePercent, 100);
  const listed = await api.groups.list(lead.token);
  assert.equal(listed.listed, true);
});

test("client: a listed group's members are fixed, and the member sees only their own shares", async () => {
  await assert.rejects(
    () => api.groups.addMember(lead.token, agentVendor.id, 1),
    (err) => err instanceof ApiError && err.status === 409
  );
  const mine = await api.groups.myShares(memberVendor.token);
  assert.equal(mine[0].group, "Client Growers");
  assert.equal(mine[0].sharePercent, 100);
});

test("client: a buyer reviews a fulfilled order, and the vendor's rating reflects it", async () => {
  await h.api("POST", "/cart/items", { token: buyerToken, body: { productId: product.id, quantity: 1 } });
  const checkout = await h.api("POST", "/orders/checkout", {
    token: buyerToken,
    body: { delivery, deliveryChoices: {} },
  });
  assert.equal(checkout.status, 201);
  fulfilledSubId = checkout.data.subOrders[0].id;
  await h.prisma.subOrder.update({ where: { id: fulfilledSubId }, data: { status: "FULFILLED" } });

  const review = await api.reviews.reviews.create(buyerToken, fulfilledSubId, { rating: 4, comment: "Good crate" });
  assert.equal(review.rating, 4);

  const rating = await api.reviews.reviews.vendorRating(lead.id);
  assert.equal(rating.reviewCount, 1);
  assert.equal(rating.averageRating, 4);
});

test("client: a buyer opens a dispute, and the admin decides it", async () => {
  const opened = await api.reviews.disputes.open(buyerToken, fulfilledSubId, "Arrived damaged");
  assert.equal(opened.status, "OPEN");
  const decided = await api.reviews.disputes.decide(admin, opened.id, "RESOLVED_FOR_BUYER", "Photos confirm damage");
  assert.equal(decided.status, "RESOLVED_FOR_BUYER");
});

test("client: a refused decision raises ApiError with the API's status", async () => {
  const dispute = await h.prisma.dispute.findUnique({ where: { subOrderId: fulfilledSubId } });
  await assert.rejects(
    () => api.reviews.disputes.decide(admin, dispute.id, "RESOLVED_FOR_VENDOR", "Changing my mind"),
    (err) => err instanceof ApiError && err.status === 409
  );
});

test("client: the price guide reports the minimum sales and a list of districts", async () => {
  const category = await h.prisma.category.findUnique({ where: { slug: "rest" } });
  const guide = await api.priceIndex.guide({ categoryId: category.id });
  assert.equal(guide.minimumSales, 5);
  assert.ok(Array.isArray(guide.districts));
});

test("client: a price index request without a valid category is refused", async () => {
  await assert.rejects(
    () => api.priceIndex.guide({ categoryId: 0 }),
    (err) => err instanceof ApiError && err.status === 400
  );
});
