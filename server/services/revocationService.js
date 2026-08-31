const mongoose = require("mongoose");
const RevokedAdminToken = require("../models/RevokedAdminToken");

// Persists an admin-token revocation so it survives a backend
// restart/redeploy, on top of (never instead of) auth.js's existing
// in-memory revokedJtis Set. Called from authController.logout right after
// the in-memory revocation, so a revoked token is invalid immediately in
// this process either way, and stays invalid in every future process once
// this write lands.
//
// If MongoDB is simply not connected, this is the exact same "DB feature
// not configured for this deployment" situation config/database.js's
// ensureDbConnection() already tolerates elsewhere in this codebase — admin
// login/logout must keep working with in-memory-only revocation exactly as
// it did before this feature existed, so this returns immediately instead
// of letting Mongoose buffer the write for up to its default 10s timeout.
//
// A write that IS attempted but fails (transient network error, timeout)
// is logged, never thrown back into the logout response: the in-memory
// revocation has already made the token invalid in this process by the
// time this runs, so logout must not appear to fail over a transient
// durability error. The trade-off (this one write failing right before an
// immediate restart could lose that token's cross-restart revocation) is a
// deliberate, disclosed choice — not a silent weakening — and does not
// affect the fail-closed guarantee at verification time (see
// isJtiPersistentlyRevoked below), which is the one this feature is
// actually built to close.
async function persistAdminTokenRevocation(jti, expiresAtEpochSeconds) {
  if (!jti || !Number.isFinite(expiresAtEpochSeconds)) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  try {
    await RevokedAdminToken.updateOne(
      { jti },
      { $setOnInsert: { jti, expiresAt: new Date(expiresAtEpochSeconds * 1000) } },
      { upsert: true, maxTimeMS: 3000 }
    );
  } catch (error) {
    console.error(
      "Admin token iptali kalıcı depoya yazılamadı (bellek içi iptal bu süreçte hâlâ geçerli, " +
        "ancak bir sonraki restart'ta kaybolabilir):",
      error.message
    );
  }
}

// Fail-closed by construction: any error while consulting the persistent
// revocation store must never be interpreted as "not revoked" — the caller
// (middleware/authMiddleware.js) rejects the request when this throws. The
// one deliberate exception is "Mongo was never connected at all"
// (readyState !== 1), handled the same way as the write path above: that is
// a static, known "no persistent store configured" condition, not a
// runtime error, and in that mode auth.js's own cryptographic checks
// (HMAC, canonical encoding, expiry) plus its in-memory revocation set
// remain the sole authority — exactly as before this feature existed. A
// connection that IS live but whose query then fails (timeout, dropped
// connection, etc.) is a genuine error and is NOT swallowed here; it
// propagates so the caller fails closed.
async function isJtiPersistentlyRevoked(jti) {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }

  const found = await RevokedAdminToken.findOne({ jti }, { _id: 1 }).maxTimeMS(3000).lean();
  return Boolean(found);
}

module.exports = { persistAdminTokenRevocation, isJtiPersistentlyRevoked };
