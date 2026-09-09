import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sessionNoteTemplates } from "../../../db/schema";
import { apiAccountGuard } from "../../../lib/access-control";
import { DEFAULT_SESSION_NOTE_TEMPLATE, sanitizeSessionNoteFields } from "../../../lib/session-note-templates";

function textValue(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseFields(value: unknown) {
  if (typeof value !== "string") return sanitizeSessionNoteFields(value);
  try { return sanitizeSessionNoteFields(JSON.parse(value)); } catch { return []; }
}

function serializeTemplate(template: typeof sessionNoteTemplates.$inferSelect) {
  return { ...template, fields: parseFields(template.fields) };
}

function templateError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
  return message.includes("no such table")
    ? "El almacenamiento de plantillas de notas todavía no está preparado."
    : message;
}

export async function ensureDefaultSessionNoteTemplate(db: Awaited<ReturnType<typeof getDb>>) {
  const [existing] = await db.select({ id: sessionNoteTemplates.id }).from(sessionNoteTemplates)
    .where(eq(sessionNoteTemplates.id, DEFAULT_SESSION_NOTE_TEMPLATE.id)).limit(1);
  if (existing) return;
  await db.insert(sessionNoteTemplates).values({
    id: DEFAULT_SESSION_NOTE_TEMPLATE.id,
    name: DEFAULT_SESSION_NOTE_TEMPLATE.name,
    description: DEFAULT_SESSION_NOTE_TEMPLATE.description,
    fields: JSON.stringify(DEFAULT_SESSION_NOTE_TEMPLATE.fields),
    builtIn: true,
    createdByAccountId: null,
  }).onConflictDoNothing();
}

export async function GET() {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["sessions.view", "sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try {
    const db = await getDb();
    await ensureDefaultSessionNoteTemplate(db);
    const templates = await db.select().from(sessionNoteTemplates)
      .where(eq(sessionNoteTemplates.status, "active"))
      .orderBy(desc(sessionNoteTemplates.builtIn), asc(sessionNoteTemplates.name));
    return Response.json({ templates: templates.map(serializeTemplate), canManage: account.role === "direccion_clinica" });
  } catch (error) {
    return Response.json({ error: templateError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ roles: ["direccion_clinica"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = textValue(body.name, 160);
    const fields = sanitizeSessionNoteFields(body.fields);
    if (!name || !fields.length) return Response.json({ error: "La plantilla necesita nombre y al menos un campo." }, { status: 400 });
    const db = await getDb();
    await ensureDefaultSessionNoteTemplate(db);
    const [template] = await db.insert(sessionNoteTemplates).values({
      id: crypto.randomUUID(),
      name,
      description: textValue(body.description, 700),
      fields: JSON.stringify(fields),
      builtIn: false,
      createdByAccountId: account.id,
    }).returning();
    return Response.json({ template: serializeTemplate(template) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: templateError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ roles: ["direccion_clinica"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = textValue(body.id, 100);
    const db = await getDb();
    const [current] = await db.select().from(sessionNoteTemplates).where(eq(sessionNoteTemplates.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la plantilla." }, { status: 404 });
    if (body.action === "archive") {
      if (current.builtIn) return Response.json({ error: "La plantilla general predeterminada no puede archivarse." }, { status: 409 });
      await db.update(sessionNoteTemplates).set({ status: "archived", updatedAt: new Date().toISOString() }).where(eq(sessionNoteTemplates.id, id));
      const active = await db.select().from(sessionNoteTemplates).where(eq(sessionNoteTemplates.status, "active"));
      return Response.json({ templates: active.map(serializeTemplate) });
    }
    if (current.builtIn) return Response.json({ error: "La plantilla general se conserva como referencia institucional. Crea una nueva plantilla para personalizarla." }, { status: 409 });
    const name = textValue(body.name, 160);
    const fields = sanitizeSessionNoteFields(body.fields);
    if (!name || !fields.length) return Response.json({ error: "La plantilla necesita nombre y al menos un campo." }, { status: 400 });
    const [template] = await db.update(sessionNoteTemplates).set({
      name,
      description: textValue(body.description, 700),
      fields: JSON.stringify(fields),
      updatedAt: new Date().toISOString(),
    }).where(eq(sessionNoteTemplates.id, id)).returning();
    return Response.json({ template: serializeTemplate(template) });
  } catch (error) {
    return Response.json({ error: templateError(error) }, { status: 500 });
  }
}
