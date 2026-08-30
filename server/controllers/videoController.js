const Video = require("../models/Video");
const { ensureDbConnection } = require("../config/database");

// Plain CRUD with no business rules beyond the DB schema itself — no
// dedicated service layer here, same reasoning as blockedSlotController.

function formatVideo(video) {
  return {
    id: video._id.toString(),
    title: video.title,
    description: video.description || "",
    videoUrl: video.videoUrl,
    thumbnailUrl: video.thumbnailUrl || "",
    category: video.category || "",
    isActive: video.isActive,
    order: video.order || 0,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}

// Public: sadece aktif videolar
async function listActiveVideos(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const videos = await Video.find({ isActive: true }).sort({
      order: 1,
      createdAt: -1,
    });

    res.json(videos.map(formatVideo));
  } catch (error) {
    console.error("Videolar alınamadı:", error);
    res.status(500).json({ message: "Videolar alınamadı" });
  }
}

// Admin: tüm videolar
async function listAllVideos(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const videos = await Video.find().sort({
      order: 1,
      createdAt: -1,
    });

    res.json(videos.map(formatVideo));
  } catch (error) {
    console.error("Admin videolar alınamadı:", error);
    res.status(500).json({ message: "Videolar alınamadı" });
  }
}

// Admin: yeni video ekle
async function createVideo(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const {
      title,
      description,
      videoUrl,
      thumbnailUrl,
      category,
      isActive,
      order,
    } = req.body;

    if (!title || !videoUrl) {
      return res.status(400).json({
        message: "Başlık ve video linki zorunludur",
      });
    }

    const video = await Video.create({
      title,
      description: description || "",
      videoUrl,
      thumbnailUrl: thumbnailUrl || "",
      category: category || "",
      isActive: typeof isActive === "boolean" ? isActive : true,
      order: Number(order) || 0,
    });

    res.status(201).json(formatVideo(video));
  } catch (error) {
    console.error("Video eklenemedi:", error);
    res.status(500).json({ message: "Video eklenemedi" });
  }
}

// Admin: video güncelle
async function updateVideo(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const { id } = req.params;

    const {
      title,
      description,
      videoUrl,
      thumbnailUrl,
      category,
      isActive,
      order,
    } = req.body;

    if (!title || !videoUrl) {
      return res.status(400).json({
        message: "Başlık ve video linki zorunludur",
      });
    }

    const updatedVideo = await Video.findByIdAndUpdate(
      id,
      {
        title,
        description: description || "",
        videoUrl,
        thumbnailUrl: thumbnailUrl || "",
        category: category || "",
        isActive: typeof isActive === "boolean" ? isActive : true,
        order: Number(order) || 0,
      },
      { new: true }
    );

    if (!updatedVideo) {
      return res.status(404).json({ message: "Video bulunamadı" });
    }

    res.json(formatVideo(updatedVideo));
  } catch (error) {
    console.error("Video güncellenemedi:", error);
    res.status(500).json({ message: "Video güncellenemedi" });
  }
}

// Admin: video sil
async function deleteVideo(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const { id } = req.params;

    const deletedVideo = await Video.findByIdAndDelete(id);

    if (!deletedVideo) {
      return res.status(404).json({ message: "Video bulunamadı" });
    }

    res.json({ message: "Video silindi" });
  } catch (error) {
    console.error("Video silinemedi:", error);
    res.status(500).json({ message: "Video silinemedi" });
  }
}

module.exports = {
  listActiveVideos,
  listAllVideos,
  createVideo,
  updateVideo,
  deleteVideo,
};
