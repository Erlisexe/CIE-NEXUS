import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionGraph } from "../lib/automatic-graphs.ts";
import { cumulativeSeriesValues, DEFAULT_GRAPH_CONFIG, stepGraphPath } from "../lib/graph-types.ts";
import { analyzeABCGraph } from "../lib/abc-graph-analysis.ts";

const target = (id, measurement = "discrete_trials") => ({ id, code: id, name: id, specificObjective: "", measurement, unitLabel: "%", state: "acquisition" });
const program = {
  id: "P1", profileId: "N1", name: "Comunicación", participantName: "Niño", site: "León", objective: "", status: "active",
  targets: [target("T1"), target("T2"), target("F1", "frequency")],
  masteryEvents: [
    { id: "E1", targetId: "T1", programId: "P1", sessionId: "S2", masteredAt: "2026-08-02T16:00:00Z", masteryMethod: "acquisition", professionalAccountId: null, criterionSnapshot: {}, status: "active" },
    { id: "E1-duplicate", targetId: "T1", programId: "P1", sessionId: "S2", masteredAt: "2026-08-02T16:00:00Z", masteryMethod: "acquisition", professionalAccountId: null, criterionSnapshot: {}, status: "active" },
    { id: "E2", targetId: "T2", programId: "P1", sessionId: "S4", masteredAt: "2026-08-04T16:00:00Z", masteryMethod: "baseline", professionalAccountId: null, criterionSnapshot: {}, status: "active" },
  ],
};
const sampled = (targetId, correct, opportunities) => ({ targetId, sampled: true, correct, opportunities, value: correct / opportunities * 100, note: "", stateAtSession: "acquisition" });
const sessions = [
  { id: "S1", programId: "P1", sessionDate: "2026-08-01", status: "closed", createdAt: "2026-08-01T12:00:00Z", context: "Mesa", notes: "", results: [sampled("T1", 1, 2)] },
  { id: "S2", programId: "P1", sessionDate: "2026-08-02", status: "closed", createdAt: "2026-08-02T12:00:00Z", context: "Piso", notes: "", results: [sampled("T1", 2, 2), sampled("T2", 0, 2)] },
  { id: "S3", programId: "P1", sessionDate: "2026-08-03", status: "closed", createdAt: "2026-08-03T12:00:00Z", context: "Mesa", notes: "", results: [] },
  { id: "S4", programId: "P1", sessionDate: "2026-08-04", status: "closed", createdAt: "2026-08-04T12:00:00Z", context: "Mesa", notes: "", results: [sampled("T2", 2, 2)] },
];
function chart(graphType, config = {}) {
  return buildSessionGraph({ id: "G1", program, sessions, targetIds: program.targets.map((item) => item.id), graphType, designType: "AB", title: "Comunicación", objective: "", xAxisLabel: "Sesiones", yAxisLabel: "", config: { ...DEFAULT_GRAPH_CONFIG, clinicalScope: "program", clinicalMetric: "percentage", ...config } });
}

test("portada por programa: pondera correctos/oportunidades, no promedia porcentajes, ni cuenta muestras ausentes", () => {
  const graph = chart("line");
  assert.equal(graph.points.length, 4);
  assert.deepEqual(graph.points.map((point) => point.value), [50, 50, null, 100]);
  assert.equal(new Set(graph.points.map((point) => point.series)).size, 1);
  assert.equal(graph.points[1].source.opportunities, 4);
});

test("barras y agrupación diaria/mensual conservan una única serie del programa", () => {
  const graph = chart("bar", { clinicalGrouping: "month", clinicalMetric: "count" });
  assert.equal(graph.points.length, 1);
  assert.equal(graph.points[0].value, 5);
  assert.equal(graph.points[0].label, "08/2026");
});

test("la tasa se calcula sólo con segundos de observación; no se fabrica un cero ni se mezcla frecuencia con ensayos", () => {
  const withoutTime = chart("line", { clinicalMetric: "rate" });
  assert.equal(withoutTime.points.every((point) => point.value === null), true);
  const withTime = chart("line", { clinicalMetric: "rate" });
  const observedSessions = sessions.map((session) => ({ ...session, results: [...session.results, ...(session.id === "S1" ? [{ targetId: "F1", sampled: true, value: 5, frequencyObservationSeconds: 150, note: "", stateAtSession: "acquisition" }] : [])] }));
  const graph = buildSessionGraph({ id: "G-rate", program, sessions: observedSessions, targetIds: program.targets.map((item) => item.id), graphType: "line", designType: "AB", title: "Tasa", objective: "", xAxisLabel: "Sesión", yAxisLabel: "", config: { ...withTime.config, clinicalMetric: "rate" } });
  assert.deepEqual(graph.points.map((point) => point.value), [2, null, null, null]);
});

test("acumulada 0→1→1→2, último día inclusivo, un target cuenta una vez y la capa visual no suma de nuevo", () => {
  const graph = chart("cumulative", { dateTo: "2026-08-04" });
  assert.deepEqual(graph.points.map((point) => point.value), [0, 1, 1, 2]);
  assert.deepEqual([...cumulativeSeriesValues(graph.points, graph.config.cumulativeValues).values()], [0, 1, 1, 2]);
  assert.equal(graph.config.cumulativeValues, "totals");
  assert.equal(stepGraphPath([{ x: 0, y: 2 }, { x: 10, y: 2 }, { x: 20, y: 1 }]), "M 0 2 H 10 V 2 H 20 V 1");
});

test("ABC cruza antecedente/conducta, mantiene fechas y no infiere función", () => {
  const result = analyzeABCGraph([
    { eventDate: "2026-08-01", antecedentLabel: "Demanda", behaviorLabel: "Grito" },
    { eventDate: "2026-08-02", antecedentLabel: "Demanda", behaviorLabel: "Grito" },
    { eventDate: "2026-08-02", antecedentLabel: "Espera", behaviorLabel: "Grito" },
  ]);
  assert.deepEqual(result.pairs.map((pair) => pair.count), [2, 1]);
  assert.deepEqual(result.days.map((day) => day.count), [1, 2]);
});
