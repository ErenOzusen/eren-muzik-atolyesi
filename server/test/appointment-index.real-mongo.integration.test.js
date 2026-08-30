// B2 — REAL MongoDB integration test for the appointment double-booking
// unique partial index. Unlike appointment-integrity.unit.test.js (which
// only checks the Mongoose schema *declaration* and the E11000-handling
// *source code*), this test runs against a genuine, real mongod process
// (via mongodb-memory-server — an ephemeral, local-only MongoDB instance,
// never a production database) and proves the actual atomic-uniqueness
// guarantee: concurrent writes, real duplicate-key errors, real partial
// filter behavior. This directly answers the audit's requirement not to
// claim "DB atomic guarantee tested" from mocks alone.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Appointment = require("../models/Appointment");
const { verifyAppointmentSlotIndexExists, isAppointmentSlotConflictError } = Appointment;

let mongod;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Appointment.init(); // wait for index build to settle
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test.beforeEach(async () => {
  await Appointment.deleteMany({});
});

function makeAppointment(overrides = {}) {
  return {
    name: "Test Öğrenci",
    phone: "0500 000 00 00",
    lesson: "Gitar",
    appointmentDate: "2027-01-15",
    appointmentTime: "11:00",
    ...overrides,
  };
}

test("B2.real.1 — the unique partial index is actually built and healthy on a real MongoDB", async () => {
  const health = await verifyAppointmentSlotIndexExists();
  assert.equal(health.healthy, true, JSON.stringify(health));
});

test("B2.real.2 — first active appointment for a slot succeeds", async () => {
  const doc = await Appointment.create(makeAppointment());
  assert.ok(doc._id);
});

test("B2.real.3 — a second ACTIVE appointment for the exact same slot is rejected by the real unique index (E11000)", async () => {
  await Appointment.create(makeAppointment());

  await assert.rejects(
    () => Appointment.create(makeAppointment()),
    (error) => {
      assert.equal(error.code, 11000);
      assert.equal(isAppointmentSlotConflictError(error), true);
      return true;
    }
  );

  const count = await Appointment.countDocuments({
    appointmentDate: "2027-01-15",
    appointmentTime: "11:00",
  });
  assert.equal(count, 1, "only the first appointment must exist — the rejected duplicate must not have been written");
});

test("B2.real.4 — cancelling the first appointment frees the slot for a brand-new active appointment", async () => {
  const first = await Appointment.create(makeAppointment());
  first.status = "İptal";
  await first.save();

  const second = await Appointment.create(makeAppointment());
  assert.ok(second._id);
  assert.notEqual(second._id.toString(), first._id.toString());
});

test("B2.real.5 — multiple cancelled records can coexist for the same slot without any index conflict", async () => {
  const first = await Appointment.create(makeAppointment());
  first.status = "İptal";
  await first.save();

  const second = await Appointment.create(makeAppointment());
  second.status = "İptal";
  await second.save();

  const third = await Appointment.create(makeAppointment());
  third.status = "İptal";
  await third.save();

  const cancelledCount = await Appointment.countDocuments({
    appointmentDate: "2027-01-15",
    appointmentTime: "11:00",
    status: "İptal",
  });
  assert.equal(cancelledCount, 3);
});

test("B2.real.6 — a different time on the same date is completely unaffected", async () => {
  await Appointment.create(makeAppointment({ appointmentTime: "11:00" }));
  const other = await Appointment.create(makeAppointment({ appointmentTime: "11:30" }));
  assert.ok(other._id);
});

test("B2.real.7 — CONCURRENT inserts for the same active slot: at most one succeeds, atomically, at the database level", async () => {
  const attempts = Array.from({ length: 8 }, () => Appointment.create(makeAppointment()));
  const results = await Promise.allSettled(attempts);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "exactly one concurrent insert must succeed");
  assert.equal(rejected.length, 7, "the other seven must be rejected");

  for (const r of rejected) {
    assert.equal(r.reason.code, 11000);
    assert.equal(isAppointmentSlotConflictError(r.reason), true);
  }

  const count = await Appointment.countDocuments({
    appointmentDate: "2027-01-15",
    appointmentTime: "11:00",
    status: { $ne: "İptal" },
  });
  assert.equal(count, 1, "the database must contain exactly one active appointment for this slot, never more");
});

test("B2.real.8 — a genuinely different unique-index violation (not this slot index) is NOT misreported as a booking conflict", async () => {
  // Prove isAppointmentSlotConflictError() discriminates correctly: build a
  // second, unrelated unique index on this same collection and confirm its
  // violations are NOT classified as an appointment-slot conflict.
  await Appointment.collection.createIndex({ phone: 1 }, { unique: true, name: "unrelated_unique_phone_index" });

  await Appointment.create(makeAppointment({ phone: "0500 999 99 99", appointmentTime: "09:00" }));

  await assert.rejects(
    () => Appointment.create(makeAppointment({ phone: "0500 999 99 99", appointmentTime: "10:00" })),
    (error) => {
      assert.equal(error.code, 11000);
      assert.equal(
        isAppointmentSlotConflictError(error),
        false,
        "a duplicate-key error from an unrelated index must not be classified as a slot conflict"
      );
      return true;
    }
  );

  await Appointment.collection.dropIndex("unrelated_unique_phone_index");
});
