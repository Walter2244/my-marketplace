const crypto = require("node:crypto");

const COMMISSION_RATE = 0.1;

// Splits a sub-order total into the platform's commission and the vendor's share.
// Amounts are whole cents, so the commission is rounded down and the vendor keeps the remainder.
function splitAmount(totalCents) {
  const commissionCents = Math.floor(totalCents * COMMISSION_RATE);
  return { commissionCents, vendorShareCents: totalCents - commissionCents };
}

// Checks a webhook's signature against the body, using the shared secret.
// The comparison is constant-time, so the check doesn't leak how much of the signature matched.
function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || typeof signatureHeader !== "string") return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = Buffer.from(signatureHeader, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length) return false;
  return crypto.timingSafeEqual(given, wanted);
}

module.exports = { COMMISSION_RATE, splitAmount, verifySignature };
