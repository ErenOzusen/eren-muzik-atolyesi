require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const Submission = require("./models/Submission");
const Video = require("./models/Video");
const Appointment = require("./models/Appointment");
const { verifyAppointmentSlotIndexExists, isAppointmentSlotConflictError } = Appointment;
const BlockedSlot = require("./models/BlockedSlot");
const WeeklySchedule = require("./models/WeeklySchedule");
const {
  loadAdminSecrets,
  createAdminToken,
  verifyAdminToken,
  revokeAdminToken,
  timingSafeEqualStrings,
} = require("./auth");
const {
  checkPayloadShape,
  isValidLesson,
  isValidPhone,
  isValidEmail,
  exceedsMaxLength,
  isValidNotPastDate,
} = require("./validation");
const { resolveTrustProxySetting } = require("./proxyConfig");
const { resolveAllowedOrigins } = require("./corsConfig");

// A hidden field the public forms send (see src/services rendered forms in
// App.jsx: a visually-hidden, aria-hidden, tab-unreachable input named
// "website"). A human never sees or fills it; if it arrives non-empty, the
// request is silently treated as spam (see checkPayloadShape).
const HONEYPOT_FIELDS = ["website"];

// Fail-closed: refuses to start rather than run with an insecure default
// admin password/token, in every environment (see auth.js).
const { adminPassword: ADMIN_PASSWORD, tokenSecret: ADMIN_TOKEN_SECRET } =
  loadAdminSecrets();

// Defined here (before any route registration) so every /api/admin/* route
// below can reference it regardless of declaration order in the file.
const checkAdminToken = (req, res, next) => {
  const authorizationHeader = req.headers.authorization || "";
  const token = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : "";

  const result = verifyAdminToken(token, ADMIN_TOKEN_SECRET);

  if (result.valid) {
    req.adminTokenId = result.jti;
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Yetkisiz erişim",
  });
};

const app = express();

// See proxyConfig.js: trusts exactly the reverse-proxy hop count that's
// actually real for this deployment (env-overridable via TRUST_PROXY),
// instead of either ignoring X-Forwarded-For entirely (breaks per-client
// rate limiting behind Render) or blindly trusting it (lets a direct local
// client forge its own IP).
app.set("trust proxy", resolveTrustProxySetting());

// See corsConfig.js: the production frontend origin and localhost dev
// origins are ALWAYS included, deterministically, regardless of whether
// ALLOWED_ORIGINS is set — so configuring it (e.g. to add a staging
// frontend) can never accidentally drop the real production site's access.
// Malformed entries or a literal "*" wildcard fail closed at startup.
const allowedOrigins = resolveAllowedOrigins();

const corsOptions = {
  origin(origin, callback) {
    // No Origin header (same-origin requests, curl, server-to-server,
    // health checks) is not a browser cross-origin request — allow it.
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS: origin izinli değil"));
  },
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "20kb" }));

// Generic API rate limit: baseline abuse protection without affecting
// normal admin-dashboard or public-site usage.
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Çok fazla giriş denemesi. Lütfen daha sonra tekrar deneyin.",
  },
});

const publicFormRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.",
  },
});

// CORS rejections must never leak a stack trace or internal detail to the
// client — respond with a plain, generic 403.
app.use((err, req, res, next) => {
  if (err && err.message === "CORS: origin izinli değil") {
    return res.status(403).json({ success: false, message: "Yetkisiz kaynak" });
  }

  return next(err);
});
const sendBrevoEmail = async ({
  subject,
  text,
  to,
  toName = "",
}) => {
  const recipientEmail = to || process.env.NOTIFICATION_EMAIL;

  if (
    !process.env.BREVO_API_KEY ||
    !process.env.EMAIL_USER ||
    !recipientEmail
  ) {
    console.warn("Brevo e-posta ayarları veya alıcı adresi eksik.");
    return null;
  }

  const recipient = {
    email: recipientEmail,
  };

  if (toName && toName.trim()) {
    recipient.name = toName.trim();
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: "Eren Müzik Atölyesi",
        email: process.env.EMAIL_USER,
      },
      to: [recipient],
      subject,
      textContent: text,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `Brevo API hatası (${response.status}): ${
        result.message || JSON.stringify(result)
      }`
    );
  }

  console.log(
    "Brevo e-postası kabul edildi:",
    result.messageId || result
  );

  return result;
};

let isDbConnected = false;

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

async function connectMongo() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn(
      "MONGODB_URI tanımlı değil. Başvurular veritabanına kaydedilemez."
    );
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    isDbConnected = true;
    console.log("MongoDB bağlantısı başarılı");

    // Wait for index building to settle (Model.init() resolves once any
    // pending autoIndex work — including the appointment slot unique index —
    // has finished, success or failure), then explicitly confirm the
    // appointment double-booking index is actually live on the collection.
    // This is a READ-ONLY check: it never creates, drops, or repairs any
    // index or data, and it never deletes/modifies existing appointments —
    // if duplicate active slots already exist in production, resolving
    // that is a deliberate, separate, human decision, not something this
    // check attempts automatically.
    try {
      await Appointment.init();
    } catch {
      // Swallowed here — verifyAppointmentSlotIndexExists() below reads the
      // live index list directly, which is the authoritative check.
    }

    const indexHealth = await verifyAppointmentSlotIndexExists();

    if (!indexHealth.healthy) {
      console.error(
        "‼️  RANDEVU ÇAKIŞMA KORUMASI (DB seviyesi) AKTİF DEĞİL:",
        indexHealth.reason,
        "— Uygulama seviyesi çakışma kontrolü hâlâ çalışıyor, ancak eşzamanlı " +
          "isteklerde ek atomik koruma yok. Mevcut randevu verisinde aynı " +
          "tarih/saat için birden fazla aktif kayıt olup olmadığını manuel " +
          "kontrol edin; bu kontrol hiçbir veriyi otomatik silmez/değiştirmez."
      );
    } else {
      console.log("Randevu çakışma koruması (unique index) doğrulandı: aktif.");
    }
  } catch (error) {
    console.error("MongoDB bağlantı hatası:", error.message);
  }
}

function ensureDbConnection(res) {
  if (isDbConnected) {
    return true;
  }

  res.status(503).json({
    success: false,
    message: "Veritabanı bağlantısı kurulamadı",
  });

  return false;
}

app.get("/", (req, res) => {
  res.send("Backend çalışıyor kral");
});

const sendNewSubmissionEmail = async (submission) => {
  const result = await sendBrevoEmail({
    subject: "Yeni bilgi alma başvurusu geldi 🎵",
    text: `
Yeni bir bilgi alma başvurusu geldi 🎵

Ad Soyad: ${submission.name || "-"}
Telefon: ${submission.phone || "-"}
Ders: ${submission.lesson || "-"}
Mesaj: ${submission.message || "-"}

Admin panel:
https://eren-muzik-atolyesi.vercel.app/admin
    `,
  });

  console.log(
    "Yeni başvuru e-postası Brevo ile gönderildi:",
    result?.messageId
  );
};

const sendNewAppointmentEmail = async (appointment) => {
  const result = await sendBrevoEmail({
    subject: "Yeni ön görüşme talebi geldi 🎵",
    text: `
Yeni bir ön görüşme talebi geldi 🎵

Ad Soyad: ${appointment.name || "-"}
Telefon: ${appointment.phone || "-"}
E-posta: ${appointment.email || "-"}
Ders: ${appointment.lesson || "-"}
Tarih: ${appointment.appointmentDate || "-"}
Saat: ${appointment.appointmentTime || "-"}
Not: ${appointment.note || "-"}

Admin panel:
https://eren-muzik-atolyesi.vercel.app/admin
    `,
  });

  console.log(
    "Ön görüşme e-postası Brevo ile gönderildi:",
    result?.messageId
  );
};
app.post("/api/contact", publicFormRateLimiter, async (req, res) => {
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
    const submission = await Submission.create({
      name: name.trim(),
      phone: phone.trim(),
      lesson: lesson.trim(),
      message: message.trim(),
    });

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
});

// Public: yeni randevu talebi oluştur
app.post("/api/appointments", publicFormRateLimiter, async (req, res) => {
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

  const dayOfWeek = selectedDate.getUTCDay();
  const appointmentDuration = 30;

  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const weeklySchedule = await WeeklySchedule.findOne({
      dayOfWeek,
    }).lean();

    const schedule = weeklySchedule || {
      dayOfWeek,
      isOpen: true,
      startTime: "10:00",
      endTime: "20:00",
    };

    if (!schedule.isOpen) {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz gün randevuya kapalı. Lütfen başka bir gün seçin.",
      });
    }

    const [scheduleStartHour, scheduleStartMinute] =
      schedule.startTime.split(":").map(Number);

    const [scheduleEndHour, scheduleEndMinute] =
      schedule.endTime.split(":").map(Number);

    const scheduleStart =
      scheduleStartHour * 60 + scheduleStartMinute;

    const scheduleEnd =
      scheduleEndHour * 60 + scheduleEndMinute;

    const [requestedHour, requestedMinute] =
      normalizedTime.split(":").map(Number);

    const requestedStart =
      requestedHour * 60 + requestedMinute;

    const requestedEnd =
      requestedStart + appointmentDuration;

    const isInsideWorkingHours =
      requestedStart >= scheduleStart &&
      requestedEnd <= scheduleEnd;

    const isValidTimeInterval =
      (requestedStart - scheduleStart) % appointmentDuration === 0;

    if (!isInsideWorkingHours || !isValidTimeInterval) {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz saat çalışma programına uygun değil. Lütfen başka bir saat seçin.",
      });
    }

    const sameDayAppointments = await Appointment.find({
      appointmentDate: normalizedDate,
      status: { $ne: "İptal" },
    })
      .select("appointmentTime -_id")
      .lean();

    const blockedSlotsForDate = await BlockedSlot.find({
      date: normalizedDate,
    })
      .select("startTime endTime -_id")
      .lean();

    const hasTimeConflict = sameDayAppointments.some((item) => {
      const [existingHour, existingMinute] =
        item.appointmentTime.split(":").map(Number);

      const existingStart =
        existingHour * 60 + existingMinute;

      const existingEnd =
        existingStart + appointmentDuration;

      return (
        requestedStart < existingEnd &&
        requestedEnd > existingStart
      );
    });

    const hasBlockedSlotConflict = blockedSlotsForDate.some(
      (blockedSlot) => {
        const [blockedStartHour, blockedStartMinute] =
          blockedSlot.startTime.split(":").map(Number);

        const [blockedEndHour, blockedEndMinute] =
          blockedSlot.endTime.split(":").map(Number);

        const blockedStart =
          blockedStartHour * 60 + blockedStartMinute;

        const blockedEnd =
          blockedEndHour * 60 + blockedEndMinute;

        return (
          requestedStart < blockedEnd &&
          requestedEnd > blockedStart
        );
      }
    );

    if (hasTimeConflict || hasBlockedSlotConflict) {
      return res.status(409).json({
        success: false,
        message:
          "Seçtiğiniz saat uygun değil. Lütfen başka bir randevu saati seçin.",
      });
    }

    const appointment = await Appointment.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim() || "",
      lesson: lesson.trim(),
      appointmentDate: normalizedDate,
      appointmentTime: normalizedTime,
      note: note?.trim() || "",
    });

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
});

// Public: seçilen tarihte uygun ve kullanılamayan randevu saatlerini getir
app.get("/api/appointments/availability", async (req, res) => {
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

  const [year, month, day] = dateParts;
  const dayOfWeek = new Date(
    Date.UTC(year, month - 1, day)
  ).getUTCDay();

  try {
    const weeklySchedule = await WeeklySchedule.findOne({
      dayOfWeek,
    }).lean();

    const schedule = weeklySchedule || {
      dayOfWeek,
      isOpen: true,
      startTime: "10:00",
      endTime: "20:00",
    };

    if (!schedule.isOpen) {
      return res.json({
        success: true,
        isOpen: false,
        dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        availableTimes: [],
        unavailableTimes: [],
      });
    }

    const [startHour, startMinute] = schedule.startTime
      .split(":")
      .map(Number);

    const [endHour, endMinute] = schedule.endTime
      .split(":")
      .map(Number);

    const scheduleStart = startHour * 60 + startMinute;
    const scheduleEnd = endHour * 60 + endMinute;
    const appointmentDuration = 30;

    const appointments = await Appointment.find({
      appointmentDate: date,
      status: { $ne: "İptal" },
    })
      .select("appointmentTime -_id")
      .lean();

    const blockedSlots = await BlockedSlot.find({
      date,
    })
      .select("startTime endTime -_id")
      .lean();

    const scheduleTimes = [];

    for (
      let minutes = scheduleStart;
      minutes + appointmentDuration <= scheduleEnd;
      minutes += appointmentDuration
    ) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");

      scheduleTimes.push(`${hour}:${minute}`);
    }

    const unavailableTimes = scheduleTimes.filter((slot) => {
      const [slotHour, slotMinute] = slot.split(":").map(Number);

      const slotStart = slotHour * 60 + slotMinute;
      const slotEnd = slotStart + appointmentDuration;

      const conflictsWithAppointment = appointments.some(
        (appointment) => {
          const [existingHour, existingMinute] =
            appointment.appointmentTime.split(":").map(Number);

          const existingStart =
            existingHour * 60 + existingMinute;

          const existingEnd =
            existingStart + appointmentDuration;

          return (
            slotStart < existingEnd &&
            slotEnd > existingStart
          );
        }
      );

      const conflictsWithBlockedSlot = blockedSlots.some(
        (blockedSlot) => {
          const [blockedStartHour, blockedStartMinute] =
            blockedSlot.startTime.split(":").map(Number);

          const [blockedEndHour, blockedEndMinute] =
            blockedSlot.endTime.split(":").map(Number);

          const blockedStart =
            blockedStartHour * 60 + blockedStartMinute;

          const blockedEnd =
            blockedEndHour * 60 + blockedEndMinute;

          return (
            slotStart < blockedEnd &&
            slotEnd > blockedStart
          );
        }
      );

      return (
        conflictsWithAppointment ||
        conflictsWithBlockedSlot
      );
    });

    const availableTimes = scheduleTimes.filter(
      (slot) => !unavailableTimes.includes(slot)
    );

    res.json({
      success: true,
      isOpen: true,
      dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      availableTimes,
      unavailableTimes,
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
});

// Admin: kapalı gün veya saat aralığı ekle
app.post("/api/admin/blocked-slots", checkAdminToken, async (req, res) => {
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
});

// Admin: kapalı gün ve saat aralıklarını getir
app.get("/api/admin/blocked-slots", checkAdminToken, async (req, res) => {
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
});

// Admin: kapalı gün veya saat aralığını sil
app.delete("/api/admin/blocked-slots/:id", checkAdminToken, async (req, res) => {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const deletedBlockedSlot = await BlockedSlot.findByIdAndDelete(
      req.params.id
    );

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
});

// Admin: haftalık çalışma programını getir
app.get("/api/admin/weekly-schedule", checkAdminToken, async (req, res) => {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const schedules = await Promise.all(
      Array.from({ length: 7 }, (_, dayOfWeek) =>
        WeeklySchedule.findOneAndUpdate(
          { dayOfWeek },
          {
            $setOnInsert: {
              dayOfWeek,
              isOpen: true,
              startTime: "10:00",
              endTime: "20:00",
            },
          },
          {
            new: true,
            upsert: true,
          }
        )
      )
    );

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
});

// Admin: haftalık çalışma programındaki bir günü güncelle
app.put("/api/admin/weekly-schedule/:dayOfWeek", checkAdminToken, async (req, res) => {
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
    const schedule = await WeeklySchedule.findOneAndUpdate(
      { dayOfWeek },
      {
        dayOfWeek,
        isOpen,
        startTime: startTime || "10:00",
        endTime: endTime || "20:00",
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

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
});

app.post("/api/admin/login", loginRateLimiter, (req, res) => {
  const { password } = req.body;

  if (
    typeof password !== "string" ||
    !timingSafeEqualStrings(password, ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      success: false,
      message: "Şifre hatalı",
    });
  }

  const token = createAdminToken(ADMIN_TOKEN_SECRET);

  return res.json({
    success: true,
    message: "Admin girişi başarılı",
    token,
  });
});

// Admin: oturumu sonlandır (token'ı sunucu tarafında geçersiz kıl)
app.post("/api/admin/logout", checkAdminToken, (req, res) => {
  revokeAdminToken(req.adminTokenId);

  res.json({
    success: true,
    message: "Çıkış yapıldı",
  });
});

const VALID_SUBMISSION_STATUSES = [
  "Yeni",
  "Arandı",
  "Beklemede",
  "Derse başladı",
  "İptal",
];

const VALID_APPOINTMENT_STATUSES = [
  "Beklemede",
  "Onaylandı",
  "Tamamlandı",
  "İptal",
];

// Video format helper
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
app.get("/api/videos", async (req, res) => {
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
});

// Admin: tüm videolar
app.get("/api/admin/videos", checkAdminToken, async (req, res) => {
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
});

// Admin: yeni video ekle
app.post("/api/admin/videos", checkAdminToken, async (req, res) => {
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
});

// Admin: video güncelle
app.patch("/api/admin/videos/:id", checkAdminToken, async (req, res) => {
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
});

// Admin: video sil
app.delete("/api/admin/videos/:id", checkAdminToken, async (req, res) => {
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
});

// Admin: tüm randevuları getir
app.get("/api/admin/appointments", checkAdminToken, async (req, res) => {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const appointments = await Appointment.find()
      .sort({
        appointmentDate: 1,
        appointmentTime: 1,
        createdAt: -1,
      })
      .lean();

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
});

// Admin: randevu durumunu güncelle
app.patch(
  "/api/admin/appointments/:id/status",
  checkAdminToken,
  async (req, res) => {
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
      const currentAppointment = await Appointment.findById(id);

      if (!currentAppointment) {
        return res.status(404).json({
          success: false,
          message: "Randevu bulunamadı",
        });
      }

      const previousStatus = currentAppointment.status;

      currentAppointment.status = status;
      const updatedAppointment = await currentAppointment.save();

      let confirmationEmailSent = false;

      if (
        status === "Onaylandı" &&
        previousStatus !== "Onaylandı" &&
        updatedAppointment.email
      ) {
        try {
          const rawAppointmentDate = String(
            updatedAppointment.appointmentDate
          );

          const appointmentDate = new Date(
            rawAppointmentDate.includes("T")
              ? rawAppointmentDate
              : `${rawAppointmentDate}T12:00:00`
          );

          const formattedDate = appointmentDate.toLocaleDateString("tr-TR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            weekday: "long",
            timeZone: "Europe/Istanbul",
          });

          await sendBrevoEmail({
            to: updatedAppointment.email,
            toName: updatedAppointment.name,
            subject: "Ön görüşmeniz onaylandı | Eren Müzik Atölyesi",
            text: `Merhaba ${updatedAppointment.name},

Ön görüşme talebiniz onaylandı.

Tarih: ${formattedDate}
Saat: ${updatedAppointment.appointmentTime}
Ders: ${updatedAppointment.lesson}

Görüşme öncesinde gerekli olması hâlinde sizinle telefon veya WhatsApp üzerinden iletişime geçeceğiz.

Görüşmek üzere,

Eren Özüşen
Eren Müzik Atölyesi`,
          });

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
);

// Admin: randevuyu sil
app.delete(
  "/api/admin/appointments/:id",
  checkAdminToken,
  async (req, res) => {
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
      const deletedAppointment = await Appointment.findByIdAndDelete(id);

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
);

app.get("/api/submissions", checkAdminToken, async (req, res) => {
  if (!ensureDbConnection(res)) {
    return;
  }

  try {
    const submissions = await Submission.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json(submissions.map((submission) => formatSubmission(submission)));
  } catch (error) {
    console.error("Başvurular alınamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Başvurular alınırken bir hata oluştu",
    });
  }
});

app.patch("/api/submissions/:id/status", checkAdminToken, async (req, res) => {
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
    const updatedSubmission = await Submission.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

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
});

app.delete("/api/submissions/:id", checkAdminToken, async (req, res) => {
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
    const deletedSubmission = await Submission.findByIdAndDelete(id);

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
});

const PORT = process.env.PORT || 5000;

// Only connect to Mongo and start listening when this file is run directly
// (`node server.js`). When required as a module — e.g. by the test suite —
// this stays a plain, inert Express app with no network/DB side effects.
if (require.main === module) {
  connectMongo().finally(() => {
    app.listen(PORT, () => {
      console.log(`Backend ${PORT} portunda çalışıyor`);
    });
  });
}

module.exports = app;
