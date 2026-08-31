const mongoose = require("mongoose");
const RevokedAdminToken = require("../models/RevokedAdminToken");

// A persistent revocation store is considered "configured for this
// deployment" only when BOTH are true: MONGODB_URI is set (the same signal
// config/database.js's own connectMongo() uses to decide whether to
// connect at all), AND mongoose.connect() has actually been invoked at
// least once in this process. This mirrors production reality — in real
// server.js's own startup, connectMongo() only ever calls
// mongoose.connect() when MONGODB_URI is present, so the two facts are
// always coupled there — and is what makes the three cases below actually
// distinguishable:
//   - not configured (no attempted connection) -> pre-existing, DB-less mode
//   - configured AND connection ready           -> real persistent check
//   - configured BUT connection not ready        -> a genuine store error
//
// The connection-attempt flag (not a bare env-var read) is required
// because of a real, verified interaction in this codebase: server.js's
// very first line unconditionally calls `require("dotenv").config()`,
// which — dotenv's own default behavior — fills in any *currently unset*
// process.env var from server/.env, MONGODB_URI included. So a test that
// does `delete process.env.MONGODB_URI` and then requires server.js (see
// admin-auth.integration.test.js, which relies on running with zero real
// DB connection) sees the variable silently reappear the instant server.js
// loads — even though mongoose.connect() is never actually called there
// (server.js's connectMongo() only runs under its `require.main === module`
// guard, which is false when required as a test module). Reading the env
// var alone would have wrongly classified that file as "configured", which
// would have made every admin route reject a perfectly valid token with no
// database involved at all — a real regression this project's test suite
// caught. Latching on mongoose's own "connecting" event (which fires
// synchronously the instant mongoose.connect() is called, regardless of
// whether the attempt eventually succeeds) is immune to that: it reflects
// whether a connection was ever actually attempted, not what a JSON/dotenv
// side effect left sitting in an env var.
let connectionEverAttempted = mongoose.connection.readyState !== 0;
mongoose.connection.on("connecting", () => {
  connectionEverAttempted = true;
});

function isRevocationStoreConfigured() {
  const uriConfigured = Boolean(process.env.MONGODB_URI && process.env.MONGODB_URI.trim());
  return uriConfigured && connectionEverAttempted;
}

// Persists an admin-token revocation so it survives a backend
// restart/redeploy, on top of (never instead of) auth.js's existing
// in-memory revokedJtis Set. Called from authController.logout right after
// the in-memory revocation, so a revoked token is invalid immediately in
// this process either way, and stays invalid in every future process once
// this write lands.
//
// Returns true only when the write is confirmed durable. Every other
// outcome (no store configured, store configured but not ready, or a write
// that itself fails) returns false and — except for the plain "not
// configured" case, which is the pre-existing, expected DB-less mode and
// logs nothing — logs loudly, so a real persistence problem is never
// invisible. The caller (authController.logout) reports this back in its
// response instead of presenting every logout as identically successful;
// it never throws, because the in-memory revocation has already made the
// token invalid in this process by the time this runs, and logout must not
// appear to fail outright over a durability problem alone.
async function persistAdminTokenRevocation(jti, expiresAtEpochSeconds) {
  if (!jti || !Number.isFinite(expiresAtEpochSeconds)) {
    return false;
  }

  if (!isRevocationStoreConfigured()) {
    return false;
  }

  if (mongoose.connection.readyState !== 1) {
    console.error(
      "Admin token iptali kalıcı depoya yazılamadı: MONGODB_URI tanımlı ama bağlantı hazır değil " +
        `(readyState=${mongoose.connection.readyState}). Bellek içi iptal bu süreçte hâlâ geçerli, ` +
        "ancak bir sonraki restart'ta kaybolabilir."
    );
    return false;
  }

  try {
    await RevokedAdminToken.updateOne(
      { jti },
      { $setOnInsert: { jti, expiresAt: new Date(expiresAtEpochSeconds * 1000) } },
      { upsert: true, maxTimeMS: 3000 }
    );
    return true;
  } catch (error) {
    console.error(
      "Admin token iptali kalıcı depoya yazılamadı (bellek içi iptal bu süreçte hâlâ geçerli, " +
        "ancak bir sonraki restart'ta kaybolabilir):",
      error.message
    );
    return false;
  }
}

// Fail-closed by construction: any error while consulting the persistent
// revocation store must never be interpreted as "not revoked" — the caller
// (middleware/authMiddleware.js) rejects the request when this throws.
//
// The ONLY case that returns false without a real DB check is "no
// persistent store configured at all" (no MONGODB_URI) — the exact same
// "DB feature not available" mode the rest of this backend already
// tolerates elsewhere (see config/database.js's ensureDbConnection). In
// that mode auth.js's own cryptographic checks (HMAC, canonical encoding,
// expiry) plus its in-memory revocation set remain the sole authority,
// exactly as before this feature existed.
//
// If a store IS configured (MONGODB_URI set) but the connection is not
// currently usable — disconnected, connecting, disconnecting, or otherwise
// unreachable — this throws rather than returning false. We cannot prove
// the jti isn't revoked in that state, and a deployment that configured a
// persistent store gets the guarantee it asked for, not a silent
// downgrade. A connection that IS ready but whose query then fails
// (timeout, dropped mid-request, etc.) is likewise never swallowed.
async function isJtiPersistentlyRevoked(jti) {
  if (!isRevocationStoreConfigured()) {
    return false;
  }

  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      "Revocation store yapılandırılmış (MONGODB_URI var) ama bağlantı hazır değil " +
        `(readyState=${mongoose.connection.readyState})`
    );
  }

  const found = await RevokedAdminToken.findOne({ jti }, { _id: 1 }).maxTimeMS(3000).lean();
  return Boolean(found);
}

module.exports = {
  persistAdminTokenRevocation,
  isJtiPersistentlyRevoked,
  isRevocationStoreConfigured,
};
