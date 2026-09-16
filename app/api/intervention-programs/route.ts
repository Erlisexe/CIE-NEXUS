import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { apiAccountGuard, canAccessProfile, visibleProfileIds } from "../../../lib/access-control";
import { isActiveSite } from "../../../lib/sites";
import { canRecordScheduledSession } from "../../../lib/resource-scope";
import {
  abcRecords,
  clinicalSessionRuns,
  clinicalDataAudit,
  interventionPrograms,
  interventionSessions,
  interventionTargets,
  personnelProfiles,
  sessionNoteTemplates,
  sessionAppointments,
  targetMasteryEvents,
  targetStateHistory,
} from "../../../db/schema";
import {
  normalizeCriteria,
  normalizeTargetState,
  normalizeTrials,
  replayClinicalProgram,
  type ClinicalSessionResult,
  type MasteryEvent,
  type ReplaySession,
  type ReplayTarget,
} from "../../../lib/clinical-mastery";
import {
  DEFAULT_SESSION_NOTE_TEMPLATE,
  formatSessionNoteText,
  missingRequiredSessionNoteFields,
  normalizeSessionNoteValues,
  sanitizeSessionNoteFields,
  type SessionNoteTemplateSnapshot,
} from "../../../lib/session-note-templates";
import { normalizeSessionTargetConfig } from "../../../lib/mobile-collection";

const MEASUREMENTS = new Set(["percentage", "frequency", "duration", "latency", "occurrence", "discrete_trials", "partial_interval", "task_analysis"]);
const GRAPH_TYPES = new Set(["line", "bar", "cumulative"]);
const LINE_DESIGNS = new Set(["simple", "AB", "ABA", "ABAB", "BAB", "multiple-baseline", "multielement", "changing-criterion", "custom"]);
type SessionResult = ClinicalSessionResult;

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function sanitizeSessionResult(raw: Record<string, unknown>, target: typeof interventionTargets.$inferSelect): SessionResult {
  const sampled = raw.sampled !== false;
  const trials = normalizeTrials(raw.trials);
  const rawOpportunities = Math.max(0, Math.round(numberValue(raw.opportunities, trials.length || 0)));
  const opportunities = trials.length ? trials.length : sampled ? rawOpportunities : 0;
  const rawCorrect = raw.correct === "" || raw.correct === null || raw.correct === undefined ? null : numberValue(raw.correct);
  const correct = trials.length ? trials.reduce<number>((sum, trial) => sum + trial, 0) : rawCorrect;
  let value = sampled && raw.value !== "" && raw.value !== null && raw.value !== undefined ? numberValue(raw.value) : null;
  if (["percentage", "occurrence", "discrete_trials", "partial_interval", "task_analysis"].includes(target.measurement) && correct !== null && opportunities > 0) {
    value = Math.round((correct / opportunities) * 1000) / 10;
  }
  const trialDetails = Array.isArray(raw.trialDetails) ? raw.trialDetails.flatMap((value) => {
    const detail = value && typeof value === "object" ? value as Record<string, unknown> : null;
    const responseCode = textValue(detail?.responseCode);
    return detail && ["I", "G", "V", "M", "FP", "FT", "X"].includes(responseCode) ? [{ id: textValue(detail.id), at: textValue(detail.at), responseCode: responseCode as "I" | "G" | "V" | "M" | "FP" | "FT" | "X", ...(Number.isInteger(detail.taskStepIndex) ? { taskStepIndex: Number(detail.taskStepIndex), taskStep: textValue(detail.taskStep) } : {}), ...(detail.probe === true ? { probe: true } : {}) }] : [];
  }) : [];
  const observations = Array.isArray(raw.observations) ? raw.observations.flatMap((value) => {
    const observation = value && typeof value === "object" ? value as Record<string, unknown> : null;
    return observation && Number.isFinite(Number(observation.value)) ? [{ id: textValue(observation.id), at: textValue(observation.at), value: Number(observation.value), ...(["I", "G", "V", "M", "FP", "FT", "X"].includes(textValue(observation.responseCode)) ? { responseCode: textValue(observation.responseCode) as "I" | "G" | "V" | "M" | "FP" | "FT" | "X" } : {}) }] : [];
  }) : [];
  return {
    targetId: textValue(raw.targetId),
    sampled,
    value,
    correct,
    opportunities,
    trials,
    note: textValue(raw.note),
    stateAtSession: normalizeTargetState(raw.stateAtSession ?? target.state),
    criterionStatus: ["met", "not_met", "insufficient_sample", "not_evaluated"].includes(textValue(raw.criterionStatus))
      ? textValue(raw.criterionStatus) as SessionResult["criterionStatus"]
      : "not_evaluated",
    criterionReason: textValue(raw.criterionReason),
    ...(trialDetails.length ? { trialDetails } : {}),
    ...(observations.length ? { observations } : {}),
    ...(Number.isFinite(Number(raw.frequencyObservationSeconds)) ? { frequencyObservationSeconds: Math.max(0, Math.round(Number(raw.frequencyObservationSeconds))) } : {}),
    ...(Number.isFinite(Number(raw.ratePerMinute)) ? { ratePerMinute: Number(raw.ratePerMinute) } : {}),
  };
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Error inesperado";
  return message.includes("no such table")
    ? "El almacenamiento de programas y sesiones todavía no está preparado."
    : /failed query|too many sql variables|too many variables|TEST-TARGET/i.test(message) || message.length > 280
      ? "No se pudieron cargar los programas y sesiones. Intenta nuevamente."
      : message;
}

function normalizeProgramGraphConfig(value: unknown, targets: Array<{ id: string }>) {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const primaryTargetIndex = Math.max(0, Math.round(numberValue(raw.primaryTargetIndex, 0)));
  const requestedTargetId = textValue(raw.primaryTargetId);
  const primaryTargetId = targets.some((target) => target.id === requestedTargetId)
    ? requestedTargetId
    : targets[primaryTargetIndex]?.id || targets[0]?.id || null;
  return {
    graphType: GRAPH_TYPES.has(textValue(raw.graphType)) ? textValue(raw.graphType) : "line",
    designType: LINE_DESIGNS.has(textValue(raw.designType)) ? textValue(raw.designType) : "AB",
    primaryTargetId,
    clinicalMetric: ["percentage", "count", "opportunities", "rate", "mastered"].includes(textValue(raw.clinicalMetric)) ? textValue(raw.clinicalMetric) : "percentage",
    clinicalGrouping: ["session", "day", "week", "month"].includes(textValue(raw.clinicalGrouping)) ? textValue(raw.clinicalGrouping) : "session",
    showPoints: raw.showPoints !== false,
    showLegend: raw.showLegend !== false,
  };
}

function serializeMasteryEvent(event: typeof targetMasteryEvents.$inferSelect) {
  return { ...event, criterionSnapshot: parseJson(event.criterionSnapshot, {}) };
}

function serializeProgram(
  program: typeof interventionPrograms.$inferSelect,
  targets: typeof interventionTargets.$inferSelect[],
  masteryEvents: typeof targetMasteryEvents.$inferSelect[] = [],
) {
  const programTargets = targets
    .filter((target) => target.programId === program.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    ...program,
    graphConfig: normalizeProgramGraphConfig(program.graphConfig, programTargets),
    targets: programTargets.map((target) => ({
      ...target,
      state: normalizeTargetState(target.state),
      criteria: normalizeCriteria(target.criteria, target.measurement),
      sessionConfig: normalizeSessionTargetConfig(target.sessionConfig),
    })),
    masteryEvents: masteryEvents
      .filter((event) => event.programId === program.id && event.status === "active")
      .map(serializeMasteryEvent),
  };
}

async function replayProgramFromRows(
  db: Awaited<ReturnType<typeof getDb>>,
  programId: string,
  sessionOverride?: { id: string; row: typeof interventionSessions.$inferSelect | null },
) {
  const targets = await db.select().from(interventionTargets).where(eq(interventionTargets.programId, programId)).orderBy(asc(interventionTargets.sortOrder));
  const storedSessions = await db.select().from(interventionSessions)
    .where(and(eq(interventionSessions.programId, programId), eq(interventionSessions.status, "closed")))
    .orderBy(asc(interventionSessions.sessionDate), asc(interventionSessions.createdAt));
  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const sessions = sessionOverride
    ? storedSessions.filter((session) => session.id !== sessionOverride.id).concat(sessionOverride.row ? [sessionOverride.row] : [])
    : storedSessions;
  const replayTargets: ReplayTarget[] = targets.map((target) => ({
    id: target.id,
    code: target.code,
    name: target.name,
    measurement: target.measurement,
    criteria: normalizeCriteria(target.criteria, target.measurement),
  }));
  const replaySessions: ReplaySession[] = sessions.map((session) => ({
    id: session.id,
    sessionDate: session.sessionDate,
    context: session.context,
    professionalAccountId: session.professionalAccountId,
    createdAt: session.createdAt,
    results: parseJson<Record<string, unknown>[]>(session.results, [])
      .flatMap((raw) => {
        const target = targetMap.get(textValue(raw.targetId));
        return target ? [sanitizeSessionResult(raw, target)] : [];
      }),
  }));
  return { targets, sessions, replay: replayClinicalProgram(replayTargets, replaySessions) };
}

function masteryDiscrepancies(current: typeof targetMasteryEvents.$inferSelect[], desired: MasteryEvent[]) {
  const desiredMap = new Map(desired.map((event) => [event.targetId, event]));
  return current.filter((event) => event.status === "active").flatMap((event) => {
    const next = desiredMap.get(event.targetId);
    return !next || next.sessionId !== event.sessionId || next.masteredAt !== event.masteredAt || next.method !== event.masteryMethod
      ? [{ targetId: event.targetId, previousDate: event.masteredAt, nextDate: next?.masteredAt || null }]
      : [];
  });
}

async function recalculateProgram(
  db: Awaited<ReturnType<typeof getDb>>,
  programId: string,
  options: { actorAccountId?: string | null; invalidationReason?: string } = {},
) {
  const { targets, replay } = await replayProgramFromRows(db, programId);
  const existingEvents = await db.select().from(targetMasteryEvents).where(eq(targetMasteryEvents.programId, programId));
  const desiredMap = new Map(replay.masteryEvents.map((event) => [event.targetId, event]));
  const now = new Date().toISOString();

  if (targets.length) await db.delete(targetStateHistory).where(inArray(targetStateHistory.targetId, targets.map((target) => target.id)));
  for (const session of replay.sessions) {
    await db.update(interventionSessions).set({
      results: JSON.stringify(session.results),
      transitions: JSON.stringify(session.transitions),
      updatedAt: now,
    }).where(eq(interventionSessions.id, session.id));
    for (const transition of session.transitions) {
      await db.insert(targetStateHistory).values({
        id: crypto.randomUUID(),
        targetId: transition.targetId,
        sessionId: session.id,
        fromState: transition.from,
        toState: transition.to,
        reason: transition.reason,
        createdAt: `${session.sessionDate}T23:59:59.000Z`,
      });
    }
  }

  for (const desired of replay.masteryEvents) {
    const existing = existingEvents.find((event) => event.targetId === desired.targetId);
    const values = {
      programId,
      sessionId: desired.sessionId,
      masteredAt: desired.masteredAt,
      masteryMethod: desired.method,
      professionalAccountId: desired.professionalAccountId,
      criterionSnapshot: JSON.stringify(desired.criterion),
      status: "active",
      invalidatedAt: null,
      invalidatedByAccountId: null,
      invalidationReason: "",
      updatedAt: now,
    };
    if (existing) await db.update(targetMasteryEvents).set(values).where(eq(targetMasteryEvents.id, existing.id));
    else await db.insert(targetMasteryEvents).values({ id: crypto.randomUUID(), targetId: desired.targetId, ...values });
  }
  for (const existing of existingEvents.filter((event) => event.status === "active" && !desiredMap.has(event.targetId))) {
    await db.update(targetMasteryEvents).set({
      status: "revoked",
      invalidatedAt: now,
      invalidatedByAccountId: options.actorAccountId || null,
      invalidationReason: options.invalidationReason || "La evidencia clínica fue recalculada y dejó de sostener el criterio de dominio.",
      updatedAt: now,
    }).where(eq(targetMasteryEvents.id, existing.id));
  }

  for (const target of targets) {
    const mastery = desiredMap.get(target.id);
    await db.update(interventionTargets).set({
      state: replay.targetStates.get(target.id) || "baseline",
      masteryAchieved: Boolean(mastery),
      masteredAt: mastery?.masteredAt || null,
      masteryMethod: mastery?.method || null,
      updatedAt: now,
    }).where(eq(interventionTargets.id, target.id));
  }
  await db.update(interventionPrograms).set({ updatedAt: new Date().toISOString() }).where(eq(interventionPrograms.id, programId));

  const [program] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, programId)).limit(1);
  const updatedTargets = await db.select().from(interventionTargets).where(eq(interventionTargets.programId, programId)).orderBy(asc(interventionTargets.sortOrder));
  const updatedSessions = await db.select().from(interventionSessions).where(eq(interventionSessions.programId, programId)).orderBy(desc(interventionSessions.sessionDate), desc(interventionSessions.createdAt));
  const updatedMasteryEvents = await db.select().from(targetMasteryEvents).where(eq(targetMasteryEvents.programId, programId)).orderBy(asc(targetMasteryEvents.masteredAt));
  return {
    program: program ? serializeProgram(program, updatedTargets, updatedMasteryEvents) : null,
    sessions: updatedSessions.map((session) => ({ ...session, results: parseJson(session.results, []), transitions: parseJson(session.transitions, []) })),
  };
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["programs.view", "programs.manage", "sessions.view", "sessions.record", "sessions.manage"] }); if (denied || !account) return denied;
  try {
    const db = await getDb();
    const params = new URL(request.url).searchParams;
    const requestedProgramId = params.get("programId")?.trim() || "";
    const requestedProfileId = params.get("profileId")?.trim() || "";
    const catalogOnly = params.get("catalog") === "1";
    const mineOnly = params.get("scope") === "mine";
    const profiles = await db.select().from(personnelProfiles);
    const allowedProfileIds = visibleProfileIds(account, profiles);
    if (requestedProfileId && !allowedProfileIds.has(requestedProfileId)) {
      return Response.json({ error: "No tienes acceso al niño seleccionado." }, { status: 403 });
    }
    const programs = requestedProgramId
      ? await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, requestedProgramId)).orderBy(desc(interventionPrograms.updatedAt))
      : requestedProfileId
        ? await db.select().from(interventionPrograms).where(eq(interventionPrograms.profileId, requestedProfileId)).orderBy(desc(interventionPrograms.updatedAt))
        : await db.select().from(interventionPrograms).orderBy(desc(interventionPrograms.updatedAt)).limit(500);
    const visiblePrograms = programs.filter((program) => Boolean(program.profileId && allowedProfileIds.has(program.profileId)));
    const visibleProgramIds = new Set(visiblePrograms.map((program) => program.id));
    const programIds = [...visibleProgramIds];
    const targets = programIds.length
      ? await db.select().from(interventionTargets).where(inArray(interventionTargets.programId, programIds)).orderBy(asc(interventionTargets.sortOrder))
      : [];
    const sessions = catalogOnly || !programIds.length
      ? []
      : requestedProgramId || requestedProfileId
        ? await db.select().from(interventionSessions).where(inArray(interventionSessions.programId, programIds)).orderBy(desc(interventionSessions.sessionDate), desc(interventionSessions.createdAt))
        : await db.select().from(interventionSessions).where(inArray(interventionSessions.programId, programIds)).orderBy(desc(interventionSessions.sessionDate), desc(interventionSessions.createdAt)).limit(500);
    const visibleTargets = targets.filter((target) => visibleProgramIds.has(target.programId));
    const visibleTargetIds = new Set(visibleTargets.map((target) => target.id));
    const masteryEvents = catalogOnly || !programIds.length
      ? []
      : await db.select().from(targetMasteryEvents).where(inArray(targetMasteryEvents.programId, programIds)).orderBy(asc(targetMasteryEvents.masteredAt));
    const isScopedRead = Boolean(requestedProgramId || requestedProfileId);
    const history = catalogOnly || !isScopedRead || !visibleTargetIds.size
      ? []
      : await db.select().from(targetStateHistory).where(inArray(targetStateHistory.targetId, [...visibleTargetIds])).orderBy(desc(targetStateHistory.createdAt)).limit(5000);
    return Response.json({
      programs: visiblePrograms.map((program) => serializeProgram(program, visibleTargets, masteryEvents)),
      sessions: sessions.filter((session) => {
        if (!visibleProgramIds.has(session.programId)) return false;
        if (!mineOnly) return true;
        return session.professionalAccountId === account.id;
      }).map((session) => ({
        ...session,
        results: parseJson(session.results, []),
        transitions: parseJson(session.transitions, []),
      })),
      // Global dashboard/program reads do not consume history and must not bind
      // thousands of target IDs. Scoped child/program reads preserve the data.
      history: history.filter((item) => visibleTargetIds.has(item.targetId)),
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["programs.manage", "sessions.record"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = textValue(body.action);
    const db = await getDb();

    if (action === "create_program") {
      if (!account.permissions.includes("programs.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite crear programas." }, { status: 403 });
      const name = textValue(body.name);
      const profileId = textValue(body.profileId);
      const objective = textValue(body.objective);
      const rawTargets = Array.isArray(body.targets) ? body.targets as Record<string, unknown>[] : [];
      const [profile] = profileId
        ? await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1)
        : [];
      if (!name || !profile || profile.status !== "active" || !(await isActiveSite(profile.site)) || !objective || !rawTargets.length) {
        return Response.json({ error: "Niño activo, nombre, objetivo general y al menos un target son obligatorios." }, { status: 400 });
      }
      if (!canAccessProfile(account, profile)) return Response.json({ error: "No tienes acceso al niño seleccionado." }, { status: 403 });
      const invalidTarget = rawTargets.some((target) => !textValue(target.name) || !textValue(target.specificObjective));
      if (invalidTarget) return Response.json({ error: "Cada target necesita nombre y objetivo específico." }, { status: 400 });

      const programId = crypto.randomUUID();
      const [program] = await db.insert(interventionPrograms).values({
        id: programId,
        profileId: profile.id,
        linkedCycleId: textValue(body.linkedCycleId) || null,
        name,
        participantName: profile.fullName,
        site: profile.site,
        objective,
        instructions: textValue(body.instructions),
      }).returning();
      const targetRows = rawTargets.map((target, index) => ({
        id: crypto.randomUUID(),
        programId,
        code: textValue(target.code) || `T${String(index + 1).padStart(2, "0")}`,
        name: textValue(target.name),
        specificObjective: textValue(target.specificObjective),
        measurement: MEASUREMENTS.has(textValue(target.measurement)) ? textValue(target.measurement) : "percentage",
        unitLabel: textValue(target.unitLabel) || "%",
        state: "baseline",
        criteria: JSON.stringify(normalizeCriteria(target.criteria, MEASUREMENTS.has(textValue(target.measurement)) ? textValue(target.measurement) : "percentage")),
        sessionConfig: JSON.stringify(normalizeSessionTargetConfig(target.sessionConfig)),
        sortOrder: index,
      }));
      const targets = await db.insert(interventionTargets).values(targetRows).returning();
      const graphConfig = normalizeProgramGraphConfig(body.graphConfig, targets);
      const [configuredProgram] = await db.update(interventionPrograms).set({ graphConfig: JSON.stringify(graphConfig) }).where(eq(interventionPrograms.id, programId)).returning();
      return Response.json({ program: serializeProgram(configuredProgram || program, targets, []) }, { status: 201 });
    }

    if (action === "close_session_run") {
      if (!account.permissions.includes("sessions.record") && !account.permissions.includes("sessions.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite registrar sesiones." }, { status: 403 });
      const profileId = textValue(body.profileId);
      const [profile] = profileId ? await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1) : [];
      if (!profile || profile.status !== "active" || !canAccessProfile(account, profile)) return Response.json({ error: "No tienes acceso al niño seleccionado." }, { status: 403 });

      const submittedProgramEntries = Array.isArray(body.programs) ? (body.programs as Record<string, unknown>[]).slice(0, 200) : [];
      const rawProgramEntries = Array.from(submittedProgramEntries.reduce((entries, entry) => {
        const programId = textValue(entry.programId);
        if (programId && !entries.has(programId)) entries.set(programId, entry);
        return entries;
      }, new Map<string, Record<string, unknown>>()).values());
      const requestedProgramIds = [...new Set(rawProgramEntries.map((entry) => textValue(entry.programId)).filter(Boolean))];
      if (!requestedProgramIds.length) return Response.json({ error: "La sesión no contiene programas con datos." }, { status: 400 });
      const programRows = await db.select().from(interventionPrograms).where(inArray(interventionPrograms.id, requestedProgramIds));
      if (programRows.length !== requestedProgramIds.length || programRows.some((program) => program.status !== "active" || program.profileId !== profile.id)) {
        return Response.json({ error: "Todos los programas deben estar activos y pertenecer al mismo niño." }, { status: 400 });
      }
      const targetRows = await db.select().from(interventionTargets).where(inArray(interventionTargets.programId, requestedProgramIds)).orderBy(asc(interventionTargets.sortOrder));
      const targetsByProgram = new Map<string, typeof interventionTargets.$inferSelect[]>();
      for (const target of targetRows) targetsByProgram.set(target.programId, [...(targetsByProgram.get(target.programId) || []), target]);
      const sanitizedEntries = rawProgramEntries.flatMap((entry) => {
        const programId = textValue(entry.programId);
        const targets = targetsByProgram.get(programId) || [];
        const targetMap = new Map(targets.map((target) => [target.id, target]));
        const rawResults = Array.isArray(entry.results) ? entry.results as Record<string, unknown>[] : [];
        const results = rawResults.flatMap((raw) => {
          const target = targetMap.get(textValue(raw.targetId));
          return target ? [sanitizeSessionResult(raw, target)] : [];
        });
        return results.some((result) => result.sampled && result.value !== null) ? [{ programId, results }] : [];
      });
      if (!sanitizedEntries.length) return Response.json({ error: "Registra al menos un resultado válido antes de cerrar la sesión." }, { status: 400 });

      const appointmentId = textValue(body.appointmentId);
      if (!canRecordScheduledSession(account, appointmentId ? account.id : null)) return Response.json({ error: "Tu rol debe ingresar desde una sesión asignada en el calendario." }, { status: 403 });
      const [appointment] = appointmentId ? await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, appointmentId)).limit(1) : [];
      if (appointmentId && (!appointment || appointment.status === "cancelled" || appointment.interventionSessionId || appointment.clinicalSessionRunId)) {
        return Response.json({ error: "La sesión programada ya no está disponible para registrar datos." }, { status: 409 });
      }
      if (appointment && (appointment.profileId !== profile.id || appointment.professionalAccountId !== account.id)) return Response.json({ error: "La sesión programada no corresponde a este niño o profesional." }, { status: 403 });
      if (appointment && !canRecordScheduledSession(account, appointment.professionalAccountId)) return Response.json({ error: "La sesión está asignada a otro profesional." }, { status: 403 });

      const requestedTemplateId = textValue(body.noteTemplateId) || DEFAULT_SESSION_NOTE_TEMPLATE.id;
      const [storedTemplate] = await db.select().from(sessionNoteTemplates).where(eq(sessionNoteTemplates.id, requestedTemplateId)).limit(1);
      if (storedTemplate && storedTemplate.status !== "active") return Response.json({ error: "La plantilla de nota seleccionada ya no está disponible." }, { status: 409 });
      let snapshot: SessionNoteTemplateSnapshot;
      if (storedTemplate) {
        snapshot = {
          id: storedTemplate.id,
          name: storedTemplate.name,
          description: storedTemplate.description,
          fields: sanitizeSessionNoteFields(parseJson(storedTemplate.fields, [])),
        };
      } else if (requestedTemplateId === DEFAULT_SESSION_NOTE_TEMPLATE.id) {
        snapshot = { ...DEFAULT_SESSION_NOTE_TEMPLATE, id: DEFAULT_SESSION_NOTE_TEMPLATE.id, fields: [...DEFAULT_SESSION_NOTE_TEMPLATE.fields] };
      } else return Response.json({ error: "No se encontró la plantilla de nota seleccionada." }, { status: 404 });
      const noteValues = normalizeSessionNoteValues(body.noteValues, snapshot.fields);
      const missingFields = missingRequiredSessionNoteFields(snapshot.fields, noteValues);
      if (missingFields.length) return Response.json({ error: `Completa los campos obligatorios de la nota: ${missingFields.map((field) => field.label).join(", ")}.` }, { status: 400 });
      const noteText = formatSessionNoteText(snapshot.fields, noteValues);

      const now = new Date().toISOString();
      const sessionDate = appointment?.sessionDate || textValue(body.sessionDate) || now.slice(0, 10);
      const context = textValue(body.context) || "Contexto no especificado";
      const runId = crypto.randomUUID();
      await db.insert(clinicalSessionRuns).values({
        id: runId,
        profileId: profile.id,
        appointmentId: appointment?.id || null,
        professionalAccountId: appointment?.professionalAccountId || account.id,
        sessionDate,
        context,
        noteTemplateId: storedTemplate?.id || null,
        noteTemplateSnapshot: JSON.stringify(snapshot),
        noteValues: JSON.stringify(noteValues),
        noteText,
        status: "closing",
        startedAt: textValue(body.startedAt) || null,
        closedAt: null,
      });

      const createdSessions: Array<typeof interventionSessions.$inferSelect> = [];
      const recalculatedPrograms: NonNullable<Awaited<ReturnType<typeof recalculateProgram>>["program"]>[] = [];
      for (const entry of sanitizedEntries) {
        const sessionId = crypto.randomUUID();
        const [session] = await db.insert(interventionSessions).values({
          id: sessionId,
          clinicalSessionRunId: runId,
          programId: entry.programId,
          sessionDate,
          context,
          notes: noteText,
          status: "closed",
          results: JSON.stringify(entry.results),
          transitions: "[]",
          professionalAccountId: appointment?.professionalAccountId || account.id,
          closedAt: now,
        }).returning();
        createdSessions.push(session);
        const recalculated = await recalculateProgram(db, entry.programId, { actorAccountId: account.id });
        if (recalculated.program) recalculatedPrograms.push(recalculated.program);
      }
      await db.update(clinicalSessionRuns).set({ status: "closed", closedAt: now, updatedAt: now }).where(eq(clinicalSessionRuns.id, runId));
      const firstSession = createdSessions[0];
      if (appointment && firstSession) {
        await db.update(sessionAppointments).set({ clinicalSessionRunId: runId, interventionSessionId: firstSession.id, status: "completed", updatedAt: now }).where(eq(sessionAppointments.id, appointment.id));
        await db.update(abcRecords).set({ sessionId: firstSession.id, updatedAt: now }).where(eq(abcRecords.appointmentId, appointment.id));
      }
      const returnedSessions = await db.select().from(interventionSessions).where(eq(interventionSessions.clinicalSessionRunId, runId));
      return Response.json({
        sessionRun: { id: runId, profileId: profile.id, sessionDate, context, noteTemplateSnapshot: snapshot, noteValues, noteText, status: "closed", startedAt: textValue(body.startedAt) || null, closedAt: now },
        sessions: returnedSessions.map((session) => ({ ...session, results: parseJson(session.results, []), transitions: parseJson(session.transitions, []) })),
        programs: recalculatedPrograms,
      }, { status: 201 });
    }

    if (action === "close_session") {
      if (!account.permissions.includes("sessions.record") && !account.permissions.includes("sessions.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite registrar sesiones." }, { status: 403 });
      const programId = textValue(body.programId);
      const [program] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, programId)).limit(1);
      if (!program || program.status !== "active") return Response.json({ error: "Selecciona un programa activo." }, { status: 400 });
      if (!canAccessProfile(account, { id: program.profileId || "", site: program.site })) return Response.json({ error: "No tienes acceso a este programa." }, { status: 403 });
      const targets = await db.select().from(interventionTargets).where(eq(interventionTargets.programId, programId)).orderBy(asc(interventionTargets.sortOrder));
      const targetMap = new Map(targets.map((target) => [target.id, target]));
      const rawResults = Array.isArray(body.results) ? body.results as Record<string, unknown>[] : [];
      const results: SessionResult[] = rawResults.flatMap((raw) => {
        const target = targetMap.get(textValue(raw.targetId));
        return target ? [sanitizeSessionResult(raw, target)] : [];
      });
      if (!results.some((result) => result.sampled && result.value !== null)) {
        return Response.json({ error: "Registra al menos un resultado antes de cerrar la sesión." }, { status: 400 });
      }

      const appointmentId = textValue(body.appointmentId);
      if (!canRecordScheduledSession(account, appointmentId ? account.id : null)) {
        return Response.json({ error: "Tu rol debe ingresar desde una sesión asignada en el calendario." }, { status: 403 });
      }
      const [appointment] = appointmentId
        ? await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, appointmentId)).limit(1)
        : [];
      if (appointmentId && (!appointment || appointment.status === "cancelled" || appointment.interventionSessionId)) {
        return Response.json({ error: "La sesión programada ya no está disponible para registrar datos." }, { status: 409 });
      }
      if (appointment && (appointment.profileId !== program.profileId || appointment.professionalAccountId !== account.id)) {
        return Response.json({ error: "La sesión programada no corresponde a este niño o profesional." }, { status: 403 });
      }
      if (appointment && !canRecordScheduledSession(account, appointment.professionalAccountId)) {
        return Response.json({ error: "La sesión está asignada a otro profesional." }, { status: 403 });
      }

      const sessionId = crypto.randomUUID();
      const sessionDate = appointment?.sessionDate || textValue(body.sessionDate) || new Date().toISOString().slice(0, 10);
      const context = textValue(body.context) || "Contexto no especificado";

      const [session] = await db.insert(interventionSessions).values({
        id: sessionId,
        programId,
        sessionDate,
        context,
        notes: textValue(body.notes),
        status: "closed",
        results: JSON.stringify(results),
        transitions: "[]",
        professionalAccountId: appointment?.professionalAccountId || account.id,
        closedAt: new Date().toISOString(),
      }).returning();
      const recalculated = await recalculateProgram(db, programId, { actorAccountId: account.id });
      if (appointment) {
        await db.update(sessionAppointments).set({ interventionSessionId: sessionId, status: "completed", updatedAt: new Date().toISOString() }).where(eq(sessionAppointments.id, appointment.id));
        await db.update(abcRecords).set({ sessionId, updatedAt: new Date().toISOString() }).where(eq(abcRecords.appointmentId, appointment.id));
      }
      const recalculatedSession = recalculated.sessions.find((item) => item.id === session.id);
      return Response.json({
        session: recalculatedSession || { ...session, results, transitions: [] },
        program: recalculated.program,
      }, { status: 201 });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["programs.manage", "sessions.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = textValue(body.action);
    const id = textValue(body.id);
    const db = await getDb();

    if (action === "update_session") {
      if (!account.permissions.includes("sessions.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite modificar sesiones." }, { status: 403 });
      const [current] = await db.select().from(interventionSessions).where(eq(interventionSessions.id, id)).limit(1);
      if (!current) return Response.json({ error: "No se encontró la sesión." }, { status: 404 });
      if (current.clinicalSessionRunId) return Response.json({ error: "Una sesión cerrada y firmada no se modifica por partes. Su evidencia clínica permanece inmutable." }, { status: 409 });
      const [currentProgram] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, current.programId)).limit(1);
      if (!currentProgram || !canAccessProfile(account, { id: currentProgram.profileId || "", site: currentProgram.site })) return Response.json({ error: "No tienes acceso a esta sesión." }, { status: 403 });
      const rawResults = Array.isArray(body.results) ? body.results as Record<string, unknown>[] : [];
      const targets = await db.select().from(interventionTargets).where(eq(interventionTargets.programId, current.programId));
      const targetMap = new Map(targets.map((target) => [target.id, target]));
      const results: SessionResult[] = rawResults.flatMap((raw) => {
        const target = targetMap.get(textValue(raw.targetId));
        return target ? [sanitizeSessionResult(raw, target)] : [];
      });
      if (!textValue(body.sessionDate) || !textValue(body.context) || !results.some((result) => result.sampled && result.value !== null)) {
        return Response.json({ error: "Fecha, contexto y al menos un resultado válido son obligatorios." }, { status: 400 });
      }
      const prospective = {
        ...current,
        sessionDate: current.clinicalSessionRunId ? current.sessionDate : textValue(body.sessionDate),
        context: current.clinicalSessionRunId ? current.context : textValue(body.context),
        notes: current.clinicalSessionRunId ? current.notes : textValue(body.notes),
        results: JSON.stringify(results),
        updatedAt: new Date().toISOString(),
      };
      const preview = await replayProgramFromRows(db, current.programId, { id, row: prospective });
      const currentMastery = await db.select().from(targetMasteryEvents).where(eq(targetMasteryEvents.programId, current.programId));
      const discrepancies = masteryDiscrepancies(currentMastery, preview.replay.masteryEvents);
      if (discrepancies.length && body.confirmMasteryRecalculation !== true) {
        return Response.json({
          error: "La edición cambiaría uno o más eventos históricos de dominio. Revisa y confirma el recálculo antes de guardar.",
          requiresMasteryRecalculation: true,
          discrepancies,
        }, { status: 409 });
      }
      await db.update(interventionSessions).set({
        sessionDate: prospective.sessionDate,
        context: prospective.context,
        notes: prospective.notes,
        results: prospective.results,
        updatedAt: prospective.updatedAt,
      }).where(eq(interventionSessions.id, id));
      await db.insert(clinicalDataAudit).values({
        id: crypto.randomUUID(),
        resourceType: "intervention_session",
        resourceId: id,
        action: discrepancies.length ? "update_with_mastery_recalculation" : "update",
        actorAccountId: account.id,
        reason: textValue(body.recalculationReason) || (discrepancies.length ? "Edición confirmada de datos históricos con impacto en dominio." : "Edición de sesión clínica."),
        beforeSnapshot: JSON.stringify({ sessionDate: current.sessionDate, context: current.context, notes: current.notes, results: parseJson(current.results, []) }),
        afterSnapshot: JSON.stringify({ sessionDate: prospective.sessionDate, context: prospective.context, notes: prospective.notes, results }),
      });
      const recalculated = await recalculateProgram(db, current.programId, {
        actorAccountId: account.id,
        invalidationReason: textValue(body.recalculationReason) || "Edición confirmada de datos históricos.",
      });
      return Response.json({ ...recalculated, sessionId: id });
    }

    if (!account.permissions.includes("programs.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite modificar programas." }, { status: 403 });
    const rawTargets = Array.isArray(body.targets) ? body.targets as Record<string, unknown>[] : [];
    if (!id || !textValue(body.name) || !textValue(body.objective) || !rawTargets.length) {
      return Response.json({ error: "Completa el programa y conserva al menos un target." }, { status: 400 });
    }
    const [current] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró el programa." }, { status: 404 });
    if (!canAccessProfile(account, { id: current.profileId || "", site: current.site })) return Response.json({ error: "No tienes acceso a este programa." }, { status: 403 });
    const profileId = textValue(body.profileId) || current.profileId || "";
    const [profile] = profileId
      ? await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1)
      : [];
    if (!profile || !(await isActiveSite(profile.site))) return Response.json({ error: "Selecciona un niño válido en una sede activa para el programa." }, { status: 400 });
    if (!canAccessProfile(account, profile)) return Response.json({ error: "No tienes acceso al niño seleccionado." }, { status: 403 });
    const existingTargets = await db.select().from(interventionTargets).where(eq(interventionTargets.programId, id));
    const activeMastery = await db.select().from(targetMasteryEvents)
      .where(and(eq(targetMasteryEvents.programId, id), eq(targetMasteryEvents.status, "active")));
    const criteriaChangedForMasteredTarget = rawTargets.some((raw) => {
      const existing = existingTargets.find((target) => target.id === textValue(raw.id));
      if (!existing || !activeMastery.some((event) => event.targetId === existing.id)) return false;
      const measurement = MEASUREMENTS.has(textValue(raw.measurement)) ? textValue(raw.measurement) : "percentage";
      return JSON.stringify(normalizeCriteria(existing.criteria, existing.measurement)) !== JSON.stringify(normalizeCriteria(raw.criteria, measurement));
    });
    if (criteriaChangedForMasteredTarget && body.confirmMasteryRecalculation !== true) {
      return Response.json({
        error: "Cambiar este criterio puede modificar el historial de dominio. Confirma el recálculo clínico para continuar.",
        requiresMasteryRecalculation: true,
      }, { status: 409 });
    }
    const submittedIds = new Set(rawTargets.map((target) => textValue(target.id)).filter(Boolean));
    const removed = existingTargets.filter((target) => !submittedIds.has(target.id));
    if (removed.length) {
      const sessions = await db.select().from(interventionSessions).where(eq(interventionSessions.programId, id));
      const used = new Set(sessions.flatMap((session) => parseJson<SessionResult[]>(session.results, []).map((result) => result.targetId)));
      if (removed.some((target) => used.has(target.id))) {
        return Response.json({ error: "No puedes eliminar un target que ya contiene datos de sesión." }, { status: 409 });
      }
      for (const target of removed) await db.delete(interventionTargets).where(eq(interventionTargets.id, target.id));
    }

    const [program] = await db.update(interventionPrograms).set({
      profileId: profile.id,
      linkedCycleId: textValue(body.linkedCycleId) || null,
      name: textValue(body.name),
      participantName: profile.fullName,
      site: profile.site,
      objective: textValue(body.objective),
      instructions: textValue(body.instructions),
      updatedAt: new Date().toISOString(),
    }).where(eq(interventionPrograms.id, id)).returning();

    for (const [index, raw] of rawTargets.entries()) {
      const targetId = textValue(raw.id);
      const measurement = MEASUREMENTS.has(textValue(raw.measurement)) ? textValue(raw.measurement) : "percentage";
      const values = {
        code: textValue(raw.code) || `T${String(index + 1).padStart(2, "0")}`,
        name: textValue(raw.name),
        specificObjective: textValue(raw.specificObjective),
        measurement,
        unitLabel: textValue(raw.unitLabel) || "%",
        criteria: JSON.stringify(normalizeCriteria(raw.criteria, measurement)),
        sessionConfig: JSON.stringify(normalizeSessionTargetConfig(raw.sessionConfig)),
        sortOrder: index,
        updatedAt: new Date().toISOString(),
      };
      const existing = existingTargets.find((target) => target.id === targetId);
      if (existing) await db.update(interventionTargets).set(values).where(eq(interventionTargets.id, targetId));
      else await db.insert(interventionTargets).values({ id: crypto.randomUUID(), programId: id, state: "baseline", ...values });
    }
    const targets = await db.select().from(interventionTargets).where(eq(interventionTargets.programId, id)).orderBy(asc(interventionTargets.sortOrder));
    const graphConfig = normalizeProgramGraphConfig(body.graphConfig, targets);
    const [configuredProgram] = await db.update(interventionPrograms).set({ graphConfig: JSON.stringify(graphConfig), updatedAt: new Date().toISOString() }).where(eq(interventionPrograms.id, id)).returning();
    if (criteriaChangedForMasteredTarget) {
      await db.insert(clinicalDataAudit).values({
        id: crypto.randomUUID(),
        resourceType: "intervention_program",
        resourceId: id,
        action: "criteria_update_with_mastery_recalculation",
        actorAccountId: account.id,
        reason: textValue(body.recalculationReason) || "Cambio confirmado de criterio estructurado.",
        beforeSnapshot: JSON.stringify(existingTargets.map((target) => ({ id: target.id, criteria: parseJson(target.criteria, {}) }))),
        afterSnapshot: JSON.stringify(rawTargets.map((target) => ({ id: textValue(target.id), criteria: target.criteria }))),
      });
    }
    const recalculated = await recalculateProgram(db, id, {
      actorAccountId: account.id,
      invalidationReason: textValue(body.recalculationReason) || "Cambio confirmado de criterio estructurado.",
    });
    return Response.json({ program: recalculated.program || serializeProgram(configuredProgram || program, targets) });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["programs.manage", "sessions.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = textValue(body.action);
    const id = textValue(body.id);
    if (!id) return Response.json({ error: "Falta el identificador." }, { status: 400 });
    const db = await getDb();

    if (action === "delete_program") {
      if (!account.permissions.includes("programs.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite eliminar programas." }, { status: 403 });
      const [program] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, id)).limit(1);
      if (!program) return Response.json({ error: "No se encontró el programa." }, { status: 404 });
      if (!canAccessProfile(account, { id: program.profileId || "", site: program.site })) return Response.json({ error: "No tienes acceso a este programa." }, { status: 403 });
      await db.delete(interventionPrograms).where(eq(interventionPrograms.id, id));
      return Response.json({ deleted: true, id, deletedSessions: true, deletedTargets: true });
    }

    if (action === "delete_session") {
      if (!account.permissions.includes("sessions.manage") && account.role !== "direccion_clinica") return Response.json({ error: "Tu rol no permite eliminar sesiones." }, { status: 403 });
      const [session] = await db.select().from(interventionSessions).where(eq(interventionSessions.id, id)).limit(1);
      if (!session) return Response.json({ error: "No se encontró la sesión." }, { status: 404 });
      if (session.clinicalSessionRunId) return Response.json({ error: "Una sesión cerrada y firmada no se puede eliminar. Su historial y evidencia clínica se conservan." }, { status: 409 });
      const [program] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, session.programId)).limit(1);
      if (!program || !canAccessProfile(account, { id: program.profileId || "", site: program.site })) return Response.json({ error: "No tienes acceso a esta sesión." }, { status: 403 });
      const preview = await replayProgramFromRows(db, session.programId, { id, row: null });
      const currentMastery = await db.select().from(targetMasteryEvents).where(eq(targetMasteryEvents.programId, session.programId));
      const discrepancies = masteryDiscrepancies(currentMastery, preview.replay.masteryEvents);
      if (discrepancies.length && body.confirmMasteryRecalculation !== true) {
        return Response.json({
          error: "Eliminar esta sesión cambiaría eventos históricos de dominio. Confirma el recálculo para continuar.",
          requiresMasteryRecalculation: true,
          discrepancies,
        }, { status: 409 });
      }
      const siblingSessions = session.clinicalSessionRunId
        ? await db.select({ id: interventionSessions.id }).from(interventionSessions).where(and(eq(interventionSessions.clinicalSessionRunId, session.clinicalSessionRunId), ne(interventionSessions.id, id)))
        : [];
      const replacementSessionId = siblingSessions[0]?.id || null;
      if (session.clinicalSessionRunId && replacementSessionId) {
        await db.update(sessionAppointments).set({ interventionSessionId: replacementSessionId, updatedAt: new Date().toISOString() }).where(eq(sessionAppointments.interventionSessionId, id));
        await db.update(abcRecords).set({ sessionId: replacementSessionId, updatedAt: new Date().toISOString() }).where(eq(abcRecords.sessionId, id));
      } else {
        await db.update(sessionAppointments).set({ clinicalSessionRunId: null, interventionSessionId: null, status: "scheduled", updatedAt: new Date().toISOString() }).where(eq(sessionAppointments.interventionSessionId, id));
        await db.update(abcRecords).set({ sessionId: null, updatedAt: new Date().toISOString() }).where(eq(abcRecords.sessionId, id));
      }
      await db.delete(interventionSessions).where(eq(interventionSessions.id, id));
      if (session.clinicalSessionRunId && !replacementSessionId) await db.delete(clinicalSessionRuns).where(eq(clinicalSessionRuns.id, session.clinicalSessionRunId));
      await db.insert(clinicalDataAudit).values({
        id: crypto.randomUUID(),
        resourceType: "intervention_session",
        resourceId: id,
        action: discrepancies.length ? "delete_with_mastery_recalculation" : "delete",
        actorAccountId: account.id,
        reason: textValue(body.recalculationReason) || "Eliminación confirmada de sesión clínica.",
        beforeSnapshot: JSON.stringify({ ...session, results: parseJson(session.results, []), transitions: parseJson(session.transitions, []) }),
        afterSnapshot: "{}",
      });
      const recalculated = await recalculateProgram(db, session.programId, {
        actorAccountId: account.id,
        invalidationReason: textValue(body.recalculationReason) || "Eliminación confirmada de sesión clínica.",
      });
      return Response.json({ deleted: true, id, ...recalculated });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
