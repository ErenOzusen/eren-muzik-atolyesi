const Appointment = require("../models/Appointment");
const BlockedSlot = require("../models/BlockedSlot");
const { getEffectiveDaySchedule } = require("./scheduleService");

const APPOINTMENT_DURATION_MINUTES = 30;

function toMinutes(hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

// Fetches the two conflict data sources shared by both appointment
// creation and availability listing: active appointments already booked
// for the date, and any admin-blocked time ranges for that date.
async function getConflictDataForDate(date) {
  const sameDayAppointments = await Appointment.find({
    appointmentDate: date,
    status: { $ne: "İptal" },
  })
    .select("appointmentTime -_id")
    .lean();

  const blockedSlotsForDate = await BlockedSlot.find({ date })
    .select("startTime endTime -_id")
    .lean();

  return { sameDayAppointments, blockedSlotsForDate };
}

// Attempts to create a new appointment for an already format/field-validated
// request (name/phone/lesson/email/date/time shape checks are the caller's
// job — see appointmentController). Returns a discriminated result object;
// the controller maps each `status` to the exact HTTP status/message the
// original inline route handler returned. Any error thrown here (in
// particular the DB-level unique-index conflict on a race) propagates to
// the caller's try/catch unchanged, exactly as when this was one inline
// try block in server.js.
async function createAppointment({ name, phone, email, lesson, normalizedDate, normalizedTime, note }) {
  const [year, month, day] = normalizedDate.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const schedule = await getEffectiveDaySchedule(dayOfWeek);

  if (!schedule.isOpen) {
    return { status: "closed" };
  }

  const scheduleStart = toMinutes(schedule.startTime);
  const scheduleEnd = toMinutes(schedule.endTime);
  const requestedStart = toMinutes(normalizedTime);
  const requestedEnd = requestedStart + APPOINTMENT_DURATION_MINUTES;

  const isInsideWorkingHours = requestedStart >= scheduleStart && requestedEnd <= scheduleEnd;
  const isValidTimeInterval = (requestedStart - scheduleStart) % APPOINTMENT_DURATION_MINUTES === 0;

  if (!isInsideWorkingHours || !isValidTimeInterval) {
    return { status: "outsideHours" };
  }

  const { sameDayAppointments, blockedSlotsForDate } = await getConflictDataForDate(normalizedDate);

  const hasTimeConflict = sameDayAppointments.some((item) => {
    const existingStart = toMinutes(item.appointmentTime);
    const existingEnd = existingStart + APPOINTMENT_DURATION_MINUTES;
    return requestedStart < existingEnd && requestedEnd > existingStart;
  });

  const hasBlockedSlotConflict = blockedSlotsForDate.some((blockedSlot) => {
    const blockedStart = toMinutes(blockedSlot.startTime);
    const blockedEnd = toMinutes(blockedSlot.endTime);
    return requestedStart < blockedEnd && requestedEnd > blockedStart;
  });

  if (hasTimeConflict || hasBlockedSlotConflict) {
    return { status: "conflict" };
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

  return { status: "created", appointment };
}

// Computes available/unavailable time slots for a given date. Throws on
// error — the controller wraps the call in try/catch, matching the
// original inline handler.
async function getAvailability(date) {
  const [year, month, day] = date.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const schedule = await getEffectiveDaySchedule(dayOfWeek);

  if (!schedule.isOpen) {
    return {
      isOpen: false,
      dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      availableTimes: [],
      unavailableTimes: [],
    };
  }

  const scheduleStart = toMinutes(schedule.startTime);
  const scheduleEnd = toMinutes(schedule.endTime);

  const { sameDayAppointments: appointments, blockedSlotsForDate: blockedSlots } =
    await getConflictDataForDate(date);

  const scheduleTimes = [];

  for (
    let minutes = scheduleStart;
    minutes + APPOINTMENT_DURATION_MINUTES <= scheduleEnd;
    minutes += APPOINTMENT_DURATION_MINUTES
  ) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minute = String(minutes % 60).padStart(2, "0");
    scheduleTimes.push(`${hour}:${minute}`);
  }

  const unavailableTimes = scheduleTimes.filter((slot) => {
    const slotStart = toMinutes(slot);
    const slotEnd = slotStart + APPOINTMENT_DURATION_MINUTES;

    const conflictsWithAppointment = appointments.some((appointment) => {
      const existingStart = toMinutes(appointment.appointmentTime);
      const existingEnd = existingStart + APPOINTMENT_DURATION_MINUTES;
      return slotStart < existingEnd && slotEnd > existingStart;
    });

    const conflictsWithBlockedSlot = blockedSlots.some((blockedSlot) => {
      const blockedStart = toMinutes(blockedSlot.startTime);
      const blockedEnd = toMinutes(blockedSlot.endTime);
      return slotStart < blockedEnd && slotEnd > blockedStart;
    });

    return conflictsWithAppointment || conflictsWithBlockedSlot;
  });

  const availableTimes = scheduleTimes.filter((slot) => !unavailableTimes.includes(slot));

  return {
    isOpen: true,
    dayOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    availableTimes,
    unavailableTimes,
  };
}

async function listAppointments() {
  return Appointment.find()
    .sort({
      appointmentDate: 1,
      appointmentTime: 1,
      createdAt: -1,
    })
    .lean();
}

// Loads the appointment, applies the new status, and saves — returns null
// if not found (controller maps that to 404). Returns the previous status
// alongside the updated document so the controller can decide whether a
// confirmation email is due (transitioning INTO "Onaylandı").
async function updateAppointmentStatus(id, status) {
  const currentAppointment = await Appointment.findById(id);

  if (!currentAppointment) {
    return null;
  }

  const previousStatus = currentAppointment.status;
  currentAppointment.status = status;
  const updatedAppointment = await currentAppointment.save();

  return { previousStatus, updatedAppointment };
}

async function deleteAppointmentById(id) {
  return Appointment.findByIdAndDelete(id);
}

module.exports = {
  createAppointment,
  getAvailability,
  listAppointments,
  updateAppointmentStatus,
  deleteAppointmentById,
};
