const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    lesson: {
      type: String,
      required: true,
      trim: true,
    },
    appointmentDate: {
      type: String,
      required: true,
      trim: true,
    },
    appointmentTime: {
      type: String,
      required: true,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["Beklemede", "Onaylandı", "Tamamlandı", "İptal"],
      default: "Beklemede",
    },
    // Derived, never set directly by any route — see the pre("save") hook
    // below. Exists ONLY because MongoDB's partialFilterExpression does not
    // support $ne/$not (confirmed against a real mongod: attempting
    // `{ status: { $ne: "İptal" } }` fails index creation outright with
    // "Expression not supported in partial index: $not", code 67 — this was
    // never caught before because no test ever ran against a real
    // database). Partial indexes only reliably support plain equality, so
    // this boolean mirrors "status !== İptal" and is what the index below
    // actually filters on.
    isActiveSlot: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

appointmentSchema.pre("save", function keepIsActiveSlotInSync(next) {
  this.isActiveSlot = this.status !== "İptal";
  next();
});

// Database-level double-booking guard, in addition to the existing
// application-level conflict check in server.js. The application-level
// check has a TOCTOU race window (two concurrent requests can both pass the
// "is this slot free?" read before either write lands); this index makes
// the same guarantee atomic at the storage layer. It is a *partial* index —
// scoped to non-cancelled appointments (via isActiveSlot, see above) — so a
// cancelled slot can always be rebooked, matching the existing app-level
// conflict check's own `status: { $ne: "İptal" }` filter's intent exactly
// (just expressed as a supported equality condition instead).
//
// The explicit name is deliberate and load-bearing: server.js's E11000
// handler checks for this exact name (via error.keyPattern as the primary
// signal, this name as a fallback) before ever mapping a duplicate-key
// error to "this slot is taken" — so a future, unrelated unique index on
// this collection can never be silently misreported as a booking conflict.
const APPOINTMENT_SLOT_INDEX_NAME = "unique_active_appointment_slot";
const APPOINTMENT_SLOT_INDEX_KEY = { appointmentDate: 1, appointmentTime: 1 };

appointmentSchema.index(APPOINTMENT_SLOT_INDEX_KEY, {
  unique: true,
  partialFilterExpression: { isActiveSlot: true },
  name: APPOINTMENT_SLOT_INDEX_NAME,
});

const Appointment = mongoose.model("Appointment", appointmentSchema);

// If this fails (most likely cause: duplicate active appointments already
// exist in production for the same date+time from before this index
// existed), Mongoose does not crash the process — it only logs by default.
// The application-level conflict check in server.js keeps working either
// way; this is strictly an additional layer. Surface it loudly in server
// logs so it isn't silently missed, and expose it via
// verifyAppointmentSlotIndexExists() so server.js can also perform an
// explicit, visible startup health check rather than relying solely on
// this event firing.
let lastIndexBuildError = null;

Appointment.on("index", (error) => {
  if (error) {
    lastIndexBuildError = error;
    console.error(
      "Randevu çakışma koruması (unique index) oluşturulamadı — muhtemelen mevcut veride çakışan kayıtlar var:",
      error.message
    );
  }
});

// Explicit startup health check: confirms the unique partial index actually
// exists on the live collection (as opposed to only trusting that the
// asynchronous 'index' event never fired an error). Read-only — never
// creates, drops, or modifies any index or data. Returns
// { healthy: true } or { healthy: false, reason }.
async function verifyAppointmentSlotIndexExists() {
  try {
    const indexes = await Appointment.collection.indexes();
    const found = indexes.find((index) => index.name === APPOINTMENT_SLOT_INDEX_NAME);

    if (!found) {
      return {
        healthy: false,
        reason: lastIndexBuildError
          ? `index build failed: ${lastIndexBuildError.message}`
          : "index not found on the live collection",
      };
    }

    if (!found.unique) {
      return { healthy: false, reason: "index exists but is not marked unique" };
    }

    return { healthy: true };
  } catch (error) {
    return { healthy: false, reason: `could not read collection indexes: ${error.message}` };
  }
}

function isAppointmentSlotConflictError(error) {
  if (!error || error.code !== 11000) {
    return false;
  }

  if (error.keyPattern) {
    const keys = Object.keys(error.keyPattern);
    return (
      keys.length === Object.keys(APPOINTMENT_SLOT_INDEX_KEY).length &&
      Object.keys(APPOINTMENT_SLOT_INDEX_KEY).every((key) => key in error.keyPattern)
    );
  }

  // Fallback for driver/error shapes that don't expose keyPattern: match
  // only on the exact, explicit index name — never a bare "duplicate key"
  // guess — so an unrelated future unique index's E11000 is never
  // misreported as "this appointment slot is taken".
  return typeof error.message === "string" && error.message.includes(APPOINTMENT_SLOT_INDEX_NAME);
}

module.exports = Appointment;
module.exports.APPOINTMENT_SLOT_INDEX_NAME = APPOINTMENT_SLOT_INDEX_NAME;
module.exports.verifyAppointmentSlotIndexExists = verifyAppointmentSlotIndexExists;
module.exports.isAppointmentSlotConflictError = isAppointmentSlotConflictError;