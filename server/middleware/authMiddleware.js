const { loadAdminSecrets, verifyAdminToken } = require("../auth");
const { isJtiPersistentlyRevoked } = require("../services/revocationService");

// Fail-closed: refuses to start rather than run with an insecure default
// admin password/token, in every environment (see auth.js). This runs at
// module-require time (not lazily inside a request handler) so a
// missing/weak secret crashes startup immediately, exactly as it did when
// this call lived at server.js's own top level.
const { adminPassword: ADMIN_PASSWORD, tokenSecret: ADMIN_TOKEN_SECRET } =
  loadAdminSecrets();

const checkAdminToken = async (req, res, next) => {
  const authorizationHeader = req.headers.authorization || "";
  const token = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : "";

  const result = verifyAdminToken(token, ADMIN_TOKEN_SECRET);

  if (!result.valid) {
    return res.status(403).json({
      success: false,
      message: "Yetkisiz erişim",
    });
  }

  // Second, independent revocation check: the in-memory revokedJtis Set
  // (inside verifyAdminToken above) only ever protects the current process
  // — this asks the persistent store too, so a token revoked before a
  // restart/redeploy stays revoked after one. isJtiPersistentlyRevoked()
  // only ever returns false without a real check when no persistent store
  // is configured at all (no MONGODB_URI) — see its own comments. Every
  // other failure — including "MONGODB_URI is set but the connection isn't
  // ready" (disconnected/connecting/disconnecting/unreachable) — throws,
  // and is caught here and fails CLOSED: the request is rejected, never
  // silently let through.
  try {
    if (await isJtiPersistentlyRevoked(result.jti)) {
      return res.status(403).json({
        success: false,
        message: "Yetkisiz erişim",
      });
    }
  } catch (error) {
    console.error(
      "Admin token iptal kontrolü başarısız (kalıcı depo) — istek reddedildi:",
      error.message
    );
    return res.status(403).json({
      success: false,
      message: "Yetkisiz erişim",
    });
  }

  req.adminTokenId = result.jti;
  req.adminTokenExpiresAt = result.expiresAt;
  return next();
};

module.exports = { checkAdminToken, ADMIN_PASSWORD, ADMIN_TOKEN_SECRET };
