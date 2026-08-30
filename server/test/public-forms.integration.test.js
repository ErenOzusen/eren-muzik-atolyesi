// Integration tests for the public /api/contact and /api/appointments
// hardening. Runs the real Express app in-process; no MongoDB connection is
// made, so every request that passes validation reaches the DB layer and
// gets a 503 (ensureDbConnection) rather than a real write. That is exactly
// what these tests check for "valid input" cases — this suite only proves
// the validation/shape/rate-limit layer, the same convention used by
// admin-auth.integration.test.js.
process.env.ADMIN_PASSWORD = "public-forms-test-password";
process.env.ADMIN_TOKEN_SECRET = "public-forms-test-token-secret-with-enough-length-1234567890";
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

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

const validContact = {
  name: "Test Öğrenci",
  phone: "0532 123 45 67",
  lesson: "Gitar",
  message: "Merhaba, bilgi almak istiyorum.",
};

function futureDateString(daysFromNow) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

const validAppointment = {
  name: "Test Öğrenci",
  phone: "0532 123 45 67",
  email: "ogrenci@example.com",
  lesson: "Piyano",
  appointmentDate: futureDateString(7),
  appointmentTime: "11:00",
  note: "",
};

test("valid contact payload passes validation (reaches the DB layer: 503, not 400)", async () => {
  const { status } = await post("/api/contact", validContact);
  assert.equal(status, 503);
});

test("contact: rejects an unexpected extra field", async () => {
  const { status, json } = await post("/api/contact", { ...validContact, isAdmin: true });
  assert.equal(status, 400);
  assert.equal(json.success, false);
});

test("contact: rejects a filled honeypot field", async () => {
  const { status } = await post("/api/contact", { ...validContact, website: "http://spam.example" });
  assert.equal(status, 400);
});

test("contact: accepts an empty honeypot field", async () => {
  const { status } = await post("/api/contact", { ...validContact, website: "" });
  assert.equal(status, 503); // passed validation, reached the (unavailable) DB layer
});

test("contact: rejects an invalid (non-whitelisted) lesson", async () => {
  const { status } = await post("/api/contact", { ...validContact, lesson: "Davul" });
  assert.equal(status, 400);
});

test("contact: rejects an invalid phone number", async () => {
  const { status } = await post("/api/contact", { ...validContact, phone: "not-a-phone" });
  assert.equal(status, 400);
});

test("contact: rejects an oversized message", async () => {
  const { status } = await post("/api/contact", { ...validContact, message: "a".repeat(3000) });
  assert.equal(status, 400);
});

test("valid appointment payload passes validation (reaches the DB layer: 503, not 400)", async () => {
  const { status } = await post("/api/appointments", validAppointment);
  assert.equal(status, 503);
});

test("appointments: rejects an unexpected extra field", async () => {
  const { status } = await post("/api/appointments", { ...validAppointment, role: "admin" });
  assert.equal(status, 400);
});

test("appointments: rejects a filled honeypot field", async () => {
  const { status } = await post("/api/appointments", { ...validAppointment, website: "spam" });
  assert.equal(status, 400);
});

test("appointments: rejects an invalid lesson", async () => {
  const { status } = await post("/api/appointments", { ...validAppointment, lesson: "Davul" });
  assert.equal(status, 400);
});

test("appointments: rejects a malformed email when one is provided", async () => {
  const { status } = await post("/api/appointments", { ...validAppointment, email: "not-an-email" });
  assert.equal(status, 400);
});

test("appointments: accepts a missing/empty email (still optional)", async () => {
  const { status } = await post("/api/appointments", { ...validAppointment, email: "" });
  assert.equal(status, 503);
});

test("appointments: rejects a date in the past", async () => {
  const { status, json } = await post("/api/appointments", {
    ...validAppointment,
    appointmentDate: "2020-01-01",
  });
  assert.equal(status, 400);
  assert.match(json.message, /geçmiş/i);
});

test("appointments: rejects an oversized note", async () => {
  const { status } = await post("/api/appointments", { ...validAppointment, note: "a".repeat(600) });
  assert.equal(status, 400);
});

// Runs LAST: exhausts the shared public-form rate limiter for this
// process's source IP across both /api/contact and /api/appointments (they
// share one limiter instance in server.js).
test("public form endpoints are rate-limited after repeated requests", async () => {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const { status } = await post("/api/contact", validContact);
    lastStatus = status;
  }
  assert.equal(lastStatus, 429);
});
