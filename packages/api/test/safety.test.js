const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { adminToken } = require("./fixtures");

before(async () => {
  await h.startServer();
  await h.resetDatabase();
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("the server and the tests share the marketplace_test database", async () => {
  const token = await adminToken("admin.safety@example.com", "Admin-Safety-2026!");

  const countBefore = await h.api("GET", "/auth/stats", { token });

  // Written directly by the test process; the server can only report it if both use the same database
  await h.prisma.vendor.create({
    data: { name: "Direct Write", email: "direct.write@example.com", password: "not-a-real-hash" },
  });

  const countAfter = await h.api("GET", "/auth/stats", { token });
  assert.equal(countAfter.data.total_vendors, countBefore.data.total_vendors + 1);
});
