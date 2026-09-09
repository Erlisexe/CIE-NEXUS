import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  interventionPrograms,
  interventionSessions,
  interventionTargets,
  personnelProfiles,
  sessionNoteTemplates,
  targetMasteryEvents,
} from "../../../../../../db/schema";
import { hasPermission } from "../../../../../../lib/access-control";
import { buildCumulativeMasteryTimeline, normalizeCriteria, normalizeTargetState } from "../../../../../../lib/clinical-mastery";
import { mobileApiGuard, mobileData, mobileError } from "../../../../../../lib/mobile-api";
import { mobileProfileScope } from "../../../../../../lib/mobile-data";
import { DEFAULT_SESSION_NOTE_TEMPLATE, sanitizeSessionNoteFields } from "../../../../../../lib/session-note-templates";

function parsed<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function requestedProfileId(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] || "").slice(0, 100);
}

function serializeTemplate(row: typeof sessionNoteTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: sanitizeSessionNoteFields(parsed(row.fields, [])),
    builtIn: row.builtIn,
  };
}

export async function GET(request: Request) {
  const { account, denied } = await mobileApiGuard(request, { permissions: ["children.view"] });
  if (denied || !account) return denied;
  try {
    const profileId = requestedProfileId(request);
    if (!profileId) return mobileError("profile_required", "Selecciona un niño.", 400);
    const db = await getDb();
    const allowedIds = await mobileProfileScope(db, account);
    if (!allowedIds.has(profileId)) {
      return mobileError("profile_out_of_scope", "El niño no está asignado a este profesional ni a una de sus sesiones.", 403);
    }
    const [profile] = await db.select().from(personnelProfiles)
      .where(and(eq(personnelProfiles.id, profileId), eq(personnelProfiles.status, "active")))
      .limit(1);
    if (!profile) return mobileError("profile_not_found", "No se encontró un perfil activo para el niño.", 404);

    const canViewPrograms = hasPermission(account, "programs.view")
      || hasPermission(account, "programs.manage")
      || hasPermission(account, "sessions.record");
    const canViewSessions = hasPermission(account, "sessions.view")
      || hasPermission(account, "sessions.record")
      || hasPermission(account, "sessions.manage");
    const canViewGraphs = hasPermission(account, "graphs.view") || hasPermission(account, "graphs.manage");
    const canRecordSessions = hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage");

    const programs = canViewPrograms
      ? await db.select().from(interventionPrograms)
        .where(and(eq(interventionPrograms.profileId, profileId), eq(interventionPrograms.status, "active")))
        .orderBy(asc(interventionPrograms.name))
      : [];
    const programIds = programs.map((program) => program.id);
    const [targets, sessions, masteryEvents, storedTemplates] = await Promise.all([
      programIds.length
        ? db.select().from(interventionTargets).where(inArray(interventionTargets.programId, programIds)).orderBy(asc(interventionTargets.sortOrder))
        : Promise.resolve([]),
      canViewSessions && programIds.length
        ? db.select().from(interventionSessions).where(inArray(interventionSessions.programId, programIds))
          .orderBy(desc(interventionSessions.sessionDate), desc(interventionSessions.createdAt)).limit(300)
        : Promise.resolve([]),
      canViewGraphs && programIds.length
        ? db.select().from(targetMasteryEvents)
          .where(and(inArray(targetMasteryEvents.programId, programIds), eq(targetMasteryEvents.status, "active")))
          .orderBy(asc(targetMasteryEvents.masteredAt))
        : Promise.resolve([]),
      canRecordSessions
        ? db.select().from(sessionNoteTemplates).where(eq(sessionNoteTemplates.status, "active")).orderBy(desc(sessionNoteTemplates.builtIn), asc(sessionNoteTemplates.name))
        : Promise.resolve([]),
    ]);

    const parsedSessions = sessions.map((session) => ({
      id: session.id,
      clinicalSessionRunId: session.clinicalSessionRunId,
      programId: session.programId,
      sessionDate: session.sessionDate,
      context: session.context,
      status: session.status,
      createdAt: session.createdAt,
      results: parsed<Array<Record<string, unknown>>>(session.results, []),
    }));
    const templates = storedTemplates.map(serializeTemplate);
    if (canRecordSessions && !templates.some((template) => template.id === DEFAULT_SESSION_NOTE_TEMPLATE.id)) {
      templates.unshift({
        id: DEFAULT_SESSION_NOTE_TEMPLATE.id,
        name: DEFAULT_SESSION_NOTE_TEMPLATE.name,
        description: DEFAULT_SESSION_NOTE_TEMPLATE.description,
        fields: [...DEFAULT_SESSION_NOTE_TEMPLATE.fields],
        builtIn: true,
      });
    }

    return mobileData({
      profile: {
        id: profile.id,
        fullName: profile.fullName,
        internalCode: profile.internalCode,
        site: profile.site,
        dateOfBirth: profile.dateOfBirth,
        diagnosis: profile.diagnosis,
        address: profile.address,
        phone: profile.phone,
        guardianName: profile.guardianName,
        guardianPhone: profile.guardianPhone,
        preferredLanguage: profile.preferredLanguage,
        emergencyContact: profile.emergencyContact,
        customFields: parsed(profile.customFields, []),
        notes: profile.notes,
      },
      programs: programs.map((program) => {
        const programTargets = targets.filter((target) => target.programId === program.id);
        const programSessions = parsedSessions.filter((session) => session.programId === program.id && session.status === "closed");
        const events = masteryEvents.filter((event) => event.programId === program.id);
        return {
          id: program.id,
          name: program.name,
          objective: program.objective,
          instructions: program.instructions,
          graphConfig: parsed(program.graphConfig, {}),
          targets: programTargets.map((target) => ({
            id: target.id,
            code: target.code,
            name: target.name,
            specificObjective: target.specificObjective,
            measurement: target.measurement,
            unitLabel: target.unitLabel,
            state: normalizeTargetState(target.state),
            criteria: normalizeCriteria(target.criteria, target.measurement),
            masteryAchieved: target.masteryAchieved,
            masteredAt: target.masteredAt,
            masteryMethod: target.masteryMethod,
          })),
          cumulativeMastery: canViewGraphs
            ? buildCumulativeMasteryTimeline(events, programSessions)
            : [],
          recentPerformance: canViewGraphs
            ? programSessions.slice(0, 30).reverse().flatMap((session) => session.results.flatMap((result) => {
              const targetId = typeof result.targetId === "string" ? result.targetId : "";
              const value = typeof result.value === "number" ? result.value : null;
              return targetId && value !== null && Number.isFinite(value)
                ? [{ sessionId: session.id, sessionDate: session.sessionDate, targetId, value }]
                : [];
            }))
            : [],
        };
      }),
      recentSessions: canViewSessions ? parsedSessions.slice(0, 50) : [],
      sessionNoteTemplates: templates,
    });
  } catch {
    return mobileError("profile_unavailable", "No se pudo cargar el expediente móvil del niño.", 500);
  }
}
