require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const Submission = require("./models/Submission");
const Video = require("./models/Video");
const Appointment = require("./models/Appointment");
//const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();

app.use(cors());
app.use(express.json());

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
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATION_EMAIL) {
    console.warn("E-posta bildirimi için gerekli env değişkenleri eksik.");
    return;
  }

  const { data, error } = await resend.emails.send({
    from: "Eren Müzik Atölyesi <onboarding@resend.dev>",
    to: process.env.NOTIFICATION_EMAIL,
    subject: "Yeni başvuru geldi 🎵",
    text: `
Yeni başvuru geldi 🎵

Ad Soyad: ${submission.name || "-"}
Telefon: ${submission.phone || "-"}
Ders: ${submission.lesson || "-"}
Mesaj: ${submission.message || "-"}

Admin panel:
https://eren-muzik-atolyesi.vercel.app/admin
    `,
  });

  if (error) {
    console.error("Resend e-posta hatası:", error);
    return;
  }

  console.log("Yeni başvuru e-postası gönderildi. Resend ID:", data?.id);
};

app.post("/api/contact", async (req, res) => {
  if (!ensureDbConnection(res)) {
    return;
  }

  const { name, phone, lesson, message } = req.body;

  if (!name?.trim() || !phone?.trim() || !lesson?.trim() || !message?.trim()) {
    return res.status(400).json({
      success: false,
      message: "Tüm alanları doldurmanız gerekiyor",
    });
  }

  try {
    const submission = await Submission.create({
      name: name.trim(),
      phone: phone.trim(),
      lesson: lesson.trim(),
      message: message.trim(),
    });

    console.log("Yeni başvuru kaydedildi:", formatSubmission(submission));

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
app.post("/api/appointments", async (req, res) => {
  if (!ensureDbConnection(res)) {
    return;
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

  try {
    const existingAppointment = await Appointment.findOne({
      appointmentDate: appointmentDate.trim(),
      appointmentTime: appointmentTime.trim(),
      status: { $ne: "İptal" },
    });

    if (existingAppointment) {
      return res.status(409).json({
        success: false,
        message: "Bu tarih ve saat için daha önce randevu alınmış",
      });
    }

    const appointment = await Appointment.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email?.trim() || "",
      lesson: lesson.trim(),
      appointmentDate: appointmentDate.trim(),
      appointmentTime: appointmentTime.trim(),
      note: note?.trim() || "",
    });

    console.log("Yeni randevu talebi oluşturuldu:", formatAppointment(appointment));

    res.status(201).json({
      success: true,
      message: "Randevu talebiniz başarıyla oluşturuldu",
      appointment: formatAppointment(appointment),
    });
  } catch (error) {
    console.error("Randevu oluşturulamadı:", error.message);

    res.status(500).json({
      success: false,
      message: "Randevu oluşturulurken bir hata meydana geldi",
    });
  }
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "eren123";
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "eren-admin-token";

  if (password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      message: "Admin girişi başarılı",
      token: ADMIN_TOKEN,
    });
  }

  return res.status(401).json({
    success: false,
    message: "Şifre hatalı",
  });
});

const checkAdminToken = (req, res, next) => {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "eren-admin-token";

  const token = req.headers.authorization;

  if (token === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Yetkisiz erişim",
    });
  }
};

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
      const updatedAppointment = await Appointment.findByIdAndUpdate(
        id,
        { status },
        { new: true }
      );

      if (!updatedAppointment) {
        return res.status(404).json({
          success: false,
          message: "Randevu bulunamadı",
        });
      }

      res.json({
        success: true,
        message: "Randevu durumu güncellendi",
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

connectMongo().finally(() => {
  app.listen(PORT, () => {
    console.log(`Backend ${PORT} portunda çalışıyor`);
  });
});
