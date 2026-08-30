// Zero-network, zero-DB checks for the appointment double-booking guard.
//
// This complements appointment-index.real-mongo.integration.test.js (which
// proves the actual atomic behavior against a real, ephemeral mongod). This
// file checks things a real-DB test can't cheaply cover on every run: the
// exact schema/source-code contract, and the E11000-discrimination logic in
// isolation.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const Appointment = require("../models/Appointment");
const { isAppointmentSlotConflictError, APPOINTMENT_SLOT_INDEX_NAME } = Appointment;

test("Appointment schema declares a unique partial index on (appointmentDate, appointmentTime), filtered on the derived isActiveSlot flag", () => {
  const indexes = Appointment.schema.indexes();
  const match = indexes.find(([fields]) =>
    Object.prototype.hasOwnProperty.call(fields, "appointmentDate") &&
    Object.prototype.hasOwnProperty.call(fields, "appointmentTime")
  );

  assert.ok(match, "expected an index on appointmentDate + appointmentTime");

  const [fields, options] = match;
  assert.equal(fields.appointmentDate, 1);
  assert.equal(fields.appointmentTime, 1);
  assert.equal(options.unique, true, "the index must be unique");
  assert.equal(options.name, APPOINTMENT_SLOT_INDEX_NAME);

  // MongoDB's partialFilterExpression does not support $ne/$not (confirmed
  // against a real mongod — see appointment-index.real-mongo test file);
  // only a plain-equality filter is reliably supported. isActiveSlot is a
  // derived boolean kept in sync via a pre("save") hook specifically so
  // this filter can be plain equality.
  assert.deepEqual(
    options.partialFilterExpression,
    { isActiveSlot: true },
    "the partial filter must be a supported plain-equality expression, not $ne/$not"
  );
  assert.ok(
    !JSON.stringify(options.partialFilterExpression).includes("$ne") &&
      !JSON.stringify(options.partialFilterExpression).includes("$not"),
    "partialFilterExpression must never use $ne/$not — MongoDB rejects index creation outright for these"
  );
});

test("isActiveSlot is derived from status via a pre(save) hook, not settable independently by any route", () => {
  const modelSource = readFileSync(path.join(__dirname, "..", "models", "Appointment.js"), "utf8");

  assert.match(modelSource, /pre\(\s*["']save["']/, "expected a pre(save) hook");
  assert.match(modelSource, /this\.isActiveSlot\s*=\s*this\.status\s*!==\s*"İptal"/);

  const serverSource = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(
    !serverSource.includes("isActiveSlot"),
    "no route should set isActiveSlot directly — it must only ever be derived from status"
  );
});

test("isAppointmentSlotConflictError: recognizes a real E11000 keyPattern match for this exact index", () => {
  const error = {
    code: 11000,
    keyPattern: { appointmentDate: 1, appointmentTime: 1 },
  };
  assert.equal(isAppointmentSlotConflictError(error), true);
});

test("isAppointmentSlotConflictError: falls back to the exact index name when keyPattern is absent", () => {
  const error = {
    code: 11000,
    message: `E11000 duplicate key error collection: db.appointments index: ${APPOINTMENT_SLOT_INDEX_NAME} dup key: { : "x" }`,
  };
  assert.equal(isAppointmentSlotConflictError(error), true);
});

test("isAppointmentSlotConflictError: rejects a duplicate-key error from an unrelated index (keyPattern mismatch)", () => {
  const error = {
    code: 11000,
    keyPattern: { phone: 1 },
  };
  assert.equal(isAppointmentSlotConflictError(error), false);
});

test("isAppointmentSlotConflictError: rejects a duplicate-key error whose message doesn't mention this index (no keyPattern)", () => {
  const error = {
    code: 11000,
    message: "E11000 duplicate key error collection: db.appointments index: some_other_index dup key: {}",
  };
  assert.equal(isAppointmentSlotConflictError(error), false);
});

test("isAppointmentSlotConflictError: rejects non-duplicate-key errors entirely", () => {
  assert.equal(isAppointmentSlotConflictError({ code: 121, message: "validation failed" }), false);
  assert.equal(isAppointmentSlotConflictError(new Error("cast error")), false);
  assert.equal(isAppointmentSlotConflictError(null), false);
  assert.equal(isAppointmentSlotConflictError(undefined), false);
});

test("the appointment-creation route uses isAppointmentSlotConflictError (not a bare error.code check) and maps it to 409, not 500", () => {
  // The route registration itself lives in routes/appointmentRoutes.js; the
  // actual error-discrimination logic this test cares about lives in its
  // controller (extracted from server.js by the backend architecture
  // refactor — same behavior, new location).
  const serverSource = readFileSync(
    path.join(__dirname, "..", "controllers", "appointmentController.js"),
    "utf8"
  );

  const routeStart = serverSource.indexOf("async function createAppointment(req, res)");
  assert.ok(routeStart >= 0, "could not find the appointment creation route");

  const nextRouteStart = serverSource.indexOf("\nasync function", routeStart + 1);
  const routeBlock = serverSource.slice(routeStart, nextRouteStart === -1 ? undefined : nextRouteStart);

  assert.match(
    routeBlock,
    /isAppointmentSlotConflictError\s*\(\s*error\s*\)/,
    "must discriminate the specific appointment-slot index, not just any E11000"
  );
  assert.ok(
    !/if\s*\(\s*error\.code\s*===\s*11000\s*\)/.test(routeBlock),
    "must not fall back to a bare error.code === 11000 check that would misclassify unrelated unique-index violations"
  );

  const checkIndex = routeBlock.search(/isAppointmentSlotConflictError\s*\(\s*error\s*\)/);
  const afterCheck = routeBlock.slice(checkIndex, checkIndex + 300);
  assert.match(afterCheck, /status\(409\)/, "a slot-conflict error must be reported as 409, not left to fall through to 500");
});

test("Appointment model logs (rather than silently swallowing) an index-build failure", () => {
  const modelSource = readFileSync(path.join(__dirname, "..", "models", "Appointment.js"), "utf8");

  assert.match(
    modelSource,
    /Appointment\.on\(\s*["']index["']/,
    "an index-build failure (e.g. pre-existing duplicate data) must be surfaced in logs, not ignored"
  );
});

test("B2 — connectMongo performs an explicit, visible startup health check of the appointment-slot index", () => {
  // connectMongo/ensureDbConnection live in config/database.js (extracted
  // from server.js by the backend architecture refactor) — same behavior,
  // new location.
  const databaseSource = readFileSync(path.join(__dirname, "..", "config", "database.js"), "utf8");
  const connectMongoStart = databaseSource.indexOf("async function connectMongo()");
  assert.ok(connectMongoStart >= 0);
  const connectMongoEnd = databaseSource.indexOf("\nfunction ensureDbConnection", connectMongoStart);
  const connectMongoBlock = databaseSource.slice(connectMongoStart, connectMongoEnd);

  assert.match(connectMongoBlock, /verifyAppointmentSlotIndexExists\s*\(\s*\)/);
  assert.match(connectMongoBlock, /indexHealth\.healthy/);
});
