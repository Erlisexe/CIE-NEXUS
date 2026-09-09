import test from "node:test";
import assert from "node:assert/strict";
import { buildConfigurableGraph, resolveGraphPeriod } from "../lib/configurable-graphs.ts";
import { normalizeCriteria } from "../lib/clinical-mastery.ts";
import { DEFAULT_GRAPH_CONFIG } from "../lib/graph-types.ts";

const percentageCriteria = normalizeCriteria({
  baseline: { metric: "percentage_correct", threshold: 80, minTrials: 1, requiredSessions: 1 },
  acquisition: { metric: "percentage_correct", threshold: 80, minTrials: 1, requiredSessions: 3 },
}, "percentage");

function target(overrides = {}) {
  return { id: "t1", programId: "p1", code: "T1", name: "Imitación", measurement: "percentage", unitLabel: "%", state: "acquisition", criteria: percentageCriteria, ...overrides };
}

function result(overrides = {}) {
  return {
    targetId: "t1", sampled: true, value: 100, correct: 1, opportunities: 1, trials: [1], trialDetails: [], note: "",
    stateAtSession: "acquisition", criterionStatus: "met", criterionReason: "", criterionSnapshot: { state: "acquisition", criterion: percentageCriteria.acquisition },
    ...overrides,
  };
}

function session(id, date, results, overrides = {}) {
  return {
    id, clinicalSessionRunId: `run-${id}`, programId: "p1", sessionDate: date, createdAt: `${date}T15:00:00.000Z`,
    professionalAccountId: "pro-1", professionalName: "Terapeuta A", rawDetailAvailable: true, context: "Clínica", notes: "",
    durationSeconds: 3600, documentedDuration: true, abcObservationDocumented: false, transitions: [], results, ...overrides,
  };
}

function dataset(overrides = {}) {
  const item = target();
  return {
    profile: { id: "child-1", fullName: "Caso prueba", site: "León" },
    programs: [{ id: "p1", name: "Programa motor", status: "active", targets: [item], masteryEvents: [] }],
    sessions: [], abc: [], professionals: [{ id: "pro-1", name: "Terapeuta A" }],
    capabilities: { canCompareTherapists: true, canViewSessionSource: true, canViewTrialSource: true, canViewAbcSource: true, privacyMode: "scope_full" },
    warnings: [], ...overrides,
  };
}

function config(overrides = {}) {
  return {
    ...DEFAULT_GRAPH_CONFIG,
    version: 2,
    dataSource: "sessions",
    period: "all",
    xAxis: "session",
    yAxis: "percentage_correct",
    grouping: "target",
    filters: { programIds: [], targetIds: [], targetStates: [], therapistIds: [] },
    showCriterion: true,
    ...overrides,
    filters: { programIds: [], targetIds: [], targetStates: [], therapistIds: [], ...(overrides.filters || {}) },
  };
}

function build(data, graphConfig, graphType = "line", manualPhases = []) {
  return buildConfigurableGraph({
    id: "graph-1", dataset: data, config: graphConfig, graphType, title: "Progreso", objective: "Validar datos",
    measurement: "Sesiones", xAxisLabel: "Sesión", yAxisLabel: "Resultado", manualPhases, today: "2026-09-08",
  });
}

test("los períodos incluyen hoy y validan el rango esperado", () => {
  assert.deepEqual(resolveGraphPeriod({ period: "today", dateFrom: "", dateTo: "" }, "2026-09-08"), { from: "2026-09-08", to: "2026-09-08" });
  assert.deepEqual(resolveGraphPeriod({ period: "7d", dateFrom: "", dateTo: "" }, "2026-09-08"), { from: "2026-09-02", to: "2026-09-08" });
  assert.deepEqual(resolveGraphPeriod({ period: "30d", dateFrom: "", dateTo: "" }, "2026-09-08"), { from: "2026-08-10", to: "2026-09-08" });
});

test("cero observado y no medido permanecen distintos, incluso el mismo día", () => {
  const data = dataset({ sessions: [
    session("s1", "2026-09-01", [result({ value: 0, correct: 0, trials: [0], criterionStatus: "not_met" })]),
    session("s2", "2026-09-01", []),
  ] });
  const graph = build(data, config());
  assert.deepEqual(graph.points.map((point) => point.value), [0, null]);
  assert.equal(new Set(graph.points.map((point) => point.xKey)).size, 2);
});

test("criterio, avance consecutivo y fase automática usan la copia histórica", () => {
  const data = dataset({ sessions: [
    session("s1", "2026-09-01", [result()], { transitions: [{ targetId: "t1", from: "baseline", to: "acquisition", reason: "Cambio" }] }),
    session("s2", "2026-09-02", [result()]),
  ] });
  const graph = build(data, config());
  assert.deepEqual(graph.points.map((point) => point.criterion), [80, 80]);
  assert.deepEqual(graph.points.map((point) => point.criterionProgress?.label), ["1 de 3", "2 de 3"]);
  assert.equal(graph.phases.some((phase) => phase.origin === "automatic" && phase.afterLabel === "Adquisición"), true);
});

test("una tasa sólo se calcula con una ventana de observación documentada", () => {
  const frequency = target({ measurement: "frequency", unitLabel: "ocurrencias", criteria: normalizeCriteria({}, "frequency") });
  const program = { id: "p1", name: "Programa motor", status: "active", targets: [frequency], masteryEvents: [] };
  const measured = result({ value: 6, correct: null, opportunities: 1, trials: [], criterionSnapshot: null, criterionStatus: "not_evaluated" });
  const valid = build(dataset({ programs: [program], sessions: [session("s1", "2026-09-01", [measured])] }), config({ yAxis: "rate", rateUnit: "hour" }));
  assert.equal(valid.points[0].value, 6);
  const undocumented = build(dataset({ programs: [program], sessions: [session("s1", "2026-09-01", [measured], { durationSeconds: null, documentedDuration: false })] }), config({ yAxis: "rate", rateUnit: "hour" }));
  assert.equal(undocumented.points[0].value, null);
  assert.equal(undocumented.config.warnings.some((warning) => warning.includes("tiempo de observación")), true);
});

test("el prompt se obtiene de cada ensayo y nunca del resumen de sesión", () => {
  const trials = result({ value: 50, correct: 1, opportunities: 2, trials: [1, 0], trialDetails: [
    { value: 1, at: "2026-09-01T15:01:00Z", promptLevel: "independent" },
    { value: 0, at: "2026-09-01T15:02:00Z", promptLevel: "verbal" },
  ] });
  const data = dataset({ sessions: [session("s1", "2026-09-01", [trials])] });
  const graph = build(data, config({ dataSource: "trials", xAxis: "prompt", grouping: "target" }), "bar");
  assert.deepEqual(new Map(graph.points.map((point) => [point.label, point.value])), new Map([["Independiente", 100], ["Verbal", 0]]));
  const invalid = build(data, config({ dataSource: "sessions", xAxis: "prompt" }), "bar");
  assert.equal(invalid.points.length, 0);
  assert.equal(invalid.config.warnings.some((warning) => warning.includes("cada ensayo")), true);
});

test("la acumulativa cuenta cada target adquirido una vez y nunca desciende", () => {
  const t2 = target({ id: "t2", code: "T2", name: "Juego" });
  const data = dataset({ programs: [{
    id: "p1", name: "Programa motor", status: "active", targets: [target(), t2], masteryEvents: [
      { id: "e1", targetId: "t1", programId: "p1", sessionId: "s1", masteredAt: "2026-09-01", masteryMethod: "acquisition" },
      { id: "e1-duplicado", targetId: "t1", programId: "p1", sessionId: "s2", masteredAt: "2026-09-02", masteryMethod: "acquisition" },
      { id: "e2", targetId: "t2", programId: "p1", sessionId: "s3", masteredAt: "2026-09-03", masteryMethod: "acquisition" },
    ],
  }] });
  const graph = build(data, config({ xAxis: "date", yAxis: "count", grouping: "program" }), "cumulative");
  const totals = [];
  graph.points.reduce((total, point) => { const next = total + point.value; totals.push(next); return next; }, 0);
  assert.deepEqual(totals, [0, 1, 2]);
  assert.equal(totals.every((value, index) => index === 0 || value >= totals[index - 1]), true);
});

test("ABC sólo produce un cero cuando existe una ventana móvil documentada", () => {
  const observed = dataset({ sessions: [session("s1", "2026-09-01", [result()], { abcObservationDocumented: true })] });
  const graph = build(observed, config({ dataSource: "abc", xAxis: "session", yAxis: "count", grouping: "none" }), "bar");
  assert.equal(graph.points[0].value, 0);
  const unmeasured = dataset({ sessions: [session("s1", "2026-09-01", [result()], { abcObservationDocumented: false })] });
  assert.equal(build(unmeasured, config({ dataSource: "abc", xAxis: "session", yAxis: "count", grouping: "none" }), "bar").points.length, 0);
});

test("un rango personalizado inválido no abre silenciosamente todo el historial", () => {
  const graph = build(dataset({ sessions: [session("s1", "2026-09-01", [result()])] }), config({ period: "custom", dateFrom: "2026-09-08", dateTo: "2026-09-01" }));
  assert.equal(graph.points.length, 0);
  assert.equal(graph.config.warnings.some((warning) => warning.includes("rango personalizado")), true);
});
