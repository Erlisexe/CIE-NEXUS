import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  abcCategories,
  abcRecords,
  interventionPrograms,
  interventionSessions,
  interventionTargets,
  personnelProfiles,
  sessionAppointments,
} from "../../../db/schema";
import { apiAccountGuard, canAccessChild, hasPermission } from "../../../lib/access-control";

const CATEGORY_TYPES = new Set(["antecedent", "consequence"]);

function clean(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateValue(value: unknown) {
  const text = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function timeValue(value: unknown) {
  const text = clean(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

async function childWithinScope(profileId: string, account: NonNullable<Awaited<ReturnType<typeof apiAccountGuard>>["account"]>) {
  const db = await getDb();
  const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
  if (!profile) throw new Error("No se encontró el niño.");
  if (!canAccessChild(account, profile)) throw new Error("Este niño no está dentro de tu alcance.");
  return profile;
}

async function linkedClinicalContext(profileId: string, body: Record<string, unknown>) {
  const db = await getDb();
  const programId = clean(body.programId, 100);
  const targetId = clean(body.targetId, 100);
  const sessionId = clean(body.sessionId, 100);
  const appointmentId = clean(body.appointmentId, 100);
  const [program] = programId ? await db.select().from(interventionPrograms).where(eq(interventionPrograms.id, programId)).limit(1) : [];
  if (programId && (!program || program.profileId !== profileId)) throw new Error("El programa no pertenece al niño seleccionado.");
  const [target] = targetId ? await db.select().from(interventionTargets).where(eq(interventionTargets.id, targetId)).limit(1) : [];
  if (targetId && (!target || !program || target.programId !== program.id)) throw new Error("La conducta objetivo no pertenece al programa seleccionado.");
  const [session] = sessionId ? await db.select().from(interventionSessions).where(eq(interventionSessions.id, sessionId)).limit(1) : [];
  if (sessionId && (!session || !program || session.programId !== program.id)) throw new Error("La sesión no pertenece al contexto clínico seleccionado.");
  const [appointment] = appointmentId ? await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, appointmentId)).limit(1) : [];
  if (appointmentId && (!appointment || appointment.profileId !== profileId)) throw new Error("La cita no corresponde al niño seleccionado.");
  return { program: program || null, target: target || null, session: session || null, appointment: appointment || null };
}

async function categorySnapshot(categoryId: string, categoryType: "antecedent" | "consequence", customLabel: string) {
  if (!categoryId) {
    if (!customLabel) throw new Error(`Selecciona o describe ${categoryType === "antecedent" ? "el antecedente" : "la consecuencia"}.`);
    return { id: null, label: customLabel };
  }
  const db = await getDb();
  const [category] = await db.select().from(abcCategories).where(and(eq(abcCategories.id, categoryId), eq(abcCategories.categoryType, categoryType))).limit(1);
  if (!category || category.status !== "active") throw new Error("La categoría seleccionada ya no está disponible.");
  return { id: category.id, label: category.label };
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["abc.view", "abc.record", "abc.manage"] });
  if (denied || !account) return denied;
  try {
    const url = new URL(request.url);
    const profileId = clean(url.searchParams.get("profileId"), 100);
    if (!profileId) return Response.json({ error: "Selecciona un niño." }, { status: 400 });
    const profile = await childWithinScope(profileId, account);
    const db = await getDb();
    const catalogOnly = url.searchParams.get("catalog") === "1";
    const [categories, programs, records] = await Promise.all([
      db.select().from(abcCategories).orderBy(asc(abcCategories.categoryType), asc(abcCategories.sortOrder), asc(abcCategories.label)),
      db.select().from(interventionPrograms).where(eq(interventionPrograms.profileId, profileId)).orderBy(desc(interventionPrograms.updatedAt)),
      catalogOnly ? Promise.resolve([]) : db.select().from(abcRecords).where(eq(abcRecords.profileId, profileId)).orderBy(desc(abcRecords.eventDate), desc(abcRecords.eventTime), desc(abcRecords.createdAt)).limit(1000),
    ]);
    const targets = programs.length
      ? await db.select().from(interventionTargets).where(inArray(interventionTargets.programId, programs.map((program) => program.id))).orderBy(asc(interventionTargets.sortOrder))
      : [];
    const sessionIds = [...new Set(records.flatMap((record) => record.sessionId ? [record.sessionId] : []))];
    const sessions = sessionIds.length
      ? await db.select().from(interventionSessions).where(inArray(interventionSessions.id, sessionIds))
      : [];
    const programMap = new Map(programs.map((program) => [program.id, program]));
    const targetMap = new Map(targets.map((target) => [target.id, target]));
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    return Response.json({
      profile: { id: profile.id, fullName: profile.fullName, site: profile.site },
      categories,
      programs: programs.map((program) => ({ id: program.id, name: program.name, status: program.status })),
      targets: targets.map((target) => ({ id: target.id, programId: target.programId, code: target.code, name: target.name, state: target.state })),
      records: records.map((record) => ({
        ...record,
        programName: record.programId ? programMap.get(record.programId)?.name || "Programa histórico" : "Sin programa",
        targetName: record.targetId ? targetMap.get(record.targetId)?.name || record.behaviorLabel : record.behaviorLabel,
        sessionDate: record.sessionId ? sessionMap.get(record.sessionId)?.sessionDate || null : null,
      })),
      canRecord: hasPermission(account, "abc.record") || hasPermission(account, "abc.manage"),
      canManage: hasPermission(account, "abc.manage"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el Registro ABC.";
    return Response.json({ error: message }, { status: /alcance/.test(message) ? 403 : /encontró/.test(message) ? 404 : 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["abc.record", "abc.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "create_category") {
      if (!hasPermission(account, "abc.manage")) return Response.json({ error: "Tu rol no permite configurar categorías ABC." }, { status: 403 });
      const categoryType = clean(body.categoryType, 30);
      const label = clean(body.label, 120);
      if (!CATEGORY_TYPES.has(categoryType) || !label) return Response.json({ error: "Completa un tipo y nombre de categoría válidos." }, { status: 400 });
      const db = await getDb();
      const [existing] = await db.select().from(abcCategories).where(and(eq(abcCategories.categoryType, categoryType), eq(abcCategories.label, label))).limit(1);
      if (existing) return Response.json({ error: "Esta categoría ya existe." }, { status: 409 });
      const [category] = await db.insert(abcCategories).values({
        id: crypto.randomUUID(), categoryType, label, sortOrder: Math.max(0, Math.round(Number(body.sortOrder) || 0)), createdByAccountId: account.id,
      }).returning();
      return Response.json({ category }, { status: 201 });
    }

    const profileId = clean(body.profileId, 100);
    await childWithinScope(profileId, account);
    const context = await linkedClinicalContext(profileId, body);
    const eventDate = dateValue(body.eventDate);
    const eventTime = timeValue(body.eventTime);
    if (!eventDate || !eventTime) return Response.json({ error: "Registra una fecha y hora válidas." }, { status: 400 });
    const antecedent = await categorySnapshot(clean(body.antecedentCategoryId, 100), "antecedent", clean(body.antecedentLabel, 160));
    const consequence = await categorySnapshot(clean(body.consequenceCategoryId, 100), "consequence", clean(body.consequenceLabel, 160));
    const behaviorLabel = context.target ? `${context.target.code} · ${context.target.name}` : clean(body.behaviorLabel, 200);
    const behaviorDescription = clean(body.behaviorDescription, 2000);
    if (!behaviorLabel && !behaviorDescription) return Response.json({ error: "Selecciona una conducta objetivo o descríbela de manera observable." }, { status: 400 });
    const db = await getDb();
    const [record] = await db.insert(abcRecords).values({
      id: crypto.randomUUID(),
      profileId,
      appointmentId: context.appointment?.id || null,
      sessionId: context.session?.id || null,
      programId: context.program?.id || null,
      targetId: context.target?.id || null,
      recordedByAccountId: account.id,
      recordedByName: account.displayName,
      eventDate,
      eventTime,
      locationContext: clean(body.locationContext, 300),
      activity: clean(body.activity, 300),
      antecedentCategoryId: antecedent.id,
      antecedentLabel: antecedent.label,
      antecedentDescription: clean(body.antecedentDescription, 2000),
      behaviorLabel: behaviorLabel || "Observación descriptiva",
      behaviorDescription,
      consequenceCategoryId: consequence.id,
      consequenceLabel: consequence.label,
      consequenceDescription: clean(body.consequenceDescription, 2000),
      additionalObservation: clean(body.additionalObservation, 3000),
    }).returning();
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el Registro ABC.";
    return Response.json({ error: message }, { status: /alcance|permite/.test(message) ? 403 : /pertenece|Selecciona|describe|disponible/.test(message) ? 400 : 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["abc.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id, 100);
    if (!id || body.action !== "set_category_status") return Response.json({ error: "Acción no reconocida." }, { status: 400 });
    const status = body.status === "active" ? "active" : "inactive";
    const db = await getDb();
    const [category] = await db.update(abcCategories).set({ status, updatedAt: new Date().toISOString() }).where(eq(abcCategories.id, id)).returning();
    if (!category) return Response.json({ error: "No se encontró la categoría." }, { status: 404 });
    return Response.json({ category });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la categoría." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["abc.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id, 100);
    const db = await getDb();
    const [record] = await db.select().from(abcRecords).where(eq(abcRecords.id, id)).limit(1);
    if (!record) return Response.json({ error: "No se encontró el registro ABC." }, { status: 404 });
    await childWithinScope(record.profileId, account);
    await db.delete(abcRecords).where(eq(abcRecords.id, id));
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el registro ABC." }, { status: 500 });
  }
}
