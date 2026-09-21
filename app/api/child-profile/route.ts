import { asc, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  abcRecords,
  analyticGraphs,
  childDocuments,
  interventionPrograms,
  interventionSessions,
  interventionTargets,
  personnelProfiles,
  reports,
  sessionAppointments,
  trainingCycles,
} from "../../../db/schema";
import { apiAccountGuard, canAccessChild, hasPermission } from "../../../lib/access-control";
import { collectionDateTime, maintenanceProbeStatus, normalizeSessionTargetConfig } from "../../../lib/mobile-collection";
import { signedProfilePhotoMap } from "../../../lib/profile-photos";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

function parsed(value: string, fallback: unknown) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["children.view"] });
  if (denied || !account) return denied;
  try {
    const profileId = new URL(request.url).searchParams.get("profileId") || "";
    if (!profileId) return Response.json({ error: "Selecciona un niño." }, { status: 400 });
    const db = await getDb();
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
    if (!profile) return Response.json({ error: "No se encontró el niño." }, { status: 404 });
    if (!canAccessChild(account, profile)) return Response.json({ error: "Este niño no está dentro de tu alcance." }, { status: 403 });

    const capabilities = {
      evaluations: hasPermission(account, "evaluations.view") || hasPermission(account, "evaluations.manage"),
      programs: hasPermission(account, "programs.view") || hasPermission(account, "programs.manage"),
      sessions: hasPermission(account, "sessions.view") || hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage"),
      graphs: hasPermission(account, "graphs.view") || hasPermission(account, "graphs.manage"),
      reports: hasPermission(account, "reports.view") || hasPermission(account, "reports.manage"),
      abc: hasPermission(account, "abc.view") || hasPermission(account, "abc.record") || hasPermission(account, "abc.manage"),
      manageChild: hasPermission(account, "children.manage"),
    };

    const [evaluationRows, programRows, documentRows, reportRows, abcRows] = await Promise.all([
      capabilities.evaluations || capabilities.graphs
        ? db.select().from(trainingCycles).where(eq(trainingCycles.profileId, profileId)).orderBy(desc(trainingCycles.updatedAt))
        : Promise.resolve([]),
      capabilities.programs || capabilities.sessions
        ? db.select().from(interventionPrograms).where(eq(interventionPrograms.profileId, profileId)).orderBy(desc(interventionPrograms.updatedAt))
        : Promise.resolve([]),
      db.select({
        id: childDocuments.id,
        fileName: childDocuments.fileName,
        contentType: childDocuments.contentType,
        sizeBytes: childDocuments.sizeBytes,
        description: childDocuments.description,
        createdAt: childDocuments.createdAt,
      }).from(childDocuments).where(eq(childDocuments.profileId, profileId)).orderBy(desc(childDocuments.createdAt)),
      capabilities.reports
        ? db.select({ id: reports.id, title: reports.title, reportType: reports.reportType, status: reports.status, authorName: reports.authorName, finalizedAt: reports.finalizedAt, updatedAt: reports.updatedAt }).from(reports).where(eq(reports.profileId, profileId)).orderBy(desc(reports.updatedAt))
        : Promise.resolve([]),
      capabilities.abc
        ? db.select({ id: abcRecords.id, eventDate: abcRecords.eventDate, eventTime: abcRecords.eventTime, antecedentLabel: abcRecords.antecedentLabel, behaviorLabel: abcRecords.behaviorLabel, consequenceLabel: abcRecords.consequenceLabel, recordedByName: abcRecords.recordedByName }).from(abcRecords).where(eq(abcRecords.profileId, profileId)).orderBy(desc(abcRecords.eventDate), desc(abcRecords.eventTime)).limit(6)
        : Promise.resolve([]),
    ]);

    const programIds = programRows.map((program) => program.id);
    const evaluationIds = evaluationRows.map((evaluation) => evaluation.id);
    const [targetRows, sessionRows, graphRows] = await Promise.all([
      capabilities.programs && programIds.length
        ? db.select().from(interventionTargets).where(inArray(interventionTargets.programId, programIds)).orderBy(asc(interventionTargets.sortOrder))
        : Promise.resolve([]),
      capabilities.sessions && programIds.length
        ? db.select().from(interventionSessions).where(inArray(interventionSessions.programId, programIds)).orderBy(desc(interventionSessions.sessionDate), desc(interventionSessions.createdAt))
        : Promise.resolve([]),
      capabilities.graphs
        ? db.select().from(analyticGraphs).where(or(
          eq(analyticGraphs.profileId, profileId),
          evaluationIds.length ? inArray(analyticGraphs.linkedCycleId, evaluationIds) : undefined,
          programIds.length ? inArray(analyticGraphs.linkedProgramId, programIds) : undefined,
        )).orderBy(desc(analyticGraphs.updatedAt))
        : Promise.resolve([]),
    ]);
    const appointmentRows = capabilities.sessions && sessionRows.length
      ? await db.select().from(sessionAppointments).where(inArray(sessionAppointments.interventionSessionId, sessionRows.map((session) => session.id)))
      : [];
    const professionalIds = [...new Set(sessionRows.flatMap((session) => session.professionalAccountId ? [session.professionalAccountId] : []))];
    const supabase = await createSupabaseServerClient();
    const { data: professionalRows } = professionalIds.length
      ? await supabase.from("app_accounts").select("id,display_name").in("id", professionalIds)
      : { data: [] };
    const professionalMap = new Map((professionalRows || []).map((professional) => [String(professional.id), String(professional.display_name)]));
    const photoUrls = await signedProfilePhotoMap(supabase, "child", [profileId]);
    const lastSampledDateByTarget = new Map<string, string>();
    for (const session of sessionRows) {
      const results = parsed(session.results, []) as Array<{ targetId?: unknown; sampled?: unknown }>;
      for (const result of results) {
        const targetId = typeof result.targetId === "string" ? result.targetId : "";
        if (!targetId || result.sampled === false || lastSampledDateByTarget.has(targetId)) continue;
        lastSampledDateByTarget.set(targetId, session.sessionDate);
      }
    }
    const today = collectionDateTime(new Date()).date;

    return Response.json({
      profile: {
        ...profile,
        role: "Niño",
        customFields: parsed(profile.customFields, []),
        photoUrl: photoUrls.get(profileId) || null,
      },
      evaluations: capabilities.evaluations ? evaluationRows.map((evaluation) => ({
        id: evaluation.id,
        programContext: evaluation.programContext,
        cycleLabel: evaluation.cycleLabel,
        instrumentVersion: evaluation.instrumentVersion,
        routeType: evaluation.routeType,
        status: evaluation.status,
        archivedAt: evaluation.archivedAt,
        createdAt: evaluation.createdAt,
        updatedAt: evaluation.updatedAt,
      })) : [],
      programs: capabilities.programs ? programRows.map((program) => ({
        ...program,
        graphConfig: parsed(program.graphConfig, {}),
        targets: targetRows.filter((target) => target.programId === program.id).map((target) => {
          const sessionConfig = normalizeSessionTargetConfig(target.sessionConfig);
          const lastSampledDate = lastSampledDateByTarget.get(target.id) || null;
          const maintenance = capabilities.sessions
            ? maintenanceProbeStatus(target.state, lastSampledDate, sessionConfig.maintenanceProbeEveryDays, today)
            : null;
          return {
            ...target,
            criteria: parsed(target.criteria, {}),
            sessionConfig,
            lastSampledDate,
            maintenanceDue: maintenance?.due,
            maintenanceDueDate: maintenance?.dueDate,
          };
        }),
      })) : [],
      sessions: sessionRows.map((session) => ({
        ...session,
        programName: programRows.find((program) => program.id === session.programId)?.name || "Programa",
        professionalName: session.professionalAccountId ? professionalMap.get(session.professionalAccountId) || "Profesional no disponible" : "Sin profesional registrado",
        durationMinutes: (() => { const appointment = appointmentRows.find((item) => item.interventionSessionId === session.id); if (!appointment) return null; const [sh, sm] = appointment.startTime.split(":").map(Number); const [eh, em] = appointment.endTime.split(":").map(Number); return Math.max(0, eh * 60 + em - sh * 60 - sm); })(),
        results: parsed(session.results, []),
        transitions: parsed(session.transitions, []),
      })),
      graphs: graphRows.map((graph) => ({
        id: graph.id,
        title: graph.title,
        objective: graph.objective,
        graphType: graph.graphType,
        designType: graph.designType,
        measurement: graph.measurement,
        status: graph.status,
        profileId: graph.profileId,
        linkedProgramId: graph.linkedProgramId,
        programName: programRows.find((program) => program.id === graph.linkedProgramId)?.name || "",
        linkedCycleId: graph.linkedCycleId,
        updatedAt: graph.updatedAt,
        pointCount: Array.isArray(parsed(graph.points, [])) ? (parsed(graph.points, []) as unknown[]).length : 0,
      })),
      reports: reportRows,
      abcRecords: abcRows,
      documents: documentRows,
      capabilities,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar el expediente." }, { status: 500 });
  }
}
