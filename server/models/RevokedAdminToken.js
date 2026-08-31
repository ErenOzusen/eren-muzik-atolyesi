const mongoose = require("mongoose");

// Persists ONLY what is needed to keep an admin-token revocation effective
// across a backend restart/redeploy: the token's jti (a random 128-bit id
// minted by auth.js's generateJti()) and the moment the token would have
// expired naturally anyway. Never the raw bearer token string, never
// ADMIN_PASSWORD, never ADMIN_TOKEN_SECRET — none of those are ever passed
// to this model (see services/revocationService.js, the only code that
// writes to this collection).
//
// expiresAt carries a MongoDB TTL index (expireAfterSeconds: 0): once a
// revoked token's own natural expiry passes, auth.js's own expiry check
// would already reject it on cryptographic grounds alone, so the
// revocation record has served its purpose — MongoDB removes it
// automatically and this store never grows unbounded.
const revokedAdminTokenSchema = new mongoose.Schema(
  {
    jti: {
      type: String,
      required: true,
      unique: true,
      match: /^[0-9a-f]{32}$/,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    versionKey: false,
  }
);

revokedAdminTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RevokedAdminToken", revokedAdminTokenSchema);
