const bcrypt = require("bcryptjs");
const h = require("./helpers");

// Creates a vendor through the real register route and returns its id, email and token
async function createVendor(name, email, password) {
  const res = await h.api("POST", "/vendor/register", { body: { name, email, password } });
  if (res.status !== 201) throw new Error(`vendor register failed: ${JSON.stringify(res.data)}`);
  return { id: res.data.vendor.id, email, token: res.data.token };
}

// Creates or updates an admin directly, then logs in through the real login route
async function adminToken(email, password) {
  const hashed = await bcrypt.hash(password, 10);
  await h.prisma.admin.upsert({
    where: { email },
    update: { password: hashed },
    create: { email, password: hashed },
  });
  const res = await h.api("POST", "/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

// A complete delivery address, used by every test that places an order
const address = {
  name: "Test Buyer",
  phone: "+263770000000",
  line1: "1 Test Road",
  city: "Harare",
  postalCode: "00000",
  country: "Zimbabwe",
};

module.exports = { createVendor, adminToken, address };
