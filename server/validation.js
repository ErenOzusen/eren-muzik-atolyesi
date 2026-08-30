// Pure, zero-dependency validation helpers for the public-facing forms
// (/api/contact, /api/appointments). Kept dependency-free and DB-free so it
// can be unit-tested directly with no network/DB involved.

const LESSON_WHITELIST = [
  "Gitar",
  "Piyano",
  "Bas Gitar",
  "Müzik Teorisi",
  "Çocuklar İçin Müzik",
];

const MAX_LENGTHS = {
  name: 100,
  phone: 30,
  email: 200,
  lesson: 50,
  message: 2000,
  note: 500,
  appointmentDate: 10,
  appointmentTime: 5,
};

// Deliberately permissive (Turkish numbers, spaces, parens, +, -), just
// enough to reject garbage/oversized input — not a strict E.164 validator.
const PHONE_PATTERN = /^[0-9+()\s-]{7,30}$/;

// Practical, not RFC-5322-complete: rejects obviously malformed input while
// staying permissive enough not to bounce real addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function exceedsMaxLength(value, field) {
  const limit = MAX_LENGTHS[field];
  return typeof value === "string" && limit !== undefined && value.length > limit;
}

function isValidLesson(value) {
  return typeof value === "string" && LESSON_WHITELIST.includes(value.trim());
}

function isValidPhone(value) {
  return typeof value === "string" && PHONE_PATTERN.test(value.trim());
}

function isValidEmail(value) {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim());
}

// Rejects the payload outright (rather than silently stripping) if it
// contains any key outside the allowed set, or if a honeypot field was
// filled in (a human never sees or fills that field; a naive bot script
// often does). Returns { ok: true } or { ok: false, reason }.
function checkPayloadShape(body, allowedKeys, honeypotKeys = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_body" };
  }

  const allowed = new Set([...allowedKeys, ...honeypotKeys]);
  const unexpectedKeys = Object.keys(body).filter((key) => !allowed.has(key));

  if (unexpectedKeys.length > 0) {
    return { ok: false, reason: "unexpected_fields", fields: unexpectedKeys };
  }

  for (const honeypotKey of honeypotKeys) {
    const value = body[honeypotKey];
    if (typeof value === "string" && value.trim().length > 0) {
      return { ok: false, reason: "honeypot" };
    }
  }

  return { ok: true };
}

// YYYY-MM-DD, must be a real calendar date, and must not be strictly before
// today (server clock, UTC day boundary — same convention already used for
// the existing weekday/working-hours checks in server.js).
function isValidNotPastDate(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  const isRealCalendarDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  if (!isRealCalendarDate) {
    return false;
  }

  const now = new Date();
  const todayUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  return parsed.getTime() >= todayUtcMidnight;
}

module.exports = {
  LESSON_WHITELIST,
  MAX_LENGTHS,
  isNonEmptyString,
  exceedsMaxLength,
  isValidLesson,
  isValidPhone,
  isValidEmail,
  checkPayloadShape,
  isValidNotPastDate,
};
