import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { sessionAppointments } from "../db/schema";
import type { AppAccount } from "./access-control";
import { mobileProfileIds } from "./mobile-api";

export async function mobileProfileScope(
  db: Awaited<ReturnType<typeof getDb>>,
  account: Pick<AppAccount, "id" | "assignedProfileIds">,
) {
  const appointments = await db.select({ profileId: sessionAppointments.profileId })
    .from(sessionAppointments)
    .where(and(
      eq(sessionAppointments.professionalAccountId, account.id),
      inArray(sessionAppointments.status, ["scheduled", "in_progress"]),
    ));
  return mobileProfileIds(account, appointments.map((appointment) => appointment.profileId));
}
