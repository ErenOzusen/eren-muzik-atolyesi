// B3 — static scan: no console.* call anywhere in server.js may log raw
// personal fields (name/phone/email/message/note) or secrets
// (password/token/authorization). Zero-network, zero-DB, source-text-only —
// matches the static-assertion testing style already used across this
// repo's automation test suite.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");

function readServerSource() {
  return readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
}

// Finds the substring of `text` starting at `openParenIndex` (which must
// point at an opening "(") up to and including its matching closing ")".
// A simple depth counter is sufficient for this codebase's actual call
// sites (no parens appear inside string literals within any console.*
// call argument list here).
function extractBalancedParens(text, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openParenIndex, i + 1);
      }
    }
  }
  throw new Error("unbalanced parens starting at index " + openParenIndex);
}

function findConsoleCallArgs(source) {
  const calls = [];
  const consoleCallRegex = /console\.(log|error|warn|info)\(/g;
  let match;
  while ((match = consoleCallRegex.exec(source)) !== null) {
    const openParenIndex = match.index + match[0].length - 1;
    calls.push({
      method: match[1],
      index: match.index,
      argsText: extractBalancedParens(source, openParenIndex),
    });
  }
  return calls;
}

const FORBIDDEN_PATTERNS = [
  { pattern: /formatSubmission\s*\(/, label: "formatSubmission(...) (name/phone/lesson/message)" },
  { pattern: /formatAppointment\s*\(/, label: "formatAppointment(...) (name/phone/email/note)" },
  { pattern: /\.email\b/, label: ".email" },
  { pattern: /\.phone\b/, label: ".phone" },
  // Excludes error.message / emailError.message / dbError.message (a
  // completely normal, safe thing to log) — only flags the contact-form
  // "message" field, e.g. submission.message or req.body.message.
  { pattern: /(?<!rror)\.message\b/i, label: ".message (submission text, not error.message)" },
  { pattern: /\bnote\b/, label: "note" },
  { pattern: /\bpassword\b/i, label: "password" },
  { pattern: /authorization/i, label: "authorization" },
  { pattern: /ADMIN_TOKEN_SECRET/, label: "ADMIN_TOKEN_SECRET" },
  { pattern: /ADMIN_PASSWORD/, label: "ADMIN_PASSWORD" },
  { pattern: /req\.body\b/, label: "req.body (raw payload)" },
];

test("B3 — no console.* call in server.js logs PII fields or secrets", () => {
  const source = readServerSource();
  const calls = findConsoleCallArgs(source);

  assert.ok(calls.length > 10, "sanity check: expected many console.* calls in server.js");

  for (const call of calls) {
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      assert.ok(
        !pattern.test(call.argsText),
        `console.${call.method} call contains forbidden pattern "${label}": ${call.argsText.slice(0, 160)}`
      );
    }
  }
});

test("B3 — the three previously PII-leaking log sites now log only operational fields", () => {
  const source = readServerSource();

  assert.match(source, /Yeni başvuru kaydedildi.*\{\s*\n\s*id: submission\._id\.toString\(\)/s);
  assert.match(source, /Yeni randevu talebi oluşturuldu.*\{\s*\n\s*id: appointment\._id\.toString\(\)/s);
  assert.match(source, /Ön görüşme onay e-postası gönderildi.*\{\s*\n\s*appointmentId: updatedAppointment\._id\.toString\(\)/s);
});
