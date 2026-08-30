// Express app assembly: global middleware (trust proxy, CORS, Helmet, body
// limit, rate limiting), the CORS error handler, and every route module —
// no env/DB-connect/listen concerns here (those stay in server.js so this
// file can be required by tests with zero network/DB side effects, exactly
// as server.js itself worked before this split).
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { resolveTrustProxySetting } = require("./config/proxyConfig");
const { resolveAllowedOrigins } = require("./config/corsConfig");
const { apiRateLimiter } = require("./middleware/rateLimiters");
const { corsErrorHandler } = require("./middleware/errorMiddleware");

const authRoutes = require("./routes/authRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const submissionRoutes = require("./routes/submissionRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const blockedSlotRoutes = require("./routes/blockedSlotRoutes");
const videoRoutes = require("./routes/videoRoutes");

const app = express();

// See config/proxyConfig.js: trusts exactly the reverse-proxy hop count
// that's actually real for this deployment (env-overridable via
// TRUST_PROXY), instead of either ignoring X-Forwarded-For entirely
// (breaks per-client rate limiting behind Render) or blindly trusting it
// (lets a direct local client forge its own IP).
app.set("trust proxy", resolveTrustProxySetting());

// See config/corsConfig.js: the production frontend origin and localhost
// dev origins are ALWAYS included, deterministically, regardless of
// whether ALLOWED_ORIGINS is set — so configuring it (e.g. to add a
// staging frontend) can never accidentally drop the real production
// site's access. Malformed entries or a literal "*" wildcard fail closed
// at startup.
const allowedOrigins = resolveAllowedOrigins();

const corsOptions = {
  origin(origin, callback) {
    // No Origin header (same-origin requests, curl, server-to-server,
    // health checks) is not a browser cross-origin request — allow it.
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS: origin izinli değil"));
  },
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "20kb" }));

// Generic API rate limit: baseline abuse protection without affecting
// normal admin-dashboard or public-site usage.
app.use("/api", apiRateLimiter);

app.use(corsErrorHandler);

app.use(authRoutes);
app.use(appointmentRoutes);
app.use(submissionRoutes);
app.use(scheduleRoutes);
app.use(blockedSlotRoutes);
app.use(videoRoutes);

app.get("/", (req, res) => {
  res.send("Backend çalışıyor kral");
});

module.exports = app;
