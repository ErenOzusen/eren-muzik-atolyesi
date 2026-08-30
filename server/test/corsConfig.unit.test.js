// Zero-network unit tests for server/corsConfig.js (B4).
const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAllowedOrigins, PRODUCTION_ORIGIN } = require("../config/corsConfig");

test("B4 — production origin is included even when ALLOWED_ORIGINS is unset", () => {
  const origins = resolveAllowedOrigins({});
  assert.ok(origins.has(PRODUCTION_ORIGIN));
});

test("B4 — production origin is STILL included when ALLOWED_ORIGINS is set to something else entirely", () => {
  const origins = resolveAllowedOrigins({ ALLOWED_ORIGINS: "https://staging.example.com" });
  assert.ok(origins.has(PRODUCTION_ORIGIN), "setting ALLOWED_ORIGINS must never drop the production origin");
  assert.ok(origins.has("https://staging.example.com"));
});

test("B4 — localhost dev origins are always included", () => {
  const origins = resolveAllowedOrigins({ ALLOWED_ORIGINS: "https://only-this.example.com" });
  assert.ok(origins.has("http://localhost:5173"));
  assert.ok(origins.has("http://127.0.0.1:5173"));
  assert.ok(origins.has("http://localhost:3000"));
});

test("B4 — multiple configured origins are all accepted", () => {
  const origins = resolveAllowedOrigins({
    ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com",
  });
  assert.ok(origins.has("https://a.example.com"));
  assert.ok(origins.has("https://b.example.com"));
});

test("B4 — origins are normalized (trailing slash / path stripped to bare origin)", () => {
  const origins = resolveAllowedOrigins({ ALLOWED_ORIGINS: "https://a.example.com/" });
  assert.ok(origins.has("https://a.example.com"));
});

test("B4 — a literal wildcard is rejected, fail-closed", () => {
  assert.throws(() => resolveAllowedOrigins({ ALLOWED_ORIGINS: "*" }), /wildcard/);
});

test("B4 — a malformed URL is rejected, fail-closed, with an explicit error", () => {
  assert.throws(() => resolveAllowedOrigins({ ALLOWED_ORIGINS: "not a url" }), /ALLOWED_ORIGINS/);
  assert.throws(() => resolveAllowedOrigins({ ALLOWED_ORIGINS: "ftp://example.com" }), /http\/https/);
  assert.throws(() => resolveAllowedOrigins({ ALLOWED_ORIGINS: "example.com" }), /ALLOWED_ORIGINS/);
});

test("B4 — empty/whitespace-only ALLOWED_ORIGINS behaves like unset (no error, safe defaults only)", () => {
  const origins = resolveAllowedOrigins({ ALLOWED_ORIGINS: "   " });
  assert.ok(origins.has(PRODUCTION_ORIGIN));
  assert.equal(origins.size, 4); // production + 3 localhost dev origins, nothing else
});
