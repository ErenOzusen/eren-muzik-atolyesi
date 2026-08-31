// Integration tests for PERSISTENT admin-token revocation: proves logout
// invalidates a token immediately AND that the invalidation survives a
// simulated backend restart/redeploy (auth.js's in-memory revokedJtis Set
// is wiped, but the MongoDB-backed record — see models/RevokedAdminToken.js
// and services/revocationService.js — is not). Runs against a real,
// ephemeral, local-only MongoDB (mongodb-memory-server), exactly like
// appointment-index.real-mongo.integration.test.js already does for the
// appointment slot index — never a production database.
process.env.ADMIN_PASSWORD = "revocation-persistence-test-password";
process.env.ADMIN_TOKEN_SECRET =
  "revocation-persistence-test-token-secret-with-enough-length-1234567890";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const RevokedAdminToken = require("../models/RevokedAdminToken");
const { createAdminToken, _resetRevokedTokensForTests } = require("../auth");

let mongod;
let server;
let baseUrl;

test.before(async () => {
  mongod = await MongoMemoryServer.create();

  // revocationService.js treats a persistent store as "configured for this
  // deployment" exactly when MONGODB_URI is set (mirroring
  // config/database.js's own connectMongo()) — set it here, exactly as a
  // real deployment would, so this file's tests exercise the real
  // "configured and connected" path rather than the "no store configured"
  // fallback.
  process.env.MONGODB_URI = mongod.getUri();
  await mongoose.connect(mongod.getUri());

  // Required as a module: server.js's own connectMongo()/app.listen() never
  // run (require.main !== module here), so this test manages the Mongo
  // connection itself, same as appointment-index.real-mongo.integration.
  // test.js.
  const app = require("../server.js");
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
  delete process.env.MONGODB_URI;
});

test.beforeEach(async () => {
  await RevokedAdminToken.deleteMany({});
  _resetRevokedTokensForTests();
});

async function request(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response, leave json null
  }
  return { status: response.status, json };
}

// Mints tokens directly via auth.js's own createAdminToken, exactly what
// the real POST /api/admin/login handler does internally — rather than
// round-tripping through that rate-limited HTTP endpoint (10 requests /
// 15 min, see middleware/rateLimiters.js's loginRateLimiter) for every
// token this file needs. This file is testing REVOCATION, not the login
// endpoint itself (admin-auth.integration.test.js already covers that in
// full), so a directly minted token is both equivalent and appropriate;
// test a) below still exercises the real HTTP login endpoint once, so the
// full path is proven at least once in this file too.
function mintToken() {
  return createAdminToken(process.env.ADMIN_TOKEN_SECRET);
}

async function login() {
  const { json } = await request("POST", "/api/admin/login", {
    body: { password: "revocation-persistence-test-password" },
  });
  return json.token;
}

test("a) a freshly issued token is accepted (via the real HTTP login endpoint)", async () => {
  const token = await login();
  const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
});

test("b) logout revokes the token: rejected immediately afterward", async () => {
  const token = mintToken();
  const { status: logoutStatus } = await request("POST", "/api/admin/logout", { token });
  assert.equal(logoutStatus, 200);

  const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.equal(status, 403);
});

test("c) revocation survives a simulated backend restart (in-memory state wiped, DB-backed check still rejects)", async () => {
  const token = mintToken();
  await request("POST", "/api/admin/logout", { token });

  // Simulate exactly what a real process restart does to in-memory state:
  // revokedJtis starts empty again. Deliberately do NOT touch the mongoose
  // connection or the RevokedAdminToken collection — those represent what a
  // restart does NOT wipe (an external database).
  _resetRevokedTokensForTests();

  const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.equal(status, 403, "a token revoked before restart must stay revoked after restart");
});

test("d) revoking one token never affects a different, unrelated valid token", async () => {
  const tokenA = mintToken();
  const tokenB = mintToken();

  await request("POST", "/api/admin/logout", { token: tokenA });
  _resetRevokedTokensForTests(); // simulate restart, same as test c)

  const { status: statusA } = await request("GET", "/api/admin/weekly-schedule", { token: tokenA });
  assert.equal(statusA, 403);

  const { status: statusB } = await request("GET", "/api/admin/weekly-schedule", { token: tokenB });
  assert.notEqual(statusB, 401);
  assert.notEqual(statusB, 403);
});

test("e) a TTL index on expiresAt exists on the revocation collection (expired revocation records self-clean)", async () => {
  const token = mintToken();
  await request("POST", "/api/admin/logout", { token });

  const indexes = await RevokedAdminToken.collection.indexes();
  const ttlIndex = indexes.find(
    (index) =>
      Object.prototype.hasOwnProperty.call(index, "expireAfterSeconds") &&
      index.key &&
      index.key.expiresAt === 1
  );
  assert.ok(ttlIndex, `expected a TTL index on expiresAt, got indexes: ${JSON.stringify(indexes)}`);
  assert.equal(
    ttlIndex.expireAfterSeconds,
    0,
    "TTL index must expire documents exactly at their own expiresAt timestamp, not some offset later"
  );
});

test("f) the persisted revocation record stores only jti + expiresAt — never the raw token, password, or secret", async () => {
  const token = mintToken();
  await request("POST", "/api/admin/logout", { token });

  const docs = await RevokedAdminToken.collection.find({}).toArray();
  assert.equal(docs.length, 1);

  const doc = docs[0];
  assert.deepEqual(Object.keys(doc).sort(), ["_id", "expiresAt", "jti"].sort());
  assert.match(doc.jti, /^[0-9a-f]{32}$/);
  assert.ok(doc.expiresAt instanceof Date);

  const serialized = JSON.stringify(doc);
  assert.doesNotMatch(serialized, /revocation-persistence-test-password/);
  assert.doesNotMatch(serialized, /revocation-persistence-test-token-secret/);
  assert.ok(!serialized.includes(token), "the raw bearer token string must never be persisted");
});

test("g) a revocation-store error while checking fails CLOSED — the token is rejected, not silently accepted", async (t) => {
  const token = mintToken();

  // Force the persistent-revocation check itself to throw, simulating a
  // real store error while the connection stays live and configured
  // (distinct from admin-revocation-store-unavailable.integration.test.js,
  // which covers "MONGODB_URI set but the connection itself isn't ready" —
  // both must fail closed, exercised as two separate, deliberate failure
  // modes).
  const original = RevokedAdminToken.findOne;
  RevokedAdminToken.findOne = () => {
    throw new Error("simulated revocation store failure");
  };
  t.after(() => {
    RevokedAdminToken.findOne = original;
  });

  const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.equal(status, 403, "a revocation-store error must never be treated as 'token is valid'");
});

test("h) a revoked token stays rejected across repeated requests, not just the first one after logout", async () => {
  const token = mintToken();
  await request("POST", "/api/admin/logout", { token });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
    assert.equal(status, 403);
  }
});

test("i) a logout whose persistence write fails is never presented as an identical, fully-successful logout", async (t) => {
  const token = mintToken();

  // Force the persistence write itself to fail, simulating a real store
  // error at logout time (store configured and connected, write throws).
  const original = RevokedAdminToken.updateOne;
  RevokedAdminToken.updateOne = () => {
    throw new Error("simulated persistence write failure");
  };
  t.after(() => {
    RevokedAdminToken.updateOne = original;
  });

  const { status, json } = await request("POST", "/api/admin/logout", { token });

  // Logout still succeeds outright: the in-memory revocation already made
  // the token invalid in this process, so it must not be reported as a
  // hard failure. But it must not look identical to a durable logout
  // either — `persisted: false` is the honest signal a caller (or an
  // ops/monitoring consumer) can check.
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.persisted, false, "a failed persistence write must be reported, not silently reported as fully successful");

  // The immediate, in-process revocation must still have happened despite
  // the persistence failure.
  const { status: afterLogout } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.equal(afterLogout, 403);
});

test("j) a normal logout (persistence succeeds) reports persisted: true", async () => {
  const token = mintToken();
  const { json } = await request("POST", "/api/admin/logout", { token });
  assert.equal(json.persisted, true);
});
