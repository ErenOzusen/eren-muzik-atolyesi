// Integration tests for A2 — trust proxy / rate limit correctness behind a
// (simulated) single-hop reverse proxy like Render, and safety in plain
// local development with no proxy at all.
//
// Honesty note on what this can and cannot prove: a local test script that
// directly opens the HTTP connection to the app *is* the raw TCP peer, so
// it necessarily occupies the position of "the one trusted hop" whenever
// trust-proxy trusts >=1 hop. That makes it possible to faithfully test
// "does Express correctly read the client IP that a genuine single-hop
// proxy like Render's edge would have appended" (yes — tested below), but
// it cannot reproduce a real two-hop topology to prove an attacker sitting
// *in front of* a real proxy can't smuggle extra spoofed entries past it —
// that would require an actual reverse proxy in the test topology, which
// this suite does not stand up (see the same zero-heavy-infra rationale as
// the rest of this project's tests).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

process.env.ADMIN_PASSWORD = "proxy-rate-limit-test-password";
process.env.ADMIN_TOKEN_SECRET = "proxy-rate-limit-test-token-secret-with-enough-length-123456";

// Force a fresh module load of every server-owned module (route, controller,
// service, middleware, config file — everything under server/ except
// node_modules) so proxyConfig's env read (via app.js's top-level
// `app.set("trust proxy", resolveTrustProxySetting())`) picks up overrides
// applied per test, AND so singleton state — e.g. the shared rate-limiter
// request-count buckets in middleware/rateLimiters.js — resets between test
// cases. Busting only server.js itself is not enough post-refactor: any
// intermediate cached module (a route file, say) that already required a
// singleton once would otherwise keep handing out its stale, non-reset
// reference. This reproduces, file-layout-agnostically, the isolation the
// old single-file server.js got for free whenever its one cache entry was
// busted and the whole module body re-ran.
//
// models/*.js and auth.js are deliberately EXCLUDED from the bust:
//   - models/*.js call `mongoose.model("Name", schema)` at require-time;
//     mongoose itself (never busted — it's a node_modules singleton) keeps
//     its own model registry keyed by name, so re-executing a model file a
//     second time throws OverwriteModelError. Leaving models cached is also
//     exactly what the pre-refactor test did (it only ever busted server.js
//     + proxyConfig.js — model files were never part of that list either).
//   - auth.js holds the in-memory admin-token revocation set, which this
//     suite doesn't exercise and which was likewise never busted before.
const SERVER_ROOT = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(SERVER_ROOT, "models") + path.sep;
const AUTH_JS_PATH = path.join(SERVER_ROOT, "auth.js");

function bustServerRequireCache() {
  for (const cachedPath of Object.keys(require.cache)) {
    if (!cachedPath.startsWith(SERVER_ROOT + path.sep)) continue;
    if (cachedPath.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (cachedPath.startsWith(MODELS_DIR)) continue;
    if (cachedPath === AUTH_JS_PATH) continue;
    if (cachedPath === __filename) continue;

    delete require.cache[cachedPath];
  }
}

function startServerWithEnv(envOverrides) {
  const previous = {};
  for (const key of Object.keys(envOverrides)) {
    previous[key] = process.env[key];
    if (envOverrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envOverrides[key];
    }
  }

  bustServerRequireCache();

  const app = require("../server.js");
  const server = http.createServer(app);

  return {
    server,
    restore() {
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    },
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function loginAttempt(baseUrl, xForwardedFor) {
  const headers = { "Content-Type": "application/json" };
  if (xForwardedFor !== undefined) {
    headers["X-Forwarded-For"] = xForwardedFor;
  }
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "wrong-on-purpose" }),
  });
  return res.status;
}

test("A2.1 — TRUST_PROXY=1 (Render-like): two different client IPs (via a single, edge-style X-Forwarded-For entry each) get independent rate-limit buckets", async () => {
  const { server, restore } = startServerWithEnv({ TRUST_PROXY: "1", MONGODB_URI: undefined });
  const baseUrl = await listen(server);

  try {
    const statusesClientA = [];
    for (let i = 0; i < 10; i += 1) {
      statusesClientA.push(await loginAttempt(baseUrl, "203.0.113.10"));
    }
    // First 10 attempts from client A should all be normal 401s (wrong
    // password), not yet rate-limited.
    assert.ok(
      statusesClientA.every((s) => s === 401),
      `expected all 10 client-A attempts to be plain 401s, got: ${statusesClientA.join(",")}`
    );

    const eleventhClientA = await loginAttempt(baseUrl, "203.0.113.10");
    assert.equal(eleventhClientA, 429, "client A must be rate-limited after exceeding its own budget");

    // A different client (different X-Forwarded-For, as a real distinct
    // visitor behind the same Render edge would produce) must NOT be
    // affected by client A's limit.
    const clientBStatus = await loginAttempt(baseUrl, "198.51.100.20");
    assert.equal(clientBStatus, 401, "an unrelated client must get its own rate-limit bucket, not share client A's");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});

test("A2.2 — TRUST_PROXY=1: express-rate-limit raises no X-Forwarded-For validation error", async () => {
  const { server, restore } = startServerWithEnv({ TRUST_PROXY: "1", MONGODB_URI: undefined });
  const baseUrl = await listen(server);

  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    await loginAttempt(baseUrl, "203.0.113.55");
    // Give any async validation rejection a tick to surface.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const xffValidationErrors = unhandled.filter(
      (err) => err && err.code === "ERR_ERL_UNEXPECTED_X_FORWARDED_FOR"
    );
    assert.equal(
      xffValidationErrors.length,
      0,
      "trust proxy=1 with a genuine single X-Forwarded-For entry must not trigger express-rate-limit's misconfiguration error"
    );
  } finally {
    process.removeListener("unhandledRejection", onUnhandledRejection);
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});

test("A2.3 — local development default (no TRUST_PROXY, no RENDER/production): spoofed X-Forwarded-For does NOT let a direct client evade or split its own rate limit", async () => {
  const { server, restore } = startServerWithEnv({
    TRUST_PROXY: undefined,
    RENDER: undefined,
    NODE_ENV: "test",
    MONGODB_URI: undefined,
  });
  const baseUrl = await listen(server);

  try {
    const statuses = [];
    // Same "direct client" (127.0.0.1 loopback, as this test always is),
    // claiming a DIFFERENT X-Forwarded-For on every single request — if
    // trust proxy were incorrectly trusting this header here, each request
    // would land in its own fresh bucket and never get rate-limited.
    for (let i = 0; i < 11; i += 1) {
      statuses.push(await loginAttempt(baseUrl, `10.0.0.${i}`));
    }

    assert.equal(
      statuses[10],
      429,
      "in plain local development, a directly-connecting client must not be able to reset its rate-limit bucket by varying X-Forwarded-For"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});

test("A2.4 — local development default: requests with no X-Forwarded-For at all still work normally (nothing broken for the common case)", async () => {
  const { server, restore } = startServerWithEnv({
    TRUST_PROXY: undefined,
    RENDER: undefined,
    NODE_ENV: "test",
    MONGODB_URI: undefined,
  });
  const baseUrl = await listen(server);

  try {
    const status = await loginAttempt(baseUrl, undefined);
    assert.equal(status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});
