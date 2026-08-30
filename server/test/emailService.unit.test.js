// Zero-network unit tests for the outbound-email kill switch in
// services/emailService.js (see testSetup.js for why this exists).
//
// The whole point of this file is to PROVE, not just assume, that no test
// run can ever reach the real Brevo API — including the specific scenario
// the refactor audit flagged: a BREVO_API_KEY that looks completely valid,
// present at the same time as a reachable "DB" (irrelevant here — the
// guard lives inside sendBrevoEmail itself and never looks at DB state at
// all, which is a stronger guarantee than "no DB" ever was).
const test = require("node:test");
const assert = require("node:assert/strict");

const { sendBrevoEmail, isOutboundEmailDisabledForTests } = require("../services/emailService");

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

function stubFetch(response) {
  const previousFetch = global.fetch;
  let callCount = 0;
  let lastArgs = null;

  global.fetch = async (...args) => {
    callCount += 1;
    lastArgs = args;
    return response;
  };

  return {
    callCount: () => callCount,
    lastArgs: () => lastArgs,
    restore() {
      global.fetch = previousFetch;
    },
  };
}

test("isOutboundEmailDisabledForTests: only the exact literal string \"true\" disables outbound email", () => {
  assert.equal(isOutboundEmailDisabledForTests({ DISABLE_OUTBOUND_EMAIL: "true" }), true);

  // Fail-safe means every other value — unset, empty, falsy-looking,
  // wrong case, "1" — must NOT disable real email. A typo in a future
  // production env var must never accidentally suppress customer email.
  assert.equal(isOutboundEmailDisabledForTests({}), false);
  assert.equal(isOutboundEmailDisabledForTests({ DISABLE_OUTBOUND_EMAIL: "" }), false);
  assert.equal(isOutboundEmailDisabledForTests({ DISABLE_OUTBOUND_EMAIL: "1" }), false);
  assert.equal(isOutboundEmailDisabledForTests({ DISABLE_OUTBOUND_EMAIL: "TRUE" }), false);
  assert.equal(isOutboundEmailDisabledForTests({ DISABLE_OUTBOUND_EMAIL: "false" }), false);
});

test("this test process actually has the kill switch on (proves testSetup.js's --require preload ran)", () => {
  assert.equal(
    process.env.DISABLE_OUTBOUND_EMAIL,
    "true",
    "expected `node --require ./testSetup.js` (see package.json's test script) to have set this before any test file ran"
  );
});

test("NEGATIVE: with the kill switch on, a fully valid-looking BREVO_API_KEY/EMAIL_USER/recipient still never reaches fetch()", async () => {
  const fetchStub = stubFetch({ ok: true, status: 200, json: async () => ({ messageId: "should-never-happen" }) });

  try {
    await withEnv(
      {
        // Deliberately realistic-looking values — exactly the audit's
        // concern: "BREVO_API_KEY gerçek/değerli görünse ... bile outbound
        // Brevo request yapılmamalı". DISABLE_OUTBOUND_EMAIL is already
        // "true" process-wide (see previous test) — this only re-asserts
        // it explicitly so this test's intent doesn't depend on file order.
        DISABLE_OUTBOUND_EMAIL: "true",
        BREVO_API_KEY: "xkeysib-fake-but-well-formed-looking-key-1234567890",
        EMAIL_USER: "owner@example.com",
        NOTIFICATION_EMAIL: "owner@example.com",
      },
      async () => {
        const result = await sendBrevoEmail({
          subject: "should never be sent",
          text: "should never be sent",
        });

        assert.equal(result, null, "sendBrevoEmail must short-circuit to null, exactly like the existing missing-config case");
      }
    );

    assert.equal(fetchStub.callCount(), 0, "fetch() must NEVER be called while the outbound-email kill switch is on");
  } finally {
    fetchStub.restore();
  }
});

test("POSITIVE: without the kill switch, a fully configured send still goes through fetch() (the guard doesn't accidentally block real production email)", async () => {
  const fetchStub = stubFetch({ ok: true, status: 200, json: async () => ({ messageId: "fake-message-id" }) });

  try {
    await withEnv(
      {
        // Simulates production: the flag testSetup.js sets is
        // absent, exactly as it always is outside this test process.
        DISABLE_OUTBOUND_EMAIL: undefined,
        BREVO_API_KEY: "xkeysib-fake-but-well-formed-looking-key-1234567890",
        EMAIL_USER: "owner@example.com",
        NOTIFICATION_EMAIL: "owner@example.com",
      },
      async () => {
        const result = await sendBrevoEmail({
          subject: "a real send attempt",
          text: "a real send attempt",
        });

        assert.equal(result?.messageId, "fake-message-id");
      }
    );

    assert.equal(
      fetchStub.callCount(),
      1,
      "fetch() must still be called when DISABLE_OUTBOUND_EMAIL isn't explicitly \"true\" — the guard must never engage on its own"
    );
    assert.equal(fetchStub.lastArgs()[0], "https://api.brevo.com/v3/smtp/email");
  } finally {
    fetchStub.restore();
  }
});
