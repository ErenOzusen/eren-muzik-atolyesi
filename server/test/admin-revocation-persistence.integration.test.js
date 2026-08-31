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
const { _resetRevokedTokensForTests } = require("../auth");

let mongod;
let server;
let baseUrl;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
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

async function login() {
  const { json } = await request("POST", "/api/admin/login", {
    body: { password: "revocation-persistence-test-password" },
  });
  return json.token;
}

test("a) a freshly issued token is accepted", async () => {
  const token = await login();
  const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
});

test("b) logout revokes the token: rejected immediately afterward", async () => {
  const token = await login();
  const { status: logoutStatus } = await request("POST", "/api/admin/logout", { token });
  assert.equal(logoutStatus, 200);

  const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.equal(status, 403);
});

test("c) revocation survives a simulated backend restart (in-memory state wiped, DB-backed check still rejects)", async () => {
  const token = await login();
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
  const tokenA = await login();
  const tokenB = await login();

  await request("POST", "/api/admin/logout", { token: tokenA });
  _resetRevokedTokensForTests(); // simulate restart, same as test c)

  const { status: statusA } = await request("GET", "/api/admin/weekly-schedule", { token: tokenA });
  assert.equal(statusA, 403);

  const { status: statusB } = await request("GET", "/api/admin/weekly-schedule", { token: tokenB });
  assert.notEqual(statusB, 401);
  assert.notEqual(statusB, 403);
});

test("e) a TTL index on expiresAt exists on the revocation collection (expired revocation records self-clean)", async () => {
  const token = await login();
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
  const token = await login();
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
  const token = await login();

  // Force the persistent-revocation check itself to throw, simulating a
  // real store error while the connection stays live (distinct from "not
  // connected", which auth-middleware.js is deliberately allowed to
  // tolerate — see revocationService.js's own comments on that trade-off).
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
  const token = await login();
  await request("POST", "/api/admin/logout", { token });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { status } = await request("GET", "/api/admin/weekly-schedule", { token });
    assert.equal(status, 403);
  }
});
