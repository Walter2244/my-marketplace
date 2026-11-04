const rateLimit = require("express-rate-limit");

// Failed attempts allowed per IP address in each window.
// The test server raises this through LOGIN_RATE_LIMIT, so the test suites aren't blocked by their own logins.
const MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT) || 5;

// Only failed requests count. A successful login or registration doesn't use up the allowance.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: MAX_FAILED_ATTEMPTS,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many failed attempts. Try again in 15 minutes." },
});

module.exports = { loginLimiter };
