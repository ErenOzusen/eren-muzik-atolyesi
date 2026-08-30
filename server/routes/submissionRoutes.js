const express = require("express");
const { checkAdminToken } = require("../middleware/authMiddleware");
const { publicFormRateLimiter } = require("../middleware/rateLimiters");
const {
  createSubmission,
  listSubmissions,
  updateSubmissionStatus,
  deleteSubmission,
} = require("../controllers/submissionController");

const router = express.Router();

router.post("/api/contact", publicFormRateLimiter, createSubmission);

// These three paths intentionally have NO "/admin" prefix — a pre-existing
// quirk from before this refactor, preserved exactly (still gated by
// checkAdminToken).
router.get("/api/submissions", checkAdminToken, listSubmissions);
router.patch("/api/submissions/:id/status", checkAdminToken, updateSubmissionStatus);
router.delete("/api/submissions/:id", checkAdminToken, deleteSubmission);

module.exports = router;
