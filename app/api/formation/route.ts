import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { formationCourses } from "../../../db/schema";
import { adminApiGuard } from "../../../lib/admin-auth";
import {
  formationStorageKeys,
  normalizeFormationContent,
  parseFormationCourse,
  slugifyFormation,
  validateFormationContent,
} from "../../../lib/formation";

type Bucket = { delete(key: string): Promise<void> };

async function getBucket() {
  const workers = await import("cloudflare:workers");
  return (workers.env as unknown as { BUCKET?: Bucket }).BUCKET;
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function ensureStarterCourse() {
  const db = await getDb();
  await db.insert(formationCourses).values({
    id: "formation-aba-45h",
    slug: "formacion-aba-45-horas",
    title: "Formación ABA · 45 horas",
    description: "Programa formativo en Análisis Aplicado de la Conducta.",
    audience: "Coordinadores, supervisores y terapeutas",
    durationHours: 45,
    status: "draft",
    content: JSON.stringify({ chapters: [] }),
  }).onConflictDoNothing();
  return db;
}

function formationError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la acción.";
  return message.includes("no such table") || message.startsWith("Failed query")
    ? "El campus formativo se habilitará al publicar esta actualización."
    : message;
}

export async function GET() {
  const denied = await adminApiGuard("training.manage");
  if (denied) return denied;
  try {
    const db = await ensureStarterCourse();
    const rows = await db.select().from(formationCourses).orderBy(desc(formationCourses.updatedAt));
    return Response.json({ courses: rows.map((row) => parseFormationCourse(row as unknown as Record<string, unknown>)) });
  } catch (error) { return Response.json({ error: formationError(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  const denied = await adminApiGuard("training.manage");
  if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const title = textValue(body.title, 180) || "Nueva formación";
    const db = await ensureStarterCourse();
    const id = crypto.randomUUID();
    const slug = `${slugifyFormation(title)}-${id.slice(0, 6)}`;
    const [row] = await db.insert(formationCourses).values({
      id, slug, title, description: textValue(body.description, 2500), audience: textValue(body.audience, 500),
      durationHours: Math.min(500, Math.max(1, Number(body.durationHours) || 45)), status: "draft",
      content: JSON.stringify({ chapters: [] }),
    }).returning();
    return Response.json({ course: parseFormationCourse(row as unknown as Record<string, unknown>) }, { status: 201 });
  } catch (error) { return Response.json({ error: formationError(error) }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const denied = await adminApiGuard("training.manage");
  if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = textValue(body.id, 100);
    const db = await ensureStarterCourse();
    const [current] = await db.select().from(formationCourses).where(eq(formationCourses.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la formación." }, { status: 404 });
    const action = body.action === "publish" ? "publish" : body.action === "unpublish" ? "unpublish" : "save";
    const title = textValue(body.title, 180);
    const description = textValue(body.description, 2500);
    const audience = textValue(body.audience, 500);
    const durationHours = Math.min(500, Math.max(1, Number(body.durationHours) || 45));
    if (!title || !description) return Response.json({ error: "Completa el título y la descripción principal." }, { status: 400 });
    const content = normalizeFormationContent(body.content);
    const validation = validateFormationContent(content, action === "publish");
    if (validation) return Response.json({ error: validation }, { status: 400 });
    const priorContent = normalizeFormationContent(JSON.parse(current.content || '{"chapters":[]}'));
    const nextKeys = new Set(formationStorageKeys(content));
    const removedKeys = formationStorageKeys(priorContent).filter((key) => !nextKeys.has(key));
    const [row] = await db.update(formationCourses).set({
      title, description, audience, durationHours, content: JSON.stringify(content),
      status: action === "publish" ? "published" : action === "unpublish" ? "draft" : current.status,
      publishedAt: action === "publish" ? sql`COALESCE(${formationCourses.publishedAt}, CURRENT_TIMESTAMP)` : action === "unpublish" ? null : current.publishedAt,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(formationCourses.id, id)).returning();
    const bucket = await getBucket();
    if (bucket) await Promise.all(removedKeys.map((key) => bucket.delete(key).catch(() => undefined)));
    return Response.json({ course: parseFormationCourse(row as unknown as Record<string, unknown>) });
  } catch (error) { return Response.json({ error: formationError(error) }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  const denied = await adminApiGuard("training.manage");
  if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = textValue(body.id, 100);
    const db = await ensureStarterCourse();
    const [current] = await db.select().from(formationCourses).where(eq(formationCourses.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la formación." }, { status: 404 });
    await db.delete(formationCourses).where(eq(formationCourses.id, id));
    const bucket = await getBucket();
    const keys = formationStorageKeys(normalizeFormationContent(JSON.parse(current.content || '{"chapters":[]}')));
    if (bucket) await Promise.all(keys.map((key) => bucket.delete(key).catch(() => undefined)));
    return Response.json({ deleted: true, id });
  } catch (error) { return Response.json({ error: formationError(error) }, { status: 500 }); }
}
