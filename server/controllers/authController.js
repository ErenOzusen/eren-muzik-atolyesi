const { createAdminToken, revokeAdminToken, timingSafeEqualStrings } = require("../auth");
const { ADMIN_PASSWORD, ADMIN_TOKEN_SECRET } = require("../middleware/authMiddleware");

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

// Admin: oturumu sonlandır (token'ı sunucu tarafında geçersiz kıl)
function logout(req, res) {
  revokeAdminToken(req.adminTokenId);

  res.json({
    success: true,
    message: "Çıkış yapıldı",
  });
}

module.exports = { login, logout };
