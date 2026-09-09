import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const extraSeedPath = process.argv[2] || null;
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");

function applySqlFile(path) {
  const sql = readFileSync(path, "utf8");
  const statements = sql.split("--> statement-breakpoint");
  for (let index = 0; index < statements.length; index += 1) {
    const raw = statements[index];
    const statement = raw.trim();
    if (!statement) continue;
    try {
      db.exec(statement);
    } catch (error) {
      throw new Error(`${path} · sentencia ${index + 1} · ${statement.slice(0, 180)}`, { cause: error });
    }
  }
}

for (let index = 0; index <= 11; index += 1) {
  const prefix = String(index).padStart(4, "0");
  const path = (await import("node:fs")).readdirSync("drizzle").find((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
  if (!path) throw new Error(`No se encontró la migración ${prefix}.`);
  applySqlFile(`drizzle/${path}`);
}
applySqlFile(extraSeedPath || "drizzle/0012_test_phase1_fixture.sql");
applySqlFile("drizzle/0013_isolate_test_authorship.sql");

const scalar = (sql, params = []) => db.prepare(sql).get(...params)["value"];
const timed = (name, sql, params = []) => {
  const start = performance.now();
  const rows = db.prepare(sql).all(...params);
  return { name, milliseconds: Number((performance.now() - start).toFixed(3)), rows: rows.length };
};

const counts = {
  children: scalar("select count(*) as value from personnel_profiles where id like 'TEST-CLIENT-%'"),
  programs: scalar("select count(*) as value from intervention_programs where id like 'TEST-PROGRAM-%'"),
  targets: scalar("select count(*) as value from intervention_targets where id like 'TEST-TARGET-%'"),
  sessions: scalar("select count(*) as value from intervention_sessions where id like 'TEST-SESSION-%'"),
  measurements: scalar("select count(*) as value from intervention_sessions, json_each(intervention_sessions.results) where intervention_sessions.id like 'TEST-SESSION-%'"),
  graphs: scalar("select count(*) as value from analytic_graphs where id like 'TEST-GRAPH-%'"),
  graphPoints: scalar("select count(*) as value from analytic_graphs, json_each(analytic_graphs.points) where analytic_graphs.id like 'TEST-GRAPH-%'"),
  evaluations: scalar("select count(*) as value from training_cycles where id like 'TEST-EVALUATION-%'"),
  reports: scalar("select count(*) as value from reports where id like 'TEST-REPORT-%'"),
  histories: scalar("select (select count(*) from graph_history where id like 'TEST-%') + (select count(*) from evaluation_history where id like 'TEST-%') + (select count(*) from target_state_history where id like 'TEST-%') as value"),
  missingMeasurements: scalar("select count(*) as value from intervention_sessions, json_each(intervention_sessions.results) where intervention_sessions.id like 'TEST-SESSION-%' and json_extract(json_each.value, '$.sampled') = 0"),
};

const integrity = {
  foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
  invalidGraphJson: scalar("select count(*) as value from analytic_graphs where id like 'TEST-GRAPH-%' and (not json_valid(points) or not json_valid(phases) or not json_valid(config))"),
  invalidSessionJson: scalar("select count(*) as value from intervention_sessions where id like 'TEST-SESSION-%' and (not json_valid(results) or not json_valid(transitions))"),
  orphanPrograms: scalar("select count(*) as value from intervention_programs p left join personnel_profiles c on c.id=p.profile_id where p.id like 'TEST-PROGRAM-%' and c.id is null"),
  orphanTargets: scalar("select count(*) as value from intervention_targets t left join intervention_programs p on p.id=t.program_id where t.id like 'TEST-TARGET-%' and p.id is null"),
  orphanSessions: scalar("select count(*) as value from intervention_sessions s left join intervention_programs p on p.id=s.program_id where s.id like 'TEST-SESSION-%' and p.id is null"),
  orphanGraphs: scalar("select count(*) as value from analytic_graphs g left join personnel_profiles c on c.id=g.profile_id left join intervention_programs p on p.id=g.linked_program_id where g.id like 'TEST-GRAPH-%' and (c.id is null or p.id is null)"),
  orphanReports: scalar("select count(*) as value from reports r left join personnel_profiles c on c.id=r.profile_id where r.id like 'TEST-REPORT-%' and c.id is null"),
  nonSyntheticAuthorship: scalar("select (select count(*) from report_templates where id like 'TEST-%' and coalesce(created_by_account_id, '') not like 'TEST-%') + (select count(*) from analytic_graphs where id like 'TEST-%' and coalesce(owner_account_id, '') not like 'TEST-%') + (select count(*) from reports where id like 'TEST-%' and (coalesce(author_account_id, '') not like 'TEST-%' or coalesce(author_name, '') not like 'TEST-%')) as value"),
};

const queries = [
  timed("buscar-niños", "select id, full_name, site from personnel_profiles where role='Niño' and full_name like ? order by full_name", ["%TEST-CLIENT-020%"]),
  timed("filtrar-sede", "select id, full_name from personnel_profiles where role='Niño' and site=? order by full_name", ["León"]),
  timed("perfil-programas", "select * from intervention_programs where profile_id=? order by updated_at desc", ["TEST-CLIENT-001"]),
  timed("perfil-targets", "select t.* from intervention_targets t join intervention_programs p on p.id=t.program_id where p.profile_id=? order by t.sort_order", ["TEST-CLIENT-001"]),
  timed("perfil-sesiones", "select s.* from intervention_sessions s join intervention_programs p on p.id=s.program_id where p.profile_id=? order by s.session_date desc", ["TEST-CLIENT-001"]),
  timed("perfil-graficas", "select g.* from analytic_graphs g where g.profile_id=? order by g.updated_at desc", ["TEST-CLIENT-001"]),
  timed("perfil-informes", "select * from reports where profile_id=? order by updated_at desc", ["TEST-CLIENT-001"]),
  timed("endpoint-programas-cap", "select * from intervention_programs order by updated_at desc limit 200"),
  timed("endpoint-sesiones-cap", "select * from intervention_sessions order by session_date desc, created_at desc limit 500"),
  timed("endpoint-graficas-cap", "select * from analytic_graphs order by updated_at desc limit 300"),
  timed("endpoint-evaluaciones-cap", "select * from training_cycles order by updated_at desc limit 300"),
  timed("endpoint-informes-cap", "select * from reports order by updated_at desc limit 500"),
];

const caps = {
  programs: { total: counts.programs, currentLimit: 200, hidden: Math.max(0, counts.programs - 200) },
  sessions: { total: counts.sessions, currentLimit: 500, hidden: Math.max(0, counts.sessions - 500) },
  graphs: { total: counts.graphs, currentLimit: 300, hidden: Math.max(0, counts.graphs - 300) },
  evaluations: { total: counts.evaluations, currentLimit: 300, hidden: Math.max(0, counts.evaluations - 300) },
  reports: { total: counts.reports, currentLimit: 500, hidden: Math.max(0, counts.reports - 500) },
};

console.log(JSON.stringify({ mode: extraSeedPath ? "custom" : "phase1", counts, integrity, queries, caps }, null, 2));
