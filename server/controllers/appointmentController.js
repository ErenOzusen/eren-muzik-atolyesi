const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { isAppointmentSlotConflictError } = Appointment;
const { ensureDbConnection } = require("../config/database");
const {
  checkPayloadShape,
  isValidLesson,
  isValidPhone,
  isValidEmail,
  exceedsMaxLength,
  isValidNotPastDate,
  HONEYPOT_FIELDS,
} = require("../validation");
const appointmentService = require("../services/appointmentService");
const { sendNewAppointmentEmail, sendAppointmentConfirmationEmail } = require("../services/emailService");

const VALID_APPOINTMENT_STATUSES = [
  "Beklemede",
  "Onaylandı",
  "Tamamlandı",
  "İptal",
];

function formatAppointment(appointment) {
  return {
    _id: appointment._id.toString(),
    name: appointment.name,
    phone: appointment.phone,
    email: appointment.email || "",
    lesson: appointment.lesson,
    appointmentDate: appointment.appointmentDate,
    appointmentTime: appointment.appointmentTime,
    note: appointment.note || "",
    status: appointment.status || "Beklemede",
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

// Public: yeni randevu talebi oluştur
async function createAppointment(req, res) {
  const shapeCheck = checkPayloadShape(
    req.body,
    ["name", "phone", "email", "lesson", "appointmentDate", "appointmentTime", "note"],
    HONEYPOT_FIELDS
  );

  if (!shapeCheck.ok) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz istek",
    });
  }

  const {
    name,
    phone,
    email,
    lesson,
    appointmentDate,
    appointmentTime,
    note,
  } = req.body;

  if (
    !name?.trim() ||
    !phone?.trim() ||
    !lesson?.trim() ||
    !appointmentDate?.trim() ||
    !appointmentTime?.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "Zorunlu alanların tamamını doldurmanız gerekiyor",
    });
  }

  if (
    exceedsMaxLength(name, "name") ||
    exceedsMaxLength(phone, "phone") ||
    exceedsMaxLength(email, "email") ||
    exceedsMaxLength(note, "note")
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

  // Email stays optional (unchanged from prior behavior) — only its format
  // is validated when the caller does provide one.
  if (email?.trim() && !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz e-posta adresi",
    });
  }

  const normalizedDate = appointmentDate.trim();
  const normalizedTime = appointmentTime.trim();

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (
    !datePattern.test(normalizedDate) ||
    !timePattern.test(normalizedTime)
  ) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz tarih veya saat bilgisi",
    });
  }

  const [year, month, day] = normalizedDate.split("-").map(Number);
  const selectedDate = new Date(Date.UTC(year, month - 1, day));

  const isValidDate =
    selectedDate.getUTCFullYear() === year &&
    selectedDate.getUTCMonth() === month - 1 &&
    selectedDate.getUTCDate() === day;

  if (!isValidDate) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz randevu tarihi",
    });
  }

  if (!isValidNotPastDate(normalizedDate)) {
    return res.status(400).json({
      success: false,
      message: "Geçmiş bir tarihe randevu oluşturamazsınız",
    });
  }

  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const result = await appointmentService.createAppointment({
      name,
      phone,
      email,
      lesson,
      normalizedDate,
      normalizedTime,
      note,
    });

    if (result.status === "closed") {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz gün randevuya kapalı. Lütfen başka bir gün seçin.",
      });
    }

    if (result.status === "outsideHours") {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz saat çalışma programına uygun değil. Lütfen başka bir saat seçin.",
      });
    }

    if (result.status === "conflict") {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz saat uygun değil. Lütfen başka bir randevu saati seçin.",
      });
    }

    const { appointment } = result;

    // Operational log only — no name/phone/email/note. See PII/log audit (B3).
    console.log("Yeni randevu talebi oluşturuldu:", {
      id: appointment._id.toString(),
      lesson: appointment.lesson,
      appointmentDate: appointment.appointmentDate,
      appointmentTime: appointment.appointmentTime,
      status: appointment.status,
    });

    sendNewAppointmentEmail(appointment).catch((emailError) => {
      console.error(
        "Ön görüşme bildirim e-postası gönderilemedi:",
        emailError
      );
    });

    res.status(201).json({
      success: true,
      message: "Randevu talebiniz başarıyla oluşturuldu",
      appointment: formatAppointment(appointment),
    });
  } catch (error) {
    // E11000 on the appointment-slot index specifically (see
    // models/Appointment.js's isAppointmentSlotConflictError): the DB-level
    // unique partial index caught a race the application-level conflict
    // check above missed — two concurrent requests for the same active
    // slot. Report it exactly like the existing application-level conflict
    // response, not a generic server error. Any OTHER duplicate-key error
    // (a different, future unique index) deliberately falls through to the
    // generic 500 below instead of being misreported as "slot taken".
    if (isAppointmentSlotConflictError(error)) {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz saat uygun değil. Lütfen başka bir randevu saati seçin.",
      });
    }

    console.error("Randevu oluşturulamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Randevu oluşturulurken bir hata meydana geldi",
    });
  }
}

// Public: seçilen tarihte uygun ve kullanılamayan randevu saatlerini getir
async function getAvailability(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      success: false,
      message: "Randevu tarihi gereklidir",
    });
  }

  const dateParts = date.split("-").map(Number);

  if (
    dateParts.length !== 3 ||
    dateParts.some((part) => Number.isNaN(part))
  ) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz randevu tarihi",
    });
  }

  try {
    const availability = await appointmentService.getAvailability(date);

    res.json({
      success: true,
      ...availability,
    });
  } catch (error) {
    console.error(
      "Randevu uygunluk bilgisi alınamadı:",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Randevu saatleri alınırken bir hata oluştu",
    });
  }
}

// Admin: tüm randevuları getir
async function listAppointments(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const appointments = await appointmentService.listAppointments();

    res.json(
      appointments.map((appointment) => formatAppointment(appointment))
    );
  } catch (error) {
    console.error("Randevular alınamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Randevular alınırken bir hata oluştu",
    });
  }
}

// Admin: randevu durumunu güncelle
async function updateAppointmentStatus(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz randevu id",
    });
  }

  if (!VALID_APPOINTMENT_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz randevu durumu",
    });
  }

  try {
    const result = await appointmentService.updateAppointmentStatus(id, status);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Randevu bulunamadı",
      });
    }

    const { previousStatus, updatedAppointment } = result;

    let confirmationEmailSent = false;

    if (
      status === "Onaylandı" &&
      previousStatus !== "Onaylandı" &&
      updatedAppointment.email
    ) {
      try {
        await sendAppointmentConfirmationEmail(updatedAppointment);

        confirmationEmailSent = true;

        // Operational log only — no email address. See PII/log audit (B3).
        console.log("Ön görüşme onay e-postası gönderildi:", {
          appointmentId: updatedAppointment._id.toString(),
        });
      } catch (emailError) {
        console.error(
          "Öğrenci onay e-postası gönderilemedi:",
          emailError.message
        );
      }
    }

    res.json({
      success: true,
      message: confirmationEmailSent
        ? "Randevu durumu güncellendi ve öğrenciye onay e-postası gönderildi"
        : "Randevu durumu güncellendi",
      confirmationEmailSent,
      appointment: formatAppointment(updatedAppointment),
    });
  } catch (error) {
    console.error("Randevu durumu güncellenemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Randevu durumu güncellenirken bir hata oluştu",
    });
  }
}

// Admin: randevuyu sil
async function deleteAppointment(req, res) {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Geçersiz randevu id",
    });
  }

  try {
    const deletedAppointment = await appointmentService.deleteAppointmentById(id);

    if (!deletedAppointment) {
      return res.status(404).json({
        success: false,
        message: "Randevu bulunamadı",
      });
    }

    res.json({
      success: true,
      message: "Randevu başarıyla silindi",
    });
  } catch (error) {
    console.error("Randevu silinemedi:", error.message);

    res.status(500).json({
      success: false,
      message: "Randevu silinirken bir hata oluştu",
    });
  }
}

module.exports = {
  createAppointment,
  getAvailability,
  listAppointments,
  updateAppointmentStatus,
  deleteAppointment,
};
