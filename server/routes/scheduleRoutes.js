const express = require("express");
const { checkAdminToken } = require("../middleware/authMiddleware");
const { getWeeklySchedule, updateWeeklySchedule } = require("../controllers/scheduleController");

const router = express.Router();

router.get("/api/admin/weekly-schedule", checkAdminToken, getWeeklySchedule);
router.put("/api/admin/weekly-schedule/:dayOfWeek", checkAdminToken, updateWeeklySchedule);

module.exports = router;
