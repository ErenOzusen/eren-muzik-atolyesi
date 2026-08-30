const express = require("express");
const { checkAdminToken } = require("../middleware/authMiddleware");
const { createBlockedSlot, listBlockedSlots, deleteBlockedSlot } = require("../controllers/blockedSlotController");

const router = express.Router();

router.post("/api/admin/blocked-slots", checkAdminToken, createBlockedSlot);
router.get("/api/admin/blocked-slots", checkAdminToken, listBlockedSlots);
router.delete("/api/admin/blocked-slots/:id", checkAdminToken, deleteBlockedSlot);

module.exports = router;
