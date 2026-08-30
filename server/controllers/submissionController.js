const mongoose = require("mongoose");
const { ensureDbConnection } = require("../config/database");
const {
  checkPayloadShape,
  isValidLesson,
  isValidPhone,
  exceedsMaxLength,
  HONEYPOT_FIELDS,
} = require("../validation");
const submissionService = require("../services/submissionService");
const { sendNewSubmissionEmail } = require("../services/emailService");

const VALID_SUBMISSION_STATUSES = [
  "Yeni",
  "Arandı",
  "Beklemede",
  "Derse başladı",
  "İptal",
];

function formatSubmission(submission) {
  const createdAt = submission.createdAt;

  return {
    _id: submission._id.toString(),
    name: submission.name,
    phone: submission.phone,
    lesson: submission.lesson,
    message: submission.message,
    status: submission.status || "Yeni",
    createdAt,
    date: createdAt ? new Date(createdAt).toISOString() : null,
  };
}

// Public: yeni bilgi alma başvurusu
async function createSubmission(req, res) {
  // Input shape/format is checked before touching the DB layer: cheap,
  // no I/O, and a malformed/bot request should get a plain 400 rather than
  // a 503 that leaks DB-connectivity state.
  const shapeCheck = checkPayloadShape(
    req.body,
    ["name", "phone", "lesson", "message"],
    HONEYPOT_FIELDS
  );

  if (!shapeCheck.ok) {
    // A filled honeypot or an unexpected field shape is treated as spam —
    // respond exactly like a normal validation failure, without revealing
    // that this was specifically flagged as bot traffic.
    return res.status(400).json({
      success: false,
      message: "Geçersiz istek",
    });
  }

  const { name, phone, lesson, message } = req.body;

  if (!name?.trim() || !phone?.trim() || !lesson?.trim() || !message?.trim()) {
    return res.status(400).json({
      success: false,
      message: "Tüm alanları doldurmanız gerekiyor",
    });
  }

  if (
    exceedsMaxLength(name, "name") ||
    exceedsMaxLength(phone, "phone") ||
    exceedsMaxLength(message, "message")
  ) {
    return res.status(400).json({
      success: false,
      message: "Girdiğiniz bilgiler çok uzun",
    });
  }

  if (!isValidLesson(lesson)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz ders seçimi",
    });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz telefon numarası",
    });
  }

  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const submission = await submissionService.createSubmission({ name, phone, lesson, message });

    // Operational log only — no name/phone/message. See PII/log audit (B3).
    console.log("Yeni başvuru kaydedildi:", {
      id: submission._id.toString(),
      lesson: submission.lesson,
      status: submission.status,
    });

    sendNewSubmissionEmail(submission)
      .then(() => {
        //console.log("Yeni başvuru e-postası gönderildi.");
      })
      .catch((emailError) => {
        console.error("Yeni başvuru e-postası gönderilemedi:", emailError.message);
      });

    res.json({
      success: true,
      message: "Başvuru başarıyla kaydedildi",
    });
  } catch (error) {
    console.error("Başvuru kaydedilemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Başvuru kaydedilirken bir hata oluştu",
    });
  }
}

// Admin: tüm başvuruları getir (not: URL kasıtlı olarak /admin öneki
// taşımıyor — mevcut davranış korunuyor)
async function listSubmissions(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const submissions = await submissionService.listSubmissions();

    res.json(submissions.map((submission) => formatSubmission(submission)));
  } catch (error) {
    console.error("Başvurular alınamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Başvurular alınırken bir hata oluştu",
    });
  }
}

async function updateSubmissionStatus(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz kayıt id",
    });
  }

  if (!VALID_SUBMISSION_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz başvuru durumu",
    });
  }

  try {
    const updatedSubmission = await submissionService.updateSubmissionStatus(id, status);

    if (!updatedSubmission) {
      return res.status(404).json({
        success: false,
        message: "Başvuru bulunamadı",
      });
    }

    res.json({
      success: true,
      message: "Başvuru durumu güncellendi",
      submission: formatSubmission(updatedSubmission),
    });
  } catch (error) {
    console.error("Başvuru durumu güncellenemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Başvuru durumu güncellenirken bir hata oluştu",
    });
  }
}

async function deleteSubmission(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz kayıt id",
    });
  }

  try {
    const deletedSubmission = await submissionService.deleteSubmissionById(id);

    if (!deletedSubmission) {
      return res.status(404).json({
        success: false,
        message: "Başvuru bulunamadı",
      });
    }

    res.json({
      success: true,
      message: "Başvuru silindi",
    });
  } catch (error) {
    console.error("Başvuru silinemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Başvuru silinirken bir hata oluştu",
    });
  }
}

module.exports = {
  createSubmission,
  listSubmissions,
  updateSubmissionStatus,
  deleteSubmission,
};
