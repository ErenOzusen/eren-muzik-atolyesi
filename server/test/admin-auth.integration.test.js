// Integration tests for admin-route auth. Runs the real Express app
// in-process on an ephemeral port; no MongoDB connection is made (the app
// is required as a module, so `connectMongo`/`app.listen` never run — see
// the `require.main === module` guard at the bottom of server.js). Routes
// that need the DB will correctly return 503 past the auth layer; this
// suite only asserts on the auth layer itself: 401/403 vs "got through".
process.env.ADMIN_PASSWORD = "integration-test-password";
process.env.ADMIN_TOKEN_SECRET = "integration-test-token-secret-with-enough-length-1234567890";
delete process.env.MONGODB_URI;

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const app = require("../server.js");

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Every route that must require admin auth. This list is the actual
// regression contract: if a future change adds a new /api/admin/* route (or
// an equivalent sensitive route outside that prefix) without wiring
// checkAdminToken, add it here and this suite must fail until it's fixed.
const ADMIN_ROUTES = [
  ["POST", "/api/admin/blocked-slots"],
  ["GET", "/api/admin/blocked-slots"],
  ["DELETE", "/api/admin/blocked-slots/000000000000000000000000"],
  ["GET", "/api/admin/weekly-schedule"],
  ["PUT", "/api/admin/weekly-schedule/1"],
  ["GET", "/api/admin/videos"],
  ["POST", "/api/admin/videos"],
  ["PATCH", "/api/admin/videos/000000000000000000000000"],
  ["DELETE", "/api/admin/videos/000000000000000000000000"],
  ["GET", "/api/admin/appointments"],
  ["PATCH", "/api/admin/appointments/000000000000000000000000/status"],
  ["DELETE", "/api/admin/appointments/000000000000000000000000"],
  ["GET", "/api/submissions"],
  ["PATCH", "/api/submissions/000000000000000000000000/status"],
  ["DELETE", "/api/submissions/000000000000000000000000"],
  ["POST", "/api/admin/logout"],
];

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

test("every admin route rejects requests with no Authorization header (401/403)", async () => {
  for (const [method, path] of ADMIN_ROUTES) {
    const { status } = await request(method, path);
    assert.ok(
      status === 401 || status === 403,
      `${method} ${path} should reject unauthenticated requests, got ${status}`
    );
  }
});

test("every admin route rejects an obviously wrong bearer token (403)", async () => {
  for (const [method, path] of ADMIN_ROUTES) {
    const { status } = await request(method, path, { token: "not-a-real-token" });
    assert.equal(status, 403, `${method} ${path} should reject a garbage token`);
  }
});

test("POST /api/admin/login rejects the wrong password", async () => {
  const { status, json } = await request("POST", "/api/admin/login", {
    body: { password: "definitely-wrong" },
  });
  assert.equal(status, 401);
  assert.equal(json.success, false);
});

test("POST /api/admin/login issues a working token for the correct password, and every admin route accepts it (no 401/403)", async () => {
  const { status: loginStatus, json: loginJson } = await request("POST", "/api/admin/login", {
    body: { password: "integration-test-password" },
  });
  assert.equal(loginStatus, 200);
  assert.equal(loginJson.success, true);
  assert.ok(typeof loginJson.token === "string" && loginJson.token.length > 0);

  const token = loginJson.token;

  for (const [method, path] of ADMIN_ROUTES) {
    if (method === "POST" && path === "/api/admin/logout") {
      // exercised separately below, since it consumes the token
      continue;
    }
    const { status } = await request(method, path, { token });
    assert.ok(
      status !== 401 && status !== 403,
      `${method} ${path} should accept a valid token (got ${status}, expected e.g. 503 due to no DB in this test)`
    );
  }
});

test("logout revokes the token: it works once, then the same token is rejected", async () => {
  const { json: loginJson } = await request("POST", "/api/admin/login", {
    body: { password: "integration-test-password" },
  });
  const token = loginJson.token;

  const { status: firstAdminCall } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.notEqual(firstAdminCall, 403);

  const { status: logoutStatus } = await request("POST", "/api/admin/logout", { token });
  assert.equal(logoutStatus, 200);

  const { status: afterLogout } = await request("GET", "/api/admin/weekly-schedule", { token });
  assert.equal(afterLogout, 403, "a revoked (logged-out) token must be rejected");
});

test("a request with a disallowed Origin header is rejected by CORS (403), a normal same-origin/no-origin request is not", async () => {
  // Uses the public "/" route so this test isolates CORS behavior from the
  // admin-auth layer (an admin route would also 403 on a missing token,
  // which would make this assertion meaningless either way).
  const response = await fetch(`${baseUrl}/`, {
    headers: { Origin: "https://evil-example.com" },
  });
  assert.equal(response.status, 403);

  const noOriginResponse = await fetch(`${baseUrl}/`);
  assert.notEqual(noOriginResponse.status, 403);

  const allowedOriginResponse = await fetch(`${baseUrl}/`, {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.notEqual(allowedOriginResponse.status, 403);
});

// Runs LAST: this deliberately exhausts the login rate limiter's budget for
// this test process's source IP, so it must not run before the tests above.
test("POST /api/admin/login is rate-limited after repeated failed attempts (brute-force protection)", async () => {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { status } = await request("POST", "/api/admin/login", {
      body: { password: "still-wrong" },
    });
    lastStatus = status;
  }
  assert.equal(lastStatus, 429, "after enough failed attempts, login must be rate-limited");
});
