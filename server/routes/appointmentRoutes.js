const express = require("express");
const { checkAdminToken } = require("../middleware/authMiddleware");
const { publicFormRateLimiter } = require("../middleware/rateLimiters");
const {
  createAppointment,
  getAvailability,
  listAppointments,
  updateAppointmentStatus,
  deleteAppointment,
} = require("../controllers/appointmentController");

const router = express.Router();

router.post("/api/appointments", publicFormRateLimiter, createAppointment);
router.get("/api/appointments/availability", getAvailability);

router.get("/api/admin/appointments", checkAdminToken, listAppointments);
router.patch("/api/admin/appointments/:id/status", checkAdminToken, updateAppointmentStatus);
router.delete("/api/admin/appointments/:id", checkAdminToken, deleteAppointment);

module.exports = router;
