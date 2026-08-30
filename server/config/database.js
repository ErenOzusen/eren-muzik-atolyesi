const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { verifyAppointmentSlotIndexExists } = Appointment;

let isDbConnected = false;

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

module.exports = { connectMongo, ensureDbConnection };
