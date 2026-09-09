import { asc, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { interventionPrograms, personnelProfiles } from "../../../../../db/schema";
import { createSupabaseAccessTokenClient } from "../../../../../lib/supabase/server";
import { signedProfilePhotoMap } from "../../../../../lib/profile-photos";
import { mobileApiGuard, mobileData, mobileError } from "../../../../../lib/mobile-api";
import { mobileProfileScope } from "../../../../../lib/mobile-data";

function ageFromBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const birth = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < birth.getUTCMonth()
    || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 100 ? age : null;
}

export async function GET(request: Request) {
  const { accessToken, account, denied } = await mobileApiGuard(request, { permissions: ["children.view"] });
  if (denied || !account || !accessToken) return denied;
  try {
    const db = await getDb();
    const allowedIds = await mobileProfileScope(db, account);
    if (!allowedIds.size) return mobileData({ children: [] });
    const ids = [...allowedIds];
    const [profiles, programs] = await Promise.all([
      db.select().from(personnelProfiles)
        .where(inArray(personnelProfiles.id, ids))
        .orderBy(asc(personnelProfiles.fullName)),
      db.select({ id: interventionPrograms.id, profileId: interventionPrograms.profileId, status: interventionPrograms.status })
        .from(interventionPrograms)
        .where(inArray(interventionPrograms.profileId, ids)),
    ]);
    const activeProfiles = profiles.filter((profile) => profile.status === "active");
    const photoUrls = await signedProfilePhotoMap(
      createSupabaseAccessTokenClient(accessToken),
      "child",
      activeProfiles.map((profile) => profile.id),
    ).catch(() => new Map<string, string>());
    return mobileData({
      children: activeProfiles.map((profile) => ({
        id: profile.id,
        fullName: profile.fullName,
        internalCode: profile.internalCode,
        site: profile.site,
        diagnosis: profile.diagnosis,
        age: ageFromBirthDate(profile.dateOfBirth),
        photoUrl: photoUrls.get(profile.id) || null,
        activeProgramCount: programs.filter((program) => program.profileId === profile.id && program.status === "active").length,
      })),
    });
  } catch {
    return mobileError("children_unavailable", "No se pudieron cargar los niños asignados.", 500);
  }
}
