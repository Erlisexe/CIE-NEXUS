import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { apiAccountGuard, canAccessProfile, type AppAccount } from "../../../lib/access-control";
import { analyticGraphs, graphHistory, interventionPrograms, personnelProfiles, trainingCycles } from "../../../db/schema";
import {
  DEFAULT_GRAPH_CONFIG,
  type GraphConfig,
  type GraphPoint,
  type GraphType,
  type LineDesign,
  type PhaseBoundary,
} from "../../../lib/graph-types";

const graphTypes = new Set<GraphType>(["line", "bar", "cumulative"]);
const lineDesigns = new Set<LineDesign>(["simple", "AB", "ABA", "ABAB", "BAB", "multiple-baseline", "multielement", "changing-criterion", "custom"]);

class GraphLinkError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function textValue(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function errorMessage(error: unknown) {
  let current = error as { message?: string; cause?: unknown } | undefined;
  const messages: string[] = [];
  while (current && messages.length < 4) {
    if (current.message) messages.push(current.message);
    current = current.cause as { message?: string; cause?: unknown } | undefined;
  }
  const message = messages.join(" · ") || "Error inesperado";
  return message.includes("no such table")
    ? "El almacenamiento de gráficas todavía no está preparado."
    : message;
}

function historyRow(graphId: string, action: string, summary: string, details = "") {
  return { id: crypto.randomUUID(), graphId, action, summary, details };
}

function finiteNumber(value: unknown, fallback: number | null = null) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizePoints(value: unknown): GraphPoint[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2000).map((raw, index) => {
    const point = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const source = point.source && typeof point.source === "object" ? point.source as Record<string, unknown> : null;
    return {
      id: textValue(point.id, 80) || crypto.randomUUID(),
      label: textValue(point.label, 80) || String(index + 1),
      value: finiteNumber(point.value),
      series: textValue(point.series, 80) || "Datos",
      criterion: finiteNumber(point.criterion),
      note: textValue(point.note, 600),
      ...(source ? { source: {
        sessionId: textValue(source.sessionId, 80),
        sessionDate: textValue(source.sessionDate, 20),
        programId: textValue(source.programId, 80),
        targetId: textValue(source.targetId, 80),
        targetName: textValue(source.targetName, 160),
        opportunities: Math.max(0, Math.round(finiteNumber(source.opportunities, 0) || 0)),
        context: textValue(source.context, 300),
        sessionNotes: textValue(source.sessionNotes, 800),
      } } : {}),
    };
  });
}

function sanitizePhases(value: unknown, pointCount: number): PhaseBoundary[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((raw) => {
    const phase = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const afterIndex = Math.round(Number(phase.afterIndex));
    return {
      id: textValue(phase.id, 80) || crypto.randomUUID(),
      afterIndex: Number.isFinite(afterIndex) ? Math.max(1, Math.min(afterIndex, Math.max(1, pointCount - 1))) : 1,
      beforeLabel: textValue(phase.beforeLabel, 80) || "Fase anterior",
      afterLabel: textValue(phase.afterLabel, 80) || "Fase siguiente",
      ...(textValue(phase.boundaryDate, 20) ? { boundaryDate: textValue(phase.boundaryDate, 20) } : {}),
    };
  }).sort((a, b) => a.afterIndex - b.afterIndex);
}

function sanitizeConfig(value: unknown): GraphConfig {
  const config = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const analysis = (config.visualAnalysis && typeof config.visualAnalysis === "object"
    ? config.visualAnalysis
    : {}) as Record<string, unknown>;
  const yMin = finiteNumber(config.yMin, 0) ?? 0;
  const yMax = finiteNumber(config.yMax);
  return {
    yMin,
    yMax: yMax !== null && yMax > yMin ? yMax : null,
    showGrid: config.showGrid !== false,
    showMean: config.showMean === true,
    showTrend: config.showTrend === true,
    connectPoints: config.connectPoints !== false,
    showPoints: config.showPoints !== false,
    showLegend: config.showLegend !== false,
    showValues: config.showValues === true,
    dataSource: config.dataSource === "sessions" ? "sessions" : "manual",
    sourceTargetIds: Array.isArray(config.sourceTargetIds)
      ? config.sourceTargetIds.map((item) => textValue(item, 80)).filter(Boolean).slice(0, 50)
      : [],
    dateFrom: textValue(config.dateFrom, 20),
    dateTo: textValue(config.dateTo, 20),
    visualAnalysis: {
      level: textValue(analysis.level, 800),
      trend: textValue(analysis.trend, 800),
      variability: textValue(analysis.variability, 800),
      immediacy: textValue(analysis.immediacy, 800),
      overlap: textValue(analysis.overlap, 800),
      consistency: textValue(analysis.consistency, 800),
      decision: textValue(analysis.decision, 1200),
      nextReview: textValue(analysis.nextReview, 40),
    },
  };
}

async function canUseGraph(db: Awaited<ReturnType<typeof getDb>>, account: AppAccount, graph: typeof analyticGraphs.$inferSelect) {
  if (account.role === "direccion_clinica" || account.role === "subdirector") return true;
  if (graph.profileId) {
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, graph.profileId)).limit(1);
    return Boolean(profile && canAccessProfile(account, profile));
  }
  if (graph.linkedProgramId) {
    const [program] = await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, graph.linkedProgramId)).limit(1);
    if (program) return canAccessProfile(account, { id: program.profileId || "", site: program.site });
  }
  if (graph.linkedCycleId) {
    const [cycle] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, graph.linkedCycleId)).limit(1);
    if (cycle) return canAccessProfile(account, { id: cycle.profileId || "", site: cycle.site });
  }
  return graph.ownerAccountId === account.id;
}

async function resolveGraphLinks(
  db: Awaited<ReturnType<typeof getDb>>,
  account: AppAccount,
  body: Record<string, unknown>,
) {
  const requestedProfileId = textValue(body.profileId, 80) || null;
  const linkedProgramId = textValue(body.linkedProgramId, 80) || null;
  const linkedCycleId = textValue(body.linkedCycleId, 80) || null;
  const [profile, program, cycle] = await Promise.all([
    requestedProfileId ? db.select().from(personnelProfiles).where(eq(personnelProfiles.id, requestedProfileId)).limit(1).then((rows) => rows[0] || null) : null,
    linkedProgramId ? db.select().from(interventionPrograms).where(eq(interventionPrograms.id, linkedProgramId)).limit(1).then((rows) => rows[0] || null) : null,
    linkedCycleId ? db.select().from(trainingCycles).where(eq(trainingCycles.id, linkedCycleId)).limit(1).then((rows) => rows[0] || null) : null,
  ]);
  if (requestedProfileId && !profile) throw new GraphLinkError("El niño vinculado no existe.");
  if (linkedProgramId && !program) throw new GraphLinkError("El programa vinculado no existe.");
  if (linkedCycleId && !cycle) throw new GraphLinkError("La evaluación vinculada no existe.");

  const profileIds = [requestedProfileId, program?.profileId || null, cycle?.profileId || null].filter((id): id is string => Boolean(id));
  if (new Set(profileIds).size > 1) throw new GraphLinkError("El niño, el programa y la evaluación deben pertenecer al mismo expediente.");
  const profileId = profileIds[0] || null;
  const linkedProfile = profileId === requestedProfileId
    ? profile
    : profileId ? await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1).then((rows) => rows[0] || null) : null;
  const scope = linkedProfile
    ? { id: linkedProfile.id, site: linkedProfile.site }
    : program ? { id: program.profileId || "", site: program.site }
      : cycle ? { id: cycle.profileId || "", site: cycle.site }
        : null;
  if (scope && !canAccessProfile(account, scope)) throw new GraphLinkError("No tienes acceso al expediente seleccionado.", 403);
  return { profileId, linkedProgramId, linkedCycleId };
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["graphs.view"] }); if (denied || !account) return denied;
  try {
    const db = await getDb();
    const historyFor = new URL(request.url).searchParams.get("historyFor");
    if (historyFor) {
      const [graph] = await db.select().from(analyticGraphs).where(eq(analyticGraphs.id, historyFor)).limit(1);
      if (!graph || !(await canUseGraph(db, account, graph))) return Response.json({ error: "No tienes acceso a esta gráfica." }, { status: 403 });
      const history = await db.select().from(graphHistory)
        .where(eq(graphHistory.graphId, historyFor))
        .orderBy(desc(graphHistory.createdAt));
      return Response.json({ history });
    }
    const graphs = await db.select().from(analyticGraphs).orderBy(desc(analyticGraphs.updatedAt)).limit(300);
    const visible: typeof graphs = [];
    for (const graph of graphs) if (await canUseGraph(db, account, graph)) visible.push(graph);
    return Response.json({ graphs: visible });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["graphs.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const title = textValue(body.title, 140);
    const objective = textValue(body.objective, 1200);
    const graphType = graphTypes.has(body.graphType as GraphType) ? body.graphType as GraphType : "line";
    const designType = lineDesigns.has(body.designType as LineDesign) ? body.designType as LineDesign : "AB";
    if (!title || !objective) {
      return Response.json({ error: "El nombre y el objetivo de la gráfica son obligatorios." }, { status: 400 });
    }
    const db = await getDb();
    const links = await resolveGraphLinks(db, account, body);
    const points = sanitizePoints(body.points).map((point) => graphType === "cumulative" && point.value !== null
      ? { ...point, value: Math.max(0, point.value) }
      : point);
    const phases = sanitizePhases(body.phases, points.length);
    const id = crypto.randomUUID();
    const graphValues: typeof analyticGraphs.$inferInsert = {
      id,
      ownerAccountId: account.id,
      profileId: links.profileId,
      linkedProgramId: links.linkedProgramId,
      linkedCycleId: links.linkedCycleId,
      title,
      objective,
      graphType,
      designType,
      measurement: textValue(body.measurement, 80) || "Porcentaje",
      xAxisLabel: textValue(body.xAxisLabel, 80) || (graphType === "bar" ? "Categorías" : "Sesiones"),
      yAxisLabel: textValue(body.yAxisLabel, 80) || "Valor",
      points: JSON.stringify(points),
      phases: JSON.stringify(phases),
      config: JSON.stringify(sanitizeConfig(body.config || DEFAULT_GRAPH_CONFIG)),
    };
    const [graph] = await db.insert(analyticGraphs).values(graphValues).returning();
    await db.insert(graphHistory).values(historyRow(
      id,
      "created",
      "Gráfica creada",
      `${graphType} · ${designType} · ${points.length} registros iniciales${links.profileId ? " · vinculada a un niño" : ""}${links.linkedProgramId ? " y programa" : ""}`,
    ));
    return Response.json({ graph }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: error instanceof GraphLinkError ? error.status : 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["graphs.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = textValue(body.id, 80);
    if (!id) return Response.json({ error: "La gráfica no es válida." }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(analyticGraphs).where(eq(analyticGraphs.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la gráfica." }, { status: 404 });
    if (!(await canUseGraph(db, account, current))) return Response.json({ error: "No tienes acceso a esta gráfica." }, { status: 403 });

    if (body.action === "archive") {
      if (current.archivedAt) return Response.json({ error: "La gráfica ya está archivada." }, { status: 400 });
      const [graph] = await db.update(analyticGraphs).set({
        status: "archived",
        archivedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(analyticGraphs.id, id)).returning();
      await db.insert(graphHistory).values(historyRow(id, "archived", "Gráfica archivada como registro de solo lectura"));
      return Response.json({ graph });
    }

    if (body.action === "restore") {
      if (!current.archivedAt) return Response.json({ error: "La gráfica no está archivada." }, { status: 400 });
      const [graph] = await db.update(analyticGraphs).set({
        status: "active",
        archivedAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(analyticGraphs.id, id)).returning();
      await db.insert(graphHistory).values(historyRow(id, "restored", "Gráfica restaurada para edición"));
      return Response.json({ graph });
    }

    if (current.archivedAt) {
      return Response.json({ error: "Las gráficas archivadas son de solo lectura. Restáurala antes de editar." }, { status: 409 });
    }

    const title = textValue(body.title, 140);
    const objective = textValue(body.objective, 1200);
    const graphType = graphTypes.has(body.graphType as GraphType) ? body.graphType as GraphType : "line";
    const designType = lineDesigns.has(body.designType as LineDesign) ? body.designType as LineDesign : "AB";
    if (!title || !objective) return Response.json({ error: "Revisa el nombre y el objetivo de la gráfica." }, { status: 400 });
    const links = await resolveGraphLinks(db, account, body);
    const points = sanitizePoints(body.points).map((point) => graphType === "cumulative" && point.value !== null
      ? { ...point, value: Math.max(0, point.value) }
      : point);
    const phases = sanitizePhases(body.phases, points.length);
    const config = sanitizeConfig(body.config);
    const changes: string[] = [];
    if (title !== current.title || objective !== current.objective) changes.push("identificación y objetivo");
    if (graphType !== current.graphType || designType !== current.designType) changes.push("tipo o diseño");
    if (textValue(body.measurement, 80) !== current.measurement || textValue(body.xAxisLabel, 80) !== current.xAxisLabel || textValue(body.yAxisLabel, 80) !== current.yAxisLabel) changes.push("medición o ejes");
    if (links.profileId !== current.profileId) changes.push("vinculación con el niño");
    if (links.linkedProgramId !== current.linkedProgramId) changes.push("vinculación con el programa");
    if (links.linkedCycleId !== current.linkedCycleId) changes.push("vinculación con la evaluación");
    if (JSON.stringify(points) !== current.points) changes.push("datos");
    if (JSON.stringify(phases) !== current.phases) changes.push("fases");
    if (JSON.stringify(config) !== current.config) changes.push("configuración o análisis visual");

    const [graph] = await db.update(analyticGraphs).set({
      title,
      objective,
      graphType,
      designType,
      measurement: textValue(body.measurement, 80) || "Porcentaje",
      xAxisLabel: textValue(body.xAxisLabel, 80) || "Sesiones",
      yAxisLabel: textValue(body.yAxisLabel, 80) || "Valor",
      profileId: links.profileId,
      linkedProgramId: links.linkedProgramId,
      linkedCycleId: links.linkedCycleId,
      points: JSON.stringify(points),
      phases: JSON.stringify(phases),
      config: JSON.stringify(config),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(analyticGraphs.id, id)).returning();
    if (changes.length) {
      await db.insert(graphHistory).values(historyRow(
        id,
        "updated",
        changes.length === 1 ? `Se actualizaron ${changes[0]}` : "Se actualizaron varios componentes",
        changes.join(" · "),
      ));
    }
    return Response.json({ graph });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: error instanceof GraphLinkError ? error.status : 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["graphs.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = textValue(body.id, 80);
    if (!id) return Response.json({ error: "Identificador obligatorio." }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(analyticGraphs).where(eq(analyticGraphs.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la gráfica." }, { status: 404 });
    if (!(await canUseGraph(db, account, current))) return Response.json({ error: "No tienes acceso a esta gráfica." }, { status: 403 });
    await db.batch([
      db.delete(graphHistory).where(eq(graphHistory.graphId, id)),
      db.delete(analyticGraphs).where(eq(analyticGraphs.id, id)),
    ]);
    return Response.json({ deleted: true, id, historyDeleted: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
