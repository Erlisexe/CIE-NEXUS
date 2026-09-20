import { profileMatchesClinicalFilter, type ClinicalFilter } from "./clinical-filter.ts";
import { canAccessProfileByScope, type ResourceScopeAccount } from "./resource-scope.ts";

export function calendarProfileIds(account: ResourceScopeAccount, profiles: Array<{ id: string; site: string }>, filter: ClinicalFilter) {
  return profiles.filter((profile) => canAccessProfileByScope(account, profile) && profileMatchesClinicalFilter(profile, filter)).map((profile) => profile.id);
}

export function matchesSubmittedClinicalFilter(profile: { id: string; site: string }, value: unknown) {
  if (value === undefined) return true; // Existing clients have no view filter.
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const filter = value as Record<string, unknown>;
  return typeof filter.site === "string" && typeof filter.profileId === "string"
    && profileMatchesClinicalFilter(profile, { site: filter.site, profileId: filter.profileId });
}
