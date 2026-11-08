const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { createVendor } = require("./fixtures");

before(async () => {
  await h.startServer();
  await h.resetDatabase();
});

after(async () => {
  await h.stopServer();
  await h.prisma.$disconnect();
});

test("buyer registration needs a valid email and a password of at least 8 characters", async () => {
  const badEmail = await h.api("POST", "/buyers/register", { body: { email: "not-an-email", password: "Long-Enough-1" } });
  assert.equal(badEmail.status, 400);
  const shortPassword = await h.api("POST", "/buyers/register", { body: { email: "short@example.com", password: "short" } });
  assert.equal(shortPassword.status, 400);
});

test("buyer registration returns a token and never returns the password", async () => {
  const res = await h.api("POST", "/buyers/register", {
    body: { name: "Amina", email: "amina@example.com", password: "Amina-Pass-2026!" },
  });
  assert.equal(res.status, 201);
  assert.ok(res.data.token);
  assert.equal(res.data.user.password, undefined);
});

test("a duplicate buyer email is refused", async () => {
  await h.api("POST", "/buyers/register", { body: { email: "dup.buyer@example.com", password: "Dup-Buyer-2026!" } });
  const res = await h.api("POST", "/buyers/register", { body: { email: "dup.buyer@example.com", password: "Dup-Buyer-2026!" } });
  assert.equal(res.status, 409);
});

test("buyer login refuses a wrong password", async () => {
  await h.api("POST", "/buyers/register", { body: { email: "login.buyer@example.com", password: "Right-Buyer-2026!" } });
  const res = await h.api("POST", "/buyers/login", { body: { email: "login.buyer@example.com", password: "Wrong-Buyer-2026!" } });
  assert.equal(res.status, 401);
});

test("the buyer profile needs a buyer token", async () => {
  const none = await h.api("GET", "/buyers/me");
  assert.equal(none.status, 401);

  const vendor = await createVendor("Not A Buyer", "not.a.buyer@example.com", "Not-A-Buyer-2026!");
  const wrongRole = await h.api("GET", "/buyers/me", { token: vendor.token });
  assert.equal(wrongRole.status, 403);

  const reg = await h.api("POST", "/buyers/register", { body: { email: "profile.buyer@example.com", password: "Profile-Buyer-2026!" } });
  const own = await h.api("GET", "/buyers/me", { token: reg.data.token });
  assert.equal(own.status, 200);
  assert.equal(own.data.email, "profile.buyer@example.com");
  assert.equal(own.data.password, undefined);
});
