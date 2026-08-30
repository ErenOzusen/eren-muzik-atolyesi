const express = require("express");
const { checkAdminToken } = require("../middleware/authMiddleware");
const {
  listActiveVideos,
  listAllVideos,
  createVideo,
  updateVideo,
  deleteVideo,
} = require("../controllers/videoController");

const router = express.Router();

router.get("/api/videos", listActiveVideos);
router.get("/api/admin/videos", checkAdminToken, listAllVideos);
router.post("/api/admin/videos", checkAdminToken, createVideo);
router.patch("/api/admin/videos/:id", checkAdminToken, updateVideo);
router.delete("/api/admin/videos/:id", checkAdminToken, deleteVideo);

module.exports = router;
