const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const Submission = require("./models/Submission");

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
