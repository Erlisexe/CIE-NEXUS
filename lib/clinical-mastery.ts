export const TARGET_STATES = ["baseline", "acquisition", "generalization", "maintenance", "closed"] as const;

export type TargetState = typeof TARGET_STATES[number];
export type LegacyTargetState = TargetState | "mastered" | "generalized";
export type CriterionMetric = "percentage_correct" | "correct_count" | "value";
export type CriterionOperator = "gte" | "lte";
export type CriterionStage = Exclude<TargetState, "closed">;

export const TARGET_STATE_LABELS: Record<TargetState, string> = {
  baseline: "Línea base",
  acquisition: "Adquisición",
  generalization: "Masterizado",
  maintenance: "Generalizado",
  closed: "Cerrado",
};

export function targetStateLabel(state: TargetState) {
  return TARGET_STATE_LABELS[state];
}

export type MasteryCriterion = {
  metric: CriterionMetric;
  operator: CriterionOperator;
  threshold: number;
  minTrials: number;
  requiredSessions: number;
  consecutive: boolean;
  distinctContexts: number;
  insufficientSampleBreaksStreak: boolean;
};

export type TargetCriteria = Record<CriterionStage, MasteryCriterion>;

export type TrialValue = 0 | 1;

export type ClinicalSessionResult = {
  targetId: string;
  sampled: boolean;
  value: number | null;
  correct: number | null;
  opportunities: number;
  trials: TrialValue[];
  note: string;
  stateAtSession: TargetState;
  criterionStatus: "met" | "not_met" | "insufficient_sample" | "not_evaluated";
  criterionReason: string;
};

export type ReplayTarget = {
  id: string;
  code: string;
  name: string;
  measurement: string;
  criteria: TargetCriteria;
  initialState?: TargetState;
};

export type ReplaySession = {
  id: string;
  sessionDate: string;
  context: string;
  professionalAccountId?: string | null;
  createdAt?: string;
  results: ClinicalSessionResult[];
};

export type TargetTransition = {
  targetId: string;
  code: string;
  targetName: string;
  from: TargetState;
  to: TargetState;
  reason: string;
};

export type MasteryEvent = {
  targetId: string;
  sessionId: string;
  masteredAt: string;
  method: "baseline" | "acquisition";
  professionalAccountId: string | null;
  criterion: MasteryCriterion;
};

export type ReplayResult = {
  targetStates: Map<string, TargetState>;
  sessions: Array<ReplaySession & { transitions: TargetTransition[] }>;
  masteryEvents: MasteryEvent[];
};

export type CumulativeMasteryPoint = {
  id: string;
  date: string;
  total: number;
  targetIds: string[];
  isStart: boolean;
};

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTargetState(value: unknown): TargetState {
  if (value === "mastered") return "generalization";
  if (value === "generalized") return "maintenance";
  return TARGET_STATES.includes(value as TargetState) ? value as TargetState : "baseline";
}

function defaultMetric(measurement: string): CriterionMetric {
  return measurement === "percentage" || measurement === "occurrence" || measurement === "discrete_trials"
    ? "percentage_correct"
    : "value";
}

export function defaultCriterion(stage: CriterionStage, measurement = "percentage"): MasteryCriterion {
  return {
    metric: defaultMetric(measurement),
    operator: "gte",
    threshold: stage === "baseline" ? 90 : 80,
    minTrials: measurement === "percentage" || measurement === "occurrence" || measurement === "discrete_trials" ? 3 : 1,
    requiredSessions: stage === "baseline" ? 1 : stage === "generalization" || stage === "maintenance" ? 2 : 3,
    consecutive: true,
    distinctContexts: stage === "generalization" ? 2 : 1,
    insufficientSampleBreaksStreak: false,
  };
}

export function normalizeCriterion(value: unknown, stage: CriterionStage, measurement = "percentage"): MasteryCriterion {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const defaults = defaultCriterion(stage, measurement);
  const metric = ["percentage_correct", "correct_count", "value"].includes(String(raw.metric))
    ? raw.metric as CriterionMetric
    : defaults.metric;
  const operator = raw.operator === "lte" || raw.comparator === "lte" ? "lte" : "gte";
  return {
    metric,
    operator,
    threshold: finiteNumber(raw.threshold ?? raw.value, defaults.threshold),
    minTrials: Math.max(0, Math.round(finiteNumber(raw.minTrials ?? raw.minOpportunities, defaults.minTrials))),
    requiredSessions: Math.max(1, Math.round(finiteNumber(raw.requiredSessions ?? raw.consecutiveSessions, defaults.requiredSessions))),
    consecutive: raw.consecutive !== false,
    distinctContexts: Math.max(1, Math.round(finiteNumber(raw.distinctContexts, defaults.distinctContexts))),
    insufficientSampleBreaksStreak: raw.insufficientSampleBreaksStreak === true,
  };
}

export function normalizeCriteria(value: unknown, measurement = "percentage"): TargetCriteria {
  let raw: Record<string, unknown> = {};
  if (typeof value === "string") {
    try { raw = JSON.parse(value) as Record<string, unknown>; } catch { raw = {}; }
  } else if (value && typeof value === "object") raw = value as Record<string, unknown>;
  return {
    baseline: normalizeCriterion(raw.baseline, "baseline", measurement),
    acquisition: normalizeCriterion(raw.acquisition, "acquisition", measurement),
    generalization: normalizeCriterion(raw.generalization ?? raw.mastered, "generalization", measurement),
    maintenance: normalizeCriterion(raw.maintenance ?? raw.generalized, "maintenance", measurement),
  };
}

export function normalizeTrials(value: unknown): TrialValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((trial) => trial === 1 || trial === true || trial === "1" || trial === "correct"
    ? [1 as const]
    : trial === 0 || trial === false || trial === "0" || trial === "incorrect"
      ? [0 as const]
      : []);
}

export function resultValueForCriterion(result: ClinicalSessionResult, criterion: MasteryCriterion) {
  if (criterion.metric === "correct_count") {
    if (result.correct !== null) return result.correct;
    return result.trials.reduce<number>((sum, trial) => sum + trial, 0);
  }
  if (criterion.metric === "percentage_correct") {
    const correct = result.correct !== null ? result.correct : result.trials.reduce<number>((sum, trial) => sum + trial, 0);
    if (result.opportunities > 0 && (result.correct !== null || result.trials.length)) {
      return Math.round((correct / result.opportunities) * 1000) / 10;
    }
  }
  return result.value;
}

export function evaluateResult(result: ClinicalSessionResult, criterion: MasteryCriterion) {
  if (!result.sampled) return { status: "not_evaluated" as const, value: null, reason: "Target no trabajado en esta sesión." };
  const value = resultValueForCriterion(result, criterion);
  if (value === null || !Number.isFinite(value)) return { status: "not_evaluated" as const, value: null, reason: "No existe un resultado evaluable." };
  if (result.opportunities < criterion.minTrials) {
    return {
      status: "insufficient_sample" as const,
      value,
      reason: `Muestra insuficiente para criterio: ${result.opportunities} de ${criterion.minTrials} oportunidades mínimas.`,
    };
  }
  const met = criterion.operator === "lte" ? value <= criterion.threshold : value >= criterion.threshold;
  return {
    status: met ? "met" as const : "not_met" as const,
    value,
    reason: met ? "La sesión cumple el criterio vigente." : "La sesión no alcanza el criterio vigente.",
  };
}

function nextState(state: TargetState): TargetState {
  if (state === "acquisition") return "generalization";
  if (state === "generalization") return "maintenance";
  if (state === "maintenance") return "closed";
  return state;
}

type Evidence = {
  status: "met" | "not_met";
  context: string;
};

function criterionWindow(evidence: Evidence[], criterion: MasteryCriterion) {
  const eligible = criterion.consecutive
    ? evidence.slice(-criterion.requiredSessions)
    : evidence.filter((item) => item.status === "met").slice(-criterion.requiredSessions);
  if (eligible.length < criterion.requiredSessions) return { ready: false, met: false, contexts: 0 };
  const met = eligible.every((item) => item.status === "met");
  const contexts = new Set(eligible.map((item) => item.context.trim().toLocaleLowerCase("es")).filter(Boolean)).size;
  return { ready: true, met: met && contexts >= criterion.distinctContexts, contexts };
}

export function replayClinicalProgram(targets: ReplayTarget[], sessions: ReplaySession[]): ReplayResult {
  const orderedSessions = [...sessions].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)
    || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    || a.id.localeCompare(b.id));
  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const targetStates = new Map(targets.map((target) => [target.id, target.initialState || "baseline" as TargetState]));
  const evidence = new Map<string, Evidence[]>();
  const masteryByTarget = new Map<string, MasteryEvent>();

  const replayedSessions = orderedSessions.map((session) => {
    const transitions: TargetTransition[] = [];
    const results = session.results.map((rawResult) => {
      const target = targetMap.get(rawResult.targetId);
      const state = targetStates.get(rawResult.targetId) || "baseline";
      const result: ClinicalSessionResult = { ...rawResult, stateAtSession: state };
      if (!target || state === "closed") {
        return { ...result, criterionStatus: "not_evaluated" as const, criterionReason: state === "closed" ? "Target cerrado antes de esta sesión." : "Target no reconocido." };
      }
      const criterion = target.criteria[state as CriterionStage];
      if (!criterion) return { ...result, criterionStatus: "not_evaluated" as const, criterionReason: "El estado no tiene criterio evaluable." };
      const evaluation = evaluateResult(result, criterion);
      const evaluatedResult = { ...result, value: evaluation.value ?? result.value, criterionStatus: evaluation.status, criterionReason: evaluation.reason };
      const key = `${target.id}|${state}`;
      const stageEvidence = evidence.get(key) || [];
      if (evaluation.status === "met" || evaluation.status === "not_met") {
        stageEvidence.push({ status: evaluation.status, context: session.context });
      } else if (evaluation.status === "insufficient_sample" && criterion.insufficientSampleBreaksStreak) {
        stageEvidence.push({ status: "not_met", context: session.context });
      }
      evidence.set(key, stageEvidence);

      const window = criterionWindow(stageEvidence, criterion);
      let to: TargetState | null = null;
      let reason = "";
      if (state === "baseline" && stageEvidence.length >= criterion.requiredSessions) {
        to = window.met ? "closed" : "acquisition";
        reason = window.met
          ? `Línea base superada: ${criterion.requiredSessions} sesión(es) cumplieron el criterio; la habilidad ya estaba presente.`
          : "Línea base completada sin alcanzar el criterio; el target pasa a Adquisición.";
      } else if (state !== "baseline" && window.ready && window.met) {
        to = nextState(state);
        reason = `${criterion.requiredSessions} sesión(es) ${criterion.consecutive ? "consecutivas " : ""}cumplieron el criterio de ${targetStateLabel(state)}${criterion.distinctContexts > 1 ? ` en ${window.contexts} contextos` : ""}.`;
      }

      if (to && to !== state) {
        targetStates.set(target.id, to);
        transitions.push({ targetId: target.id, code: target.code, targetName: target.name, from: state, to, reason });
        if ((state === "baseline" && to === "closed") || state === "acquisition") {
          if (!masteryByTarget.has(target.id)) {
            masteryByTarget.set(target.id, {
              targetId: target.id,
              sessionId: session.id,
              masteredAt: session.sessionDate,
              method: state === "baseline" ? "baseline" : "acquisition",
              professionalAccountId: session.professionalAccountId || null,
              criterion,
            });
          }
        }
      }
      return evaluatedResult;
    });
    return { ...session, results, transitions };
  });

  return { targetStates, sessions: replayedSessions, masteryEvents: [...masteryByTarget.values()] };
}

export function buildCumulativeMasteryTimeline(
  events: Array<{ id: string; targetId: string; sessionId: string | null; masteredAt: string }>,
  sessions: Array<{ id: string; sessionDate: string }>,
  dateFrom = "",
  dateTo = "",
): CumulativeMasteryPoint[] {
  const uniqueEvents = [...new Map([...events]
    .sort((a, b) => a.masteredAt.localeCompare(b.masteredAt) || a.targetId.localeCompare(b.targetId))
    .map((event) => [event.targetId, event])).values()];
  const before = uniqueEvents.filter((event) => dateFrom && event.masteredAt < dateFrom);
  const inRange = uniqueEvents.filter((event) => (!dateFrom || event.masteredAt >= dateFrom) && (!dateTo || event.masteredAt <= dateTo));
  const moments = sessions
    .filter((session) => (!dateFrom || session.sessionDate >= dateFrom) && (!dateTo || session.sessionDate <= dateTo))
    .map((session) => ({ id: session.id, date: session.sessionDate }));
  for (const event of inRange) {
    if (!moments.some((moment) => moment.id === event.sessionId)) moments.push({ id: `mastery-${event.id}`, date: event.masteredAt });
  }
  moments.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const counted = new Set(before.map((event) => event.targetId));
  let total = counted.size;
  const points: CumulativeMasteryPoint[] = moments.map((moment) => {
    const additions = inRange.filter((event) => !counted.has(event.targetId)
      && (event.sessionId === moment.id || moment.id === `mastery-${event.id}`));
    for (const event of additions) counted.add(event.targetId);
    total += additions.length;
    return { id: moment.id, date: moment.date, total, targetIds: additions.map((event) => event.targetId), isStart: false };
  });
  if (points[0] && points[0].total > before.length) {
    points.unshift({ id: "start", date: points[0].date, total: before.length, targetIds: [], isStart: true });
  }
  return points;
}
