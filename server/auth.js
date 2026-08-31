const crypto = require("crypto");

// Admin auth: time-limited, HMAC-signed bearer tokens with a random,
// unforgeable token id (jti) used for revocation.
//
// This intentionally does NOT fall back to any hard-coded default secret or
// password. If the required environment variables are missing — or
// ADMIN_TOKEN_SECRET is too weak to trust as an HMAC key — the process must
// fail to start rather than silently run insecurely. This applies in every
// environment, development included.
//
// Token format: base64url(payload) + "." + hex(hmacSha256(payload))
//   payload = "<issuedAt>.<expiresAt>.<jti>"
//   jti     = 32 hex chars (128 bits) from crypto.randomBytes — the only
//             thing the in-memory revocation set ever stores or checks.
//
// Verification requires the encoded payload to be the CANONICAL base64url
// re-encoding of its own decoded bytes (see verifyAdminToken). This closes
// a previously-found bypass: Node's base64 decoder is lenient and silently
// discards certain malformed trailing groups, so appending an arbitrary
// character to an already-4-aligned encoded payload could decode back to
// the identical payload bytes — producing a *different* token string with
// the *same* valid signature. Because the old design revoked by raw token
// string, that cosmetic variant was never in the revocation set and stayed
// valid after logout. Revoking by a signature-and-canonical-verified jti,
// and rejecting any non-canonical encoding outright, removes that entire
// class of bypass: every wire-string that decodes to the same payload is
// now required to be byte-identical to the one canonical encoding, or it is
// rejected before the signature is even checked.

const ADMIN_TOKEN_TTL_SECONDS = Number(process.env.ADMIN_TOKEN_TTL_SECONDS) > 0
  ? Number(process.env.ADMIN_TOKEN_TTL_SECONDS)
  : 12 * 60 * 60; // 12 hours

const MIN_TOKEN_SECRET_LENGTH = 32;
const MIN_TOKEN_SECRET_DISTINCT_CHARS = 8;

function requireEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(
      `Güvenlik nedeniyle başlatma durduruldu: ${name} ortam değişkeni tanımlı değil. ` +
        "Hiçbir varsayılan admin şifresi veya token değeri kullanılmaz."
    );
  }

  return value;
}

// Fail-closed minimum-strength check for the HMAC signing key specifically
// (not the human-chosen ADMIN_PASSWORD, whose strength is the site owner's
// own call). A short or low-variety value would make the signature
// forgeable by brute force; this does not attempt to "measure entropy"
// precisely, only to reject the clearly-too-weak values a careless
// deployment might set (e.g. "1", "changeme", "eren-admin-token").
function requireStrongTokenSecret(value) {
  if (value.length < MIN_TOKEN_SECRET_LENGTH) {
    throw new Error(
      `Güvenlik nedeniyle başlatma durduruldu: ADMIN_TOKEN_SECRET en az ${MIN_TOKEN_SECRET_LENGTH} ` +
        `karakter olmalı (mevcut uzunluk: ${value.length}). Rastgele üretmek için: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }

  const distinctChars = new Set(value).size;

  if (distinctChars < MIN_TOKEN_SECRET_DISTINCT_CHARS) {
    throw new Error(
      "Güvenlik nedeniyle başlatma durduruldu: ADMIN_TOKEN_SECRET yeterince rastgele görünmüyor " +
        `(yalnızca ${distinctChars} farklı karakter içeriyor). Rastgele üretmek için: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
}

// Loaded once, eagerly, so a missing/weak secret fails at startup
// (fail-closed) instead of failing later on the first login attempt.
function loadAdminSecrets() {
  const adminPassword = requireEnv("ADMIN_PASSWORD");
  const tokenSecret = requireEnv("ADMIN_TOKEN_SECRET");

  requireStrongTokenSecret(tokenSecret);

  return { adminPassword, tokenSecret };
}

// Revocation is keyed by jti (a random token id extracted only from a
// payload that has already passed canonical-encoding AND signature
// verification) — never by the raw wire-format token string.
const revokedJtis = new Set();

function base64UrlEncode(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, "base64").toString("utf8");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function generateJti() {
  return crypto.randomBytes(16).toString("hex"); // 128 bits, 32 hex chars
}

const PAYLOAD_PATTERN = /^(\d{1,20})\.(\d{1,20})\.([0-9a-f]{32})$/;

function createAdminToken(secret, ttlSeconds = ADMIN_TOKEN_TTL_SECONDS) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const jti = generateJti();
  const payload = `${issuedAt}.${expiresAt}.${jti}`;
  const signature = sign(payload, secret);

  return `${base64UrlEncode(payload)}.${signature}`;
}

// Timing-safe comparison that never leaks input length via timing and never
// branches on a length check before comparing: both inputs are first
// reduced to a fixed-length SHA-256 digest (always 32 bytes, regardless of
// input length), so crypto.timingSafeEqual can be called unconditionally.
// This is a standard, correct use of the primitive — not a replacement for
// it — and removes the previous length-mismatch branch, whose own timing
// scaled with the attacker-supplied input's length.
function timingSafeEqualStrings(a, b) {
  const digestA = crypto.createHash("sha256").update(String(a), "utf8").digest();
  const digestB = crypto.createHash("sha256").update(String(b), "utf8").digest();

  return crypto.timingSafeEqual(digestA, digestB);
}

// Returns { valid: true, jti } or { valid: false, reason }. Never throws —
// every failure path (missing, malformed, non-canonical, bad signature,
// expired, revoked) returns a rejection value instead.
function verifyAdminToken(token, secret) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "missing" };
  }

  const separatorIndex = token.lastIndexOf(".");

  if (separatorIndex <= 0) {
    return { valid: false, reason: "malformed" };
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  let payload;

  try {
    payload = base64UrlDecode(encodedPayload);
  } catch {
    return { valid: false, reason: "malformed" };
  }

  // Canonical-encoding check — must happen before trusting anything else
  // about this token. Re-encoding the decoded bytes must reproduce the
  // exact wire-format string; any other string that happens to decode to
  // the same bytes (a non-canonical / padding-manipulated variant) is
  // rejected outright, fail-closed, before the signature is even checked.
  let canonicalEncodedPayload;

  try {
    canonicalEncodedPayload = base64UrlEncode(payload);
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (canonicalEncodedPayload !== encodedPayload) {
    return { valid: false, reason: "non_canonical" };
  }

  const expectedSignature = sign(payload, secret);

  if (!timingSafeEqualStrings(signature, expectedSignature)) {
    return { valid: false, reason: "bad_signature" };
  }

  // Only now — after canonical-encoding AND signature verification have
  // both passed — is the payload's content trusted enough to parse and act
  // on (expiry, jti/revocation lookup).
  const match = PAYLOAD_PATTERN.exec(payload);

  if (!match) {
    return { valid: false, reason: "malformed" };
  }

  const expiresAt = Number(match[2]);
  const jti = match[3];
  const now = Math.floor(Date.now() / 1000);

  if (now >= expiresAt) {
    return { valid: false, reason: "expired" };
  }

  if (revokedJtis.has(jti)) {
    return { valid: false, reason: "revoked" };
  }

  // expiresAt (epoch seconds, from the already-verified payload) is
  // returned alongside jti so a caller that wants to persist revocation
  // beyond this process (see services/revocationService.js) never needs to
  // re-parse the token itself — it only ever sees the jti/expiry pair that
  // has already passed signature and canonical-encoding verification.
  return { valid: true, jti, expiresAt };
}

// Revokes by jti, not by raw token string. Callers should only ever pass a
// jti that came back from a successful verifyAdminToken() call (server.js
// does exactly this: checkAdminToken stores req.adminTokenId = result.jti,
// and /api/admin/logout revokes that).
function revokeAdminToken(jti) {
  if (jti) {
    revokedJtis.add(jti);
  }
}

// Test-only escape hatch: never used by production code paths.
function _resetRevokedTokensForTests() {
  revokedJtis.clear();
}

module.exports = {
  ADMIN_TOKEN_TTL_SECONDS,
  MIN_TOKEN_SECRET_LENGTH,
  MIN_TOKEN_SECRET_DISTINCT_CHARS,
  loadAdminSecrets,
  requireStrongTokenSecret,
  createAdminToken,
  verifyAdminToken,
  revokeAdminToken,
  timingSafeEqualStrings,
  base64UrlEncode,
  base64UrlDecode,
  _resetRevokedTokensForTests,
};
