const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor, adminToken } = require("./fixtures");

let admin;
let vendor;
let agentA;
let agentB;
let product;
let buyer;

before(async () => {
  await h.startServer();
  await h.resetDatabase();
  admin = await adminToken("admin.agents@example.com", "Admin-Agents-2026!");
  vendor = await createVendor("Agent Seller", "agent.seller@example.com", "Agent-Seller-2026!");
  await h.prisma.vendor.update({ where: { id: vendor.id }, data: { verified: true } });
  await h.api("POST", "/stores", { token: vendor.token, body: { name: "Agent Farm", city: "Harare" } });
  const cat = await h.prisma.category.create({ data: { name: "Assisted", slug: "assisted", level: 1 } });
  const p = await h.api("POST", "/products", {
    token: vendor.token,
    body: { title: "Assisted item", priceCents: 10000, quantity: 50, status: "PUBLISHED", categoryId: cat.id },
  });
  product = p.data;
  const reg = await h.api("POST", "/buyers/register", {
    body: { name: "Agent Buyer", email: "agent.buyer@example.com", password: "Agent-Buyer-2026!" },
  });
  buyer = reg.data.token;
  const a = await h.api("POST", "/agents", { token: admin, body: { name: "Tendai", phone: "+263771111111" } });
  agentA = a.data;
  const b = await h.api("POST", "/agents", { token: admin, body: { name: "Rudo", phone: "+263772222222" } });
  agentB = b.data;
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("only an admin can register an agent", async () => {
  const res = await h.api("POST", "/agents", { token: vendor.token, body: { name: "No", phone: "+263773333333" } });
  assert.equal(res.status, 403);
});

test("an agent phone number must be valid, and unique", async () => {
  const bad = await h.api("POST", "/agents", { token: admin, body: { name: "Bad", phone: "not-a-number" } });
  assert.equal(bad.status, 400);
  const dup = await h.api("POST", "/agents", { token: admin, body: { name: "Dup", phone: "+263771111111" } });
  assert.equal(dup.status, 409);
});

test("a seller chooses an agent, and only one is active at a time", async () => {
  const linked = await h.api("POST", "/agents/link", { token: vendor.token, body: { agentId: agentA.id } });
  assert.equal(linked.status, 201);
  const second = await h.api("POST", "/agents/link", { token: vendor.token, body: { agentId: agentB.id } });
  assert.equal(second.status, 409);
});

test("a seller can see their current agent", async () => {
  const res = await h.api("GET", "/agents/me", { token: vendor.token });
  assert.equal(res.data.agent.name, "Tendai");
});

test("a suspended agent cannot take on a seller", async () => {
  await h.api("POST", `/agents/${agentB.id}/status`, { token: admin, body: { status: "SUSPENDED" } });
  const res = await h.api("POST", "/agents/link", { token: createdVendorToken(), body: { agentId: agentB.id } });
  assert.equal(res.status, 409);
});

function createdVendorToken() {
  return vendor.token;
}

test("the seller can end the link at any time", async () => {
  const res = await h.api("POST", "/agents/unlink", { token: vendor.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.endedBy, "vendor");
  const me = await h.api("GET", "/agents/me", { token: vendor.token });
  assert.equal(me.data.agent, null);
});

test("an agent is paid 2% of a sale, once, when the order is paid", async () => {
  await h.api("POST", "/agents/link", { token: vendor.token, body: { agentId: agentA.id } });
  await h.api("POST", "/cart/items", { token: buyer, body: { productId: product.id, quantity: 2 } });
  const checkout = await h.api("POST", "/orders/checkout", {
    token: buyer,
    body: { delivery: { name: "Agent Buyer", phone: "+263770000009", line1: "1 Agent Road", city: "Harare", postalCode: "00000", country: "Zimbabwe" } },
  });
  const subId = checkout.data.subOrders[0].id;
  const commission = await h.prisma.agentCommission.findUnique({ where: { subOrderId: subId } });
  assert.equal(commission, null);

  const sub = await h.prisma.subOrder.findUnique({ where: { id: subId } });
  const { recordAgentCommission } = require("../routes/agents");
  await h.prisma.$transaction(async (tx) => {
    await recordAgentCommission(tx, sub);
    await recordAgentCommission(tx, sub);
  });
  const recorded = await h.prisma.agentCommission.findMany({ where: { subOrderId: subId } });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].saleCents, 20000);
  assert.equal(recorded[0].commissionCents, 400);
});

test("only an admin can mark an agent commission as paid, and only once", async () => {
  const commission = await h.prisma.agentCommission.findFirst({});
  const byVendor = await h.api("POST", `/agents/commissions/${commission.id}/paid`, { token: vendor.token });
  assert.equal(byVendor.status, 403);
  const first = await h.api("POST", `/agents/commissions/${commission.id}/paid`, { token: admin });
  assert.equal(first.status, 200);
  const again = await h.api("POST", `/agents/commissions/${commission.id}/paid`, { token: admin });
  assert.equal(again.status, 409);
});
