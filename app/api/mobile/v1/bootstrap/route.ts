import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { personnelProfiles, sessionAppointments } from "../../../../../db/schema";
import { roleLabel } from "../../../../../lib/access-control";
import {
  MOBILE_API_VERSION,
  MOBILE_SCOPE_POLICY,
  mobileApiGuard,
  mobileCapabilities,
  mobileData,
  mobileError,
} from "../../../../../lib/mobile-api";
import { mobileProfileScope } from "../../../../../lib/mobile-data";

export async function GET(request: Request) {
  const { account, denied } = await mobileApiGuard(request);
  if (denied || !account) return denied;
  try {
    const db = await getDb();
    const profileIds = await mobileProfileScope(db, account);
    const today = new Date().toISOString().slice(0, 10);
    const upcomingAppointments = await db.select({ id: sessionAppointments.id })
      .from(sessionAppointments)
      .where(and(
        eq(sessionAppointments.professionalAccountId, account.id),
        gte(sessionAppointments.sessionDate, today),
        ne(sessionAppointments.status, "cancelled"),
      ));
    const activeProfiles = profileIds.size
      ? await db.select({ id: personnelProfiles.id }).from(personnelProfiles)
        .where(and(eq(personnelProfiles.status, "active"), inArray(personnelProfiles.id, [...profileIds])))
      : [];
    const activeProfileCount = activeProfiles.length;
    return mobileData({
      apiVersion: MOBILE_API_VERSION,
      account: {
        id: account.id,
        displayName: account.displayName,
        role: account.role,
        roleLabel: roleLabel(account.role),
        siteScope: account.siteScope,
      },
      capabilities: mobileCapabilities(account),
      scope: {
        policy: MOBILE_SCOPE_POLICY,
        activeProfileCount,
        upcomingAppointmentCount: upcomingAppointments.length,
      },
    });
  } catch {
    return mobileError("bootstrap_unavailable", "No se pudo iniciar la aplicación móvil.", 500);
  }
}
