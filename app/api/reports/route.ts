import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  analyticGraphs,
  interventionPrograms,
  interventionSessions,
  interventionTargets,
  personnelProfiles,
  reports,
  reportTemplates,
  targetMasteryEvents,
  trainingCycles,
} from "../../../db/schema";
import { apiAccountGuard, canAccessChild, hasPermission, visibleProfileIds, type AppAccount } from "../../../lib/access-control";
import { normalizeGraph } from "../../../lib/graph-types";
import { aggregateOnlySessionResult, canViewRawClinicalDetail, redactGraphPointForViewer } from "../../../lib/clinical-data-privacy";
import { buildSessionGraph, type ClinicalMeasurement, type ClinicalSession, type ClinicalTargetState } from "../../../lib/automatic-graphs";
import { signedProfilePhotoMap } from "../../../lib/profile-photos";
import {
  BUILT_IN_REPORT_TEMPLATES,
  type ReportBlock,
  type ReportProfileSnapshot,
  type ReportSource,
} from "../../../lib/report-types";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

function textValue(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parsed<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function serializedBlocks(value: unknown) {
  if (!Array.isArray(value)) throw new Error("La estructura del informe no es válida.");
  const blocks = value.slice(0, 80) as ReportBlock[];
  const serialized = JSON.stringify(blocks);
  if (serialized.length > 1_750_000) throw new Error("El informe contiene demasiada información para guardarse.");
  return serialized;
}

function serializedTemplateBlocks(value: unknown) {
  if (!Array.isArray(value)) throw new Error("La estructura de la plantilla no es válida.");
  return serializedBlocks(value.filter((block) => {
    if (!block || typeof block !== "object" || !("type" in block)) return false;
    return block.type !== "graph" && block.type !== "table";
  }));
}

function sourceSelection(value: unknown) {
  return JSON.stringify(Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 180)))].slice(0, 200)
    : []);
}

function formatDate(value: string) {
  if (!value) return "No registrada";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" });
}

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
  return message.includes("no such table")
    ? "El almacenamiento del módulo Informes todavía no está preparado."
    : message;
}

async function ensureBuiltInTemplates(db: Awaited<ReturnType<typeof getDb>>) {
  const existing = await db.select({ id: reportTemplates.id }).from(reportTemplates)
    .where(inArray(reportTemplates.id, BUILT_IN_REPORT_TEMPLATES.map((template) => template.id)));
  const existingIds = new Set(existing.map((item) => item.id));
  const missing = BUILT_IN_REPORT_TEMPLATES.filter((template) => !existingIds.has(template.id));
  if (!missing.length) return;
  await db.insert(reportTemplates).values(missing.map((template) => ({
    ...template,
    blocks: JSON.stringify(template.blocks),
    builtIn: true,
    createdByAccountId: null,
  }))).onConflictDoNothing();
}

async function profileSnapshot(
  account: AppAccount,
  profileId: string,
  photoUrl: string | null = null,
): Promise<ReportProfileSnapshot> {
  const db = await getDb();
  const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
  if (!profile) throw new Error("No se encontró el niño seleccionado.");
  if (!canAccessChild(account, profile)) throw new Error("Este niño no está dentro de tu alcance.");

  const supabase = await createSupabaseServerClient();
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("account_assignments")
    .select("account_id")
    .eq("profile_id", profileId);
  if (assignmentError) throw new Error(assignmentError.message);
  const accountIds = (assignmentRows || []).map((item) => String(item.account_id));
  const { data: accountRows, error: accountError } = accountIds.length
    ? await supabase.from("app_accounts").select("id,display_name,role,status").in("id", accountIds).neq("status", "suspended")
    : { data: [], error: null };
  if (accountError) throw new Error(accountError.message);
  const names = (accountRows || []) as Array<{ display_name: string; role: string }>;
  const namesFor = (role: string) => names.filter((item) => item.role === role).map((item) => item.display_name).join(", ");

  return {
    id: profile.id,
    fullName: profile.fullName,
    photoUrl,
    internalCode: profile.internalCode,
    dateOfBirth: profile.dateOfBirth,
    diagnosis: profile.diagnosis,
    site: profile.site,
    address: profile.address,
    phone: profile.phone,
    guardianName: profile.guardianName,
    guardianPhone: profile.guardianPhone,
    preferredLanguage: profile.preferredLanguage,
    responsibles: {
      coordinador: namesFor("coordinador"),
      supervisor: namesFor("supervisor"),
      subdirector: namesFor("subdirector"),
      terapeuta: namesFor("terapeuta"),
    },
    customFields: parsed<Array<{ label: string; value: string }>>(profile.customFields, []).map((item) => ({
      label: textValue(item.label, 100),
      value: textValue(item.value, 500),
    })).filter((item) => item.label),
  };
}

function serializeTemplate(template: typeof reportTemplates.$inferSelect) {
  return { ...template, blocks: parsed<ReportBlock[]>(template.blocks, []) };
}

function redactReportBlocks(blocks: ReportBlock[], account: AppAccount) {
  if (account.role !== "terapeuta") return blocks;
  return blocks.map((block) => {
    if (block.type === "graph") return { ...block, graph: { ...block.graph, points: block.graph.points.map((point) => redactGraphPointForViewer(point, account) as typeof point) } };
    if (block.type !== "table" || !block.sourceId.startsWith("sessions:")) return block;
    const hiddenColumns = new Set(block.data.columns.flatMap((column, index) => ["Contexto", "Notas"].includes(column) ? [index] : []));
    return { ...block, data: { ...block.data, rows: block.data.rows.map((row) => row.map((value, index) => hiddenColumns.has(index) ? "Detalle restringido" : value)) } };
  });
}

function serializeReport(
  report: typeof reports.$inferSelect,
  profileName: string,
  photoUrl: string | null = null,
  account?: AppAccount,
) {
  const snapshot = parsed<ReportProfileSnapshot>(report.profileSnapshot, {} as ReportProfileSnapshot);
  const blocks = parsed<ReportBlock[]>(report.blocks, []);
  return {
    ...report,
    profileName,
    blocks: account ? redactReportBlocks(blocks, account) : blocks,
    profileSnapshot: { ...snapshot, photoUrl },
    sourceSelection: parsed<string[]>(report.sourceSelection, []),
  };
}

function evaluationSource(row: typeof trainingCycles.$inferSelect): ReportSource {
  const initial = parsed<Record<string, Record<string, unknown>>>(row.initialScores, {});
  const reevaluation = parsed<Record<string, Record<string, unknown>>>(row.reevaluationScores, {});
  const recorded = (scores: Record<string, Record<string, unknown>>) => Object.values(scores).filter((score) => Object.values(score || {}).some((value) => value !== "" && value !== null && value !== undefined)).length;
  return {
    id: `evaluation:${row.id}`,
    kind: "evaluation",
    title: row.programContext,
    detail: `${row.cycleLabel} · ${row.instrumentVersion}`,
    table: {
      columns: ["Evaluación", "Versión", "Ruta", "Estado", "Registros iniciales", "Registros de reevaluación", "Actualización"],
      rows: [[row.cycleLabel, row.instrumentVersion, row.routeType, row.archivedAt ? "Archivada" : row.status, recorded(initial), recorded(reevaluation), formatDate(row.updatedAt)]],
    },
  };
}

function programSource(program: typeof interventionPrograms.$inferSelect, targets: typeof interventionTargets.$inferSelect[]): ReportSource {
  const rows = targets.filter((target) => target.programId === program.id);
  return {
    id: `program:${program.id}`,
    kind: "program",
    title: program.name,
    detail: `${rows.length} objetivo${rows.length === 1 ? "" : "s"} · ${program.status}`,
    table: {
      columns: ["Código", "Objetivo específico", "Medición", "Estado"],
      rows: rows.map((target) => [target.code, target.name, target.measurement, target.state]),
    },
  };
}

function sessionSource(account: AppAccount, program: typeof interventionPrograms.$inferSelect, rows: typeof interventionSessions.$inferSelect[]): ReportSource {
  const sessions = rows.filter((session) => session.programId === program.id).slice(0, 10);
  return {
    id: `sessions:${program.id}`,
    kind: "sessions",
    title: `Últimas sesiones · ${program.name}`,
    detail: `${sessions.length} sesión${sessions.length === 1 ? "" : "es"} disponible${sessions.length === 1 ? "" : "s"}`,
    table: {
      columns: ["Fecha", "Contexto", "Estado", "Notas", "Resultados registrados"],
      rows: sessions.map((session) => {
        const rawDetailAvailable = canViewRawClinicalDetail(account, session.professionalAccountId);
        return [
        formatDate(session.sessionDate),
        rawDetailAvailable ? session.context || "No especificado" : "Detalle restringido",
        session.status,
        rawDetailAvailable ? session.notes || "" : "Detalle restringido",
        parsed<unknown[]>(session.results, []).filter((result) => result && typeof result === "object" && (result as Record<string, unknown>).sampled !== false).length,
      ];
      }),
    },
  };
}

async function reportSources(account: AppAccount, profileId: string) {
  const supabase = await createSupabaseServerClient();
  const photos = await signedProfilePhotoMap(supabase, "child", [profileId]);
  const profile = await profileSnapshot(account, profileId, photos.get(profileId) || null);
  const db = await getDb();
  const canEvaluations = hasPermission(account, "evaluations.view") || hasPermission(account, "evaluations.manage");
  const canPrograms = hasPermission(account, "programs.view") || hasPermission(account, "programs.manage");
  const canSessions = hasPermission(account, "sessions.view") || hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage");
  const canGraphs = hasPermission(account, "graphs.view") || hasPermission(account, "graphs.manage");
  const [evaluationRows, programRows] = await Promise.all([
    canEvaluations || canGraphs
      ? db.select().from(trainingCycles).where(eq(trainingCycles.profileId, profileId)).orderBy(desc(trainingCycles.updatedAt))
      : Promise.resolve([]),
    canPrograms || canSessions
      ? db.select().from(interventionPrograms).where(eq(interventionPrograms.profileId, profileId)).orderBy(desc(interventionPrograms.updatedAt))
      : Promise.resolve([]),
  ]);
  const evaluationIds = evaluationRows.map((item) => item.id);
  const programIds = programRows.map((item) => item.id);
  const [targetRows, sessionRows, graphRows, masteryRows] = await Promise.all([
    (canPrograms || canGraphs) && programIds.length
      ? db.select().from(interventionTargets).where(inArray(interventionTargets.programId, programIds)).orderBy(asc(interventionTargets.sortOrder))
      : Promise.resolve([]),
    (canSessions || canGraphs) && programIds.length
      ? db.select().from(interventionSessions).where(inArray(interventionSessions.programId, programIds)).orderBy(desc(interventionSessions.sessionDate), desc(interventionSessions.createdAt))
      : Promise.resolve([]),
    canGraphs
      ? db.select().from(analyticGraphs).where(or(
        eq(analyticGraphs.profileId, profileId),
        evaluationIds.length ? inArray(analyticGraphs.linkedCycleId, evaluationIds) : undefined,
        programIds.length ? inArray(analyticGraphs.linkedProgramId, programIds) : undefined,
      )).orderBy(desc(analyticGraphs.updatedAt))
      : Promise.resolve([]),
    canGraphs && programIds.length
      ? db.select().from(targetMasteryEvents).where(inArray(targetMasteryEvents.programId, programIds)).orderBy(asc(targetMasteryEvents.masteredAt))
      : Promise.resolve([]),
  ]);
  function reportGraph(row: typeof analyticGraphs.$inferSelect) {
    const normalized = normalizeGraph(row as unknown as Record<string, unknown>);
    if (normalized.config.dataSource !== "sessions" || !row.linkedProgramId) return normalized;
    const program = programRows.find((item) => item.id === row.linkedProgramId);
    if (!program) return normalized;
    const live = buildSessionGraph({
      id: normalized.id,
      program: {
        ...program,
        graphConfig: parsed(program.graphConfig, undefined),
        targets: targetRows.filter((target) => target.programId === program.id).map((target) => ({
          ...target,
          measurement: target.measurement as ClinicalMeasurement,
          state: target.state as ClinicalTargetState,
          criteria: parsed(target.criteria, {}),
        })),
        masteryEvents: masteryRows.filter((event) => event.programId === program.id && event.status === "active").map((event) => ({
          ...event,
          masteryMethod: event.masteryMethod as "baseline" | "acquisition",
          criterionSnapshot: parsed(event.criterionSnapshot, {}),
        })),
      },
      sessions: sessionRows.filter((session) => session.programId === program.id).map((session) => ({
        ...session,
        context: canViewRawClinicalDetail(account, session.professionalAccountId) ? session.context : "",
        notes: canViewRawClinicalDetail(account, session.professionalAccountId) ? session.notes : "",
        results: parsed<Record<string, unknown>[]>(session.results, []).map((result) => canViewRawClinicalDetail(account, session.professionalAccountId) ? result : aggregateOnlySessionResult(result)) as ClinicalSession["results"],
      })),
      targetIds: normalized.config.sourceTargetIds,
      graphType: normalized.graphType,
      designType: normalized.designType,
      title: normalized.title,
      objective: normalized.objective,
      xAxisLabel: normalized.xAxisLabel,
      yAxisLabel: normalized.yAxisLabel,
      config: normalized.config,
      phases: normalized.phases,
    });
    return { ...normalized, ...live, status: normalized.status, archivedAt: normalized.archivedAt, createdAt: normalized.createdAt, updatedAt: normalized.updatedAt };
  }
  const sources: ReportSource[] = [
    ...(canGraphs ? graphRows.map((graph) => ({
      id: `graph:${graph.id}`,
      kind: "graph" as const,
      title: graph.title,
      detail: `${graph.designType} · ${graph.measurement} · ${parsed<unknown[]>(graph.points, []).length} puntos${graph.linkedProgramId ? ` · ${programRows.find((program) => program.id === graph.linkedProgramId)?.name || "Programa vinculado"}` : ""}`,
      graph: reportGraph(graph),
    })) : []),
    ...(canEvaluations ? evaluationRows.map(evaluationSource) : []),
    ...(canPrograms ? programRows.map((program) => programSource(program, targetRows)) : []),
    ...(canSessions ? programRows.map((program) => sessionSource(account, program, sessionRows)).filter((source) => source.table?.rows.length) : []),
  ];
  return { profile, sources };
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["reports.view"] });
  if (denied || !account) return denied;
  try {
    const profileId = new URL(request.url).searchParams.get("profileId") || "";
    if (profileId) return Response.json(await reportSources(account, profileId));

    const db = await getDb();
    await ensureBuiltInTemplates(db);
    const [templateRows, reportRows, profiles] = await Promise.all([
      db.select().from(reportTemplates).where(eq(reportTemplates.status, "active")).orderBy(desc(reportTemplates.builtIn), asc(reportTemplates.name)),
      db.select().from(reports).orderBy(desc(reports.updatedAt)).limit(500),
      db.select().from(personnelProfiles),
    ]);
    const allowedIds = visibleProfileIds(account, profiles);
    const visibleReports = reportRows.filter((report) => Boolean(report.profileId && allowedIds.has(report.profileId)));
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const supabase = await createSupabaseServerClient();
    const photoUrls = await signedProfilePhotoMap(supabase, "child", visibleReports.flatMap((report) => report.profileId ? [report.profileId] : []));
    return Response.json({
      templates: templateRows.map(serializeTemplate),
      reports: visibleReports.map((report) => serializeReport(
        report,
        report.profileId ? profileById.get(report.profileId)?.fullName || "Perfil eliminado" : "Institucional",
        report.profileId ? photoUrls.get(report.profileId) || null : null,
        account,
      )),
    });
  } catch (error) {
    return Response.json({ error: reportError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["reports.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = textValue(body.action, 40);
    const db = await getDb();
    await ensureBuiltInTemplates(db);

    if (action === "save_template") {
      const name = textValue(body.name, 160);
      if (!name) return Response.json({ error: "Escribe un nombre para la plantilla." }, { status: 400 });
      const [template] = await db.insert(reportTemplates).values({
        id: crypto.randomUUID(),
        name,
        reportType: textValue(body.reportType, 100) || "Clínico",
        description: textValue(body.description, 700),
        blocks: serializedTemplateBlocks(body.blocks),
        createdByAccountId: account.id,
      }).returning();
      return Response.json({ template: serializeTemplate(template) }, { status: 201 });
    }

    if (action === "duplicate_report") {
      const id = textValue(body.id, 100);
      const [source] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
      if (!source || !source.profileId) return Response.json({ error: "No se encontró el informe." }, { status: 404 });
      await profileSnapshot(account, source.profileId);
      const [report] = await db.insert(reports).values({
        id: crypto.randomUUID(),
        profileId: source.profileId,
        templateId: source.templateId,
        title: `${source.title} · copia`,
        reportType: source.reportType,
        status: "draft",
        blocks: source.blocks,
        profileSnapshot: source.profileSnapshot,
        sourceSelection: source.sourceSelection,
        authorAccountId: account.id,
        authorName: account.displayName,
      }).returning();
      const snapshot = parsed<ReportProfileSnapshot>(report.profileSnapshot, {} as ReportProfileSnapshot);
      return Response.json({ report: serializeReport(report, snapshot.fullName || "Niño") }, { status: 201 });
    }

    const profileId = textValue(body.profileId, 100);
    const title = textValue(body.title, 180);
    if (!profileId || !title) return Response.json({ error: "Selecciona un niño y escribe el título del informe." }, { status: 400 });
    const snapshot = await profileSnapshot(account, profileId);
    const status = body.status === "finalized" ? "finalized" : "draft";
    const [report] = await db.insert(reports).values({
      id: crypto.randomUUID(),
      profileId,
      templateId: textValue(body.templateId, 100) || null,
      title,
      reportType: textValue(body.reportType, 100) || "Clínico",
      status,
      blocks: serializedBlocks(body.blocks),
      profileSnapshot: JSON.stringify({ ...snapshot, photoUrl: null }),
      sourceSelection: sourceSelection(body.sourceSelection),
      authorAccountId: account.id,
      authorName: account.displayName,
      finalizedAt: status === "finalized" ? new Date().toISOString() : null,
    }).returning();
    return Response.json({ report: serializeReport(report, snapshot.fullName, snapshot.photoUrl) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: reportError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["reports.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = textValue(body.id, 100);
    const db = await getDb();
    const [current] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!current || !current.profileId) return Response.json({ error: "No se encontró el informe." }, { status: 404 });
    if (current.status === "finalized") return Response.json({ error: "Los informes finalizados son de solo lectura. Duplícalo para crear una actualización." }, { status: 409 });
    const nextProfileId = textValue(body.profileId, 100) || current.profileId;
    const snapshot = await profileSnapshot(account, nextProfileId);
    const title = textValue(body.title, 180);
    if (!title) return Response.json({ error: "Escribe el título del informe." }, { status: 400 });
    const finalize = body.action === "finalize";
    const [report] = await db.update(reports).set({
      profileId: nextProfileId,
      templateId: textValue(body.templateId, 100) || null,
      title,
      reportType: textValue(body.reportType, 100) || current.reportType,
      status: finalize ? "finalized" : "draft",
      blocks: serializedBlocks(body.blocks),
      profileSnapshot: JSON.stringify({ ...snapshot, photoUrl: null }),
      sourceSelection: sourceSelection(body.sourceSelection),
      finalizedAt: finalize ? new Date().toISOString() : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(reports.id, id), eq(reports.status, "draft"))).returning();
    return Response.json({ report: serializeReport(report, snapshot.fullName, snapshot.photoUrl) });
  } catch (error) {
    return Response.json({ error: reportError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["reports.manage"] });
  if (denied || !account) return denied;
  try {
    const id = textValue((await request.json() as Record<string, unknown>).id, 100);
    const db = await getDb();
    const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!report || !report.profileId) return Response.json({ error: "No se encontró el informe." }, { status: 404 });
    await profileSnapshot(account, report.profileId);
    if (report.status !== "draft") return Response.json({ error: "Solo pueden eliminarse los borradores." }, { status: 409 });
    await db.delete(reports).where(eq(reports.id, id));
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: reportError(error) }, { status: 500 });
  }
}
