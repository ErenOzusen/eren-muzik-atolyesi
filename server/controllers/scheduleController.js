const { ensureDbConnection } = require("../config/database");
const scheduleService = require("../services/scheduleService");

function formatWeeklySchedule(schedule) {
  return {
    _id: schedule._id.toString(),
    dayOfWeek: schedule.dayOfWeek,
    isOpen: schedule.isOpen,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

// Admin: haftalık çalışma programını getir
async function getWeeklySchedule(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const schedules = await scheduleService.getAllWeeklySchedules();

    res.json({
      success: true,
      schedules: schedules.map(formatWeeklySchedule),
    });
  } catch (error) {
    console.error("Haftalık program alınamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Haftalık program alınırken bir hata oluştu",
    });
  }
}

// Admin: haftalık çalışma programındaki bir günü güncelle
async function updateWeeklySchedule(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const dayOfWeek = Number(req.params.dayOfWeek);
  const { isOpen, startTime, endTime } = req.body;

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz gün bilgisi",
    });
  }

  if (typeof isOpen !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Çalışma durumu belirtilmelidir",
    });
  }

  if (isOpen && (!startTime || !endTime)) {
    return res.status(400).json({
      success: false,
      message: "Başlangıç ve bitiş saati gereklidir",
    });
  }

  if (isOpen && startTime >= endTime) {
    return res.status(400).json({
      success: false,
      message: "Bitiş saati başlangıç saatinden sonra olmalıdır",
    });
  }

  try {
    const schedule = await scheduleService.updateDaySchedule(dayOfWeek, { isOpen, startTime, endTime });

    res.json({
      success: true,
      message: "Çalışma programı başarıyla güncellendi",
      schedule: formatWeeklySchedule(schedule),
    });
  } catch (error) {
    console.error("Haftalık program güncellenemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Haftalık program güncellenirken bir hata oluştu",
    });
  }
}

module.exports = { getWeeklySchedule, updateWeeklySchedule };
