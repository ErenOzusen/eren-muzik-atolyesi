const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const submissionsFilePath = path.join(__dirname, "submissions.json");

app.get("/", (req, res) => {
  res.send("Backend çalışıyor kral");
});

app.post("/api/contact", (req, res) => {
  const newSubmission = {
    ...req.body,
    date: new Date().toISOString(),
  };

  console.log("Yeni başvuru geldi:");
  console.log(newSubmission);

  let submissions = [];

  if (fs.existsSync(submissionsFilePath)) {
    const fileData = fs.readFileSync(submissionsFilePath, "utf-8");

    if (fileData) {
      submissions = JSON.parse(fileData);
    }
  }

  submissions.push(newSubmission);

  fs.writeFileSync(
    submissionsFilePath,
    JSON.stringify(submissions, null, 2),
    "utf-8"
  );

  res.json({
    success: true,
    message: "Başvuru başarıyla kaydedildi",
  });
});

app.get("/api/submissions", (req, res) => {
  let submissions = [];

  if (fs.existsSync(submissionsFilePath)) {
    const fileData = fs.readFileSync(submissionsFilePath, "utf-8");

    if (fileData) {
      submissions = JSON.parse(fileData);
    }
  }

  res.json(submissions);
});

app.delete("/api/submissions/:index", (req, res) => {
  const index = Number(req.params.index);

  if (!fs.existsSync(submissionsFilePath)) {
    return res.json({
      success: false,
      message: "Kayıt dosyası bulunamadı",
    });
  }

  const fileData = fs.readFileSync(submissionsFilePath, "utf-8");
  const submissions = JSON.parse(fileData);

  if (index < 0 || index >= submissions.length) {
    return res.json({
      success: false,
      message: "Geçersiz kayıt",
    });
  }

  submissions.splice(index, 1);

  fs.writeFileSync(
    submissionsFilePath,
    JSON.stringify(submissions, null, 2)
  );

  res.json({
    success: true,
    message: "Başvuru silindi",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend ${PORT} portunda çalışıyor`);
});