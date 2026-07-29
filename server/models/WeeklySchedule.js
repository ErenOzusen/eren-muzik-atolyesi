const mongoose = require("mongoose");

const weeklyScheduleSchema = new mongoose.Schema(
  {
    dayOfWeek: {
      type: Number,
      required: true,
      unique: true,
      min: 0,
      max: 6,
    },
    isOpen: {
      type: Boolean,
      default: true,
    },
    startTime: {
      type: String,
      default: "10:00",
    },
    endTime: {
      type: String,
      default: "20:00",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("WeeklySchedule", weeklyScheduleSchema);
