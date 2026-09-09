import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { cieSites, interventionPrograms, personnelProfiles, sessionAppointments, trainingCycles } from "../../../db/schema";
import { apiAccountGuard } from "../../../lib/access-control";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

function clean(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function codeValue(value: unknown) {
  return clean(value, 12).toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

async function linkedSummary(name: string) {
  const db = await getDb();
  const [[children], [evaluations], [programs], [appointments]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(personnelProfiles).where(eq(personnelProfiles.site, name)),
    db.select({ count: sql<number>`count(*)` }).from(trainingCycles).where(eq(trainingCycles.site, name)),
    db.select({ count: sql<number>`count(*)` }).from(interventionPrograms).where(eq(interventionPrograms.site, name)),
    db.select({ count: sql<number>`count(*)` }).from(sessionAppointments).where(eq(sessionAppointments.site, name)),
  ]);
  const supabase = await createSupabaseServerClient();
  const { count: accounts = 0 } = await supabase.from("app_accounts").select("id", { count: "exact", head: true }).contains("site_scope", [name]);
  return {
    children: Number(children?.count || 0),
    evaluations: Number(evaluations?.count || 0),
    programs: Number(programs?.count || 0),
    appointments: Number(appointments?.count || 0),
    accounts: Number(accounts || 0),
  };
}

function totalLinked(summary: Awaited<ReturnType<typeof linkedSummary>>) {
  return Object.values(summary).reduce((total, value) => total + value, 0);
}

export async function GET() {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["sites.view", "sites.manage", "children.view", "calendar.view"] });
  if (denied || !account) return denied;
  try {
    const db = await getDb();
    const rows = await db.select().from(cieSites).orderBy(cieSites.name);
    const includeUsage = account.role === "direccion_clinica" || account.permissions.includes("sites.manage");
    return Response.json({
      sites: await Promise.all(rows.map(async (site) => ({
        ...site,
        usage: includeUsage ? await linkedSummary(site.name) : undefined,
      }))),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las sedes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["sites.manage"] });
  if (denied || !account) return denied;
  const body = await request.json() as Record<string, unknown>;
  const name = clean(body.name, 80);
  const code = codeValue(body.code);
  if (name.length < 2 || code.length < 2) return Response.json({ error: "Completa el nombre y un código válido para la sede." }, { status: 400 });
  try {
    const db = await getDb();
    const [duplicate] = await db.select({ id: cieSites.id }).from(cieSites)
      .where(sql`lower(${cieSites.name}) = lower(${name}) or lower(${cieSites.code}) = lower(${code})`).limit(1);
    if (duplicate) return Response.json({ error: "Ya existe una sede con ese nombre o código." }, { status: 409 });
    const [site] = await db.insert(cieSites).values({ id: crypto.randomUUID(), name, code, createdByAccountId: account.id }).returning();
    return Response.json({ site: { ...site, usage: { children: 0, evaluations: 0, programs: 0, appointments: 0, accounts: 0 } } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear la sede." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { denied } = await apiAccountGuard({ permissions: ["sites.manage"] });
  if (denied) return denied;
  const body = await request.json() as Record<string, unknown>;
  const id = clean(body.id, 100);
  const action = clean(body.action, 30);
  try {
    const db = await getDb();
    const [current] = await db.select().from(cieSites).where(eq(cieSites.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la sede." }, { status: 404 });
    if (action === "deactivate" || action === "activate") {
      if (action === "deactivate") {
        const [remaining] = await db.select({ count: sql<number>`count(*)` }).from(cieSites).where(and(eq(cieSites.status, "active"), ne(cieSites.id, id)));
        if (!Number(remaining?.count || 0)) return Response.json({ error: "La institución debe conservar al menos una sede activa." }, { status: 409 });
      }
      const [site] = await db.update(cieSites).set({ status: action === "activate" ? "active" : "inactive", updatedAt: new Date().toISOString() }).where(eq(cieSites.id, id)).returning();
      return Response.json({ site: { ...site, usage: await linkedSummary(site.name) } });
    }
    const name = clean(body.name, 80);
    const code = codeValue(body.code);
    if (name.length < 2 || code.length < 2) return Response.json({ error: "Completa el nombre y el código." }, { status: 400 });
    if (name !== current.name) {
      const usage = await linkedSummary(current.name);
      if (totalLinked(usage)) return Response.json({ error: "La sede ya tiene registros vinculados. Conserva el nombre para proteger el historial; puedes editar el código o desactivarla." }, { status: 409 });
    }
    const [duplicate] = await db.select({ id: cieSites.id }).from(cieSites)
      .where(and(ne(cieSites.id, id), sql`(lower(${cieSites.name}) = lower(${name}) or lower(${cieSites.code}) = lower(${code}))`)).limit(1);
    if (duplicate) return Response.json({ error: "Ya existe otra sede con ese nombre o código." }, { status: 409 });
    const [site] = await db.update(cieSites).set({ name, code, updatedAt: new Date().toISOString() }).where(eq(cieSites.id, id)).returning();
    return Response.json({ site: { ...site, usage: await linkedSummary(site.name) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la sede." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { denied } = await apiAccountGuard({ permissions: ["sites.manage"] });
  if (denied) return denied;
  const body = await request.json() as Record<string, unknown>;
  const id = clean(body.id, 100);
  try {
    const db = await getDb();
    const [current] = await db.select().from(cieSites).where(eq(cieSites.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la sede." }, { status: 404 });
    const usage = await linkedSummary(current.name);
    if (totalLinked(usage)) return Response.json({ error: "Esta sede tiene historial vinculado y no puede eliminarse. Desactívala para conservar los registros." }, { status: 409 });
    await db.delete(cieSites).where(eq(cieSites.id, id));
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la sede." }, { status: 500 });
  }
}
