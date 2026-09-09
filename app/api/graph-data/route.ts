import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  abcRecords,
  clinicalSessionRuns,
  interventionPrograms,
  interventionSessions,
  interventionTargets,
  personnelProfiles,
  targetMasteryEvents,
} from "../../../db/schema";
import { apiAccountGuard, canAccessProfile, hasPermission } from "../../../lib/access-control";
import { normalizeCriteria, normalizeTargetState, normalizeTrials } from "../../../lib/clinical-mastery";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { PROMPT_LEVELS, normalizeTrialDetails } from "../../../lib/trial-data";
import { canViewRawClinicalDetail } from "../../../lib/clinical-data-privacy";

function parsed<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function clean(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function activeMobileObservations(snapshot: Record<string, unknown>, targetId: string) {
  const captures = snapshot.captures && typeof snapshot.captures === "object"
    ? snapshot.captures as Record<string, unknown>
    : {};
  const capture = captures[targetId] && typeof captures[targetId] === "object"
    ? captures[targetId] as Record<string, unknown>
    : null;
  if (!capture || !Array.isArray(capture.observations)) return [];
  return capture.observations.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (item.removedAt || (item.value !== 0 && item.value !== 1)) return [];
    return [{
      value: item.value as 0 | 1,
      ...(typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) ? { at: item.at } : {}),
      ...(typeof item.promptLevel === "string" && PROMPT_LEVELS.some((level) => level.id === item.promptLevel) ? { promptLevel: item.promptLevel } : {}),
    }];
  });
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["graphs.view"] });
  if (denied || !account) return denied;
  try {
    const profileId = clean(new URL(request.url).searchParams.get("profileId"));
    if (!profileId) return Response.json({ error: "Selecciona un niño para construir la gráfica." }, { status: 400 });
    const db = await getDb();
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
    if (!profile) return Response.json({ error: "No se encontró el niño seleccionado." }, { status: 404 });
    if (!canAccessProfile(account, profile)) return Response.json({ error: "No tienes acceso al expediente seleccionado." }, { status: 403 });

    const canViewSessions = hasPermission(account, "sessions.view") || hasPermission(account, "sessions.manage") || hasPermission(account, "sessions.record");
    const canViewAbc = hasPermission(account, "abc.view") || hasPermission(account, "abc.manage");
    const canCompareTherapists = account.role !== "terapeuta";
    const programs = await db.select().from(interventionPrograms)
      .where(eq(interventionPrograms.profileId, profileId))
      .orderBy(asc(interventionPrograms.name));
    const programIds = programs.map((program) => program.id);
    const [targets, sessionRows, masteryRows, abcRows] = await Promise.all([
      programIds.length
        ? db.select().from(interventionTargets).where(inArray(interventionTargets.programId, programIds)).orderBy(asc(interventionTargets.sortOrder))
        : Promise.resolve([]),
      canViewSessions && programIds.length
        ? db.select().from(interventionSessions).where(and(inArray(interventionSessions.programId, programIds), eq(interventionSessions.status, "closed")))
          .orderBy(asc(interventionSessions.sessionDate), asc(interventionSessions.createdAt)).limit(10000)
        : Promise.resolve([]),
      programIds.length
        ? db.select().from(targetMasteryEvents).where(and(inArray(targetMasteryEvents.programId, programIds), eq(targetMasteryEvents.status, "active")))
          .orderBy(asc(targetMasteryEvents.masteredAt))
        : Promise.resolve([]),
      canViewAbc
        ? db.select().from(abcRecords).where(eq(abcRecords.profileId, profileId))
          .orderBy(asc(abcRecords.eventDate), asc(abcRecords.eventTime), asc(abcRecords.createdAt)).limit(10000)
        : Promise.resolve([]),
    ]);
    const runIds = [...new Set(sessionRows.flatMap((session) => session.clinicalSessionRunId ? [session.clinicalSessionRunId] : []))];
    const runs = runIds.length
      ? await db.select().from(clinicalSessionRuns).where(inArray(clinicalSessionRuns.id, runIds))
      : [];
    const runMap = new Map(runs.map((run) => [run.id, run]));
    const sessionMap = new Map(sessionRows.map((session) => [session.id, session]));
    const accountIds = [...new Set([
      ...sessionRows.flatMap((session) => session.professionalAccountId ? [session.professionalAccountId] : []),
      ...abcRows.flatMap((record) => record.recordedByAccountId ? [record.recordedByAccountId] : []),
    ])];
    const supabase = await createSupabaseServerClient();
    const { data: professionalRows } = accountIds.length
      ? await supabase.from("app_accounts").select("id,display_name,role").in("id", accountIds)
      : { data: [] };
    const professionalMap = new Map((professionalRows || []).map((row) => [String(row.id), { name: String(row.display_name), role: String(row.role) }]));
    const visibleProfessional = (id: string | null) => {
      const own = id === account.id;
      if (!canCompareTherapists && !own) return { id: "clinical-team", name: "Equipo clínico", own: false };
      return { id: id || "unassigned", name: own ? "Mis sesiones" : professionalMap.get(id || "")?.name || "Profesional histórico", own };
    };

    const sessions = sessionRows.map((session) => {
      const professional = visibleProfessional(session.professionalAccountId);
      const rawDetailAvailable = canViewRawClinicalDetail(account, session.professionalAccountId);
      const run = session.clinicalSessionRunId ? runMap.get(session.clinicalSessionRunId) : null;
      const snapshot = parsed<Record<string, unknown>>(run?.collectionSnapshot, {});
      return {
        id: session.id,
        clinicalSessionRunId: session.clinicalSessionRunId,
        programId: session.programId,
        sessionDate: session.sessionDate,
        createdAt: session.createdAt,
        professionalAccountId: professional.id,
        professionalName: professional.name,
        rawDetailAvailable,
        context: rawDetailAvailable ? session.context : "",
        notes: rawDetailAvailable ? session.notes : "",
        durationSeconds: run && run.durationSeconds > 0 ? run.durationSeconds : null,
        documentedDuration: Boolean(run && run.durationSeconds > 0 && run.startedAt && run.closedAt),
        abcObservationDocumented: Boolean(run && run.source === "mobile" && Array.isArray(snapshot.abc) && run.durationSeconds > 0),
        transitions: parsed<Array<Record<string, unknown>>>(session.transitions, []).map((transition) => ({
          targetId: clean(transition.targetId),
          from: normalizeTargetState(transition.from),
          to: normalizeTargetState(transition.to),
          reason: rawDetailAvailable ? clean(transition.reason, 1000) : "",
        })),
        results: parsed<Array<Record<string, unknown>>>(session.results, []).map((result) => {
          const trials = normalizeTrials(result.trials);
          const storedDetails = normalizeTrialDetails(result.trialDetails, trials);
          const mobileDetails = rawDetailAvailable && !storedDetails.length ? activeMobileObservations(snapshot, clean(result.targetId)) : [];
          return {
            targetId: clean(result.targetId),
            sampled: result.sampled !== false,
            value: typeof result.value === "number" && Number.isFinite(result.value) ? result.value : null,
            correct: typeof result.correct === "number" && Number.isFinite(result.correct) ? result.correct : null,
            opportunities: Math.max(0, Math.round(Number(result.opportunities) || 0)),
            trials: rawDetailAvailable ? trials : [],
            trialDetails: rawDetailAvailable ? (storedDetails.length ? storedDetails : mobileDetails) : [],
            note: rawDetailAvailable ? clean(result.note, 2000) : "",
            stateAtSession: normalizeTargetState(result.stateAtSession),
            criterionStatus: ["met", "not_met", "insufficient_sample", "not_evaluated"].includes(String(result.criterionStatus)) ? result.criterionStatus : "not_evaluated",
            criterionReason: rawDetailAvailable ? clean(result.criterionReason, 1000) : "",
            criterionSnapshot: result.criterionSnapshot && typeof result.criterionSnapshot === "object" ? result.criterionSnapshot : null,
          };
        }),
      };
    });

    const rawAbc = abcRows.map((record) => {
      const professional = visibleProfessional(record.recordedByAccountId);
      const rawDetailAvailable = canViewRawClinicalDetail(account, record.recordedByAccountId);
      const linkedSession = record.sessionId ? sessionMap.get(record.sessionId) : null;
      const run = linkedSession?.clinicalSessionRunId ? runMap.get(linkedSession.clinicalSessionRunId) : null;
      return {
        id: record.id,
        eventDate: record.eventDate,
        eventTime: rawDetailAvailable ? record.eventTime : "",
        programId: record.programId,
        targetId: record.targetId,
        sessionId: rawDetailAvailable ? record.sessionId : null,
        sessionKey: linkedSession?.clinicalSessionRunId || record.sessionId || null,
        professionalAccountId: professional.id,
        professionalName: professional.name,
        count: 1,
        rawDetailAvailable,
        behaviorLabel: rawDetailAvailable ? record.behaviorLabel : "Incidente ABC",
        details: rawDetailAvailable
          ? [record.antecedentLabel, record.behaviorDescription, record.consequenceLabel, record.additionalObservation].filter(Boolean).join(" · ")
          : "Detalle clínico restringido; incluido únicamente en el progreso agregado.",
        observationSeconds: run && run.durationSeconds > 0 ? run.durationSeconds : null,
        documentedDuration: Boolean(run && run.durationSeconds > 0 && run.startedAt && run.closedAt),
      };
    });
    const abc = canCompareTherapists ? rawAbc : [...rawAbc.reduce((groups, record) => {
      if (record.rawDetailAvailable) {
        groups.set(`own:${record.id}`, record);
        return groups;
      }
      const key = [record.eventDate, record.sessionKey || "", record.programId || "", record.targetId || "", record.professionalAccountId].join("|");
      const current = groups.get(key);
      groups.set(key, current ? { ...current, id: `aggregate:${key}`, count: current.count + 1 } : { ...record, id: `aggregate:${key}` });
      return groups;
    }, new Map<string, typeof rawAbc[number]>()).values()];

    return Response.json({
      profile: { id: profile.id, fullName: profile.fullName, site: profile.site },
      programs: programs.map((program) => ({
        id: program.id,
        name: program.name,
        status: program.status,
        targets: targets.filter((target) => target.programId === program.id).map((target) => ({
          id: target.id,
          programId: target.programId,
          code: target.code,
          name: target.name,
          measurement: target.measurement,
          unitLabel: target.unitLabel,
          state: normalizeTargetState(target.state),
          criteria: normalizeCriteria(target.criteria, target.measurement),
        })),
        masteryEvents: masteryRows.filter((event) => event.programId === program.id).map((event) => ({
          id: event.id,
          targetId: event.targetId,
          programId: event.programId,
          sessionId: event.sessionId,
          masteredAt: event.masteredAt,
          masteryMethod: event.masteryMethod,
        })),
      })),
      sessions,
      abc,
      professionals: [...new Map<string, { id: string; name: string }>([
        ...sessions.map((session): [string, { id: string; name: string }] => [session.professionalAccountId, { id: session.professionalAccountId, name: session.professionalName }]),
        ...abc.map((record): [string, { id: string; name: string }] => [record.professionalAccountId, { id: record.professionalAccountId, name: record.professionalName }]),
      ]).values()],
      capabilities: {
        canCompareTherapists,
        canViewSessionSource: canViewSessions,
        canViewTrialSource: canViewSessions,
        canViewAbcSource: canViewAbc,
        privacyMode: account.role === "terapeuta" ? "assigned_child_aggregate_own_raw" : "scope_full",
      },
      warnings: [
        ...(sessionRows.length === 10000 ? ["La consulta alcanzó el límite de 10 000 sesiones; reduce el período antes de interpretar la gráfica."] : []),
        ...(abcRows.length === 10000 ? ["La consulta alcanzó el límite de 10 000 incidentes ABC; reduce el período antes de interpretar la gráfica."] : []),
      ],
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudieron preparar los datos de la gráfica." }, { status: 500 });
  }
}
