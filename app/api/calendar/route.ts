import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb, getRawDb } from "../../../db";
import { abcRecords, meetingRequests, personnelProfiles, sessionAppointments } from "../../../db/schema";
import { apiAccountGuard, canAccessChild, hasPermission, ROLE_ORDER, type AppRole } from "../../../lib/access-control";
import { appointmentHasClinicalEvidence, canAdministrativelyDeleteAppointment, normalizeCancellationInput } from "../../../lib/calendar-appointments";
import { MEETING_BLOCKING_STATUSES } from "../../../lib/meetings";
import { canClinicalProfessionalServeChild } from "../../../lib/resource-scope";
import { isActiveSite } from "../../../lib/sites";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const STATUSES = new Set(["scheduled", "in_progress", "completed", "cancelled"]);

type CancellationAudit = {
  appointment_id: string;
  category: string | null;
  reason: string;
  actor_account_id: string;
  created_at: string;
};

function clean(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateValue(value: unknown) {
  const valueText = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : "";
}

function timeValue(value: unknown) {
  const valueText = clean(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(valueText) ? valueText : "";
}

function dayShift(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

async function clinicalProfessionalCatalog() {
  const db = await getDb();
  const profiles = await db.select({ id: personnelProfiles.id, site: personnelProfiles.site, status: personnelProfiles.status }).from(personnelProfiles);
  const supabase = await createSupabaseServerClient();
  const [{ data: accounts, error }, { data: assignments }, { data: permissionRows }] = await Promise.all([
    supabase.from("app_accounts").select("id,display_name,email,role,status,site_scope").eq("status", "active").order("display_name"),
    supabase.from("account_assignments").select("account_id,profile_id"),
    supabase.from("role_permissions").select("role,allowed").eq("permission_key", "sessions.record").eq("allowed", true),
  ]);
  if (error) throw new Error(error.message);
  const clinicalRoles = new Set<string>(ROLE_ORDER);
  const recordingRoles = new Set<string>(["direccion_clinica", ...(permissionRows || []).map((item) => String(item.role))]);
  return (accounts || []).filter((item) => clinicalRoles.has(String(item.role)) && recordingRoles.has(String(item.role))).map((item) => {
    const assignedProfileIds = (assignments || []).filter((assignment) => assignment.account_id === item.id).map((assignment) => String(assignment.profile_id));
    const scope = {
      role: String(item.role) as AppRole,
      siteScope: Array.isArray(item.site_scope) ? item.site_scope.map(String) : [],
      assignedProfileIds,
    };
    return {
      id: String(item.id),
      displayName: String(item.display_name),
      email: String(item.email),
      role: scope.role,
      siteScope: scope.siteScope,
      assignedProfileIds,
      eligibleProfileIds: profiles.filter((profile) => profile.status === "active" && canClinicalProfessionalServeChild(scope, profile)).map((profile) => profile.id),
    };
  });
}

async function appointmentView(account: Awaited<ReturnType<typeof apiAccountGuard>>["account"], row: typeof sessionAppointments.$inferSelect) {
  if (!account) return false;
  if (account.role === "terapeuta" && row.professionalAccountId !== account.id) return false;
  const db = await getDb();
  const [profile] = await db.select({ id: personnelProfiles.id, site: personnelProfiles.site }).from(personnelProfiles).where(eq(personnelProfiles.id, row.profileId)).limit(1);
  return Boolean(profile && canAccessChild(account, profile));
}

async function latestCancellationAudit(rows: Array<typeof sessionAppointments.$inferSelect>) {
  const result = new Map<string, CancellationAudit>();
  if (!rows.length) return result;
  const rawDb = await getRawDb();
  const ids = rows.filter((row) => row.status === "cancelled").map((row) => row.id);
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const response = await rawDb.prepare(`
      SELECT appointment_id, category, reason, actor_account_id, created_at
      FROM session_appointment_audit
      WHERE action = 'cancel' AND appointment_id IN (${placeholders})
      ORDER BY created_at DESC
    `).bind(...chunk).all<CancellationAudit>();
    for (const row of response.results || []) if (!result.has(row.appointment_id)) result.set(row.appointment_id, row);
  }
  return result;
}

async function serializeRows(rows: Array<typeof sessionAppointments.$inferSelect>, account: NonNullable<Awaited<ReturnType<typeof apiAccountGuard>>["account"]>) {
  const db = await getDb();
  const profiles = rows.length ? await db.select({ id: personnelProfiles.id, fullName: personnelProfiles.fullName, site: personnelProfiles.site, status: personnelProfiles.status }).from(personnelProfiles) : [];
  const professionals = await clinicalProfessionalCatalog();
  const cancellationAudit = await latestCancellationAudit(rows);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const professionalMap = new Map(professionals.map((professional) => [professional.id, professional]));
  return rows.map((row) => {
    const cancellation = cancellationAudit.get(row.id);
    return {
      ...row,
      profileName: profileMap.get(row.profileId)?.fullName || "Niño no disponible",
      professionalName: professionalMap.get(row.professionalAccountId)?.displayName || "Profesional no disponible",
      professionalRole: professionalMap.get(row.professionalAccountId)?.role || null,
      canStart: row.professionalAccountId === account.id && (hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage")),
      cancellationCategory: cancellation?.category || null,
      cancellationReason: cancellation?.reason || "",
      cancelledByAccountId: cancellation?.actor_account_id || null,
      cancelledAt: cancellation?.created_at || null,
    };
  });
}

async function validateProfessional(professionalAccountId: string, profileId: string) {
  const professional = (await clinicalProfessionalCatalog()).find((item) => item.id === professionalAccountId);
  if (!professional) throw new Error("Selecciona un profesional clínico activo con permiso para registrar sesiones.");
  if (!professional.eligibleProfileIds.includes(profileId)) throw new Error("El niño no está dentro del alcance clínico del profesional seleccionado.");
  return professional;
}

async function ensureNoOverlap(professionalAccountId: string, sessionDate: string, startTime: string, endTime: string, excludeId = "") {
  const db = await getDb();
  const [overlap] = await db.select({ id: sessionAppointments.id }).from(sessionAppointments).where(and(
    eq(sessionAppointments.professionalAccountId, professionalAccountId),
    eq(sessionAppointments.sessionDate, sessionDate),
    ne(sessionAppointments.status, "cancelled"),
    excludeId ? ne(sessionAppointments.id, excludeId) : undefined,
    sql`${sessionAppointments.startTime} < ${endTime} and ${sessionAppointments.endTime} > ${startTime}`,
  )).limit(1);
  if (overlap) throw new Error("El profesional ya tiene otra sesión programada dentro de ese horario.");
  const [meetingOverlap] = await db.select({ id: meetingRequests.id }).from(meetingRequests).where(and(
    eq(meetingRequests.recipientAccountId, professionalAccountId),
    eq(meetingRequests.meetingDate, sessionDate),
    inArray(meetingRequests.status, [...MEETING_BLOCKING_STATUSES]),
    sql`${meetingRequests.startTime} < ${endTime} and ${meetingRequests.endTime} > ${startTime}`,
  )).limit(1);
  if (meetingOverlap) throw new Error("El profesional ya tiene una reunión solicitada o aceptada dentro de ese horario.");
}

async function hasAppointmentEvidence(appointment: typeof sessionAppointments.$inferSelect) {
  if (appointmentHasClinicalEvidence(appointment)) return true;
  const db = await getDb();
  const [abcEvidence] = await db.select({ id: abcRecords.id }).from(abcRecords).where(eq(abcRecords.appointmentId, appointment.id)).limit(1);
  return Boolean(abcEvidence);
}

function appointmentSnapshot(appointment: typeof sessionAppointments.$inferSelect) {
  return JSON.stringify({
    id: appointment.id,
    profileId: appointment.profileId,
    professionalAccountId: appointment.professionalAccountId,
    site: appointment.site,
    sessionDate: appointment.sessionDate,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    sessionType: appointment.sessionType,
    notes: appointment.notes,
    status: appointment.status,
    clinicalSessionRunId: appointment.clinicalSessionRunId,
    interventionSessionId: appointment.interventionSessionId,
  });
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["calendar.view", "calendar.manage"] });
  if (denied || !account) return denied;
  try {
    const url = new URL(request.url);
    const today = new Date();
    const from = dateValue(url.searchParams.get("from")) || dayShift(today, -7);
    const requestedTo = dateValue(url.searchParams.get("to")) || dayShift(today, 60);
    const maxTo = dayShift(new Date(`${from}T00:00:00Z`), 180);
    const to = requestedTo > maxTo ? maxTo : requestedTo;
    const mineOnly = url.searchParams.get("mine") === "1";
    const db = await getDb();
    const rows = await db.select().from(sessionAppointments)
      .where(and(gte(sessionAppointments.sessionDate, from), lte(sessionAppointments.sessionDate, to)))
      .orderBy(asc(sessionAppointments.sessionDate), asc(sessionAppointments.startTime));
    const visible: Array<typeof sessionAppointments.$inferSelect> = [];
    for (const row of rows) if ((!mineOnly || row.professionalAccountId === account.id) && await appointmentView(account, row)) visible.push(row);
    const canManage = hasPermission(account, "calendar.manage");
    return Response.json({
      appointments: await serializeRows(visible, account),
      professionals: canManage ? await clinicalProfessionalCatalog() : [],
      canManage,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar el calendario." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["calendar.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const profileId = clean(body.profileId, 100);
    const professionalAccountId = clean(body.professionalAccountId, 100);
    const sessionDate = dateValue(body.sessionDate);
    const startTime = timeValue(body.startTime);
    const endTime = timeValue(body.endTime);
    const sessionType = clean(body.sessionType, 100) || "Terapia individual";
    if (!profileId || !professionalAccountId || !sessionDate || !startTime || !endTime || endTime <= startTime) {
      return Response.json({ error: "Completa niño, profesional, fecha y un horario válido." }, { status: 400 });
    }
    const db = await getDb();
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
    if (!profile || profile.status !== "active" || !canAccessChild(account, profile)) return Response.json({ error: "El niño no está dentro de tu alcance." }, { status: 403 });
    if (!(await isActiveSite(profile.site))) return Response.json({ error: "La sede del niño no está activa." }, { status: 409 });
    await validateProfessional(professionalAccountId, profileId);
    await ensureNoOverlap(professionalAccountId, sessionDate, startTime, endTime);
    const [appointment] = await db.insert(sessionAppointments).values({
      id: crypto.randomUUID(), profileId, professionalAccountId, site: profile.site, sessionDate, startTime, endTime,
      sessionType, notes: clean(body.notes, 2000), createdByAccountId: account.id,
    }).returning();
    return Response.json({ appointment: (await serializeRows([appointment], account))[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo programar la sesión.";
    if ((message + String((error as {cause?:unknown})?.cause)).includes("meeting_schedule_conflict")) return Response.json({error:"El profesional tiene una reunión en ese horario. Actualiza la agenda."},{status:409});
    return Response.json({ error: message }, { status: /Vincula|Selecciona|horario/.test(message) ? 409 : 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["calendar.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id, 100);
    const db = await getDb();
    const [current] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la sesión programada." }, { status: 404 });
    if (!(await appointmentView(account, current))) return Response.json({ error: "La sesión no está dentro de tu alcance." }, { status: 403 });

    if (body.action === "cancel") {
      if (await hasAppointmentEvidence(current)) return Response.json({ error: "La cita ya contiene evidencia clínica y no puede cancelarse como una cita administrativa." }, { status: 409 });
      const { category, reason } = normalizeCancellationInput(body.cancellationCategory, body.cancellationReason);
      const now = new Date().toISOString();
      const rawDb = await getRawDb();
      await rawDb.batch([
        rawDb.prepare("UPDATE session_appointments SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, id),
        rawDb.prepare("INSERT INTO session_appointment_audit (id, appointment_id, action, category, reason, actor_account_id, snapshot, created_at) VALUES (?, ?, 'cancel', ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), id, category, reason, account.id, appointmentSnapshot(current), now),
      ]);
      const [appointment] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
      return Response.json({ appointment: (await serializeRows([appointment], account))[0] });
    }

    if (body.action === "restore") {
      if (await hasAppointmentEvidence(current)) return Response.json({ error: "La cita contiene evidencia clínica y su estado no puede restaurarse desde el calendario." }, { status: 409 });
      if (current.status !== "cancelled") return Response.json({ error: "Sólo una cita cancelada puede restaurarse." }, { status: 409 });
      await ensureNoOverlap(current.professionalAccountId, current.sessionDate, current.startTime, current.endTime, current.id);
      const now = new Date().toISOString();
      const rawDb = await getRawDb();
      await rawDb.batch([
        rawDb.prepare("UPDATE session_appointments SET status = 'scheduled', updated_at = ? WHERE id = ?").bind(now, id),
        rawDb.prepare("INSERT INTO session_appointment_audit (id, appointment_id, action, category, reason, actor_account_id, snapshot, created_at) VALUES (?, ?, 'restore', NULL, '', ?, ?, ?)")
          .bind(crypto.randomUUID(), id, account.id, appointmentSnapshot(current), now),
      ]);
      const [appointment] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
      return Response.json({ appointment: (await serializeRows([appointment], account))[0] });
    }

    if (await hasAppointmentEvidence(current)) return Response.json({ error: "La cita ya contiene evidencia clínica y no puede editarse desde el calendario." }, { status: 409 });
    const profileId = clean(body.profileId, 100);
    const professionalAccountId = clean(body.professionalAccountId, 100);
    const sessionDate = dateValue(body.sessionDate);
    const startTime = timeValue(body.startTime);
    const endTime = timeValue(body.endTime);
    if (!profileId || !professionalAccountId || !sessionDate || !startTime || !endTime || endTime <= startTime) return Response.json({ error: "Completa un horario válido." }, { status: 400 });
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
    if (!profile || profile.status !== "active" || !canAccessChild(account, profile)) return Response.json({ error: "El niño no está dentro de tu alcance." }, { status: 403 });
    await validateProfessional(professionalAccountId, profileId);
    await ensureNoOverlap(professionalAccountId, sessionDate, startTime, endTime, id);
    const [appointment] = await db.update(sessionAppointments).set({
      profileId, professionalAccountId, site: profile.site, sessionDate, startTime, endTime,
      sessionType: clean(body.sessionType, 100) || "Terapia individual", notes: clean(body.notes, 2000),
      status: STATUSES.has(clean(body.status, 30)) ? clean(body.status, 30) : current.status,
      updatedAt: new Date().toISOString(),
    }).where(eq(sessionAppointments.id, id)).returning();
    return Response.json({ appointment: (await serializeRows([appointment], account))[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el calendario.";
    if ((message + String((error as {cause?:unknown})?.cause)).includes("meeting_schedule_conflict")) return Response.json({error:"El profesional tiene una reunión en ese horario. Actualiza la agenda."},{status:409});
    return Response.json({ error: message }, { status: /Vincula|Selecciona|horario|categoría|Describe/.test(message) ? 409 : 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["calendar.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id, 100);
    const db = await getDb();
    const [current] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la sesión programada." }, { status: 404 });
    if (!(await appointmentView(account, current))) return Response.json({ error: "La sesión no está dentro de tu alcance." }, { status: 403 });
    if (!canAdministrativelyDeleteAppointment(current) || await hasAppointmentEvidence(current)) {
      return Response.json({ error: "No puede eliminarse porque ya existe actividad o evidencia clínica asociada. Conserva la cita para mantener la trazabilidad." }, { status: 409 });
    }
    const now = new Date().toISOString();
    const rawDb = await getRawDb();
    await rawDb.batch([
      rawDb.prepare("INSERT INTO session_appointment_audit (id, appointment_id, action, category, reason, actor_account_id, snapshot, created_at) VALUES (?, ?, 'delete', NULL, '', ?, ?, ?)")
        .bind(crypto.randomUUID(), id, account.id, appointmentSnapshot(current), now),
      rawDb.prepare("DELETE FROM session_appointments WHERE id = ?").bind(id),
    ]);
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la cita del calendario." }, { status: 500 });
  }
}
