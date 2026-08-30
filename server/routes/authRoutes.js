const express = require("express");
const { checkAdminToken } = require("../middleware/authMiddleware");
const { loginRateLimiter } = require("../middleware/rateLimiters");
const { login, logout } = require("../controllers/authController");

const router = express.Router();

router.post("/api/admin/login", loginRateLimiter, login);
router.post("/api/admin/logout", checkAdminToken, logout);

module.exports = router;
