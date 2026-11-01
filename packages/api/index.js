require("dotenv").config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require("cors");

// Import route modules
const vendorRoutes = require("./routes/vendor");
const adminRoutes = require("./routes/admin");
const productRoutes = require("./routes/product");

// Initialize Express app
const app = express();
app.use(cookieParser());

// Configure CORS to allow dashboard access
app.use(cors({
  origin: [
    "http://192.168.1.241:7000",
    "http://localhost:7000",
    "http://127.0.0.1:7000",
    "http://192.168.1.241:5173",
    "https://192.168.1.241:7000"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

// Request logger (useful during rollout)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "acme-api" });
});

// Mount routes
app.use("/vendor", vendorRoutes);
app.use("/auth", adminRoutes);
app.use("/products", productRoutes);

// Robust route printer for startup debugging
function printRegisteredRoutes() {
  try {
    console.log('Registered routes:');
    const stack = app._router && app._router.stack ? app._router.stack : [];
    stack.forEach(layer => {
      // Direct routes
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase()).join(',');
        console.log(methods || 'USE', layer.route.path);
        return;
      }
      // Mounted routers
      if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        layer.handle.stack.forEach(r => {
          if (r.route && r.route.path) {
            const methods = Object.keys(r.route.methods || {}).map(m => m.toUpperCase()).join(',');
            // Attempt to show mount path if available
            let mount = '';
            if (layer.regexp && layer.regexp.fast_slash) {
              mount = '';
            } else if (layer.regexp && layer.regexp.source) {
              // best-effort: show nothing complex to avoid errors
              mount = '';
            }
            console.log(methods || 'USE', (mount + r.route.path));
          }
        });
      }
    });
  } catch (err) {
    console.warn('Could not print registered routes:', err && err.message ? err.message : err);
  }
}

// Start server
const PORT = process.env.PORT || 9000;
const server = app.listen(PORT, () => {
  console.log(`ACME API running on port ${PORT}`);
  printRegisteredRoutes();
});

// Graceful shutdown handlers
function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down server...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit after timeout
  setTimeout(() => {
    console.error('Forcing shutdown.');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;

