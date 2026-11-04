const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

before(async () => {
  await h.startServer();
  await h.resetDatabase();
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("health check responds", async () => {
  const { status, data } = await h.api("GET", "/health");
  assert.equal(status, 200);
  assert.equal(data.status, "ok");
});

test("admin stats require a token", async () => {
  const { status, data } = await h.api("GET", "/auth/stats");
  assert.equal(status, 401);
  assert.equal(data.error, "Missing token");
});

test("the old hardcoded admin login is refused", async () => {
  const { status } = await h.api("POST", "/auth/login", {
    body: { email: "admin@example.com", password: "admin123" },
  });
  assert.equal(status, 401);
});
