const BlockedSlot = require("../models/BlockedSlot");
const { ensureDbConnection } = require("../config/database");

// Blocked slots are plain CRUD with no business rules beyond the DB schema
// itself — no dedicated service layer here, matching the "don't create
// unnecessary abstraction for simple one-line logic" guidance.

// Admin: kapalı gün veya saat aralığı ekle
async function createBlockedSlot(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { date, startTime, endTime, reason } = req.body;

  if (!date || !startTime || !endTime) {
    return res.status(400).json({
      success: false,
      message: "Tarih, başlangıç saati ve bitiş saati gereklidir",
    });
  }

  try {
    const blockedSlot = await BlockedSlot.create({
      date: date.trim(),
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      reason: reason?.trim() || "",
    });

    res.status(201).json({
      success: true,
      message: "Kapalı saat başarıyla eklendi",
      blockedSlot,
    });
  } catch (error) {
    console.error("Kapalı saat eklenemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Kapalı saat eklenirken bir hata oluştu",
    });
  }
}

// Admin: kapalı gün ve saat aralıklarını getir
async function listBlockedSlots(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const blockedSlots = await BlockedSlot.find()
      .sort({ date: 1, startTime: 1 })
      .lean();

    res.json({
      success: true,
      blockedSlots,
    });
  } catch (error) {
    console.error("Kapalı saatler alınamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Kapalı saatler alınırken bir hata oluştu",
    });
  }
}

// Admin: kapalı gün veya saat aralığını sil
async function deleteBlockedSlot(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const deletedBlockedSlot = await BlockedSlot.findByIdAndDelete(req.params.id);

    if (!deletedBlockedSlot) {
      return res.status(404).json({
        success: false,
        message: "Kapalı saat bulunamadı",
      });
    }

    res.json({
      success: true,
      message: "Kapalı saat başarıyla silindi",
    });
  } catch (error) {
    console.error("Kapalı saat silinemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Kapalı saat silinirken bir hata oluştu",
    });
  }
}

module.exports = { createBlockedSlot, listBlockedSlots, deleteBlockedSlot };
