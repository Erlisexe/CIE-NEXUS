import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { apiAccountGuard, canAccessProfile, visibleProfileIds } from "../../../lib/access-control";
import { evaluationHistory, evaluationPackages, personnelProfiles, trainingCycles } from "../../../db/schema";
import { DEFAULT_EVALUATION_PACKAGE, normalizePackageDefinition, targetsForPackage } from "../../../lib/evaluation-packages";
import { isActiveSite } from "../../../lib/sites";

const validStatuses = new Set(["initial", "teaching", "reevaluation", "complete"]);

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Error inesperado";
  return message.includes("no such table")
    ? "El almacenamiento formativo todavía no está preparado."
    : message;
}

function parseScores(value: unknown) {
  if (typeof value === "object" && value) return value as Record<string, { interview?: string; verification?: string }>;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value) as Record<string, { interview?: string; verification?: string }>; }
  catch { return {}; }
}

function strengthCount(value: unknown, snapshot: unknown, route: "4A" | "4B") {
  const scores = parseScores(value);
  return targetsForPackage(normalizePackageDefinition(snapshot || DEFAULT_EVALUATION_PACKAGE), route)
    .filter((target) => {
      const methods = target.methods?.length ? target.methods : ["interview", "verification"];
      const score = scores[target.code];
      return (!methods.includes("interview") || score?.interview === "1")
        && (!methods.includes("verification") || score?.verification === "1");
    }).length;
}

function historyRow(cycleId: string, action: string, summary: string, details = "") {
  return { id: crypto.randomUUID(), cycleId, action, summary, details };
}

async function activePackage(db: Awaited<ReturnType<typeof getDb>>, requestedId: string) {
  await db.insert(evaluationPackages).values({
    id: DEFAULT_EVALUATION_PACKAGE.id,
    familyId: DEFAULT_EVALUATION_PACKAGE.familyId,
    name: DEFAULT_EVALUATION_PACKAGE.name,
    objective: DEFAULT_EVALUATION_PACKAGE.objective,
    version: DEFAULT_EVALUATION_PACKAGE.version,
    status: DEFAULT_EVALUATION_PACKAGE.status,
    areas: JSON.stringify(DEFAULT_EVALUATION_PACKAGE.areas),
  }).onConflictDoNothing();
  const id = requestedId || DEFAULT_EVALUATION_PACKAGE.id;
  const [selected] = await db.select().from(evaluationPackages).where(eq(evaluationPackages.id, id)).limit(1);
  if (!selected || selected.status !== "active") return null;
  return selected;
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["evaluations.view"] }); if (denied || !account) return denied;
  try {
    const db = await getDb();
    const historyFor = new URL(request.url).searchParams.get("historyFor");
    if (historyFor) {
      const [cycle] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, historyFor)).limit(1);
      if (!cycle || !canAccessProfile(account, { id: cycle.profileId || "", site: cycle.site })) {
        return Response.json({ error: "No tienes acceso a esta evaluación." }, { status: 403 });
      }
      const history = await db.select().from(evaluationHistory)
        .where(eq(evaluationHistory.cycleId, historyFor))
        .orderBy(desc(evaluationHistory.createdAt));
      return Response.json({ history });
    }
    const [records, profiles] = await Promise.all([
      db.select().from(trainingCycles).orderBy(desc(trainingCycles.updatedAt)).limit(300),
      db.select().from(personnelProfiles),
    ]);
    const allowedIds = visibleProfileIds(account, profiles);
    return Response.json({ records: records.filter((record) => Boolean(record.profileId && allowedIds.has(record.profileId))) });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["evaluations.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const profileId = textValue(body.profileId);
    const programContext = textValue(body.programContext);
    const cycleLabel = textValue(body.cycleLabel) || "Nuevo ciclo formativo";
    const routeType = body.routeType === "4B" ? "4B" : "4A";
    const sourceCycleId = textValue(body.sourceCycleId) || null;
    const packageTemplateId = textValue(body.packageTemplateId);

    if (!profileId || !programContext) {
      return Response.json({ error: "Selecciona un niño y completa el programa/contexto." }, { status: 400 });
    }

    const db = await getDb();
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
    if (!profile || profile.status !== "active" || !(await isActiveSite(profile.site))) {
      return Response.json({ error: "Selecciona un niño activo de una de las cinco sedes." }, { status: 400 });
    }
    if (!canAccessProfile(account, profile)) return Response.json({ error: "No tienes acceso al niño seleccionado." }, { status: 403 });
    const site = profile.site;
    const participantName = profile.fullName;
    const selectedPackage = await activePackage(db, packageTemplateId);
    if (!selectedPackage) {
      return Response.json({ error: "Selecciona un paquete activo para iniciar la evaluación." }, { status: 400 });
    }
    const packageAreas = JSON.parse(selectedPackage.areas) as Array<{ route?: string }>;
    if (!packageAreas.some((area) => !area.route || area.route === "all" || area.route === routeType)) {
      return Response.json({ error: `El paquete no contiene áreas aplicables a la ruta ${routeType}.` }, { status: 400 });
    }
    if (sourceCycleId) {
      const [source] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, sourceCycleId)).limit(1);
      if (!source?.archivedAt || !canAccessProfile(account, { id: source.profileId || "", site: source.site })) {
        return Response.json({ error: "El nuevo paquete solo puede derivarse de un ciclo archivado." }, { status: 400 });
      }
    }

    const id = crypto.randomUUID();
    const [record] = await db.insert(trainingCycles).values({
      id,
      profileId: profile.id,
      site,
      participantName,
      role: profile.role,
      programContext,
      cycleLabel,
      instrumentVersion: `${selectedPackage.name} · v${selectedPackage.version}.0`,
      packageTemplateId: selectedPackage.id,
      instrumentSnapshot: JSON.stringify({
        id: selectedPackage.id,
        familyId: selectedPackage.familyId,
        name: selectedPackage.name,
        objective: selectedPackage.objective,
        version: selectedPackage.version,
        status: selectedPackage.status,
        areas: JSON.parse(selectedPackage.areas),
      }),
      routeType,
      sourceCycleId,
    }).returning();

    await db.insert(evaluationHistory).values(historyRow(
      id,
      "created",
      sourceCycleId ? "Nuevo paquete creado desde un ciclo archivado" : "Evaluación creada",
      `Sede ${site} · Ruta ${routeType} · ${selectedPackage.name} v${selectedPackage.version}.0`,
    ));
    if (sourceCycleId) {
      await db.insert(evaluationHistory).values(historyRow(
        sourceCycleId,
        "next_cycle_created",
        "Se inició un nuevo paquete a partir de este ciclo",
        `Nuevo expediente: ${participantName} · ${cycleLabel}`,
      ));
    }

    return Response.json({ record }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["evaluations.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = textValue(body.id);
    if (!id) return Response.json({ error: "El expediente formativo no es válido." }, { status: 400 });

    const db = await getDb();
    const [current] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró el expediente." }, { status: 404 });
    if (!canAccessProfile(account, { id: current.profileId || "", site: current.site })) return Response.json({ error: "No tienes acceso a esta evaluación." }, { status: 403 });

    if (body.action === "archive") {
      if (current.status !== "complete") {
        return Response.json({ error: "Solo puede archivarse un ciclo con la reevaluación finalizada." }, { status: 400 });
      }
      if (current.archivedAt) return Response.json({ error: "Este ciclo ya está archivado." }, { status: 400 });
      if (body.improvementConfirmed !== true) {
        return Response.json({ error: "Debes confirmar que la mejora fue revisada." }, { status: 400 });
      }
      const route = current.routeType === "4B" ? "4B" : "4A";
      const beforeStrength = strengthCount(current.initialScores, current.instrumentSnapshot, route);
      const afterStrength = strengthCount(current.reevaluationScores, current.instrumentSnapshot, route);
      if (afterStrength <= beforeStrength) {
        return Response.json({ error: "No existe una mejora positiva verificable para archivar este ciclo." }, { status: 400 });
      }
      const summary = { confirmed: true, beforeStrength, afterStrength, netChange: afterStrength - beforeStrength };
      const [record] = await db.update(trainingCycles).set({
        archivedAt: sql`CURRENT_TIMESTAMP`,
        archiveSummary: JSON.stringify(summary),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(trainingCycles.id, id)).returning();
      await db.insert(evaluationHistory).values(historyRow(
        id,
        "archived",
        "Ciclo archivado después de confirmar mejora",
        `${beforeStrength} a ${afterStrength} fortalezas confirmadas · cambio neto +${afterStrength - beforeStrength}`,
      ));
      return Response.json({ record });
    }

    if (body.action === "restore") {
      if (!current.archivedAt) return Response.json({ error: "Este ciclo no está archivado." }, { status: 400 });
      const [record] = await db.update(trainingCycles).set({
        archivedAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(trainingCycles.id, id)).returning();
      await db.insert(evaluationHistory).values(historyRow(id, "restored", "Ciclo restaurado al listado activo"));
      return Response.json({ record });
    }

    if (current.archivedAt) {
      return Response.json({ error: "Los ciclos archivados son de solo lectura. Restáuralo antes de modificarlo." }, { status: 409 });
    }

    const profileId = textValue(body.profileId) || current.profileId || "";
    const programContext = textValue(body.programContext);
    const status = validStatuses.has(textValue(body.status)) ? textValue(body.status) : "initial";
    const [profile] = profileId
      ? await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1)
      : [];
    if (!profile || !(await isActiveSite(profile.site)) || !programContext) {
      return Response.json({ error: "El expediente formativo no es válido." }, { status: 400 });
    }
    if (!canAccessProfile(account, profile)) return Response.json({ error: "No tienes acceso al niño seleccionado." }, { status: 403 });
    const site = profile.site;
    const participantName = profile.fullName;
    const role = profile.role;

    const initialScores = JSON.stringify(body.initialScores ?? {});
    const teachingPlan = JSON.stringify(body.teachingPlan ?? []);
    const reevaluationScores = JSON.stringify(body.reevaluationScores ?? {});
    const nextMetadata = [profile.id, site, participantName, role, programContext, textValue(body.cycleLabel), current.instrumentVersion, current.routeType];
    const currentMetadata = [current.profileId, current.site, current.participantName, current.role, current.programContext, current.cycleLabel, current.instrumentVersion, current.routeType];
    const changes: string[] = [];
    if (JSON.stringify(nextMetadata) !== JSON.stringify(currentMetadata)) changes.push("datos generales");
    if (initialScores !== current.initialScores) changes.push("evaluación inicial");
    if (teachingPlan !== current.teachingPlan) changes.push("plan de enseñanza");
    if (reevaluationScores !== current.reevaluationScores) changes.push("reevaluación");
    if (status !== current.status) changes.push(`estado: ${current.status} → ${status}`);

    const [record] = await db.update(trainingCycles).set({
      profileId: profile.id,
      site,
      participantName,
      role,
      programContext,
      cycleLabel: textValue(body.cycleLabel) || "Nuevo ciclo formativo",
      instrumentVersion: current.instrumentVersion,
      packageTemplateId: current.packageTemplateId,
      instrumentSnapshot: current.instrumentSnapshot,
      routeType: current.routeType,
      status,
      initialScores,
      teachingPlan,
      reevaluationScores,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(trainingCycles.id, id)).returning();

    if (changes.length) {
      await db.insert(evaluationHistory).values(historyRow(
        id,
        "updated",
        changes.length === 1 ? `Se actualizó ${changes[0]}` : "Se actualizaron varios componentes",
        changes.join(" · "),
      ));
    }
    return Response.json({ record });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["evaluations.manage"] }); if (denied || !account) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = textValue(body.id);
    if (!id) return Response.json({ error: "Identificador obligatorio." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, id)).limit(1);
    if (!existing) return Response.json({ error: "No se encontró la evaluación." }, { status: 404 });
    if (!canAccessProfile(account, { id: existing.profileId || "", site: existing.site })) return Response.json({ error: "No tienes acceso a esta evaluación." }, { status: 403 });

    await db.batch([
      db.delete(evaluationHistory).where(eq(evaluationHistory.cycleId, id)),
      db.delete(trainingCycles).where(eq(trainingCycles.id, id)),
    ]);
    return Response.json({ deleted: true, id, historyDeleted: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
