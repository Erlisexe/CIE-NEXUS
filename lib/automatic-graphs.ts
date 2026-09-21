import {
  DEFAULT_GRAPH_CONFIG,
  type AnalyticGraph,
  type GraphConfig,
  type GraphPoint,
  type GraphType,
  type ClinicalGraphMetric,
  type ClinicalGraphGrouping,
  type LineDesign,
  type PhaseBoundary,
} from "./graph-types.ts";
import { buildCumulativeMasteryTimeline, TARGET_STATE_LABELS } from "./clinical-mastery.ts";
import { isBinaryOpportunityMeasurement, measurementDisplayLabel, usesObservationClock, type MeasurementDimension, type RecordingFormat } from "./clinical-measurement.ts";

export type ClinicalTargetState = "baseline" | "acquisition" | "generalization" | "maintenance" | "closed";
export type ClinicalMeasurement = "percentage" | "frequency" | "duration" | "latency" | "occurrence" | "discrete_trials" | "partial_interval" | "task_analysis";

export type ClinicalTarget = {
  id: string;
  code: string;
  name: string;
  specificObjective: string;
  measurement: ClinicalMeasurement;
  measurementDimension?: MeasurementDimension;
  recordingFormat?: RecordingFormat;
  unitLabel: string;
  state: ClinicalTargetState;
  masteryAchieved?: boolean;
  masteredAt?: string | null;
  masteryMethod?: string | null;
  criteria?: Record<string, { threshold?: number }>;
};

export type ClinicalMasteryEvent = {
  id: string;
  targetId: string;
  programId: string;
  sessionId: string | null;
  masteredAt: string;
  masteryMethod: "baseline" | "acquisition";
  professionalAccountId: string | null;
  criterionSnapshot: Record<string, unknown>;
  status: string;
};

export type ClinicalProgram = {
  id: string;
  profileId: string | null;
  name: string;
  participantName: string;
  site: string;
  objective: string;
  status: string;
  graphConfig?: {
    graphType: GraphType;
    designType: LineDesign;
    primaryTargetId: string | null;
    clinicalMetric?: ClinicalGraphMetric;
    clinicalGrouping?: ClinicalGraphGrouping;
    showPoints: boolean;
    showLegend: boolean;
  };
  targets: ClinicalTarget[];
  masteryEvents?: ClinicalMasteryEvent[];
};

export type ClinicalSession = {
  id: string;
  programId: string;
  sessionDate: string;
  context: string;
  notes: string;
  status: string;
  createdAt: string;
  results: Array<{
    targetId: string;
    sampled: boolean;
    value: number | null;
    correct?: number | null;
    opportunities?: number;
    frequencyObservationSeconds?: number;
    ratePerMinute?: number | null;
    trials?: Array<0 | 1>;
    note: string;
    stateAtSession: ClinicalTargetState;
    criterionStatus?: "met" | "not_met" | "insufficient_sample" | "not_evaluated";
    criterionReason?: string;
  }>;
};

const STATE_LABELS: Record<ClinicalTargetState, string> = TARGET_STATE_LABELS;

export const CLINICAL_MEASUREMENT_LABELS: Record<ClinicalMeasurement, string> = {
  percentage: "Porcentaje",
  frequency: "Frecuencia",
  duration: "Duración",
  latency: "Latencia",
  occurrence: "Registro de ocurrencia (sí/no por oportunidad)",
  discrete_trials: "Ensayo por ensayo con nivel de ayuda",
  partial_interval: "Intervalo parcial",
  task_analysis: "Análisis de tarea",
};

export function measurementScale(measurement: ClinicalMeasurement | Pick<ClinicalTarget, "measurement" | "measurementDimension" | "recordingFormat">) {
  if (isBinaryOpportunityMeasurement(typeof measurement === "string" ? { measurement } : measurement)) return { yMin: 0, yMax: 100, cumulative: false };
  return { yMin: 0, yMax: null, cumulative: false };
}

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year.slice(2)}` : value;
}

export const CLINICAL_GRAPH_METRIC_LABELS: Record<ClinicalGraphMetric, string> = {
  percentage: "% de respuestas independientes/correctas",
  count: "Respuestas correctas",
  opportunities: "Oportunidades",
  rate: "Ocurrencias por minuto observado",
  value: "Valor del target",
  mastered: "Targets masterizados",
};

function periodKey(date: string, grouping: ClinicalGraphGrouping, id: string) {
  if (grouping === "session") return id;
  if (grouping === "day") return date;
  if (grouping === "month") return date.slice(0, 7);
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - weekday);
  return day.toISOString().slice(0, 10);
}

function periodLabel(date: string, grouping: ClinicalGraphGrouping, index: number) {
  if (grouping === "session") return `${dateLabel(date)} · ${index + 1}`;
  if (grouping === "month") return `${date.slice(5, 7)}/${date.slice(0, 4)}`;
  return grouping === "week" ? `Semana ${dateLabel(date)}` : dateLabel(date);
}

function buildProgramPoints(program: ClinicalProgram, sessions: ClinicalSession[], metric: ClinicalGraphMetric, grouping: ClinicalGraphGrouping): GraphPoint[] {
  const targetMap = new Map(program.targets.map((target) => [target.id, target]));
  const buckets = new Map<string, { date: string; sessions: ClinicalSession[] }>();
  for (const session of sessions) {
    const key = periodKey(session.sessionDate, grouping, session.id);
    const bucket = buckets.get(key) || { date: session.sessionDate, sessions: [] };
    bucket.sessions.push(session);
    buckets.set(key, bucket);
  }
  return [...buckets].map(([key, bucket], index) => {
    let numerator = 0;
    let denominator = 0;
    let samples = 0;
    const contexts = new Set<string>();
    for (const session of bucket.sessions) {
      contexts.add(session.context);
      for (const result of session.results) {
        const target = targetMap.get(result.targetId);
        if (!target || !result.sampled) continue;
        const trials = isBinaryOpportunityMeasurement(target) && Number.isFinite(result.correct) && Number.isFinite(result.opportunities) && (result.opportunities || 0) > 0;
        if (metric === "percentage" && trials) { numerator += result.correct!; denominator += result.opportunities!; samples++; }
        if (metric === "count" && trials) { numerator += result.correct!; denominator += result.opportunities!; samples++; }
        if (metric === "opportunities" && trials) { numerator += result.opportunities!; denominator += result.opportunities!; samples++; }
        if (metric === "rate" && usesObservationClock(target) && Number.isFinite(result.value) && (result.frequencyObservationSeconds || 0) > 0) {
          numerator += result.value!;
          denominator += result.frequencyObservationSeconds!;
          samples++;
        }
      }
    }
    const value = !samples ? null : metric === "percentage" ? Math.round(numerator / denominator * 1000) / 10 : metric === "rate" ? Math.round(numerator / denominator * 6000) / 100 : numerator;
    const last = bucket.sessions[bucket.sessions.length - 1];
    return {
      id: `program-point-${program.id}-${key}`,
      label: periodLabel(grouping === "session" ? bucket.date : key, grouping, index),
      value,
      series: program.name,
      criterion: null,
      note: samples ? `${samples} muestras compatibles · ${metric === "rate" ? `${Math.round(denominator)} segundos observados` : `${Math.round(denominator)} oportunidades`} · ${[...contexts].filter(Boolean).join(", ")}` : "Sin muestras compatibles con esta métrica; no se representa como cero.",
      source: { sessionId: last.id, sessionDate: last.sessionDate, programId: program.id, targetId: "", targetName: "Programa completo", opportunities: metric === "rate" ? 0 : denominator, context: last.context, sessionNotes: last.notes },
    } satisfies GraphPoint;
  });
}

function sessionSort(a: ClinicalSession, b: ClinicalSession) {
  return a.sessionDate.localeCompare(b.sessionDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function targetCriterion(target: ClinicalTarget, state: ClinicalTargetState) {
  const threshold = target.criteria?.[state]?.threshold;
  return typeof threshold === "number" && Number.isFinite(threshold) ? threshold : null;
}

function defaultPhases(target: ClinicalTarget, sessions: ClinicalSession[]) {
  const observed = sessions.flatMap((session) => {
    const result = session.results.find((item) => item.targetId === target.id && item.sampled && item.value !== null);
    return result ? [{ session, state: result.stateAtSession }] : [];
  });
  return observed.flatMap((item, index) => {
    if (!index || observed[index - 1].state === item.state) return [];
    return [{
      id: `auto-phase-${target.id}-${item.session.id}`,
      afterIndex: sessions.findIndex((session) => session.id === item.session.id),
      beforeLabel: STATE_LABELS[observed[index - 1].state],
      afterLabel: STATE_LABELS[item.state],
      boundaryDate: item.session.sessionDate,
    } satisfies PhaseBoundary];
  });
}

function resolvePhases(phases: PhaseBoundary[], sessions: Array<Pick<ClinicalSession, "id" | "sessionDate">>) {
  if (sessions.length < 2) return [];
  return phases.map((phase) => {
    const dateIndex = phase.boundaryDate
      ? sessions.findIndex((session) => session.sessionDate >= phase.boundaryDate!)
      : -1;
    const afterIndex = dateIndex > 0 ? dateIndex : Math.max(1, Math.min(phase.afterIndex, sessions.length - 1));
    return { ...phase, afterIndex, boundaryDate: phase.boundaryDate || sessions[afterIndex]?.sessionDate };
  }).filter((phase, index, all) => all.findIndex((item) => item.afterIndex === phase.afterIndex) === index)
    .sort((a, b) => a.afterIndex - b.afterIndex);
}

export function buildSessionGraph({
  id,
  program,
  sessions,
  targetIds,
  graphType,
  designType,
  title,
  objective,
  xAxisLabel,
  yAxisLabel,
  config,
  phases,
}: {
  id: string;
  program: ClinicalProgram;
  sessions: ClinicalSession[];
  targetIds: string[];
  graphType: GraphType;
  designType: LineDesign;
  title: string;
  objective: string;
  xAxisLabel: string;
  yAxisLabel: string;
  config: GraphConfig;
  phases?: PhaseBoundary[];
}): AnalyticGraph {
  const targets = targetIds.flatMap((targetId) => {
    const target = program.targets.find((item) => item.id === targetId);
    return target ? [target] : [];
  });
  const filteredSessions = sessions.filter((session) => session.programId === program.id && session.status === "closed")
    .filter((session) => !config.dateFrom || session.sessionDate >= config.dateFrom)
    .filter((session) => !config.dateTo || session.sessionDate <= config.dateTo)
    .sort(sessionSort);
  const measurement = targets[0]?.measurement || "percentage";
  const scale = measurementScale(targets[0] || measurement);
  const programScope = config.clinicalScope === "program";
  const metric = graphType === "cumulative" ? "mastered" : config.clinicalMetric;
  if (graphType === "cumulative" || programScope && metric === "mastered") {
    const allEvents = (program.masteryEvents || [])
      .filter((event) => event.status === "active")
      .sort((a, b) => a.masteredAt.localeCompare(b.masteredAt) || a.targetId.localeCompare(b.targetId));
    const targetMap = new Map(program.targets.map((target) => [target.id, target]));
    const sessionMap = new Map(filteredSessions.map((session) => [session.id, session]));
    const eventMap = new Map(allEvents.map((event) => [event.targetId, event]));
    const timeline = buildCumulativeMasteryTimeline(allEvents, filteredSessions, config.dateFrom, config.dateTo);
    const grouping = config.clinicalGrouping;
    const groupedTimeline = grouping === "session" ? timeline : [...timeline.reduce((buckets, item) => {
      const key = item.isStart ? "start" : periodKey(item.date, grouping, item.id);
      const current = buckets.get(key);
      buckets.set(key, current ? { ...item, targetIds: [...current.targetIds, ...item.targetIds] } : item);
      return buckets;
    }, new Map<string, typeof timeline[number]>()).values()];
    const points: GraphPoint[] = groupedTimeline.map((item, index) => {
      const sourceSession = sessionMap.get(item.id);
      const acquired = item.targetIds.map((targetId) => {
        const target = targetMap.get(targetId);
        const event = eventMap.get(targetId);
        return `${target?.code || "Target"} · ${target?.name || targetId} (${event?.masteryMethod === "baseline" ? "Línea base" : "Adquisición"})`;
      });
      return {
        id: `cumulative-${program.id}-${item.id}`,
        label: item.isStart ? "Inicio" : periodLabel(grouping === "session" ? item.date : periodKey(item.date, grouping, item.id), grouping, index),
        value: item.total,
        series: "Targets adquiridos",
        criterion: null,
        note: item.isStart ? "Inicio del período representado." : acquired.length ? `Incorporado al repertorio: ${acquired.join(", ")}` : "Sin nuevos dominios; se conserva el total acumulado.",
        source: item.isStart ? undefined : {
          sessionId: sourceSession?.id || "",
          sessionDate: item.date,
          programId: program.id,
          targetId: item.targetIds[0] || "",
          targetName: item.targetIds[0] ? targetMap.get(item.targetIds[0])?.name || "" : "",
          opportunities: 0,
          context: sourceSession?.context || "",
          sessionNotes: sourceSession?.notes || "",
        },
      };
    });
    return {
      id,
      profileId: program.profileId,
      linkedProgramId: program.id,
      title,
      objective,
      graphType,
      designType: graphType === "line" ? designType : "simple",
      measurement: "Targets masterizados",
      xAxisLabel,
      yAxisLabel: "Targets masterizados",
      linkedCycleId: null,
      status: "active",
      points,
      phases: [],
      config: {
        ...DEFAULT_GRAPH_CONFIG,
        ...config,
        yMin: 0,
        yMax: Math.max(1, program.targets.length),
        cumulativeValues: "totals",
        dataSource: "sessions",
        sourceTargetIds: program.targets.map((target) => target.id),
      },
      archivedAt: null,
      createdAt: "",
      updatedAt: "",
    };
  }
  if (programScope) {
    const points = buildProgramPoints(program, filteredSessions, metric, config.clinicalGrouping);
    const programScale = metric === "percentage" ? { yMin: 0, yMax: 100 } : { yMin: 0, yMax: null };
    return {
      id, profileId: program.profileId, linkedProgramId: program.id, title, objective, graphType, designType,
      measurement: CLINICAL_GRAPH_METRIC_LABELS[metric], xAxisLabel,
      yAxisLabel: yAxisLabel || CLINICAL_GRAPH_METRIC_LABELS[metric], linkedCycleId: null, status: "active",
      points, phases: resolvePhases(phases || [], points.map((point) => ({ id: point.id, sessionDate: point.source?.sessionDate || "" }))),
      config: { ...DEFAULT_GRAPH_CONFIG, ...config, yMin: programScale.yMin, yMax: programScale.yMax, dataSource: "sessions", sourceTargetIds: program.targets.map((target) => target.id) },
      archivedAt: null, createdAt: "", updatedAt: "",
    };
  }
  const points: GraphPoint[] = filteredSessions.flatMap((session, sessionIndex) => targets.map((target) => {
    const result = session.results.find((item) => item.targetId === target.id);
    const recorded = Boolean(result?.sampled && result.value !== null && Number.isFinite(result.value));
    const state = result?.stateAtSession || target.state;
    return {
      id: `session-point-${session.id}-${target.id}`,
      label: `${dateLabel(session.sessionDate)} · ${sessionIndex + 1}`,
      value: recorded ? result!.value : null,
      series: `${target.code} · ${target.name}`,
      criterion: designType === "changing-criterion" ? targetCriterion(target, state) : null,
      note: recorded
        ? [STATE_LABELS[state], session.context, result?.note, `${result?.opportunities || 0} oportunidades`, result?.criterionReason, session.notes].filter(Boolean).join(" · ")
        : `Sin dato registrado para este target · ${session.context}`,
      source: {
        sessionId: session.id,
        sessionDate: session.sessionDate,
        programId: program.id,
        targetId: target.id,
        targetName: target.name,
        opportunities: result?.opportunities || 0,
        context: session.context,
        sessionNotes: session.notes,
      },
    };
  }));
  const suggestedPhases = targets[0] ? defaultPhases(targets[0], filteredSessions) : [];
  const resolvedPhases = resolvePhases(phases?.length ? phases : suggestedPhases, filteredSessions);
  return {
    id,
    profileId: program.profileId,
    linkedProgramId: program.id,
    title,
    objective,
    graphType,
    designType,
    measurement: targets[0] ? measurementDisplayLabel(targets[0]) : CLINICAL_MEASUREMENT_LABELS[measurement],
    xAxisLabel,
    yAxisLabel: yAxisLabel || targets[0]?.unitLabel || (targets[0] ? measurementDisplayLabel(targets[0]) : CLINICAL_MEASUREMENT_LABELS[measurement]),
    linkedCycleId: null,
    status: "active",
    points,
    phases: resolvedPhases,
    config: {
      ...DEFAULT_GRAPH_CONFIG,
      ...config,
      yMin: Number.isFinite(config.yMin) ? config.yMin : scale.yMin,
      yMax: config.yMax === null ? scale.yMax : config.yMax,
      dataSource: "sessions",
      sourceTargetIds: targets.map((target) => target.id),
    },
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}
