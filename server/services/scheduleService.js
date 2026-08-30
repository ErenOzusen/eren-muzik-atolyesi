const WeeklySchedule = require("../models/WeeklySchedule");

// Same default fallback used everywhere a day's schedule is looked up
// before any WeeklySchedule document exists yet for that day.
const DEFAULT_START_TIME = "10:00";
const DEFAULT_END_TIME = "20:00";

// Returns the effective schedule for a given day-of-week (0-6): the stored
// WeeklySchedule document if one exists, otherwise the same "open,
// 10:00-20:00" default the inline route handlers used before this was
// extracted. Shared by appointment creation and availability lookup
// (appointmentService) as well as the admin weekly-schedule endpoints
// (scheduleController).
async function getEffectiveDaySchedule(dayOfWeek) {
  const weeklySchedule = await WeeklySchedule.findOne({ dayOfWeek }).lean();

  return (
    weeklySchedule || {
      dayOfWeek,
      isOpen: true,
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
    }
  );
}

// Admin: upserts and returns all 7 days, creating any missing day with the
// same defaults above.
async function getAllWeeklySchedules() {
  return Promise.all(
    Array.from({ length: 7 }, (_, dayOfWeek) =>
      WeeklySchedule.findOneAndUpdate(
        { dayOfWeek },
        {
          $setOnInsert: {
            dayOfWeek,
            isOpen: true,
            startTime: DEFAULT_START_TIME,
            endTime: DEFAULT_END_TIME,
          },
        },
        {
          new: true,
          upsert: true,
        }
      )
    )
  );
}

// Admin: updates (or creates) a single day's schedule.
async function updateDaySchedule(dayOfWeek, { isOpen, startTime, endTime }) {
  return WeeklySchedule.findOneAndUpdate(
    { dayOfWeek },
    {
      dayOfWeek,
      isOpen,
      startTime: startTime || DEFAULT_START_TIME,
      endTime: endTime || DEFAULT_END_TIME,
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
    }
  );
}

module.exports = { getEffectiveDaySchedule, getAllWeeklySchedules, updateDaySchedule };
