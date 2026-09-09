import {
  DEFAULT_GRAPH_CONFIG,
  type AnalyticGraph,
  type GraphConfig,
  type GraphGrouping,
  type GraphPoint,
  type GraphType,
  type PhaseBoundary,
} from "./graph-types.ts";
import { TARGET_STATE_LABELS, normalizeCriteria, type MasteryCriterion, type TargetCriteria, type TargetState } from "./clinical-mastery.ts";
import { promptLevelLabel, type TrialDetail } from "./trial-data.ts";

export type ConfigurableTarget = {
  id: string;
  programId: string;
  code: string;
  name: string;
  measurement: string;
  unitLabel: string;
  state: TargetState;
  criteria: TargetCriteria;
};

export type ConfigurableProgram = {
  id: string;
  name: string;
  status: string;
  targets: ConfigurableTarget[];
  masteryEvents: Array<{
    id: string;
    targetId: string;
    programId: string;
    sessionId: string | null;
    masteredAt: string;
    masteryMethod: string;
  }>;
};

export type ConfigurableSessionResult = {
  targetId: string;
  sampled: boolean;
  value: number | null;
  correct: number | null;
  opportunities: number;
  trials: Array<0 | 1>;
  trialDetails: TrialDetail[];
  note: string;
  stateAtSession: TargetState;
  criterionStatus: "met" | "not_met" | "insufficient_sample" | "not_evaluated";
  criterionReason: string;
  criterionSnapshot: unknown;
};

export type ConfigurableSession = {
  id: string;
  clinicalSessionRunId: string | null;
  programId: string;
  sessionDate: string;
  createdAt: string;
  professionalAccountId: string;
  professionalName: string;
  rawDetailAvailable: boolean;
  context: string;
  notes: string;
  durationSeconds: number | null;
  documentedDuration: boolean;
  abcObservationDocumented: boolean;
  transitions: Array<{ targetId: string; from: TargetState; to: TargetState; reason: string }>;
  results: ConfigurableSessionResult[];
};

export type ConfigurableAbc = {
  id: string;
  eventDate: string;
  eventTime: string;
  programId: string | null;
  targetId: string | null;
  sessionId: string | null;
  sessionKey?: string | null;
  professionalAccountId: string;
  professionalName: string;
  count: number;
  rawDetailAvailable: boolean;
  behaviorLabel: string;
  details: string;
  observationSeconds: number | null;
  documentedDuration: boolean;
};

export type ConfigurableGraphDataset = {
  profile: { id: string; fullName: string; site: string };
  programs: ConfigurableProgram[];
  sessions: ConfigurableSession[];
  abc: ConfigurableAbc[];
  professionals: Array<{ id: string; name: string }>;
  capabilities: {
    canCompareTherapists: boolean;
    canViewSessionSource: boolean;
    canViewTrialSource: boolean;
    canViewAbcSource: boolean;
    privacyMode: string;
  };
  warnings: string[];
};

type ObservationRow = {
  id: string;
  date: string;
  sessionId: string;
  sessionKey: string;
  sessionOrder: number;
  program: ConfigurableProgram;
  target: ConfigurableTarget;
  professionalId: string;
  professionalName: string;
  rawDetailAvailable: boolean;
  sampled: boolean;
  value: number | null;
  correct: number | null;
  opportunities: number;
  durationSeconds: number | null;
  documentedDuration: boolean;
  state: TargetState;
  criterionStatus: ConfigurableSessionResult["criterionStatus"];
  criterionSnapshot: unknown;
  note: string;
  context: string;
  sessionNotes: string;
  promptLevel?: string;
  trialIndex?: number;
};

type Aggregate = {
  xKey: string;
  label: string;
  series: string;
  rows: ObservationRow[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year.slice(2)}` : value;
}

function subtractUtc(today: string, amount: number, unit: "day" | "month") {
  const date = new Date(`${today}T12:00:00.000Z`);
  if (unit === "day") date.setUTCDate(date.getUTCDate() - amount);
  else date.setUTCMonth(date.getUTCMonth() - amount);
  return date.toISOString().slice(0, 10);
}

function currentNicaraguaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function resolveGraphPeriod(config: Pick<GraphConfig, "period" | "dateFrom" | "dateTo">, today = currentNicaraguaDate()) {
  if (config.period === "all") return { from: "", to: "" };
  if (config.period === "custom") return {
    from: DATE_PATTERN.test(config.dateFrom) ? config.dateFrom : "",
    to: DATE_PATTERN.test(config.dateTo) ? config.dateTo : "",
  };
  if (config.period === "today") return { from: today, to: today };
  if (config.period === "7d") return { from: subtractUtc(today, 6, "day"), to: today };
  if (config.period === "3m") return { from: subtractUtc(today, 3, "month"), to: today };
  if (config.period === "6m") return { from: subtractUtc(today, 6, "month"), to: today };
  return { from: subtractUtc(today, 29, "day"), to: today };
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function withinDate(value: string, from: string, to: string) {
  return (!from || value >= from) && (!to || value <= to);
}

function sessionIdentity(session: ConfigurableSession) {
  return session.clinicalSessionRunId || session.id;
}

function stateLabel(value: TargetState) {
  return TARGET_STATE_LABELS[value] || value;
}

function selectedPrograms(dataset: ConfigurableGraphDataset, config: GraphConfig) {
  const requested = config.filters.programIds.length ? new Set(config.filters.programIds) : null;
  return dataset.programs.filter((program) => !requested || requested.has(program.id));
}

function selectedTargets(programs: ConfigurableProgram[], config: GraphConfig) {
  const requested = config.filters.targetIds.length ? new Set(config.filters.targetIds) : null;
  const states = config.filters.targetStates.length ? new Set(config.filters.targetStates) : null;
  return programs.flatMap((program) => program.targets).filter((target) => (!requested || requested.has(target.id)) && (!states || states.has(target.state)));
}

function groupName(row: ObservationRow, grouping: GraphGrouping) {
  if (grouping === "program") return row.program.name;
  if (grouping === "target") return `${row.target.code} · ${row.target.name}`;
  if (grouping === "prompt") return promptLevelLabel(row.promptLevel);
  if (grouping === "therapist") return row.professionalName;
  return "Datos";
}

function axisValue(row: ObservationRow, config: GraphConfig) {
  if (config.xAxis === "session") return { key: row.sessionKey, label: `S${row.sessionOrder} · ${dateLabel(row.date)}` };
  if (config.xAxis === "target") return { key: row.target.id, label: `${row.target.code} · ${row.target.name}` };
  if (config.xAxis === "prompt") return { key: row.promptLevel || "undocumented", label: promptLevelLabel(row.promptLevel) };
  if (config.xAxis === "therapist") return { key: row.professionalId, label: row.professionalName };
  return { key: row.date, label: dateLabel(row.date) };
}

function countForRow(row: ObservationRow) {
  if (!row.sampled || row.value === null) return null;
  if (["percentage", "occurrence", "discrete_trials"].includes(row.target.measurement)) {
    return row.correct !== null ? row.correct : null;
  }
  if (row.target.measurement === "frequency") return row.value;
  return null;
}

function aggregateValue(rows: ObservationRow[], config: GraphConfig) {
  const measured = rows.filter((row) => row.sampled && row.value !== null);
  if (!measured.length) return null;
  if (config.yAxis === "percentage_correct") {
    const ratioRows = measured.filter((row) => row.correct !== null && row.opportunities > 0);
    if (ratioRows.length) {
      const correct = ratioRows.reduce((sum, row) => sum + (row.correct || 0), 0);
      const opportunities = ratioRows.reduce((sum, row) => sum + row.opportunities, 0);
      return opportunities ? Math.round(correct / opportunities * 1000) / 10 : null;
    }
    const percentages = measured.filter((row) => ["percentage", "occurrence", "discrete_trials"].includes(row.target.measurement)).map((row) => row.value as number);
    return percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length * 10) / 10 : null;
  }
  if (config.yAxis === "duration") {
    const durations = measured.filter((row) => row.target.measurement === "duration").map((row) => row.value as number);
    return durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) * 10) / 10 : null;
  }
  const counts = measured.flatMap((row) => {
    const count = countForRow(row);
    return count === null ? [] : [count];
  });
  if (!counts.length) return null;
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (config.yAxis === "count") return Math.round(total * 10) / 10;
  const windows = new Map<string, number>();
  measured.forEach((row) => {
    if (row.documentedDuration && row.durationSeconds && row.durationSeconds > 0) windows.set(row.sessionKey, row.durationSeconds);
  });
  if (!windows.size || measured.some((row) => !row.documentedDuration)) return null;
  const seconds = [...windows.values()].reduce((sum, value) => sum + value, 0);
  const unitSeconds = config.rateUnit === "minute" ? 60 : config.rateUnit === "day" ? 86400 : 3600;
  return seconds ? Math.round(total / seconds * unitSeconds * 100) / 100 : null;
}

function criterionFromSnapshot(value: unknown, state: TargetState): MasteryCriterion | null {
  if (!value || typeof value !== "object" || state === "closed") return null;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.state !== state || !snapshot.criterion || typeof snapshot.criterion !== "object") return null;
  const criterion = snapshot.criterion as Record<string, unknown>;
  const metric = ["percentage_correct", "correct_count", "value"].includes(String(criterion.metric)) ? String(criterion.metric) : "";
  const threshold = Number(criterion.threshold);
  const requiredSessions = Number(criterion.requiredSessions);
  if (!metric || !Number.isFinite(threshold) || !Number.isFinite(requiredSessions)) return null;
  return {
    metric: metric as MasteryCriterion["metric"],
    operator: criterion.operator === "lte" ? "lte" : "gte",
    threshold,
    minTrials: Math.max(0, Math.round(Number(criterion.minTrials) || 0)),
    requiredSessions: Math.max(1, Math.round(requiredSessions)),
    consecutive: criterion.consecutive !== false,
    distinctContexts: Math.max(1, Math.round(Number(criterion.distinctContexts) || 1)),
    insufficientSampleBreaksStreak: criterion.insufficientSampleBreaksStreak === true,
  };
}

function criterionMatches(criterion: MasteryCriterion, config: GraphConfig) {
  if (config.yAxis === "percentage_correct") return criterion.metric === "percentage_correct";
  if (config.yAxis === "count") return criterion.metric === "correct_count";
  if (config.yAxis === "duration") return criterion.metric === "value";
  return false;
}

function criterionProgress(rows: ObservationRow[], targetId: string, sessionId: string) {
  let met = 0;
  let required = 0;
  let phase = "";
  for (const row of rows.filter((item) => item.target.id === targetId).sort((a, b) => a.date.localeCompare(b.date) || a.sessionKey.localeCompare(b.sessionKey))) {
    const criterion = criterionFromSnapshot(row.criterionSnapshot, row.state);
    if (criterion) required = criterion.requiredSessions;
    if (phase !== row.state) { phase = row.state; met = 0; }
    if (row.criterionStatus === "met") met += 1;
    else if (row.criterionStatus === "not_met" || (row.criterionStatus === "insufficient_sample" && criterion?.insufficientSampleBreaksStreak)) met = 0;
    if (row.sessionId === sessionId) return required ? { met: Math.min(met, required), required, label: `${Math.min(met, required)} de ${required}` } : null;
  }
  return null;
}

function aggregateRows(rows: ObservationRow[], config: GraphConfig) {
  const groups = new Map<string, Aggregate>();
  rows.forEach((row) => {
    const axis = axisValue(row, config);
    const series = groupName(row, config.grouping);
    const key = `${axis.key}\u0000${series}`;
    const current = groups.get(key);
    if (current) current.rows.push(row);
    else groups.set(key, { xKey: axis.key, label: axis.label, series, rows: [row] });
  });
  return [...groups.values()];
}

function sessionRows(dataset: ConfigurableGraphDataset, programs: ConfigurableProgram[], targets: ConfigurableTarget[], config: GraphConfig, from: string, to: string) {
  const programMap = new Map(programs.map((program) => [program.id, program]));
  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const allowedTherapists = config.filters.therapistIds.length ? new Set(config.filters.therapistIds) : null;
  const sessions = dataset.sessions.filter((session) => programMap.has(session.programId) && withinDate(session.sessionDate, from, to))
    .filter((session) => !allowedTherapists || allowedTherapists.has(session.professionalAccountId))
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const sessionKeys = unique(sessions.map(sessionIdentity));
  const sessionOrder = new Map(sessionKeys.map((key, index) => [key, index + 1]));
  const rows: ObservationRow[] = [];
  sessions.forEach((session) => {
    const program = programMap.get(session.programId)!;
    const sessionKey = sessionIdentity(session);
    program.targets.filter((target) => targetMap.has(target.id)).forEach((target) => {
      const result = session.results.find((item) => item.targetId === target.id);
      rows.push({
        id: `${session.id}:${target.id}`,
        date: session.sessionDate,
        sessionId: session.id,
        sessionKey,
        sessionOrder: sessionOrder.get(sessionKey) || 1,
        program,
        target,
        professionalId: session.professionalAccountId,
        professionalName: session.professionalName,
        rawDetailAvailable: session.rawDetailAvailable,
        sampled: Boolean(result?.sampled),
        value: result?.sampled && typeof result.value === "number" ? result.value : null,
        correct: result?.sampled && typeof result.correct === "number" ? result.correct : null,
        opportunities: result?.sampled ? result.opportunities : 0,
        durationSeconds: session.durationSeconds,
        documentedDuration: session.documentedDuration,
        state: result?.stateAtSession || target.state,
        criterionStatus: result?.criterionStatus || "not_evaluated",
        criterionSnapshot: result?.criterionSnapshot,
        note: result?.note || "",
        context: session.context,
        sessionNotes: session.notes,
      });
    });
  });
  return { rows, sessions, sessionKeys };
}

function phaseBoundaries(rows: ObservationRow[], sessions: ConfigurableSession[], config: GraphConfig, manualPhases: PhaseBoundary[]) {
  if (!rows.length || !["date", "session"].includes(config.xAxis)) return [];
  const axes = unique(rows.map((row) => axisValue(row, config).key));
  const targets = new Map(rows.map((row) => [row.target.id, row.target]));
  const automatic: PhaseBoundary[] = [];
  sessions.forEach((session) => session.transitions.forEach((transition) => {
    const target = targets.get(transition.targetId);
    if (!target) return;
    const sessionRow = rows.find((row) => row.sessionId === session.id && row.target.id === transition.targetId);
    if (!sessionRow) return;
    const axis = axisValue(sessionRow, config).key;
    const position = axes.indexOf(axis);
    if (position < 0) return;
    automatic.push({
      id: `auto:${transition.targetId}:${session.id}:${transition.to}`,
      afterIndex: position + 1,
      beforeLabel: stateLabel(transition.from),
      afterLabel: stateLabel(transition.to),
      boundaryDate: session.sessionDate,
      boundaryKey: axis,
      targetId: transition.targetId,
      targetLabel: `${target.code} · ${target.name}`,
      origin: "automatic",
    });
  }));
  targets.forEach((target) => {
    const measured = rows.filter((row) => row.target.id === target.id && row.sampled && row.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date) || a.sessionKey.localeCompare(b.sessionKey));
    measured.slice(1).forEach((row, index) => {
      const previous = measured[index]!;
      if (previous.state === row.state) return;
      const axis = axisValue(row, config).key;
      const position = axes.indexOf(axis);
      if (position < 1 || automatic.some((phase) => phase.targetId === target.id && phase.afterIndex === position)) return;
      automatic.push({
        id: `auto:fallback:${target.id}:${row.sessionId}:${row.state}`,
        afterIndex: position,
        beforeLabel: stateLabel(previous.state),
        afterLabel: stateLabel(row.state),
        boundaryDate: row.date,
        boundaryKey: axis,
        targetId: target.id,
        targetLabel: `${target.code} · ${target.name}`,
        origin: "automatic",
      });
    });
  });
  const manual = manualPhases.filter((phase) => phase.origin !== "automatic" && !phase.id.startsWith("auto-phase-")).map((phase) => {
    const byKey = phase.boundaryKey ? axes.indexOf(phase.boundaryKey) : -1;
    const byDate = phase.boundaryDate ? axes.findIndex((key) => key >= phase.boundaryDate!) : -1;
    return { ...phase, origin: "manual" as const, afterIndex: byKey >= 0 ? byKey : byDate > 0 ? byDate : Math.max(1, Math.min(phase.afterIndex, axes.length)) };
  });
  return [...automatic, ...manual].sort((a, b) => a.afterIndex - b.afterIndex || a.id.localeCompare(b.id));
}

function baseGraph(dataset: ConfigurableGraphDataset, config: GraphConfig, input: BuildConfigurableGraphInput, points: GraphPoint[], phases: PhaseBoundary[], warnings: string[]): AnalyticGraph {
  const programs = selectedPrograms(dataset, config);
  const selectedProgramNames = programs.map((program) => program.name);
  const allTargets = dataset.programs.flatMap((program) => program.targets);
  const selectedTargetNames = config.filters.targetIds.map((id) => {
    const target = allTargets.find((item) => item.id === id);
    return target ? `${target.code} · ${target.name}` : id;
  });
  const selectedTherapistNames = config.filters.therapistIds.map((id) => dataset.professionals.find((item) => item.id === id)?.name || id);
  const range = resolveGraphPeriod(config, input.today);
  const rangeLabel = range.from || range.to ? `${range.from || "inicio"} a ${range.to || "hoy"}` : "Todo el historial";
  const filters = [
    selectedProgramNames.length ? `Programas: ${selectedProgramNames.join(", ")}` : "Programas: todos",
    config.filters.targetIds.length ? `Targets: ${selectedTargetNames.join(", ")}` : "Targets: todos",
    config.filters.targetStates.length ? `Estados: ${config.filters.targetStates.map((state) => TARGET_STATE_LABELS[state as TargetState] || state).join(", ")}` : "Estados: todos",
    config.filters.therapistIds.length ? `Terapeutas: ${selectedTherapistNames.join(", ")}` : "Terapeutas: todos los permitidos",
  ];
  return {
    id: input.id,
    profileId: dataset.profile.id,
    linkedProgramId: programs.length === 1 ? programs[0]!.id : null,
    title: input.title,
    objective: input.objective,
    graphType: input.graphType,
    designType: "simple",
    measurement: input.measurement,
    xAxisLabel: input.xAxisLabel,
    yAxisLabel: input.yAxisLabel,
    linkedCycleId: null,
    status: "active",
    points,
    phases,
    config: {
      ...DEFAULT_GRAPH_CONFIG,
      ...config,
      version: 2,
      dateFrom: range.from,
      dateTo: range.to,
      yMin: config.yAxis === "percentage_correct" ? 0 : config.yMin,
      yMax: config.yAxis === "percentage_correct" ? 100 : config.yMax,
      sourceTargetIds: config.filters.targetIds,
      exportMetadata: [`Niño: ${dataset.profile.fullName}`, `Período: ${rangeLabel}`, ...filters],
      warnings: unique([...dataset.warnings, ...warnings]),
    },
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

export type BuildConfigurableGraphInput = {
  id: string;
  dataset: ConfigurableGraphDataset;
  config: GraphConfig;
  graphType: GraphType;
  title: string;
  objective: string;
  measurement: string;
  xAxisLabel: string;
  yAxisLabel: string;
  manualPhases?: PhaseBoundary[];
  today?: string;
};

export function buildConfigurableGraph(input: BuildConfigurableGraphInput): AnalyticGraph {
  const { dataset, config } = input;
  const warnings: string[] = [];
  const range = resolveGraphPeriod(config, input.today);
  const programs = selectedPrograms(dataset, config);
  const targets = selectedTargets(programs, config);
  if (config.period === "custom" && (!DATE_PATTERN.test(config.dateFrom) || !DATE_PATTERN.test(config.dateTo) || config.dateFrom > config.dateTo)) {
    warnings.push("El rango personalizado necesita fechas válidas y la fecha inicial no puede ser posterior a la final.");
    return baseGraph(dataset, config, input, [], [], warnings);
  }
  if (!programs.length) warnings.push("No hay programas que coincidan con los filtros.");
  if (config.dataSource !== "abc" && !targets.length) warnings.push("No hay targets que coincidan con los filtros.");
  if ((config.xAxis === "therapist" || config.grouping === "therapist") && !dataset.capabilities.canCompareTherapists) {
    warnings.push("El rol Terapia puede ver el progreso general de sus niños asignados, pero no comparar profesionales.");
    return baseGraph(dataset, config, input, [], [], warnings);
  }
  if (input.graphType === "scatter" && !["date", "session"].includes(config.xAxis)) {
    warnings.push("La dispersión requiere fecha o sesión en el eje horizontal; para categorías usa columnas.");
    return baseGraph(dataset, config, input, [], [], warnings);
  }
  if (input.graphType === "stacked-bar" && !["count", "duration"].includes(config.yAxis)) {
    warnings.push("Las columnas apiladas sólo admiten componentes aditivos: conteo o duración.");
    return baseGraph(dataset, config, input, [], [], warnings);
  }
  if (input.graphType === "line" && !["date", "session"].includes(config.xAxis)) {
    warnings.push("Una línea temporal válida requiere fecha o sesión; para categorías usa columnas.");
    return baseGraph(dataset, config, input, [], [], warnings);
  }
  if (config.dataSource === "sessions" && (config.xAxis === "prompt" || config.grouping === "prompt")) {
    warnings.push("El nivel de ayuda pertenece a cada ensayo, no al resumen de sesión. Selecciona “Ensayo por ensayo” para usar prompt sin inventar un valor global.");
    return baseGraph(dataset, config, input, [], [], warnings);
  }

  if (input.graphType === "cumulative") {
    if (config.dataSource !== "sessions" || config.filters.therapistIds.length || config.xAxis !== "date") {
      warnings.push("La acumulativa representa únicamente targets adquiridos por fecha. No admite otra fuente, eje ni atribución por terapeuta.");
      return baseGraph(dataset, config, input, [], [], warnings);
    }
    const points: GraphPoint[] = [];
    programs.forEach((program) => {
      const targetIds = new Set(targets.filter((target) => target.programId === program.id).map((target) => target.id));
      const uniqueEvents = [...program.masteryEvents
        .filter((event) => targetIds.has(event.targetId))
        .sort((a, b) => a.masteredAt.localeCompare(b.masteredAt) || a.targetId.localeCompare(b.targetId))
        .reduce((byTarget, event) => byTarget.has(event.targetId) ? byTarget : byTarget.set(event.targetId, event), new Map<string, typeof program.masteryEvents[number]>())
        .values()];
      const events = uniqueEvents.filter((event) => withinDate(event.masteredAt.slice(0, 10), range.from, range.to));
      const before = uniqueEvents.filter((event) => Boolean(range.from) && event.masteredAt.slice(0, 10) < range.from);
      points.push({ id: `cumulative:${program.id}:start`, label: "Inicio", xKey: "0000:period-start", value: before.length, series: program.name, criterion: null, note: before.length ? "Total adquirido antes del período seleccionado." : "Inicio del conteo acumulado: ningún target adquirido antes del período." });
      const byDate = new Map<string, typeof events>();
      events.forEach((event) => {
        const date = event.masteredAt.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) || []), event]);
      });
      [...byDate.entries()].forEach(([date, items]) => points.push({
        id: `cumulative:${program.id}:${date}`,
        label: dateLabel(date),
        xKey: date,
        value: items.length,
        series: program.name,
        criterion: null,
        note: `${items.length} target${items.length === 1 ? "" : "s"} adquirido${items.length === 1 ? "" : "s"}: ${items.map((item) => targets.find((target) => target.id === item.targetId)?.code || item.targetId).join(", ")}`,
      }));
    });
    points.sort((a, b) => (a.xKey || a.label).localeCompare(b.xKey || b.label) || a.series.localeCompare(b.series));
    return baseGraph(dataset, { ...config, yAxis: "count" }, input, points, [], warnings);
  }

  if (config.dataSource === "abc") {
    if (!dataset.capabilities.canViewAbcSource) warnings.push("Tu rol no tiene permiso para consultar el historial ABC.");
    if (config.yAxis === "percentage_correct" || config.yAxis === "duration") warnings.push("Los incidentes ABC sólo pueden representarse como conteo o tasa; no existe un porcentaje correcto ni una duración del incidente.");
    if (config.xAxis === "prompt" || config.grouping === "prompt") warnings.push("Los registros ABC no contienen niveles de ayuda; selecciona fecha, sesión, objetivo o terapeuta.");
    if (warnings.length) return baseGraph(dataset, config, input, [], [], warnings);
    const programIds = new Set(programs.map((program) => program.id));
    const targetIds = new Set(targets.map((target) => target.id));
    const therapistIds = config.filters.therapistIds.length ? new Set(config.filters.therapistIds) : null;
    const records = dataset.abc.filter((record) => withinDate(record.eventDate, range.from, range.to))
      .filter((record) => config.filters.programIds.length ? Boolean(record.programId && programIds.has(record.programId)) : !record.programId || programIds.has(record.programId))
      .filter((record) => config.filters.targetIds.length || config.filters.targetStates.length
        ? Boolean(record.targetId && targetIds.has(record.targetId))
        : !record.targetId || targetIds.has(record.targetId))
      .filter((record) => !therapistIds || therapistIds.has(record.professionalAccountId));
    const targetMap = new Map(targets.map((target) => [target.id, target]));
    const programMap = new Map(programs.map((program) => [program.id, program]));
    const unlinkedTarget: ConfigurableTarget = { id: "abc-unlinked-target", programId: "abc-unlinked-program", code: "—", name: "Sin objetivo", measurement: "frequency", unitLabel: "incidentes", state: "baseline", criteria: normalizeCriteria({}, "frequency") };
    const unlinkedProgram: ConfigurableProgram = { id: "abc-unlinked-program", name: "Sin programa", status: "historical", targets: [unlinkedTarget], masteryEvents: [] };
    const sessionOrder = new Map(unique(dataset.sessions.filter((session) => withinDate(session.sessionDate, range.from, range.to)).map(sessionIdentity)).map((key, index) => [key, index + 1]));
    let graphRows = records.flatMap((record): ObservationRow[] => {
      const program = record.programId ? programMap.get(record.programId) : unlinkedProgram;
      const target = record.targetId ? targetMap.get(record.targetId) : program ? { ...unlinkedTarget, programId: program.id } : null;
      if (!program || !target) return [];
      const sessionKey = record.sessionKey || record.sessionId || `abc:${record.eventDate}:${record.id}`;
      return [{
        id: record.id, date: record.eventDate, sessionId: record.sessionId || record.id, sessionKey,
        sessionOrder: sessionOrder.get(sessionKey) || sessionOrder.size + 1, program, target,
        professionalId: record.professionalAccountId, professionalName: record.professionalName,
        rawDetailAvailable: record.rawDetailAvailable,
        sampled: true, value: record.count, correct: record.count, opportunities: record.count,
        durationSeconds: record.observationSeconds, documentedDuration: record.documentedDuration,
        state: target.state, criterionStatus: "not_evaluated", criterionSnapshot: null,
        note: record.details, context: "", sessionNotes: "",
      }];
    });
    if (!config.filters.targetIds.length && !["target", "prompt"].includes(config.grouping) && ["date", "session"].includes(config.xAxis)) {
      const observedSessionKeys = new Set(records.flatMap((record) => record.sessionKey ? [record.sessionKey] : []));
      const zeroWindows = new Map<string, ConfigurableSession>();
      dataset.sessions.filter((session) => session.abcObservationDocumented && programMap.has(session.programId) && withinDate(session.sessionDate, range.from, range.to))
        .filter((session) => !therapistIds || therapistIds.has(session.professionalAccountId))
        .forEach((session) => {
          const key = sessionIdentity(session);
          if (!observedSessionKeys.has(key) && !zeroWindows.has(key)) zeroWindows.set(key, session);
        });
      graphRows = [...graphRows, ...[...zeroWindows.entries()].flatMap(([sessionKey, session]): ObservationRow[] => {
        const program = programMap.get(session.programId);
        const target = program?.targets.find((item) => targetIds.has(item.id)) || program?.targets[0];
        if (!program || !target) return [];
        return [{
          id: `abc-zero:${sessionKey}`, date: session.sessionDate, sessionId: session.id, sessionKey,
          sessionOrder: sessionOrder.get(sessionKey) || sessionOrder.size + 1, program, target,
          professionalId: session.professionalAccountId, professionalName: session.professionalName,
          rawDetailAvailable: session.rawDetailAvailable,
          sampled: true, value: 0, correct: 0, opportunities: 1,
          durationSeconds: session.durationSeconds, documentedDuration: session.documentedDuration,
          state: target.state, criterionStatus: "not_evaluated", criterionSnapshot: null,
          note: "Cero observado durante una ventana móvil documentada.", context: "", sessionNotes: "",
        }];
      })];
    }
    const aggregates = aggregateRows(graphRows, { ...config, yAxis: config.yAxis === "rate" ? "rate" : "count" });
    const points = aggregates.map((aggregate) => ({
      id: `abc:${aggregate.xKey}:${aggregate.series}`,
      label: aggregate.label,
      xKey: aggregate.xKey,
      value: aggregateValue(aggregate.rows, { ...config, yAxis: config.yAxis === "rate" ? "rate" : "count" }),
      series: aggregate.series,
      criterion: null,
      note: aggregate.rows.map((row) => row.note).filter(Boolean).join(" · "),
      source: {
        sessionId: aggregate.rows[0]?.sessionId || "",
        sessionDate: aggregate.rows[0]?.date || "",
        programId: aggregate.rows[0]?.program.id || "",
        targetId: aggregate.rows[0]?.target.id || "",
        targetName: aggregate.rows[0]?.target.name || "",
        opportunities: aggregate.rows.reduce((sum, row) => sum + row.opportunities, 0),
        context: "",
        sessionNotes: "",
        professionalAccountId: aggregate.rows[0]?.professionalId,
        professionalName: aggregate.rows[0]?.professionalName,
        rawDetailAvailable: aggregate.rows.every((row) => row.rawDetailAvailable),
      },
    } satisfies GraphPoint));
    if (config.yAxis === "rate" && points.some((point) => point.value === null)) warnings.push("Algunas tasas ABC no se calcularon porque el incidente no tiene una ventana de observación documentada.");
    if (config.yAxis === "count") {
      const documentedRuns = unique(dataset.sessions.filter((session) => session.abcObservationDocumented && withinDate(session.sessionDate, range.from, range.to)).map(sessionIdentity));
      if (documentedRuns.length) warnings.push("Un cero ABC sólo se incorpora cuando una sesión móvil documentó la ventana de observación y registró cero incidentes.");
    }
    return baseGraph(dataset, config, input, points, [], warnings);
  }

  if (!dataset.capabilities.canViewSessionSource) warnings.push("Tu rol no tiene permiso para consultar resultados de sesión.");
  const prepared = sessionRows(dataset, programs, targets, config, range.from, range.to);
  let rows = prepared.rows;
  if (config.dataSource === "trials") {
    if (!dataset.capabilities.canViewTrialSource) warnings.push("Tu rol no tiene permiso para consultar ensayos.");
    const trialRows: ObservationRow[] = [];
    rows.forEach((row) => {
      const session = prepared.sessions.find((item) => item.id === row.sessionId);
      const result = session?.results.find((item) => item.targetId === row.target.id);
      if (!result?.trials.length || !session?.rawDetailAvailable) return;
      result.trials.forEach((trial, index) => {
        const detail = result.trialDetails[index];
        trialRows.push({
          ...row,
          id: `${row.id}:trial:${index}`,
          value: trial === 1 ? 100 : 0,
          correct: trial,
          opportunities: 1,
          promptLevel: detail?.promptLevel,
          trialIndex: index + 1,
          note: [detail?.at ? new Date(detail.at).toISOString() : "Hora no documentada", promptLevelLabel(detail?.promptLevel)].join(" · "),
        });
      });
    });
    rows = trialRows;
    if (rows.some((row) => !row.promptLevel)) warnings.push("Hay ensayos históricos sin nivel de ayuda; se muestran como “Sin nivel documentado” y no se infieren.");
  }
  if (warnings.length && !rows.length) return baseGraph(dataset, config, input, [], [], warnings);
  if (config.yAxis === "duration" && !rows.some((row) => row.target.measurement === "duration")) warnings.push("La duración sólo se calcula para targets registrados con medición de duración.");
  if (config.yAxis === "rate" && rows.some((row) => row.sampled && !row.documentedDuration)) warnings.push("Las tasas sin tiempo de observación documentado se dejan como huecos; nunca se asigna una duración estimada.");
  if (config.dataSource === "trials" && config.yAxis === "rate") warnings.push("La tasa no es válida para ensayos individuales; utiliza porcentaje correcto o conteo.");
  if (config.dataSource === "trials" && config.yAxis === "duration") warnings.push("Los ensayos correcto/incorrecto no contienen duración; selecciona una fuente de sesiones con targets de duración.");
  if (config.dataSource === "trials" && ["rate", "duration"].includes(config.yAxis)) return baseGraph(dataset, config, input, [], [], warnings);

  const aggregates = config.dataSource === "trials" && ["date", "session"].includes(config.xAxis)
    ? rows.map((row) => ({
      xKey: `${axisValue(row, config).key}:trial:${row.target.id}:${row.trialIndex}`,
      label: `${axisValue(row, config).label} · E${row.trialIndex}`,
      series: groupName(row, config.grouping),
      rows: [row],
    }))
    : aggregateRows(rows, config);
  const points = aggregates.map((aggregate) => {
    const targetIds = unique(aggregate.rows.map((row) => row.target.id));
    const target = targetIds.length === 1 ? aggregate.rows[0]!.target : null;
    const lastRow = [...aggregate.rows].sort((a, b) => a.date.localeCompare(b.date) || a.sessionKey.localeCompare(b.sessionKey)).at(-1)!;
    const criterion = target ? criterionFromSnapshot(lastRow.criterionSnapshot, lastRow.state) : null;
    const matchingCriterion = criterion && criterionMatches(criterion, config) ? criterion : null;
    const progress = target && matchingCriterion ? criterionProgress(rows, target.id, lastRow.sessionId) : null;
    return {
      id: `point:${aggregate.xKey}:${aggregate.series}`,
      label: aggregate.label,
      xKey: aggregate.xKey,
      value: aggregateValue(aggregate.rows, config),
      series: aggregate.series,
      criterion: matchingCriterion?.threshold ?? null,
      criterionProgress: progress,
      targetId: target?.id,
      stateAtPoint: target ? lastRow.state : undefined,
      note: [target ? stateLabel(lastRow.state) : "", ...aggregate.rows.map((row) => row.note).filter(Boolean)].filter(Boolean).join(" · "),
      source: {
        sessionId: lastRow.sessionId,
        sessionDate: lastRow.date,
        programId: lastRow.program.id,
        targetId: target?.id || "",
        targetName: target?.name || "Varios targets",
        opportunities: aggregate.rows.reduce((sum, row) => sum + row.opportunities, 0),
        context: lastRow.context,
        sessionNotes: lastRow.sessionNotes,
        professionalAccountId: lastRow.professionalId,
        professionalName: lastRow.professionalName,
        promptLevel: lastRow.promptLevel,
        rawDetailAvailable: aggregate.rows.every((row) => row.rawDetailAvailable),
      },
    } satisfies GraphPoint;
  });
  if (config.showCriterion && rows.some((row) => row.sampled) && !points.some((point) => point.criterion !== null)) {
    warnings.push("No se dibujó un criterio: la métrica no coincide o las sesiones históricas no guardaron una copia inmutable del criterio vigente.");
  }
  const phases = input.graphType === "line" ? phaseBoundaries(rows, prepared.sessions, config, input.manualPhases || []) : [];
  return baseGraph(dataset, config, input, points, phases, warnings);
}
