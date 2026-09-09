import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { personnelProfiles, sessionAppointments } from "../../../../../db/schema";
import { hasPermission } from "../../../../../lib/access-control";
import { boundedMobileDateRange, mobileApiGuard, mobileData, mobileError } from "../../../../../lib/mobile-api";

export async function GET(request: Request) {
  const { account, denied } = await mobileApiGuard(request, { anyPermissions: ["calendar.view", "calendar.manage"] });
  if (denied || !account) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const { from, to } = boundedMobileDateRange(params.get("from"), params.get("to"));
    const db = await getDb();
    const appointments = await db.select().from(sessionAppointments)
      .where(and(
        eq(sessionAppointments.professionalAccountId, account.id),
        gte(sessionAppointments.sessionDate, from),
        lte(sessionAppointments.sessionDate, to),
      ))
      .orderBy(asc(sessionAppointments.sessionDate), asc(sessionAppointments.startTime));
    const profileIds = [...new Set(appointments.map((appointment) => appointment.profileId))];
    const profiles = profileIds.length
      ? await db.select({ id: personnelProfiles.id, fullName: personnelProfiles.fullName, site: personnelProfiles.site, status: personnelProfiles.status })
        .from(personnelProfiles)
        .where(inArray(personnelProfiles.id, profileIds))
      : [];
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    const canRecord = hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage");
    return mobileData({
      range: { from, to },
      appointments: appointments.map((appointment) => {
        const profile = profileMap.get(appointment.profileId);
        return {
          id: appointment.id,
          profileId: appointment.profileId,
          profileName: profile?.fullName || "Niño no disponible",
          site: appointment.site,
          sessionDate: appointment.sessionDate,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          sessionType: appointment.sessionType,
          notes: appointment.notes,
          status: appointment.status,
          canStart: Boolean(
            canRecord
            && profile?.status === "active"
            && (appointment.status === "scheduled" || appointment.status === "in_progress")
            && !appointment.clinicalSessionRunId
            && !appointment.interventionSessionId
          ),
        };
      }),
    });
  } catch {
    return mobileError("calendar_unavailable", "No se pudo cargar la agenda móvil.", 500);
  }
}
