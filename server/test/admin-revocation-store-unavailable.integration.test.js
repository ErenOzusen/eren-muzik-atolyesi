// Regression test for a real fail-open bug that was found and fixed in
// services/revocationService.js: when MONGODB_URI IS configured (a real
// deployment expects a persistent revocation store to exist) but the
// mongoose connection itself is not currently usable — disconnected,
// connecting, disconnecting, or otherwise unreachable — a cryptographically
// valid, non-revoked admin token must still be REJECTED by admin token
// verification itself. The store being unavailable must never be silently
// treated as "nothing is revoked".
//
// Deliberately invokes checkAdminToken directly (with a real, valid,
// HMAC-signed token obtained via a real /api/admin/login HTTP call, and a
// real mongod behind it) rather than routing through a specific admin
// endpoint: every existing admin-protected route beyond auth itself also
// touches Mongoose (appointments/videos/schedule/etc.), so a request routed
// through one of those would hit its own, unrelated "no DB" 503 the moment
// the connection drops — masking whether admin token VERIFICATION itself
// accepted or rejected the token, which is the one thing this test needs
// to isolate and prove.
//
// This is deliberately a SEPARATE file from admin-revocation-persistence.
// integration.test.js: it needs to disconnect mongoose mid-suite to prove
// the failure mode, which would corrupt that file's other (connected-path)
// tests if run in the same process/lifecycle. Node's test runner isolates
// each test file into its own process, so this is fully independent.
//
// Runs against a real, ephemeral, local-only MongoDB (mongodb-memory-
// server) — never a production database.
process.env.ADMIN_PASSWORD = "store-unavailable-test-password";
process.env.ADMIN_TOKEN_SECRET =
  "store-unavailable-test-token-secret-with-enough-length-1234567890";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;
let server;
let baseUrl;
let checkAdminToken;

test.before(async () => {
  mongod = await MongoMemoryServer.create();

  // Mark the persistent store as "configured for this deployment" exactly
  // like a real deployment would (see revocationService.js's
  // isRevocationStoreConfigured()) — this is the whole point of this test:
  // a store that IS configured but temporarily unreachable must fail
  // closed, unlike a deployment that never configured one at all.
  process.env.MONGODB_URI = mongod.getUri();
  await mongoose.connect(mongod.getUri());

  const app = require("../server.js");
  ({ checkAdminToken } = require("../middleware/authMiddleware"));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongod.stop();
  delete process.env.MONGODB_URI;
});

async function login() {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "store-unavailable-test-password" }),
  });
  const json = await response.json();
  return json.token;
}

// Minimal fake req/res, exercising checkAdminToken exactly as Express would
// call it — real behavior, not a mock of it, since checkAdminToken itself
// (and everything it calls into: auth.js, revocationService.js) is entirely
// real here. Only req/res are stand-ins, matching how server.js already
// runs (require.main !== module, so no real network is needed to invoke a
// middleware function directly).
function callMiddleware(token) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve({ nextCalled: false, statusCode: this.statusCode, body });
        return this;
      },
    };
    let settled = false;
    const next = () => {
      if (!settled) {
        settled = true;
        resolve({ nextCalled: true, statusCode: res.statusCode, body: res.body });
      }
    };
    Promise.resolve(checkAdminToken(req, res, next)).catch((error) => {
      if (!settled) {
        settled = true;
        resolve({ nextCalled: false, statusCode: res.statusCode, body: res.body, thrown: error });
      }
    });
  });
}

test("i) sanity: while the store is configured AND connected, a valid token reaches next()", async () => {
  const token = await login();
  const result = await callMiddleware(token);
  assert.equal(result.nextCalled, true);
});

test(
  "ii) MONGODB_URI configured but the connection is not ready (disconnected): a cryptographically " +
    "valid, never-revoked token must be REJECTED by admin token verification itself — not silently " +
    "accepted. (Fails under the old readyState-only implementation, passes under the fixed one.)",
  async () => {
    const token = await login();

    // Sanity check first, on the SAME token, while still connected.
    const before = await callMiddleware(token);
    assert.equal(before.nextCalled, true, "token must be accepted before the connection is dropped");

    await mongoose.disconnect(); // MONGODB_URI stays set — store is configured but not ready
    assert.notEqual(mongoose.connection.readyState, 1, "connection must actually be not-ready for this test to mean anything");

    try {
      const result = await callMiddleware(token);
      assert.equal(
        result.nextCalled,
        false,
        "admin token verification must not call next() (accept the token) when the persistent " +
          "revocation store is configured but unreachable"
      );
      assert.equal(result.statusCode, 403);
      assert.equal(result.body && result.body.success, false);
    } finally {
      // Reconnect so test.after's teardown (and any later test in this
      // file) has a clean, known connection state.
      await mongoose.connect(mongod.getUri());
    }
  }
);

test("iii) once the connection is restored, a still-valid (never-revoked) token is accepted again", async () => {
  assert.equal(mongoose.connection.readyState, 1, "connection must be restored by the previous test");
  const token = await login();
  const result = await callMiddleware(token);
  assert.equal(result.nextCalled, true);
});
