import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { buildSessionGraph, type ClinicalProgram, type ClinicalSession, type ClinicalTarget } from "../lib/automatic-graphs";
import { DEFAULT_GRAPH_CONFIG, type GraphType } from "../lib/graph-types";

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");

function apply(path: string) {
  for (const raw of readFileSync(path, "utf8").split("--> statement-breakpoint")) {
    const statement = raw.trim();
    if (statement) db.exec(statement);
  }
}

for (let index = 0; index <= 14; index += 1) {
  const prefix = String(index).padStart(4, "0");
  const name = readdirSync("drizzle").find((entry) => entry.startsWith(`${prefix}_`) && entry.endsWith(".sql"));
  if (!name) throw new Error(`No se encontró la migración ${prefix}.`);
  apply(`drizzle/${name}`);
}

function programFixture(id: string) {
  const row = db.prepare("select * from intervention_programs where id=?").get(id) as Record<string, unknown>;
  const targets = db.prepare("select * from intervention_targets where program_id=? order by sort_order").all(id) as Record<string, unknown>[];
  const sessions = db.prepare("select * from intervention_sessions where program_id=? order by session_date, created_at").all(id) as Record<string, unknown>[];
  const program: ClinicalProgram = {
    id: String(row.id),
    profileId: String(row.profile_id),
    name: String(row.name),
    participantName: String(row.participant_name),
    site: String(row.site),
    objective: String(row.objective),
    status: String(row.status),
    targets: targets.map((target) => ({
      id: String(target.id),
      code: String(target.code),
      name: String(target.name),
      specificObjective: String(target.specific_objective),
      measurement: String(target.measurement) as ClinicalTarget["measurement"],
      unitLabel: String(target.unit_label),
      state: String(target.state) as ClinicalTarget["state"],
      criteria: JSON.parse(String(target.criteria)),
    })),
  };
  return {
    program,
    sessions: sessions.map((session) => ({
      id: String(session.id),
      programId: String(session.program_id),
      sessionDate: String(session.session_date),
      context: String(session.context),
      notes: String(session.notes),
      status: String(session.status),
      createdAt: String(session.created_at),
      results: JSON.parse(String(session.results)),
    })) as ClinicalSession[],
  };
}

function graph(program: ClinicalProgram, sessions: ClinicalSession[], targetIds: string[], graphType: GraphType) {
  return buildSessionGraph({
    id: `TEST-VALIDATION-${graphType}`,
    program,
    sessions,
    targetIds,
    graphType,
    designType: "AB",
    title: "TEST-AUTO-VALIDATION",
    objective: "TEST: validación automática",
    xAxisLabel: "Fechas",
    yAxisLabel: "",
    config: { ...DEFAULT_GRAPH_CONFIG, yMax: null, dataSource: "sessions", sourceTargetIds: targetIds },
  });
}

const escape = programFixture("TEST-AUTO-PROGRAM-ESCAPE-001");
const fct = programFixture("TEST-AUTO-PROGRAM-FCT-001");
const escapeTargetIds = escape.program.targets.map((target) => target.id);
const fctTargetIds = fct.program.targets.map((target) => target.id);

const beforeNewSession = graph(escape.program, escape.sessions.slice(0, 11), [escapeTargetIds[0]], "line");
const afterNewSession = graph(escape.program, escape.sessions, [escapeTargetIds[0]], "line");
const escapeMulti = graph(escape.program, escape.sessions, escapeTargetIds, "line");
const escapeBars = graph(escape.program, escape.sessions, escapeTargetIds, "bar");
const escapeCumulative = graph(escape.program, escape.sessions, [escapeTargetIds[0]], "cumulative");
const fctLine = graph(fct.program, fct.sessions, fctTargetIds, "line");

assert.equal(beforeNewSession.points.filter((point) => point.value !== null).length, 11);
assert.equal(afterNewSession.points.filter((point) => point.value !== null).length, 12);
assert.equal(escapeMulti.points.length, 24);
assert.equal(escapeMulti.points.filter((point) => point.value === null).length, 1);
assert.equal(escapeMulti.phases[0]?.beforeLabel, "Línea base");
assert.equal(escapeMulti.phases[0]?.afterLabel, "Intervención");
assert.equal(escapeBars.graphType, "bar");
assert.equal(escapeCumulative.graphType, "cumulative");
assert.equal(fctLine.config.yMax, 100);
assert.equal(fctLine.points.filter((point) => point.value === null).length, 1);
assert.ok(afterNewSession.points.every((point) => point.source?.sessionId && point.source.targetId));
assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

console.log(JSON.stringify({
  child: "TEST-AUTO-GRAPH-CLIENT-001",
  programs: [
    { id: escape.program.id, sessions: escape.sessions.length, targets: escape.program.targets.map((target) => `${target.code}:${target.measurement}`) },
    { id: fct.program.id, sessions: fct.sessions.length, targets: fct.program.targets.map((target) => `${target.code}:${target.measurement}`) },
  ],
  assertions: {
    automaticRefresh: `${beforeNewSession.points.length}→${afterNewSession.points.length}`,
    missingIsNull: true,
    phaseDetected: "Línea base→Intervención",
    line: true,
    bar: true,
    cumulative: true,
    percentageScale: "0–100",
    sourceTraceability: true,
    foreignKeys: "ok",
  },
}, null, 2));

