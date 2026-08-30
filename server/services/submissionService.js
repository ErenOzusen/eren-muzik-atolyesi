const Submission = require("../models/Submission");

async function createSubmission({ name, phone, lesson, message }) {
  return Submission.create({
    name: name.trim(),
    phone: phone.trim(),
    lesson: lesson.trim(),
    message: message.trim(),
  });
}

async function listSubmissions() {
  return Submission.find().sort({ createdAt: -1 }).lean();
}

async function updateSubmissionStatus(id, status) {
  return Submission.findByIdAndUpdate(id, { status }, { new: true });
}

async function deleteSubmissionById(id) {
  return Submission.findByIdAndDelete(id);
}

module.exports = {
  createSubmission,
  listSubmissions,
  updateSubmissionStatus,
  deleteSubmissionById,
};
