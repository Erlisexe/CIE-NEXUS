import test from "node:test";
import assert from "node:assert/strict";
import { groupProgramSessions, programsForClinicalSession } from "../lib/clinical-session-runs.ts";

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
