import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { appointmentRestoreAvailabilitySql, noAppointmentClinicalEvidenceSql } from "../lib/calendar-database-guards.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE session_appointments (
      id TEXT PRIMARY KEY,
      professional_account_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL,
      clinical_session_run_id TEXT,
      intervention_session_id TEXT
    );
    CREATE TABLE abc_records (id TEXT PRIMARY KEY, appointment_id TEXT);
    CREATE TABLE clinical_session_runs (id TEXT PRIMARY KEY, appointment_id TEXT);
    CREATE TABLE meeting_requests (
      id TEXT PRIMARY KEY,
      requester_account_id TEXT NOT NULL,
      recipient_account_id TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  return db;
}

function addAppointment(db, id, status = "scheduled", professional = "professional-1") {
  db.prepare(`
    INSERT INTO session_appointments
      (id, professional_account_id, session_date, start_time, end_time, status)
    VALUES (?, ?, '2026-09-10', '08:00', '09:00', ?)
  `).run(id, professional, status);
}

const deleteAdministrativeSql = `
  DELETE FROM session_appointments AS appointment
  WHERE appointment.id = ? AND appointment.status IN ('scheduled', 'cancelled')
    AND ${noAppointmentClinicalEvidenceSql("appointment")}
`;

const cancelAdministrativeSql = `
  UPDATE session_appointments AS appointment SET status = 'cancelled'
  WHERE appointment.id = ? AND appointment.status = 'scheduled'
    AND ${noAppointmentClinicalEvidenceSql("appointment")}
`;

const restoreAdministrativeSql = `
  UPDATE session_appointments AS appointment SET status = 'scheduled'
  WHERE appointment.id = ? AND appointment.status = 'cancelled'
    AND ${noAppointmentClinicalEvidenceSql("appointment")}
    ${appointmentRestoreAvailabilitySql("appointment")}
`;

const editAdministrativeSql = `
  UPDATE session_appointments AS appointment SET start_time = ?, end_time = ?
  WHERE appointment.id = ? AND appointment.status IN ('scheduled', 'cancelled')
    AND ${noAppointmentClinicalEvidenceSql("appointment")}
`;

test("crea y edita citas administrativas sin alterar su naturaleza", () => {
  const db = database();
  addAppointment(db, "scheduled");
  addAppointment(db, "cancelled", "cancelled");
  assert.equal(db.prepare(editAdministrativeSql).run("09:00", "10:00", "scheduled").changes, 1);
  assert.equal(db.prepare(editAdministrativeSql).run("10:00", "11:00", "cancelled").changes, 1);
  const rows = db.prepare("SELECT id, status, start_time AS startTime FROM session_appointments ORDER BY id").all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: "cancelled", status: "cancelled", startTime: "10:00" },
    { id: "scheduled", status: "scheduled", startTime: "09:00" },
  ]);
});

test("elimina citas administrativas futuras o pasadas sin depender de la fecha", () => {
  const db = database();
  addAppointment(db, "future");
  db.prepare("UPDATE session_appointments SET session_date = '2027-01-01' WHERE id = 'future'").run();
  addAppointment(db, "past");
  db.prepare("UPDATE session_appointments SET session_date = '2025-01-01' WHERE id = 'past'").run();
  assert.equal(db.prepare(deleteAdministrativeSql).run("future").changes, 1);
  assert.equal(db.prepare(deleteAdministrativeSql).run("past").changes, 1);
});

test("conserva citas completadas y citas vinculadas a sesiones clínicas", () => {
  const db = database();
  addAppointment(db, "completed", "completed");
  db.prepare("INSERT INTO clinical_session_runs (id, appointment_id) VALUES ('completed-run', 'completed')").run();
  db.prepare("INSERT INTO abc_records (id, appointment_id) VALUES ('completed-abc', 'completed')").run();
  addAppointment(db, "linked");
  db.prepare("UPDATE session_appointments SET clinical_session_run_id = 'run-1' WHERE id = 'linked'").run();
  assert.equal(db.prepare(deleteAdministrativeSql).run("completed").changes, 0);
  assert.equal(db.prepare(deleteAdministrativeSql).run("linked").changes, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM session_appointments").get().count, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM clinical_session_runs").get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM abc_records").get().count, 1);
});

test("impide cancelar o eliminar cuando existe un ABC asociado", () => {
  const db = database();
  addAppointment(db, "with-abc");
  db.prepare("INSERT INTO abc_records (id, appointment_id) VALUES ('abc-1', 'with-abc')").run();
  assert.equal(db.prepare(cancelAdministrativeSql).run("with-abc").changes, 0);
  assert.equal(db.prepare(deleteAdministrativeSql).run("with-abc").changes, 0);
  assert.equal(db.prepare("SELECT status FROM session_appointments WHERE id = 'with-abc'").get().status, "scheduled");
});

test("detecta una sesión clínica por la relación inversa del run", () => {
  const db = database();
  addAppointment(db, "with-run");
  db.prepare("INSERT INTO clinical_session_runs (id, appointment_id) VALUES ('run-1', 'with-run')").run();
  assert.equal(db.prepare(deleteAdministrativeSql).run("with-run").changes, 0);
});

test("restaura sólo cuando no hay conflictos con sesiones ni reuniones", () => {
  const db = database();
  addAppointment(db, "cancelled", "cancelled");
  addAppointment(db, "overlap", "scheduled");
  assert.equal(db.prepare(restoreAdministrativeSql).run("cancelled").changes, 0);

  db.prepare("DELETE FROM session_appointments WHERE id = 'overlap'").run();
  db.prepare(`
    INSERT INTO meeting_requests
      (id, requester_account_id, recipient_account_id, meeting_date, start_time, end_time, status)
    VALUES ('meeting-1', 'professional-1', 'director-1', '2026-09-10', '08:15', '08:45', 'pending')
  `).run();
  assert.equal(db.prepare(restoreAdministrativeSql).run("cancelled").changes, 0);

  db.prepare("UPDATE meeting_requests SET status = 'cancelled' WHERE id = 'meeting-1'").run();
  db.prepare(`
    INSERT INTO meeting_requests
      (id, requester_account_id, recipient_account_id, meeting_date, start_time, end_time, status)
    VALUES ('meeting-2', 'director-1', 'professional-1', '2026-09-10', '08:15', '08:45', 'accepted')
  `).run();
  assert.equal(db.prepare(restoreAdministrativeSql).run("cancelled").changes, 0);

  db.prepare("UPDATE meeting_requests SET status = 'cancelled' WHERE id = 'meeting-2'").run();
  assert.equal(db.prepare(restoreAdministrativeSql).run("cancelled").changes, 1);
});

test("rechaza alias SQL no controlados", () => {
  assert.throws(() => noAppointmentClinicalEvidenceSql("appointment; DROP TABLE abc_records"), /Alias SQL/);
});
