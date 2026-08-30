const { loadAdminSecrets, verifyAdminToken } = require("../auth");

// Fail-closed: refuses to start rather than run with an insecure default
// admin password/token, in every environment (see auth.js). This runs at
// module-require time (not lazily inside a request handler) so a
// missing/weak secret crashes startup immediately, exactly as it did when
// this call lived at server.js's own top level.
const { adminPassword: ADMIN_PASSWORD, tokenSecret: ADMIN_TOKEN_SECRET } =
  loadAdminSecrets();

const checkAdminToken = (req, res, next) => {
  const authorizationHeader = req.headers.authorization || "";
  const token = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : "";

  const result = verifyAdminToken(token, ADMIN_TOKEN_SECRET);

  if (result.valid) {
    req.adminTokenId = result.jti;
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Yetkisiz erişim",
  });
};

module.exports = { checkAdminToken, ADMIN_PASSWORD, ADMIN_TOKEN_SECRET };
