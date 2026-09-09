import { and, asc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clinicalDataAudit, meetingRequests, sessionAppointments } from "../../../db/schema";
import { apiAccountGuard, roleLabel, type AppRole } from "../../../lib/access-control";
import {
  MEETING_BLOCKING_STATUSES,
  MEETING_RECIPIENT_ROLES,
  meetingDateValue,
  meetingTimeValue,
  todayInNicaragua,
} from "../../../lib/meetings";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

type DirectoryAccount = {
  id: string;
  displayName: string;
  email: string;
  role: AppRole;
};

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dayShift(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

async function meetingDirectory() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("app_accounts")
    .select("id,display_name,email,role,status")
    .eq("status", "active")
    .in("role", [...MEETING_RECIPIENT_ROLES])
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data || []).map((item) => ({
    id: String(item.id),
    displayName: String(item.display_name),
    email: String(item.email),
    role: String(item.role) as AppRole,
  })) satisfies DirectoryAccount[];
}

async function accountDirectory(ids: string[]) {
  if (!ids.length) return new Map<string, DirectoryAccount>();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("app_accounts")
    .select("id,display_name,email,role")
    .in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((item) => [String(item.id), {
    id: String(item.id),
    displayName: String(item.display_name),
    email: String(item.email),
    role: String(item.role) as AppRole,
  }]));
}

async function serialize(rows: Array<typeof meetingRequests.$inferSelect>) {
  if (!rows.length) return [];
  const directory = await accountDirectory(rows.flatMap((row) => [row.requesterAccountId, row.recipientAccountId]));
  const db = await getDb();
  const history = await db.select().from(clinicalDataAudit).where(and(eq(clinicalDataAudit.resourceType,"meeting_request"),inArray(clinicalDataAudit.resourceId,rows.map(r=>r.id)))).orderBy(asc(clinicalDataAudit.createdAt),sql`rowid`);
  return rows.map((row) => {
    const requester = directory.get(row.requesterAccountId);
    const recipient = directory.get(row.recipientAccountId);
    return {
      ...row,
      requesterName: requester?.displayName || "Usuario no disponible",
      requesterEmail: requester?.email || "",
      recipientName: recipient?.displayName || "Usuario no disponible",
      recipientEmail: recipient?.email || "",
      recipientRole: recipient?.role || null,
      recipientRoleLabel: recipient?.role ? roleLabel(recipient.role) : "",
      history: history.filter(h=>h.resourceId===row.id).map(h=>{
        let status = ""; try { status = String(JSON.parse(h.afterSnapshot).status || ""); } catch {}
        return {id:h.id,status,at:h.createdAt};
      }).filter(h=>["pending","accepted","declined","cancelled"].includes(h.status)),
    };
  });
}

async function ensureAvailable(recipientAccountId: string, meetingDate: string, startTime: string, endTime: string, excludeMeetingId = "") {
  const db = await getDb();
  const [sessionConflict] = await db.select({ id: sessionAppointments.id }).from(sessionAppointments).where(and(
    eq(sessionAppointments.professionalAccountId, recipientAccountId),
    eq(sessionAppointments.sessionDate, meetingDate),
    ne(sessionAppointments.status, "cancelled"),
    sql`${sessionAppointments.startTime} < ${endTime} and ${sessionAppointments.endTime} > ${startTime}`,
  )).limit(1);
  if (sessionConflict) throw new Error("Ese horario ya está ocupado en la agenda clínica del destinatario.");

  const [meetingConflict] = await db.select({ id: meetingRequests.id }).from(meetingRequests).where(and(
    or(eq(meetingRequests.recipientAccountId, recipientAccountId),eq(meetingRequests.requesterAccountId, recipientAccountId)),
    eq(meetingRequests.meetingDate, meetingDate),
    inArray(meetingRequests.status, [...MEETING_BLOCKING_STATUSES]),
    excludeMeetingId ? ne(meetingRequests.id, excludeMeetingId) : undefined,
    sql`${meetingRequests.startTime} < ${endTime} and ${meetingRequests.endTime} > ${startTime}`,
  )).limit(1);
  if (meetingConflict) throw new Error("Ese horario ya tiene otra reunión solicitada o aceptada.");
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  try {
    const url = new URL(request.url);
    const today = todayInNicaragua();
    const from = meetingDateValue(url.searchParams.get("from")) || today;
    const requestedTo = meetingDateValue(url.searchParams.get("to")) || dayShift(new Date(`${from}T12:00:00Z`), 13);
    const maxTo = dayShift(new Date(`${from}T12:00:00Z`), 120);
    const to = requestedTo > maxTo ? maxTo : requestedTo;
    const recipientId = clean(url.searchParams.get("recipientId"), 100);
    const directory = await meetingDirectory();
    const recipients = directory.filter((item) => item.id !== account.id);
    const db = await getDb();
    const rows = await db.select().from(meetingRequests).where(or(
      eq(meetingRequests.requesterAccountId, account.id),
      eq(meetingRequests.recipientAccountId, account.id),
    )).orderBy(asc(meetingRequests.meetingDate), asc(meetingRequests.startTime));

    let busyBlocks: Array<{ id: string; date: string; startTime: string; endTime: string; source: "session" | "meeting" }> = [];
    if (recipientId && directory.some((item) => item.id === recipientId)) {
      const [sessions, meetings] = await Promise.all([
        db.select({ id: sessionAppointments.id, date: sessionAppointments.sessionDate, startTime: sessionAppointments.startTime, endTime: sessionAppointments.endTime })
          .from(sessionAppointments)
          .where(and(
            eq(sessionAppointments.professionalAccountId, recipientId),
            ne(sessionAppointments.status, "cancelled"),
            gte(sessionAppointments.sessionDate, from),
            lte(sessionAppointments.sessionDate, to),
          )),
        db.select({ id: meetingRequests.id, date: meetingRequests.meetingDate, startTime: meetingRequests.startTime, endTime: meetingRequests.endTime })
          .from(meetingRequests)
          .where(and(
            or(eq(meetingRequests.recipientAccountId, recipientId),eq(meetingRequests.requesterAccountId, recipientId)),
            inArray(meetingRequests.status, [...MEETING_BLOCKING_STATUSES]),
            gte(meetingRequests.meetingDate, from),
            lte(meetingRequests.meetingDate, to),
          )),
      ]);
      busyBlocks = [
        ...sessions.map((item) => ({ ...item, source: "session" as const })),
        ...meetings.map((item) => ({ ...item, source: "meeting" as const })),
      ].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
    }

    return Response.json({
      recipients,
      requests: await serialize(rows),
      busyBlocks,
      currentAccountId: account.id,
      from,
      to,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar la agenda de reuniones." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const recipientAccountId = clean(body.recipientAccountId, 100);
    const meetingDate = meetingDateValue(body.meetingDate);
    const startTime = meetingTimeValue(body.startTime);
    const endTime = meetingTimeValue(body.endTime);
    const subject = clean(body.subject, 160);
    const description = clean(body.description, 3000);
    if (!recipientAccountId || !meetingDate || !startTime || !endTime || endTime <= startTime || !subject || !description) {
      return Response.json({ error: "Selecciona destinatario, fecha y horario, e incluye asunto y descripción." }, { status: 400 });
    }
    if (meetingDate < todayInNicaragua()) return Response.json({ error: "Selecciona una fecha actual o futura." }, { status: 400 });
    if (recipientAccountId === account.id) return Response.json({ error: "Selecciona a otro profesional para solicitar la reunión." }, { status: 400 });
    const recipient = (await meetingDirectory()).find((item) => item.id === recipientAccountId);
    if (!recipient) return Response.json({ error: "El destinatario debe ser un subdirector activo o Dirección Clínica." }, { status: 403 });
    await ensureAvailable(recipientAccountId, meetingDate, startTime, endTime);
    await ensureAvailable(account.id, meetingDate, startTime, endTime);
    const db = await getDb();
    const [created] = await db.insert(meetingRequests).values({
      id: crypto.randomUUID(),
      requesterAccountId: account.id,
      recipientAccountId,
      meetingDate,
      startTime,
      endTime,
      subject,
      description,
    }).returning();
    return Response.json({ request: (await serialize([created]))[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo solicitar la reunión.";
    const conflict = /horario|meeting_schedule_conflict/.test(message + " " + String((error as {cause?:unknown})?.cause));
    return Response.json({ error: conflict ? "Ese horario ya está ocupado para uno de los participantes. Actualiza la agenda." : "No se pudo solicitar la reunión." }, { status: conflict ? 409 : 500 });
  }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id, 100);
    const action = clean(body.action, 20);
    const db = await getDb();
    const [current] = await db.select().from(meetingRequests).where(eq(meetingRequests.id, id)).limit(1);
    if (!current) return Response.json({ error: "No se encontró la solicitud de reunión." }, { status: 404 });

    let nextStatus = "";
    if (action === "cancel" && current.requesterAccountId === account.id && ["pending", "accepted"].includes(current.status)) nextStatus = "cancelled";
    if (action === "accept" && current.recipientAccountId === account.id && current.status === "pending") nextStatus = "accepted";
    if (action === "decline" && current.recipientAccountId === account.id && current.status === "pending") nextStatus = "declined";
    if (!nextStatus) return Response.json({ error: "No tienes permiso para realizar esa acción sobre la solicitud." }, { status: 403 });
    if (nextStatus === "accepted") {
      if (!(await meetingDirectory()).some(item=>item.id===current.recipientAccountId)) return Response.json({error:"El destinatario ya no tiene un rol habilitado para recibir reuniones."},{status:403});
      await ensureAvailable(current.recipientAccountId, current.meetingDate, current.startTime, current.endTime, current.id);
      await ensureAvailable(current.requesterAccountId, current.meetingDate, current.startTime, current.endTime, current.id);
    }

    const [updated] = await db.update(meetingRequests).set({
      status: nextStatus,
      respondedAt: nextStatus === "accepted" || nextStatus === "declined" ? sql`CURRENT_TIMESTAMP` : current.respondedAt,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(meetingRequests.id, id),eq(meetingRequests.status,current.status))).returning();
    if (!updated) return Response.json({error:"La solicitud cambió mientras la revisabas. Actualiza la lista."},{status:409});
    return Response.json({ request: (await serialize([updated]))[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar la solicitud.";
    const conflict = message.includes("horario") || String((error as {cause?:unknown})?.cause).includes("meeting_schedule_conflict") || message.includes("meeting_schedule_conflict");
    return Response.json({ error: conflict ? "Ese horario ya está ocupado para uno de los participantes. Actualiza la agenda." : "No se pudo actualizar la solicitud." }, { status: conflict ? 409 : 500 });
  }
}
