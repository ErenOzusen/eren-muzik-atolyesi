const { createAdminToken, revokeAdminToken, timingSafeEqualStrings } = require("../auth");
const { ADMIN_PASSWORD, ADMIN_TOKEN_SECRET } = require("../middleware/authMiddleware");
const { persistAdminTokenRevocation } = require("../services/revocationService");

function login(req, res) {
  const { password } = req.body;

  if (
    typeof password !== "string" ||
    !timingSafeEqualStrings(password, ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      success: false,
      message: "Şifre hatalı",
    });
  }

  const token = createAdminToken(ADMIN_TOKEN_SECRET);

  return res.json({
    success: true,
    message: "Admin girişi başarılı",
    token,
  });
}

// Admin: oturumu sonlandır (token'ı sunucu tarafında geçersiz kıl).
// Revokes in-memory immediately (unchanged) — the token is already invalid
// in this process by the time persistAdminTokenRevocation runs, so a
// durability failure never blocks or fails the logout call itself. But it
// also must never be presented as an identical, fully-successful logout:
// `persisted` reports honestly whether the revocation is guaranteed to
// survive a restart/redeploy (see services/revocationService.js for every
// case — no store configured, store configured but not ready, or a write
// that itself failed — each already logs loudly server-side when it isn't
// simply "no store configured at all").
async function logout(req, res) {
  revokeAdminToken(req.adminTokenId);
  const persisted = await persistAdminTokenRevocation(req.adminTokenId, req.adminTokenExpiresAt);

  res.json({
    success: true,
    message: "Çıkış yapıldı",
    persisted,
  });
}

module.exports = { login, logout };
