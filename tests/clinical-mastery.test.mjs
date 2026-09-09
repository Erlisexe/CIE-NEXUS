import test from "node:test";
import assert from "node:assert/strict";
import { buildCumulativeMasteryTimeline, normalizeCriteria, replayClinicalProgram, targetStateLabel } from "../lib/clinical-mastery.ts";

test("las etapas internas heredadas presentan el vocabulario clínico vigente", () => {
  assert.equal(targetStateLabel("baseline"), "Línea base");
  assert.equal(targetStateLabel("acquisition"), "Adquisición");
  assert.equal(targetStateLabel("generalization"), "Masterizado");
  assert.equal(targetStateLabel("maintenance"), "Generalizado");
  assert.equal(targetStateLabel("closed"), "Cerrado");
});

function criteria({ threshold = 100, minTrials = 3, requiredSessions = 3 } = {}) {
  const value = {
    metric: "percentage_correct",
    operator: "gte",
    threshold,
    minTrials,
    requiredSessions,
    consecutive: true,
    distinctContexts: 1,
    insufficientSampleBreaksStreak: false,
  };
  return normalizeCriteria({ baseline: value, acquisition: value, generalization: { ...value, requiredSessions: 1 }, maintenance: { ...value, requiredSessions: 1 } }, "occurrence");
}

function target(id, options = {}) {
  return { id, code: id, name: `Target ${id}`, measurement: "occurrence", criteria: criteria(options), initialState: options.initialState || "acquisition" };
}

function result(targetId, trials) {
  const correct = trials.reduce((sum, item) => sum + item, 0);
  return {
    targetId,
    sampled: true,
    value: trials.length ? Math.round(correct / trials.length * 1000) / 10 : null,
    correct,
    opportunities: trials.length,
    trials,
    note: "",
    stateAtSession: "acquisition",
    criterionStatus: "not_evaluated",
    criterionReason: "",
  };
}

function session(id, date, results) {
  return { id, sessionDate: date, context: "Clínica", professionalAccountId: "TEST-PRO", createdAt: `${date}T10:00:00Z`, results };
}

const perfect3 = [1, 1, 1];

test("Prueba 1: 3/3 durante tres sesiones incrementa únicamente en la tercera", () => {
  const targets = [target("T1")];
  const sessions = [
    session("S1", "2026-08-01", [result("T1", perfect3)]),
    session("S2", "2026-08-02", [result("T1", perfect3)]),
    session("S3", "2026-08-03", [result("T1", perfect3)]),
  ];
  assert.equal(replayClinicalProgram(targets, sessions.slice(0, 1)).masteryEvents.length, 0);
  assert.equal(replayClinicalProgram(targets, sessions.slice(0, 2)).masteryEvents.length, 0);
  const replay = replayClinicalProgram(targets, sessions);
  assert.equal(replay.masteryEvents.length, 1);
  assert.equal(replay.masteryEvents[0].masteredAt, "2026-08-03");
});

test("Pruebas 2, 3 y 8: un segundo target suma +1 y cada target aporta una sola vez", () => {
  const targets = [target("T1"), target("T2")];
  const sessions = [
    session("S1", "2026-08-01", [result("T1", perfect3)]),
    session("S2", "2026-08-02", [result("T1", perfect3)]),
    session("S3", "2026-08-03", [result("T1", perfect3)]),
    session("S4", "2026-08-04", [result("T1", perfect3), result("T2", perfect3)]),
    session("S5", "2026-08-05", [result("T1", perfect3), result("T2", perfect3)]),
    session("S6", "2026-08-06", [result("T1", perfect3), result("T2", perfect3)]),
    session("S7", "2026-08-07", [result("T1", perfect3), result("T2", perfect3)]),
    session("S8", "2026-08-08", [result("T1", perfect3), result("T2", perfect3)]),
  ];
  const replay = replayClinicalProgram(targets, sessions);
  assert.deepEqual(replay.masteryEvents.map((event) => event.targetId), ["T1", "T2"]);
  assert.equal(new Set(replay.masteryEvents.map((event) => event.targetId)).size, 2);
  assert.equal(replay.targetStates.get("T1"), "closed");
  assert.equal(replay.targetStates.get("T2"), "closed");
});

test("Prueba 4: 9/10 en Línea base cierra y registra dominio", () => {
  const baselineTarget = target("T1", { threshold: 90, minTrials: 10, requiredSessions: 1, initialState: "baseline" });
  const replay = replayClinicalProgram([baselineTarget], [session("S1", "2026-08-15", [result("T1", [1,1,1,1,1,1,1,1,1,0])])]);
  assert.equal(replay.targetStates.get("T1"), "closed");
  assert.equal(replay.masteryEvents.length, 1);
  assert.equal(replay.masteryEvents[0].method, "baseline");
});

test("Prueba 5: 8/10 en Línea base pasa a Adquisición sin incrementar", () => {
  const baselineTarget = target("T1", { threshold: 90, minTrials: 10, requiredSessions: 1, initialState: "baseline" });
  const replay = replayClinicalProgram([baselineTarget], [session("S1", "2026-08-15", [result("T1", [1,1,1,1,1,1,1,1,0,0])])]);
  assert.equal(replay.targetStates.get("T1"), "acquisition");
  assert.equal(replay.masteryEvents.length, 0);
});

test("Prueba 6: 9/9 se conserva como 100%, queda insuficiente y no rompe la secuencia", () => {
  const acquisitionTarget = target("T1", { threshold: 90, minTrials: 10, requiredSessions: 3 });
  const sessions = [
    session("S1", "2026-08-01", [result("T1", Array(10).fill(1))]),
    session("S2", "2026-08-02", [result("T1", Array(9).fill(1))]),
    session("S3", "2026-08-03", [result("T1", Array(10).fill(1))]),
    session("S4", "2026-08-04", [result("T1", Array(10).fill(1))]),
  ];
  const replay = replayClinicalProgram([acquisitionTarget], sessions);
  assert.equal(replay.sessions[1].results[0].value, 100);
  assert.equal(replay.sessions[1].results[0].criterionStatus, "insufficient_sample");
  assert.equal(replay.masteryEvents.length, 1);
  assert.equal(replay.masteryEvents[0].sessionId, "S4");
});

test("Prueba 7: el mínimo no funciona como máximo y acepta 12 ensayos", () => {
  const acquisitionTarget = target("T1", { threshold: 90, minTrials: 10, requiredSessions: 1 });
  const trials = [1,1,1,1,1,1,1,1,1,1,1,0];
  const replay = replayClinicalProgram([acquisitionTarget], [session("S1", "2026-08-01", [result("T1", trials)])]);
  assert.equal(replay.sessions[0].results[0].opportunities, 12);
  assert.equal(replay.sessions[0].results[0].value, 91.7);
  assert.equal(replay.sessions[0].results[0].criterionStatus, "met");
  assert.equal(replay.masteryEvents.length, 1);
});

test("la gráfica acumulativa usa eventos únicos, inicia en cero y nunca desciende", () => {
  const targets = [target("T1"), target("T2")];
  const sessions = [
    session("S1", "2026-08-01", [result("T1", perfect3)]),
    session("S2", "2026-08-02", [result("T1", perfect3)]),
    session("S3", "2026-08-03", [result("T1", perfect3)]),
    session("S4", "2026-08-04", [result("T2", perfect3)]),
    session("S5", "2026-08-05", [result("T2", perfect3)]),
    session("S6", "2026-08-06", [result("T2", perfect3)]),
  ];
  const replay = replayClinicalProgram(targets, sessions);
  const timeline = buildCumulativeMasteryTimeline(
    replay.masteryEvents.map((event, index) => ({ id: `E${index}`, targetId: event.targetId, sessionId: event.sessionId, masteredAt: event.masteredAt })),
    sessions,
  );
  const values = timeline.map((point) => point.total);
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 2);
  assert.equal(values.every((value, index) => index === 0 || value >= values[index - 1]), true);
});

test("un criterio copiado al cerrar permanece inmutable si luego cambia la configuración", () => {
  const current = target("T1", { threshold: 95, minTrials: 10, requiredSessions: 1, initialState: "baseline" });
  const historical = result("T1", [1,1,1,1,1,1,1,1,0,0]);
  historical.criterionSnapshot = {
    state: "baseline",
    criterion: { ...current.criteria.baseline, threshold: 80 },
  };
  const replay = replayClinicalProgram([current], [session("S1", "2026-08-01", [historical])]);
  assert.equal(replay.targetStates.get("T1"), "closed");
  assert.equal(replay.masteryEvents.length, 1);
});
