// Reads required settings, and stops the app from starting without them
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set in .env and be at least 32 characters long");
}

module.exports = { JWT_SECRET };
