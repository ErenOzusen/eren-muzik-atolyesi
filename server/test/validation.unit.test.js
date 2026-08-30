// Zero-network, zero-DB unit tests for server/validation.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LESSON_WHITELIST,
  isValidLesson,
  isValidPhone,
  isValidEmail,
  exceedsMaxLength,
  checkPayloadShape,
  isValidNotPastDate,
} = require("../validation");

test("isValidLesson: accepts every whitelisted lesson, rejects anything else", () => {
  for (const lesson of LESSON_WHITELIST) {
    assert.equal(isValidLesson(lesson), true, lesson);
  }
  assert.equal(isValidLesson("Davul"), false);
  assert.equal(isValidLesson("<script>alert(1)</script>"), false);
  assert.equal(isValidLesson(""), false);
  assert.equal(isValidLesson(undefined), false);
});

test("isValidPhone: accepts plausible phone formats, rejects garbage", () => {
  assert.equal(isValidPhone("0532 123 45 67"), true);
  assert.equal(isValidPhone("+90 532 123 45 67"), true);
  assert.equal(isValidPhone("5321234567"), true);
  assert.equal(isValidPhone("abc"), false);
  assert.equal(isValidPhone("12"), false);
  assert.equal(isValidPhone("1".repeat(40)), false);
  assert.equal(isValidPhone(""), false);
});

test("isValidEmail: accepts plausible addresses, rejects malformed ones", () => {
  assert.equal(isValidEmail("ogrenci@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("missing@tld"), false);
  assert.equal(isValidEmail("@example.com"), false);
  assert.equal(isValidEmail(""), false);
});

test("exceedsMaxLength: enforces the configured per-field limits", () => {
  assert.equal(exceedsMaxLength("a".repeat(100), "name"), false);
  assert.equal(exceedsMaxLength("a".repeat(101), "name"), true);
  assert.equal(exceedsMaxLength("a".repeat(2000), "message"), false);
  assert.equal(exceedsMaxLength("a".repeat(2001), "message"), true);
  assert.equal(exceedsMaxLength("short", "unknown-field"), false);
});

test("checkPayloadShape: accepts an exact-match payload", () => {
  const result = checkPayloadShape(
    { name: "a", phone: "b" },
    ["name", "phone"],
    ["website"]
  );
  assert.equal(result.ok, true);
});

test("checkPayloadShape: rejects a payload with unexpected extra fields", () => {
  const result = checkPayloadShape(
    { name: "a", phone: "b", isAdmin: true },
    ["name", "phone"],
    ["website"]
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unexpected_fields");
  assert.deepEqual(result.fields, ["isAdmin"]);
});

test("checkPayloadShape: rejects when the honeypot field is filled in", () => {
  const result = checkPayloadShape(
    { name: "a", phone: "b", website: "http://spam.example" },
    ["name", "phone"],
    ["website"]
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "honeypot");
});

test("checkPayloadShape: allows an empty honeypot field", () => {
  const result = checkPayloadShape(
    { name: "a", phone: "b", website: "" },
    ["name", "phone"],
    ["website"]
  );
  assert.equal(result.ok, true);
});

test("checkPayloadShape: rejects a non-object body", () => {
  for (const bad of [null, undefined, "string", 42, ["a"]]) {
    assert.equal(checkPayloadShape(bad, ["name"]).ok, false);
  }
});

test("isValidNotPastDate: rejects yesterday, accepts today and the future", () => {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const toIso = (date) => date.toISOString().slice(0, 10);

  const yesterday = new Date(todayUtc);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const tomorrow = new Date(todayUtc);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  assert.equal(isValidNotPastDate(toIso(yesterday)), false);
  assert.equal(isValidNotPastDate(toIso(todayUtc)), true);
  assert.equal(isValidNotPastDate(toIso(tomorrow)), true);
});

test("isValidNotPastDate: rejects malformed or impossible calendar dates", () => {
  assert.equal(isValidNotPastDate("2025-13-01"), false);
  assert.equal(isValidNotPastDate("2025-02-30"), false);
  assert.equal(isValidNotPastDate("not-a-date"), false);
  assert.equal(isValidNotPastDate(""), false);
});
