/**
 * Tek seferlik import: submissions.json -> MongoDB
 * Kullanım:
 *   MONGODB_URI="..." node scripts/import-submissions.js
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Submission = require("../models/Submission");

const submissionsFilePath = path.join(__dirname, "..", "submissions.json");

async function importSubmissions() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error("MONGODB_URI tanımlı değil.");
    process.exit(1);
  }

  if (!fs.existsSync(submissionsFilePath)) {
    console.error("submissions.json bulunamadı.");
    process.exit(1);
  }

  const raw = fs.readFileSync(submissionsFilePath, "utf-8");
  const submissions = JSON.parse(raw);

  await mongoose.connect(mongoUri);

  let imported = 0;

  for (const item of submissions) {
    const createdAt = item.date ? new Date(item.date) : new Date();

    await Submission.create({
      name: item.name?.trim() || "İsimsiz",
      phone: item.phone?.trim() || "",
      lesson: item.lesson?.trim() || "",
      message: item.message?.trim() || "",
      createdAt,
    });

    imported += 1;
  }

  console.log(`${imported} başvuru MongoDB'ye aktarıldı.`);
  await mongoose.disconnect();
}

importSubmissions().catch((error) => {
  console.error("Import hatası:", error.message);
  process.exit(1);
});
