import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { apiAccountGuard, canAccessChild, hasPermission, visibleProfileIds, type AppRole } from "../../../lib/access-control";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { removeProfilePhotos, signedProfilePhotoMap } from "../../../lib/profile-photos";
import {
  childDocuments,
  interventionPrograms,
  interventionSessions,
  personnelProfiles,
  trainingCycles,
} from "../../../db/schema";
import { isActiveSite } from "../../../lib/sites";
import { summarizeClosedSessions } from "../../../lib/clinical-session-runs";

type Bucket = { delete(key: string): Promise<void> };

const RESPONSIBLE_ROLES = new Set<AppRole>(["coordinador", "supervisor", "subdirector"]);

function textValue(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function customFieldsValue(value: unknown) {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(value.slice(0, 20).map((item) => {
    const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: textValue(raw.id, 80) || crypto.randomUUID(),
      label: textValue(raw.label, 80),
      value: textValue(raw.value, 500),
    };
  }).filter((item) => item.label));
}

function parseCustomFields(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function serializeProfile<T extends typeof personnelProfiles.$inferSelect>(profile: T) {
  return { ...profile, role: "Niño", customFields: parseCustomFields(profile.customFields) };
}

async function optionalBucket() {
  try {
    const workers = await import("cloudflare:workers");
    return (workers.env as unknown as { BUCKET?: Bucket }).BUCKET || null;
  } catch { return null; }
}

function normalizedKey(name: string, site: string) {
  return `${site.trim().toLocaleLowerCase("es")}::${name.trim().toLocaleLowerCase("es")}`;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Error inesperado";
  return message.includes("no such table")
    ? "El almacenamiento de niños todavía no está preparado."
    : message;
}

function responsibleIds(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    coordinador: textValue(raw.coordinador, 100) || null,
    supervisor: textValue(raw.supervisor, 100) || null,
    subdirector: textValue(raw.subdirector, 100) || null,
  };
}

async function replaceResponsibles(profileId: string, value: unknown) {
  const ids = responsibleIds(value);
  const requested = Object.values(ids).filter((id): id is string => Boolean(id));
  const supabase = await createSupabaseServerClient();
  if (requested.length) {
    const { data: accounts, error } = await supabase
      .from("app_accounts")
      .select("id,role,status")
      .in("id", requested);
    if (error) throw new Error(error.message);
    const byId = new Map((accounts || []).map((item) => [String(item.id), item]));
    for (const [role, id] of Object.entries(ids)) {
      if (!id) continue;
      const account = byId.get(id);
      if (!account || account.role !== role || !RESPONSIBLE_ROLES.has(account.role as AppRole) || account.status === "suspended") {
        throw new Error(`Selecciona una cuenta válida para ${role}.`);
      }
    }
  }
  const { error } = await supabase.rpc("replace_child_responsibles", {
    child_id: profileId,
    coordinator_id: ids.coordinador,
    supervisor_id: ids.supervisor,
    subdirector_id: ids.subdirector,
  });
  if (error) throw new Error(error.message);
  return ids;
}

export async function GET() {
  const { account, denied } = await apiAccountGuard({ permissions: ["children.view"] });
  if (denied || !account) return denied;
  try {
    const db = await getDb();
    const [profiles, cycles, programs, sessions] = await Promise.all([
      db.select().from(personnelProfiles).orderBy(asc(personnelProfiles.site), asc(personnelProfiles.fullName)),
      db.select({ id: trainingCycles.id, profileId: trainingCycles.profileId }).from(trainingCycles),
      db.select({ id: interventionPrograms.id, profileId: interventionPrograms.profileId }).from(interventionPrograms),
      db.select({ id: interventionSessions.id, programId: interventionSessions.programId, clinicalSessionRunId: interventionSessions.clinicalSessionRunId, status: interventionSessions.status }).from(interventionSessions).where(eq(interventionSessions.status, "closed")),
    ]);
    const programOwner = new Map(programs.map((program) => [program.id, program.profileId]));
    const allowedIds = visibleProfileIds(account, profiles);
    const visibleProfiles = profiles.filter((profile) => allowedIds.has(profile.id));
    const supabase = await createSupabaseServerClient();
    const photoUrls = await signedProfilePhotoMap(supabase, "child", visibleProfiles.map((profile) => profile.id));
    let linkableAccounts: Array<{ id: string; displayName: string; role: AppRole; status: string }> = [];
    let assignments: Array<{ account_id: string; profile_id: string }> = [];
    if (hasPermission(account, "children.manage")) {
      const [{ data: accountRows }, { data: assignmentRows }] = await Promise.all([
        supabase.from("app_accounts").select("id,display_name,role,status").in("role", [...RESPONSIBLE_ROLES]).neq("status", "suspended").order("display_name"),
        supabase.from("account_assignments").select("account_id,profile_id"),
      ]);
      linkableAccounts = (accountRows || []).map((item) => ({ id: String(item.id), displayName: String(item.display_name), role: item.role as AppRole, status: String(item.status) }));
      const linkableIds = new Set(linkableAccounts.map((item) => item.id));
      assignments = (assignmentRows || []).filter((item) => linkableIds.has(String(item.account_id))).map((item) => ({ account_id: String(item.account_id), profile_id: String(item.profile_id) }));
    }
    const accountById = new Map(linkableAccounts.map((item) => [item.id, item]));
    return Response.json({
      profiles: visibleProfiles.map((profile) => {
        const linked = assignments.filter((item) => item.profile_id === profile.id).map((item) => accountById.get(item.account_id)).filter(Boolean);
        const activity = summarizeClosedSessions(sessions.filter((session) => programOwner.get(session.programId) === profile.id));
        return {
          ...serializeProfile(profile),
          evaluationCount: cycles.filter((cycle) => cycle.profileId === profile.id).length,
          programCount: programs.filter((program) => program.profileId === profile.id).length,
          sessionCount: activity.sessionCount,
          programRecordCount: activity.programRecordCount,
          responsibleAccountIds: {
            coordinador: linked.find((item) => item?.role === "coordinador")?.id || null,
            supervisor: linked.find((item) => item?.role === "supervisor")?.id || null,
            subdirector: linked.find((item) => item?.role === "subdirector")?.id || null,
          },
          responsibles: linked,
          photoUrl: photoUrls.get(profile.id) || null,
        };
      }),
      linkableAccounts,
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { denied } = await apiAccountGuard({ permissions: ["children.manage"] });
  if (denied) return denied;
  const body = await request.json() as Record<string, unknown>;
  const fullName = textValue(body.fullName, 160);
  const site = textValue(body.site, 60);
  if (!fullName || !(await isActiveSite(site))) return Response.json({ error: "Nombre y una sede activa son obligatorios." }, { status: 400 });
  const id = crypto.randomUUID();
  try {
    await replaceResponsibles(id, body.responsibleAccountIds);
    const db = await getDb();
    const existing = await db.select().from(personnelProfiles);
    if (existing.some((profile) => normalizedKey(profile.fullName, profile.site) === normalizedKey(fullName, site))) {
      await replaceResponsibles(id, {});
      return Response.json({ error: "Ya existe un niño con ese nombre en la misma sede." }, { status: 409 });
    }
    const [profile] = await db.insert(personnelProfiles).values({
      id,
      fullName,
      role: "Niño",
      site,
      internalCode: textValue(body.internalCode, 100),
      dateOfBirth: textValue(body.dateOfBirth, 10),
      diagnosis: textValue(body.diagnosis, 500),
      address: textValue(body.address, 500),
      phone: textValue(body.phone, 80),
      guardianName: textValue(body.guardianName, 160),
      guardianPhone: textValue(body.guardianPhone, 80),
      preferredLanguage: textValue(body.preferredLanguage, 100),
      emergencyContact: textValue(body.emergencyContact, 300),
      customFields: customFieldsValue(body.customFields),
      notes: textValue(body.notes),
    }).returning();
    return Response.json({ profile: { ...serializeProfile(profile), evaluationCount: 0, programCount: 0, sessionCount: 0, programRecordCount: 0, responsibleAccountIds: responsibleIds(body.responsibleAccountIds) } }, { status: 201 });
  } catch (error) {
    await replaceResponsibles(id, {}).catch(() => undefined);
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["children.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = textValue(body.id, 100);
    if (!id) return Response.json({ error: "Niño no válido." }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró el niño." }, { status: 404 });
    if (!canAccessChild(account, current)) return Response.json({ error: "Este niño no está dentro de tu alcance." }, { status: 403 });

    if (body.action === "archive" || body.action === "restore") {
      const [profile] = await db.update(personnelProfiles).set({
        status: body.action === "archive" ? "archived" : "active",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(personnelProfiles.id, id)).returning();
      return Response.json({ profile: serializeProfile(profile) });
    }

    const fullName = textValue(body.fullName, 160);
    const site = textValue(body.site, 60);
    if (!fullName || !(await isActiveSite(site))) return Response.json({ error: "Nombre y una sede activa son obligatorios." }, { status: 400 });
    const profiles = await db.select().from(personnelProfiles);
    if (profiles.some((profile) => profile.id !== id && normalizedKey(profile.fullName, profile.site) === normalizedKey(fullName, site))) {
      return Response.json({ error: "Ya existe otro niño con ese nombre en la misma sede." }, { status: 409 });
    }
    const responsibleAccountIds = await replaceResponsibles(id, body.responsibleAccountIds);
    const [profile] = await db.update(personnelProfiles).set({
      fullName,
      role: "Niño",
      site,
      internalCode: textValue(body.internalCode, 100),
      dateOfBirth: textValue(body.dateOfBirth, 10),
      diagnosis: textValue(body.diagnosis, 500),
      address: textValue(body.address, 500),
      phone: textValue(body.phone, 80),
      guardianName: textValue(body.guardianName, 160),
      guardianPhone: textValue(body.guardianPhone, 80),
      preferredLanguage: textValue(body.preferredLanguage, 100),
      emergencyContact: textValue(body.emergencyContact, 300),
      customFields: customFieldsValue(body.customFields),
      notes: textValue(body.notes),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(personnelProfiles.id, id)).returning();

    await db.batch([
      db.update(trainingCycles).set({ participantName: fullName, role: "Niño", site, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(trainingCycles.profileId, id)),
      db.update(interventionPrograms).set({ participantName: fullName, site, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(interventionPrograms.profileId, id)),
    ]);
    return Response.json({ profile: { ...serializeProfile(profile), responsibleAccountIds } });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["children.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = textValue(body.id, 100);
    if (!id) return Response.json({ error: "Niño no válido." }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró el niño." }, { status: 404 });
    if (!canAccessChild(account, current)) return Response.json({ error: "Este niño no está dentro de tu alcance." }, { status: 403 });
    const [cycles, programs, documents] = await Promise.all([
      db.select({ id: trainingCycles.id }).from(trainingCycles).where(eq(trainingCycles.profileId, id)),
      db.select({ id: interventionPrograms.id }).from(interventionPrograms).where(eq(interventionPrograms.profileId, id)),
      db.select({ storageKey: childDocuments.storageKey }).from(childDocuments).where(eq(childDocuments.profileId, id)),
    ]);
    await db.batch([
      db.delete(trainingCycles).where(eq(trainingCycles.profileId, id)),
      db.delete(interventionPrograms).where(eq(interventionPrograms.profileId, id)),
    ]);
    await db.delete(personnelProfiles).where(eq(personnelProfiles.id, id));
    const bucket = await optionalBucket();
    if (bucket) await Promise.all(documents.map((document) => bucket.delete(document.storageKey).catch(() => undefined)));
    const supabase = await createSupabaseServerClient();
    await removeProfilePhotos(supabase, "child", id).catch(() => undefined);
    await replaceResponsibles(id, {});
    return Response.json({ deleted: true, id, deletedEvaluations: cycles.length, deletedPrograms: programs.length });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
