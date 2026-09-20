import test from "node:test";
import assert from "node:assert/strict";
import { groupProgramSessions, programsForClinicalSession, summarizeClosedSessions } from "../lib/clinical-session-runs.ts";

test("una sesión incorpora todos los programas activos con targets abiertos del mismo niño", () => {
  const programs = [
    { id: "P1", profileId: "N1", status: "active", targets: [{ state: "baseline" }] },
    { id: "P2", profileId: "N1", status: "active", targets: [{ state: "acquisition" }] },
    { id: "P3", profileId: "N1", status: "archived", targets: [{ state: "acquisition" }] },
    { id: "P4", profileId: "N1", status: "active", targets: [{ state: "closed" }] },
    { id: "P5", profileId: "N2", status: "active", targets: [{ state: "baseline" }] },
  ];
  assert.deepEqual(programsForClinicalSession(programs, "N1").map((program) => program.id), ["P1", "P2"]);
});

test("los registros por programa se muestran como una sola sesión clínica", () => {
  const groups = groupProgramSessions([
    { id: "S1", clinicalSessionRunId: "RUN-1", programId: "P1" },
    { id: "S2", clinicalSessionRunId: "RUN-1", programId: "P2" },
    { id: "LEGACY", clinicalSessionRunId: null, programId: "P1" },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].rows.map((row) => row.programId), ["P1", "P2"]);
  assert.equal(groups[1].id, "LEGACY");
});

test("cinco registros por programa representan cuatro encuentros cerrados", () => {
  const records = ["R1", "R2", "R3", "R3", "R4"].map((run, i) => ({ id: `S${i}`, clinicalSessionRunId: run, programId: i === 3 ? "social" : "communication", status: "closed" }));
  const before = JSON.stringify(records);
  const summary = summarizeClosedSessions(records);
  assert.equal(summary.sessionCount, 4);
  assert.equal(summary.programRecordCount, 5);
  assert.deepEqual(summary.groups.find(g => g.id === "R3").rows.map(r => r.programId), ["communication", "social"]);
  assert.equal(JSON.stringify(records), before);
});

test("los borradores, citas canceladas y sesiones en curso no suman encuentros cerrados", () => {
  const summary = summarizeClosedSessions(["draft", "scheduled", "cancelled", "in_progress"].map(status => ({ id: status, status })));
  assert.equal(summary.sessionCount, 0);
  assert.equal(summary.programRecordCount, 0);
  assert.deepEqual(summary.groups, []);
});

test("dos encuentros del mismo día y los registros antiguos sin run conservan identidades distintas", () => {
  const records = ["R1", "R2", null, null].map((run, i) => ({ id: `S${i}`, clinicalSessionRunId: run, status: "closed", sessionDate: "2026-09-20", professionalAccountId: "same-professional" }));
  assert.equal(summarizeClosedSessions(records).sessionCount, 4);
});

test("el total no se limita a la lista reciente y archivar un programa no borra encuentros", () => {
  const records = Array.from({length: 601}, (_, i) => ({id: `S${i}`, clinicalSessionRunId: `R${i}`, programId: i % 2 ? "archived-program" : "active-program", status: "closed"}));
  const summary = summarizeClosedSessions(records);
  assert.equal(summary.sessionCount, 601);
  assert.equal(summary.programRecordCount, 601);
  assert.equal(summarizeClosedSessions(records.filter(r => r.programId === "archived-program")).sessionCount, 300);
});
