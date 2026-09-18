import { and, asc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { getDb, getRawDb } from "../../../db";
import { abcRecords, clinicalSessionRuns, meetingRequests, personnelProfiles, sessionAppointments } from "../../../db/schema";
import {
  appointmentHasLinkedClinicalEvidence,
  canAdministrativelyCancelAppointment,
  canAdministrativelyDeleteAppointment,
  canAdministrativelyEditAppointment,
  canAdministrativelyRestoreAppointment,
  cancellationLabel,
  validateCancellation,
} from "../../../lib/calendar-appointments";
import { appointmentRestoreAvailabilitySql, noAppointmentClinicalEvidenceSql } from "../../../lib/calendar-database-guards";
import { apiAccountGuard, canAccessChild, hasPermission, ROLE_ORDER, type AppRole } from "../../../lib/access-control";
import { MEETING_BLOCKING_STATUSES } from "../../../lib/meetings";
import { canClinicalProfessionalServeChild } from "../../../lib/resource-scope";
import { isActiveSite } from "../../../lib/sites";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

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

async function appointmentEvidenceIds(rows: Array<typeof sessionAppointments.$inferSelect>) {
  const ids = rows.map((row) => row.id);
  const evidenceIds = new Set(rows.filter(appointmentHasLinkedClinicalEvidence).map((row) => row.id));
  if (!ids.length) return evidenceIds;
  const db = await getDb();
  const [abcEvidence, runEvidence] = await Promise.all([
    db.select({ appointmentId: abcRecords.appointmentId }).from(abcRecords).where(inArray(abcRecords.appointmentId, ids)),
    db.select({ appointmentId: clinicalSessionRuns.appointmentId }).from(clinicalSessionRuns).where(inArray(clinicalSessionRuns.appointmentId, ids)),
  ]);
  for (const row of [...abcEvidence, ...runEvidence]) if (row.appointmentId) evidenceIds.add(row.appointmentId);
  return evidenceIds;
}

async function hasAppointmentEvidence(appointment: typeof sessionAppointments.$inferSelect) {
  return (await appointmentEvidenceIds([appointment])).has(appointment.id);
}

async function serializeRows(rows: Array<typeof sessionAppointments.$inferSelect>, account: NonNullable<Awaited<ReturnType<typeof apiAccountGuard>>["account"]>) {
  const db = await getDb();
  const profiles = rows.length ? await db.select({ id: personnelProfiles.id, fullName: personnelProfiles.fullName, site: personnelProfiles.site, status: personnelProfiles.status }).from(personnelProfiles) : [];
  const [professionals, evidenceIds] = await Promise.all([clinicalProfessionalCatalog(), appointmentEvidenceIds(rows)]);
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const professionalMap = new Map(professionals.map((professional) => [professional.id, professional]));
  return rows.map((row) => ({
    ...row,
    profileName: profileMap.get(row.profileId)?.fullName || "Niño no disponible",
    professionalName: professionalMap.get(row.professionalAccountId)?.displayName || "Profesional no disponible",
    professionalRole: professionalMap.get(row.professionalAccountId)?.role || null,
    canStart: row.professionalAccountId === account.id && (hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage")),
    hasClinicalEvidence: evidenceIds.has(row.id),
  }));
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
    or(eq(meetingRequests.recipientAccountId, professionalAccountId), eq(meetingRequests.requesterAccountId, professionalAccountId)),
    eq(meetingRequests.meetingDate, sessionDate),
    inArray(meetingRequests.status, [...MEETING_BLOCKING_STATUSES]),
    sql`${meetingRequests.startTime} < ${endTime} and ${meetingRequests.endTime} > ${startTime}`,
  )).limit(1);
  if (meetingOverlap) throw new Error("El profesional ya tiene una reunión solicitada o aceptada dentro de ese horario.");
}

function appointmentSnapshot(appointment: typeof sessionAppointments.$inferSelect) {
  return JSON.stringify(appointment);
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
      if (!canAdministrativelyCancelAppointment(current)) return Response.json({ error: "Sólo se puede cancelar una cita administrativa programada." }, { status: 409 });
      if (await hasAppointmentEvidence(current)) return Response.json({ error: "La cita ya contiene evidencia clínica y no puede cancelarse desde el calendario." }, { status: 409 });
      const cancellation = validateCancellation(body.cancellationCategory, body.cancellationReason);
      if ("error" in cancellation) return Response.json({ error: cancellation.error }, { status: 400 });
      const now = new Date().toISOString();
      const next = {
        ...current,
        status: "cancelled", cancellationCategory: cancellation!.category, cancellationReason: cancellation!.reason,
        cancelledAt: now, cancelledByAccountId: account.id, updatedAt: now,
      };
      const rawDb = await getRawDb();
      await rawDb.batch([
        rawDb.prepare(`
          INSERT INTO clinical_data_audit
            (id, resource_type, resource_id, action, actor_account_id, reason, before_snapshot, after_snapshot, created_at)
          SELECT ?, 'session_appointment', appointment.id, 'cancel', ?, ?, ?, ?, ?
          FROM session_appointments appointment
          WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status = 'scheduled'
            AND ${noAppointmentClinicalEvidenceSql("appointment")}
        `).bind(
          crypto.randomUUID(), account.id, cancellation.reason || cancellationLabel(cancellation.category),
          appointmentSnapshot(current), appointmentSnapshot(next), now, id, current.updatedAt,
        ),
        rawDb.prepare(`
          UPDATE session_appointments AS appointment
          SET status = 'cancelled', cancellation_category = ?, cancellation_reason = ?, cancelled_at = ?,
            cancelled_by_account_id = ?, updated_at = ?
          WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status = 'scheduled'
            AND ${noAppointmentClinicalEvidenceSql("appointment")}
        `).bind(cancellation.category, cancellation.reason, now, account.id, now, id, current.updatedAt),
      ]);
      const [appointment] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
      if (!appointment || appointment.status !== "cancelled" || appointment.cancelledAt !== now) {
        return Response.json({ error: "La cita cambió o recibió evidencia clínica mientras la gestionabas. Actualiza el calendario." }, { status: 409 });
      }
      return Response.json({ appointment: (await serializeRows([appointment], account))[0] });
    }

    if (body.action === "restore") {
      if (!canAdministrativelyRestoreAppointment(current)) return Response.json({ error: "Sólo se puede restaurar una cita administrativa cancelada." }, { status: 409 });
      if (await hasAppointmentEvidence(current)) return Response.json({ error: "La cita contiene evidencia clínica y no puede restaurarse desde el calendario." }, { status: 409 });
      await ensureNoOverlap(current.professionalAccountId, current.sessionDate, current.startTime, current.endTime, current.id);
      const now = new Date().toISOString();
      const next = {
        ...current,
        status: "scheduled", cancellationCategory: null, cancellationReason: "",
        cancelledAt: null, cancelledByAccountId: null, updatedAt: now,
      };
      const rawDb = await getRawDb();
      await rawDb.batch([
        rawDb.prepare(`
          INSERT INTO clinical_data_audit
            (id, resource_type, resource_id, action, actor_account_id, reason, before_snapshot, after_snapshot, created_at)
          SELECT ?, 'session_appointment', appointment.id, 'restore', ?, 'Sesión restaurada en el calendario.', ?, ?, ?
          FROM session_appointments appointment
          WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status = 'cancelled'
            AND ${noAppointmentClinicalEvidenceSql("appointment")}
            ${appointmentRestoreAvailabilitySql("appointment")}
        `).bind(crypto.randomUUID(), account.id, appointmentSnapshot(current), appointmentSnapshot(next), now, id, current.updatedAt),
        rawDb.prepare(`
          UPDATE session_appointments AS appointment
          SET status = 'scheduled', cancellation_category = NULL, cancellation_reason = '',
            cancelled_at = NULL, cancelled_by_account_id = NULL, updated_at = ?
          WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status = 'cancelled'
            AND ${noAppointmentClinicalEvidenceSql("appointment")}
            ${appointmentRestoreAvailabilitySql("appointment")}
        `).bind(now, id, current.updatedAt),
      ]);
      const [appointment] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
      if (!appointment || appointment.status !== "scheduled" || appointment.updatedAt !== now) {
        return Response.json({ error: "El horario dejó de estar disponible o la cita cambió. Actualiza el calendario antes de restaurarla." }, { status: 409 });
      }
      return Response.json({ appointment: (await serializeRows([appointment], account))[0] });
    }

    if (!canAdministrativelyEditAppointment(current) || await hasAppointmentEvidence(current)) {
      return Response.json({ error: "La cita contiene actividad o evidencia clínica y no puede editarse desde el calendario." }, { status: 409 });
    }
    const profileId = clean(body.profileId, 100);
    const professionalAccountId = clean(body.professionalAccountId, 100);
    const sessionDate = dateValue(body.sessionDate);
    const startTime = timeValue(body.startTime);
    const endTime = timeValue(body.endTime);
    if (!profileId || !professionalAccountId || !sessionDate || !startTime || !endTime || endTime <= startTime) return Response.json({ error: "Completa un horario válido." }, { status: 400 });
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
    if (!profile || profile.status !== "active" || !canAccessChild(account, profile)) return Response.json({ error: "El niño no está dentro de tu alcance." }, { status: 403 });
    if (!(await isActiveSite(profile.site))) return Response.json({ error: "La sede del niño no está activa." }, { status: 409 });
    await validateProfessional(professionalAccountId, profileId);
    if (current.status === "scheduled") await ensureNoOverlap(professionalAccountId, sessionDate, startTime, endTime, id);
    const now = new Date().toISOString();
    const rawDb = await getRawDb();
    await rawDb.prepare(`
      UPDATE session_appointments AS appointment
      SET profile_id = ?, professional_account_id = ?, site = ?, session_date = ?, start_time = ?, end_time = ?,
        session_type = ?, notes = ?, updated_at = ?
      WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status = ?
        AND ${noAppointmentClinicalEvidenceSql("appointment")}
    `).bind(
      profileId, professionalAccountId, profile.site, sessionDate, startTime, endTime,
      clean(body.sessionType, 100) || "Terapia individual", clean(body.notes, 2000), now,
      id, current.updatedAt, current.status,
    ).run();
    const [appointment] = await db.select().from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
    if (!appointment || appointment.updatedAt !== now) {
      return Response.json({ error: "La cita cambió o recibió evidencia clínica mientras la editabas. Actualiza el calendario." }, { status: 409 });
    }
    return Response.json({ appointment: (await serializeRows([appointment], account))[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el calendario.";
    if ((message + String((error as {cause?:unknown})?.cause)).includes("meeting_schedule_conflict")) return Response.json({error:"El profesional tiene una reunión en ese horario. Actualiza la agenda."},{status:409});
    return Response.json({ error: message }, { status: /Vincula|Selecciona|horario/.test(message) ? 409 : 500 });
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
      return Response.json({ error: "No puede eliminarse porque existe actividad o evidencia clínica asociada. La cita se conserva para proteger la trazabilidad." }, { status: 409 });
    }
    const now = new Date().toISOString();
    const rawDb = await getRawDb();
    await rawDb.batch([
      rawDb.prepare(`
        INSERT INTO clinical_data_audit
          (id, resource_type, resource_id, action, actor_account_id, reason, before_snapshot, after_snapshot, created_at)
        SELECT ?, 'session_appointment', appointment.id, 'delete', ?, 'Cita administrativa eliminada del calendario.', ?, '{}', ?
        FROM session_appointments appointment
        WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status IN ('scheduled', 'cancelled')
          AND ${noAppointmentClinicalEvidenceSql("appointment")}
      `).bind(crypto.randomUUID(), account.id, appointmentSnapshot(current), now, id, current.updatedAt),
      rawDb.prepare(`
        DELETE FROM session_appointments AS appointment
        WHERE appointment.id = ? AND appointment.updated_at = ? AND appointment.status IN ('scheduled', 'cancelled')
          AND ${noAppointmentClinicalEvidenceSql("appointment")}
      `).bind(id, current.updatedAt),
    ]);
    const [remaining] = await db.select({ id: sessionAppointments.id }).from(sessionAppointments).where(eq(sessionAppointments.id, id)).limit(1);
    if (remaining) return Response.json({ error: "La cita cambió o recibió evidencia clínica mientras la eliminabas. Actualiza el calendario." }, { status: 409 });
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la sesión programada." }, { status: 500 });
  }
}
