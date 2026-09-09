import { and, desc, eq, max, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { evaluationPackages } from "../../../db/schema";
import {
  DEFAULT_EVALUATION_PACKAGE,
  type AreaRoute,
  type EvaluationArea,
  type TargetMethod,
} from "../../../lib/evaluation-packages";
import { adminApiGuard } from "../../../lib/admin-auth";
import { apiAccountGuard } from "../../../lib/access-control";

function textValue(value: unknown, maxLength = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function packageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error inesperado";
  return message.includes("no such table") || message.startsWith("Failed query")
    ? "La biblioteca de paquetes se habilitará al publicar esta actualización."
    : message;
}

function serialize(row: typeof evaluationPackages.$inferSelect) {
  let areas: EvaluationArea[] = [];
  try { areas = JSON.parse(row.areas) as EvaluationArea[]; } catch { areas = []; }
  return { ...row, areas };
}

async function ensureDefaultPackage() {
  const db = await getDb();
  await db.insert(evaluationPackages).values({
    id: DEFAULT_EVALUATION_PACKAGE.id,
    familyId: DEFAULT_EVALUATION_PACKAGE.familyId,
    name: DEFAULT_EVALUATION_PACKAGE.name,
    objective: DEFAULT_EVALUATION_PACKAGE.objective,
    version: DEFAULT_EVALUATION_PACKAGE.version,
    status: DEFAULT_EVALUATION_PACKAGE.status,
    areas: JSON.stringify(DEFAULT_EVALUATION_PACKAGE.areas),
  }).onConflictDoNothing();
  return db;
}

function sanitizeAreas(value: unknown): { areas?: EvaluationArea[]; error?: string } {
  if (!Array.isArray(value) || value.length < 1) return { error: "Agrega al menos un área al paquete." };
  if (value.length > 12) return { error: "Un paquete puede contener como máximo 12 áreas." };
  const codes = new Set<string>();
  const areas: EvaluationArea[] = [];
  for (let areaIndex = 0; areaIndex < value.length; areaIndex += 1) {
    const rawArea = value[areaIndex] as Record<string, unknown>;
    const name = textValue(rawArea.short, 100);
    const rawItems = Array.isArray(rawArea.items) ? rawArea.items : [];
    if (!name) return { error: `Escribe el nombre del área ${areaIndex + 1}.` };
    if (rawItems.length < 1) return { error: `Agrega al menos un target en ${name}.` };
    if (rawItems.length > 40) return { error: `${name} supera el máximo de 40 targets.` };
    const route: AreaRoute = rawArea.route === "4A" || rawArea.route === "4B" ? rawArea.route : "all";
    const items = rawItems.map((rawItem, itemIndex) => {
      const item = rawItem as Record<string, unknown>;
      const code = textValue(item.code, 24).toUpperCase();
      const title = textValue(item.title, 140);
      const criterion = textValue(item.criterion, 1200);
      const methods = Array.isArray(item.methods)
        ? item.methods.filter((method): method is TargetMethod => method === "interview" || method === "verification")
        : [];
      if (!code || !title || !criterion) throw new Error(`Completa código, nombre y criterio del target ${itemIndex + 1} en ${name}.`);
      if (codes.has(code)) throw new Error(`El código ${code} está repetido. Cada target necesita un código único.`);
      if (!methods.length) throw new Error(`Selecciona al menos un método de recolección para ${code}.`);
      codes.add(code);
      return {
        id: textValue(item.id, 80) || crypto.randomUUID(),
        code,
        title,
        criterion,
        alert: item.alert === true,
        methods,
      };
    });
    areas.push({
      key: textValue(rawArea.key, 80) || crypto.randomUUID(),
      label: `Área ${areaIndex + 1}`,
      short: name,
      description: textValue(rawArea.description, 700),
      route,
      items,
    });
  }
  return { areas };
}

export async function GET() {
  const { denied } = await apiAccountGuard({ anyPermissions: ["evaluations.view", "packages.manage"] }); if (denied) return denied;
  try {
    const db = await ensureDefaultPackage();
    const packages = await db.select().from(evaluationPackages)
      .orderBy(desc(evaluationPackages.updatedAt), desc(evaluationPackages.version));
    return Response.json({ packages: packages.map(serialize) });
  } catch (error) {
    return Response.json({ error: packageError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await adminApiGuard("packages.manage"); if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = textValue(body.name, 120);
    const objective = textValue(body.objective, 1500);
    if (!name || !objective) return Response.json({ error: "El nombre y el objetivo principal son obligatorios." }, { status: 400 });
    let sanitized: ReturnType<typeof sanitizeAreas>;
    try { sanitized = sanitizeAreas(body.areas); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Revisa los targets." }, { status: 400 }); }
    if (!sanitized.areas) return Response.json({ error: sanitized.error }, { status: 400 });
    const db = await ensureDefaultPackage();
    const id = crypto.randomUUID();
    const [record] = await db.insert(evaluationPackages).values({
      id,
      familyId: id,
      name,
      objective,
      version: 1,
      status: "draft",
      areas: JSON.stringify(sanitized.areas),
    }).returning();
    return Response.json({ package: serialize(record) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: packageError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await adminApiGuard("packages.manage"); if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = textValue(body.id, 80);
    if (!id) return Response.json({ error: "Selecciona un paquete válido." }, { status: 400 });
    const db = await ensureDefaultPackage();
    const [current] = await db.select().from(evaluationPackages).where(eq(evaluationPackages.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró el paquete." }, { status: 404 });

    if (body.action === "publish") {
      const parsed = sanitizeAreas(JSON.parse(current.areas));
      if (!parsed.areas) return Response.json({ error: parsed.error }, { status: 400 });
      await db.update(evaluationPackages).set({ status: "archived", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(evaluationPackages.familyId, current.familyId), eq(evaluationPackages.status, "active")));
      const [record] = await db.update(evaluationPackages).set({ status: "active", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(evaluationPackages.id, id)).returning();
      return Response.json({ package: serialize(record) });
    }

    if (body.action === "archive") {
      if (current.status !== "active") return Response.json({ error: "Solo los paquetes activos pueden archivarse." }, { status: 400 });
      const [record] = await db.update(evaluationPackages).set({ status: "archived", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(evaluationPackages.id, id)).returning();
      return Response.json({ package: serialize(record) });
    }

    if (body.action === "new_version") {
      const [versionRow] = await db.select({ value: max(evaluationPackages.version) }).from(evaluationPackages)
        .where(eq(evaluationPackages.familyId, current.familyId));
      const [record] = await db.insert(evaluationPackages).values({
        id: crypto.randomUUID(),
        familyId: current.familyId,
        name: current.name,
        objective: current.objective,
        version: Number(versionRow?.value || current.version) + 1,
        status: "draft",
        areas: current.areas,
      }).returning();
      return Response.json({ package: serialize(record) }, { status: 201 });
    }

    if (current.status !== "draft") {
      return Response.json({ error: "Un paquete publicado no se modifica. Crea una nueva versión para preservar las evaluaciones existentes." }, { status: 409 });
    }
    const name = textValue(body.name, 120);
    const objective = textValue(body.objective, 1500);
    if (!name || !objective) return Response.json({ error: "El nombre y el objetivo principal son obligatorios." }, { status: 400 });
    let sanitized: ReturnType<typeof sanitizeAreas>;
    try { sanitized = sanitizeAreas(body.areas); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Revisa los targets." }, { status: 400 }); }
    if (!sanitized.areas) return Response.json({ error: sanitized.error }, { status: 400 });
    const [record] = await db.update(evaluationPackages).set({
      name,
      objective,
      areas: JSON.stringify(sanitized.areas),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(evaluationPackages.id, id)).returning();
    return Response.json({ package: serialize(record) });
  } catch (error) {
    return Response.json({ error: packageError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const denied = await adminApiGuard("packages.manage"); if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = textValue(body.id, 80);
    const db = await ensureDefaultPackage();
    const [current] = await db.select().from(evaluationPackages).where(eq(evaluationPackages.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró el paquete." }, { status: 404 });
    await db.delete(evaluationPackages).where(eq(evaluationPackages.id, id));
    return Response.json({ deleted: true, id, evaluationSnapshotsPreserved: true });
  } catch (error) {
    return Response.json({ error: packageError(error) }, { status: 500 });
  }
}
