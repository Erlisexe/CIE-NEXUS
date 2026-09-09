import { writeFileSync } from "node:fs";

const outputPath = process.argv[2];
const childCount = Number(process.argv[3] || 20);
if (!outputPath) throw new Error("Uso: node scripts/generate-test-fixture.mjs <salida.sql> [cantidad-niños]");
if (!Number.isInteger(childCount) || childCount < 1 || childCount > 1000) throw new Error("Cantidad de niños inválida.");

const SITES = ["León", "Estelí", "Santo Domingo", "Las Colinas", "Masaya"];
const AUTHOR_ID = "TEST-DIRECTOR-001";
const AUTHOR_NAME = "TEST-DIRECCION-CLINICA-001";
const pad = (value, width = 3) => String(value).padStart(width, "0");
const id = (kind, ...parts) => `TEST-${kind}-${parts.map((part) => typeof part === "number" ? pad(part) : part).join("-")}`;
const q = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const jq = (value) => q(JSON.stringify(value));
const statements = [];
const insert = (table, columns, values) => {
  statements.push(`INSERT OR IGNORE INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${values.join(", ")});`);
};

const patterns = {
  descending: [19, 18, 17, 16, 14, 13, 11, 10, 8, 7, 5, 4],
  ascending: [2, 3, 4, 5, 7, 8, 10, 12, 14, 16, 18, 20],
  stable: [8, 8, 9, 8, 7, 8, 9, 8, 8, 7, 8, 8],
  variable: [4, 17, 6, 20, 3, 15, 8, 19, 5, 16, 7, 18],
  levelChange: [14, 13, 15, 14, 6, 5, 4, 5, 3, 3, 2, 2],
  noProgress: [10, 11, 10, 9, 11, 10, 10, 9, 11, 10, 10, 11],
  deterioration: [3, 4, 4, 5, 7, 8, 10, 11, 13, 14, 16, 18],
  improving: [10, 14, 20, 28, 36, 47, 58, 69, 78, 86, 92, 95],
};
const patternNames = Object.keys(patterns);
const config = {
  yMin: 0,
  yMax: 100,
  showGrid: true,
  showMean: false,
  showTrend: true,
  connectPoints: true,
  showValues: false,
  visualAnalysis: {
    level: "TEST: nivel sintético para prueba",
    trend: "TEST: patrón programado, no corresponde a un caso real",
    variability: "TEST: variabilidad sintética",
    immediacy: "TEST: revisar cambio de fase",
    overlap: "TEST: dato no clínico",
    consistency: "TEST: serie reproducible",
    decision: "TEST: usar únicamente para validar la plataforma",
    nextReview: "2026-09-01",
  },
};

const graphRows = new Map();
const firstSessionByProgram = new Map();
const firstTargetByProgram = new Map();

insert("report_templates", ["id", "name", "report_type", "description", "blocks", "built_in", "status", "created_by_account_id"], [
  q("TEST-TEMPLATE-LOAD"), q("TEST-PLANTILLA-CARGA"), q("TEST-Clínico"),
  q("TEST: plantilla completamente ficticia para validar informes."),
  jq([{ id: "TEST-TEMPLATE-BLOCK-001", type: "paragraph", content: "TEST: contenido sintético." }]),
  "0", q("active"), q(AUTHOR_ID),
]);

for (let child = 1; child <= childCount; child += 1) {
  const site = SITES[(child - 1) % SITES.length];
  const profileId = id("CLIENT", child);
  const profileName = profileId;
  insert("personnel_profiles", [
    "id", "full_name", "role", "site", "internal_code", "date_of_birth", "diagnosis", "address", "phone",
    "guardian_name", "guardian_phone", "preferred_language", "emergency_contact", "custom_fields", "notes", "status",
  ], [
    q(profileId), q(profileName), q("Niño"), q(site), q(profileId), q(`201${child % 6}-0${(child % 8) + 1}-15`),
    q(`TEST-DIAGNOSTICO-${(child % 3) + 1}`), q(`TEST-DIRECCION-${pad(child)}`), q(`0000-TEST-${pad(child)}`),
    q(`TEST-CUIDADOR-${pad(child)}`), q(`0000-GUARD-${pad(child)}`), q(child % 2 ? "Español" : "TEST-Bilingüe"),
    q(`TEST-EMERGENCIA-${pad(child)}`), jq([{ label: "Tipo de dato", value: "PRUEBA SINTÉTICA" }, { label: "Patrón", value: patternNames[(child - 1) % patternNames.length] }]),
    q("TEST: expediente completamente ficticio para validación de carga."), q(child % 11 === 0 ? "inactive" : "active"),
  ]);

  const programKinds = child <= Math.ceil(childCount / 4)
    ? ["BEHAVIOR", "SKILL", "COMMUNICATION"]
    : ["BEHAVIOR", "SKILL"];

  for (let programIndex = 0; programIndex < programKinds.length; programIndex += 1) {
    const kind = programKinds[programIndex];
    const programId = id("PROGRAM", child, programIndex + 1);
    const patternName = patternNames[(child + programIndex - 1) % patternNames.length];
    const basePattern = patterns[patternName];
    const isSkill = kind !== "BEHAVIOR";
    const values = isSkill ? basePattern.map((value) => Math.min(100, value * 5)) : basePattern;
    const programName = kind === "BEHAVIOR"
      ? `TEST-PROGRAMA-${pad(child)}-REDUCCION`
      : kind === "SKILL" ? `TEST-PROGRAMA-${pad(child)}-ADQUISICION` : `TEST-PROGRAMA-${pad(child)}-COMUNICACION`;
    const programStatus = child % 10 === 0 && kind === "SKILL" ? "closed" : child % 9 === 0 && kind === "BEHAVIOR" ? "paused" : "active";
    insert("intervention_programs", ["id", "profile_id", "linked_cycle_id", "name", "participant_name", "site", "objective", "instructions", "status"], [
      q(programId), q(profileId), "NULL", q(programName), q(profileName), q(site),
      q(`TEST: objetivo sintético ${patternName}; no usar para decisiones clínicas.`),
      q("TEST: aplicar únicamente dentro de la simulación institucional."), q(programStatus),
    ]);

    const targetCount = child === 1 && programIndex === 0 ? 25 : kind === "BEHAVIOR" ? 3 : kind === "SKILL" ? 4 : 5;
    for (let target = 1; target <= targetCount; target += 1) {
      const targetId = id("TARGET", child, programIndex + 1, target);
      if (target === 1) firstTargetByProgram.set(programId, targetId);
      const states = ["baseline", "acquisition", "acquisition", "mastered", "generalized", "closed"];
      const state = states[(child + programIndex + target) % states.length];
      const measurement = kind === "BEHAVIOR" ? (target % 2 ? "frequency" : "duration") : "percentage";
      insert("intervention_targets", ["id", "program_id", "code", "name", "specific_objective", "measurement", "unit_label", "state", "criteria", "sort_order"], [
        q(targetId), q(programId), q(`TEST-T${pad(target, 2)}`), q(`TEST-TARGET-${pad(target, 2)}`),
        q(`TEST: objetivo específico ficticio ${target}.`), q(measurement), q(measurement === "duration" ? "min" : measurement === "frequency" ? "eventos" : "%"),
        q(state), jq({ baseline: { operator: kind === "BEHAVIOR" ? "lte" : "gte", value: kind === "BEHAVIOR" ? 5 : 80, consecutiveSessions: 3, distinctContexts: 1 }, acquisition: { operator: kind === "BEHAVIOR" ? "lte" : "gte", value: kind === "BEHAVIOR" ? 4 : 85, consecutiveSessions: 3, distinctContexts: 1 }, mastered: { operator: kind === "BEHAVIOR" ? "lte" : "gte", value: kind === "BEHAVIOR" ? 3 : 90, consecutiveSessions: 3, distinctContexts: 2 }, generalized: { operator: kind === "BEHAVIOR" ? "lte" : "gte", value: kind === "BEHAVIOR" ? 2 : 90, consecutiveSessions: 3, distinctContexts: 2 } }), String(target - 1),
      ]);
    }

    const sessionCount = child === 1 && programIndex === 0 ? 30 : kind === "BEHAVIOR" ? 10 : kind === "SKILL" ? 8 : 6;
    for (let session = 1; session <= sessionCount; session += 1) {
      const sessionId = id("SESSION", child, programIndex + 1, session);
      if (session === 1) firstSessionByProgram.set(programId, sessionId);
      const gap = child % 7 === 0 && session > Math.floor(sessionCount / 2) ? 21 : 0;
      const dayOffset = (sessionCount - session) * 4 + gap + child;
      const sessionDate = new Date(Date.UTC(2026, 7, 18 - dayOffset)).toISOString().slice(0, 10);
      const value = values[(session - 1) % values.length];
      const sampled = !(child % 6 === 0 && session % 5 === 0);
      const firstTarget = firstTargetByProgram.get(programId);
      const results = firstTarget ? [{ targetId: firstTarget, sampled, value: sampled ? value : null, note: sampled ? "TEST-DATO-SINTETICO" : "TEST-DATO-AUSENTE-INTENCIONAL", stateAtSession: session <= 3 ? "baseline" : "acquisition" }] : [];
      const transitions = session === 4 && firstTarget ? [{ targetId: firstTarget, code: "TEST-T01", targetName: "TEST-TARGET-01", from: "baseline", to: "acquisition", reason: "TEST: transición sintética de fase" }] : [];
      insert("intervention_sessions", ["id", "program_id", "session_date", "context", "notes", "status", "results", "transitions", "closed_at"], [
        q(sessionId), q(programId), q(sessionDate), q(session % 3 === 0 ? "TEST-CASA" : session % 2 === 0 ? "TEST-ESCUELA" : "TEST-CENTRO"),
        q(sampled ? "TEST: sesión ficticia completa." : "TEST: sesión con medición omitida intencionalmente."),
        q(session % 13 === 0 ? "draft" : "closed"), jq(results), jq(transitions), session % 13 === 0 ? "NULL" : q(`${sessionDate}T16:00:00.000Z`),
      ]);
    }

    const graphId = id("GRAPH", child, programIndex + 1);
    const graphPointCount = child === 1 && programIndex === 0 ? 120 : values.length;
    const graphPoints = Array.from({ length: graphPointCount }, (_, index) => ({
      id: id("POINT", child, programIndex + 1, index + 1),
      label: String(index + 1),
      value: values[index % values.length],
      series: "TEST-DATOS",
      criterion: kind === "BEHAVIOR" ? 5 : 85,
      note: index % 17 === 0 ? "TEST: punto de revisión" : "",
    }));
    const phases = [{ id: id("PHASE", child, programIndex + 1, 1), afterIndex: Math.min(4, graphPointCount - 1), beforeLabel: "TEST-Línea base", afterLabel: "TEST-Intervención" }];
    if (child % 5 === 0) phases.push({ id: id("PHASE", child, programIndex + 1, 2), afterIndex: Math.min(8, graphPointCount - 1), beforeLabel: "TEST-Intervención", afterLabel: "TEST-Generalización" });
    const graph = {
      id: graphId,
      ownerAccountId: AUTHOR_ID,
      profileId,
      linkedProgramId: programId,
      linkedCycleId: null,
      title: `TEST-GRAFICA-${patternName}-${pad(child)}`,
      objective: "TEST: validar representación, fases y volumen de puntos.",
      graphType: child % 11 === 0 ? "cumulative" : child % 13 === 0 ? "bar" : "line",
      designType: child % 5 === 0 ? "ABAB" : "AB",
      measurement: kind === "BEHAVIOR" ? "Frecuencia" : "Porcentaje",
      xAxisLabel: "Sesiones",
      yAxisLabel: kind === "BEHAVIOR" ? "Frecuencia" : "Porcentaje",
      status: child % 12 === 0 ? "archived" : "active",
      points: graphPoints,
      phases,
      config,
    };
    graphRows.set(graphId, graph);
    insert("analytic_graphs", ["id", "owner_account_id", "profile_id", "linked_program_id", "linked_cycle_id", "title", "objective", "graph_type", "design_type", "measurement", "x_axis_label", "y_axis_label", "status", "points", "phases", "config", "archived_at"], [
      q(graph.id), q(graph.ownerAccountId), q(graph.profileId), q(graph.linkedProgramId), "NULL", q(graph.title), q(graph.objective), q(graph.graphType), q(graph.designType), q(graph.measurement), q(graph.xAxisLabel), q(graph.yAxisLabel), q(graph.status), jq(graph.points), jq(graph.phases), jq(graph.config), graph.status === "archived" ? q("2026-08-18T18:00:00.000Z") : "NULL",
    ]);
    insert("graph_history", ["id", "graph_id", "action", "summary", "details"], [q(id("GRAPH-HISTORY", child, programIndex + 1, 1)), q(graphId), q("created"), q("TEST: gráfica sintética creada"), q(`${patternName} · ${graphPointCount} puntos`)]);
    if (child % 4 === 0) insert("graph_history", ["id", "graph_id", "action", "summary", "details"], [q(id("GRAPH-HISTORY", child, programIndex + 1, 2)), q(graphId), q("updated"), q("TEST: registro editado"), q("TEST: se modificaron datos y fase")]);

    const targetId = firstTargetByProgram.get(programId);
    const sessionId = firstSessionByProgram.get(programId);
    if (targetId) insert("target_state_history", ["id", "target_id", "session_id", "from_state", "to_state", "reason"], [q(id("STATE-HISTORY", child, programIndex + 1)), q(targetId), sessionId ? q(sessionId) : "NULL", q("baseline"), q("acquisition"), q("TEST: cambio de estado sintético")]);
  }

  const evaluationCount = child <= Math.ceil(childCount / 5) ? 2 : 1;
  for (let evaluation = 1; evaluation <= evaluationCount; evaluation += 1) {
    const cycleId = id("EVALUATION", child, evaluation);
    insert("training_cycles", ["id", "profile_id", "site", "participant_name", "role", "program_context", "cycle_label", "instrument_version", "package_template_id", "instrument_snapshot", "route_type", "status", "initial_scores", "teaching_plan", "reevaluation_scores", "archived_at", "archive_summary", "source_cycle_id"], [
      q(cycleId), q(profileId), q(site), q(profileName), q("Niño"), q(`TEST-EVALUACION-${evaluation}`), q(evaluation === 1 ? "TEST-Línea base" : "TEST-Reevaluación"), q("TEST-v1"), q("imc-aba-v1"), jq({ test: true, version: 1 }), q(child % 2 ? "4A" : "4B"), q(child % 8 === 0 ? "archived" : "initial"), jq({ TEST01: { interview: 1, verification: child % 2 } }), jq([{ target: "TEST-OBJETIVO", action: "TEST-ENSEÑANZA" }]), jq(child % 3 === 0 ? { TEST01: { interview: 1, verification: 1 } } : {}), child % 8 === 0 ? q("2026-08-18T18:00:00.000Z") : "NULL", jq({ note: "TEST-ARCHIVO" }), "NULL",
    ]);
    insert("evaluation_history", ["id", "cycle_id", "action", "summary", "details"], [q(id("EVAL-HISTORY", child, evaluation, 1)), q(cycleId), q("created"), q("TEST: evaluación creada"), q("Registro sintético")]);
    if (child % 4 === 0) insert("evaluation_history", ["id", "cycle_id", "action", "summary", "details"], [q(id("EVAL-HISTORY", child, evaluation, 2)), q(cycleId), q("updated"), q("TEST: evaluación editada"), q("Cambio intencional para validar historial")]);
  }

  const firstGraph = graphRows.get(id("GRAPH", child, 1));
  if (firstGraph) {
    const reportId = id("REPORT", child);
    const snapshot = {
      id: profileId,
      fullName: profileName,
      photoUrl: null,
      internalCode: profileId,
      dateOfBirth: `201${child % 6}-0${(child % 8) + 1}-15`,
      diagnosis: `TEST-DIAGNOSTICO-${(child % 3) + 1}`,
      site,
      address: `TEST-DIRECCION-${pad(child)}`,
      phone: `0000-TEST-${pad(child)}`,
      guardianName: `TEST-CUIDADOR-${pad(child)}`,
      guardianPhone: `0000-GUARD-${pad(child)}`,
      preferredLanguage: "Español",
      responsibles: { coordinador: `TEST-COORDINATOR-${pad(((child - 1) % 5) + 1)}`, supervisor: `TEST-SUPERVISOR-${pad(((child - 1) % 5) + 1)}`, subdirector: "TEST-SUBDIRECTOR-001", terapeuta: `TEST-THERAPIST-${pad(((child - 1) % 10) + 1)}` },
      customFields: [{ label: "Tipo de dato", value: "PRUEBA SINTÉTICA" }],
    };
    const graphBlock = { id: id("REPORT-BLOCK", child, 1), type: "graph", sourceId: `graph:${firstGraph.id}`, title: firstGraph.title, graph: firstGraph };
    const blocks = [
      { id: id("REPORT-BLOCK", child, 0), type: "cover", title: "TEST-INFORME-DE-PROGRESO", subtitle: `${profileName} · PRUEBA SINTÉTICA` },
      { id: id("REPORT-BLOCK", child, 2), type: "paragraph", content: "TEST: este texto y todos sus datos son completamente ficticios." },
      graphBlock,
      { id: id("REPORT-BLOCK", child, 3), type: "metrics", title: "TEST-Indicadores", items: [{ label: "Sesiones simuladas", value: "10" }, { label: "Uso clínico", value: "PROHIBIDO" }] },
      { id: id("REPORT-BLOCK", child, 4), type: "signature", label: "TEST-Autor", name: AUTHOR_NAME, role: "Dirección Clínica" },
    ];
    const finalized = child % 2 === 0;
    insert("reports", ["id", "profile_id", "template_id", "title", "report_type", "status", "blocks", "profile_snapshot", "source_selection", "author_account_id", "author_name", "finalized_at"], [
      q(reportId), q(profileId), q("TEST-TEMPLATE-LOAD"), q(`TEST-INFORME-${pad(child)}`), q("TEST-Progreso"), q(finalized ? "finalized" : "draft"), jq(blocks), jq(snapshot), jq([`graph:${firstGraph.id}`, `program:${id("PROGRAM", child, 1)}`, `sessions:${id("PROGRAM", child, 1)}`]), q(AUTHOR_ID), q(AUTHOR_NAME), finalized ? q("2026-08-18T18:00:00.000Z") : "NULL",
    ]);
  }
}

const header = [
  "-- TEST FIXTURE: datos 100 % ficticios para validación de carga.",
  "-- Todos los identificadores comienzan con TEST-. No borra ni actualiza registros previos.",
  "PRAGMA foreign_keys = ON;",
].join("\n");
writeFileSync(outputPath, `${header}\n--> statement-breakpoint\n${statements.join("\n--> statement-breakpoint\n")}\n`, "utf8");
console.log(JSON.stringify({ outputPath, childCount, statements: statements.length }));
