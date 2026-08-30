const rateLimit = require("express-rate-limit");

// Each limiter is instantiated exactly once here and shared by every
// route/module that requires this file (Node caches modules by resolved
// path) — this matters because express-rate-limit keeps its request-count
// buckets on the limiter instance itself. Re-instantiating a "new" limiter
// per route would silently give each route its own, disconnected buckets.

// Generic API rate limit: baseline abuse protection without affecting
// normal admin-dashboard or public-site usage.
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Çok fazla giriş denemesi. Lütfen daha sonra tekrar deneyin.",
  },
});

const publicFormRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.",
  },
});

module.exports = { apiRateLimiter, loginRateLimiter, publicFormRateLimiter };
