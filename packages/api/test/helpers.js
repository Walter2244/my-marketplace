const { spawn } = require("node:child_process");
const path = require("node:path");
const bcrypt = require("bcryptjs");

// Load the test settings only. They never come from .env, so the tests can't touch development data.
require("dotenv").config({ path: path.join(__dirname, "..", ".env.test") });

if (!process.env.DATABASE_URL || !/\/marketplace_test(\?|$)/.test(process.env.DATABASE_URL)) {
  throw new Error("Refusing to run: DATABASE_URL in .env.test must point at the marketplace_test database");
}

const { PrismaClient } = require("@prisma/client");

const PORT = 9100;
const BASE = `http://localhost:${PORT}`;
const prisma = new PrismaClient();
let server = null;

async function startServer() {
  server = spawn(process.execPath, ["index.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), LOGIN_RATE_LIMIT: "1000", UPLOAD_DIR: path.join(__dirname, "..", "uploads-test") },
    stdio: "inherit",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The test server did not start");
}

async function stopServer() {
  if (!server) return;
  const finished = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGINT");
  await finished;
  server = null;
}

// Empties the test database, children before parents so foreign keys don't block deletes
async function resetDatabase() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.store.deleteMany();
  await prisma.category.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.district.deleteMany();
}

async function createAdmin(email, password) {
  return prisma.admin.create({ data: { email, password: await bcrypt.hash(password, 10) } });
}

// Sends a JSON request to the test server and returns the status and parsed body
async function api(method, route, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + route, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

module.exports = { BASE, prisma, startServer, stopServer, resetDatabase, createAdmin, api };



