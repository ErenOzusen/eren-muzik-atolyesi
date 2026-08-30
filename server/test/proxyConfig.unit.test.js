// Zero-network unit tests for server/proxyConfig.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTrustProxySetting } = require("../proxyConfig");

test("A2 — no TRUST_PROXY, not Render/production: defaults to false (plain local dev, no reverse proxy)", () => {
  const env = {};
  assert.equal(resolveTrustProxySetting(env), false);
});

test("A2 — no TRUST_PROXY, RENDER set: defaults to 1 (trust exactly one hop)", () => {
  const env = { RENDER: "true" };
  assert.equal(resolveTrustProxySetting(env), 1);
});

test("A2 — no TRUST_PROXY, NODE_ENV=production: defaults to 1", () => {
  const env = { NODE_ENV: "production" };
  assert.equal(resolveTrustProxySetting(env), 1);
});

test("A2 — TRUST_PROXY=true is honored explicitly, even outside Render/production", () => {
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "true" }), true);
});

test("A2 — TRUST_PROXY=false is honored explicitly, even inside Render/production", () => {
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "false", RENDER: "true" }), false);
});

test("A2 — TRUST_PROXY=true fails closed in a Render/production environment (overly broad — trusts the whole X-Forwarded-For chain)", () => {
  assert.throws(
    () => resolveTrustProxySetting({ TRUST_PROXY: "true", RENDER: "true" }),
    /TRUST_PROXY/,
    'TRUST_PROXY="true" must be rejected on Render'
  );
  assert.throws(
    () => resolveTrustProxySetting({ TRUST_PROXY: "true", NODE_ENV: "production" }),
    /TRUST_PROXY/,
    'TRUST_PROXY="true" must be rejected when NODE_ENV=production'
  );
});

test("A2 — TRUST_PROXY=1 (the correct precise value) is still accepted in Render/production", () => {
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "1", RENDER: "true" }), 1);
});

test("A2 — TRUST_PROXY as a plain integer hop count is parsed as a number", () => {
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "1" }), 1);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "2" }), 2);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "0" }), 0);
});

test("A2 — TRUST_PROXY named presets are passed through", () => {
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "loopback" }), "loopback");
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "linklocal" }), "linklocal");
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "uniquelocal" }), "uniquelocal");
});

test("A2 — unrecognized TRUST_PROXY values fail closed at startup, not silently ignored or eval'd", () => {
  for (const bad of ["garbage", "1; rm -rf /", "true false", "-1", "1.2.3.4/99/extra", "()=>{}"]) {
    assert.throws(
      () => resolveTrustProxySetting({ TRUST_PROXY: bad }),
      /TRUST_PROXY/,
      `expected "${bad}" to be rejected`
    );
  }
});

test("A2 — empty-string TRUST_PROXY is treated as unset (falls back to environment default)", () => {
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "" }), false);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "   ", RENDER: "true" }), 1);
});
