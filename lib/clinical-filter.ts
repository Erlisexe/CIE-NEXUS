export type ClinicalFilter = { site: string; profileId: string };

export function matchesClinicalFilter(row: { site?: string | null; profileId?: string | null }, filter: ClinicalFilter) {
  return (filter.site === "Todas" || row.site === filter.site)
    && (filter.profileId === "all" || row.profileId === filter.profileId);
}

export function profileMatchesClinicalFilter(profile: { id: string; site: string }, filter: ClinicalFilter) {
  return matchesClinicalFilter({ profileId: profile.id, site: profile.site }, filter);
}

export function clinicalFilterParams(filter: ClinicalFilter) {
  const params = new URLSearchParams();
  if (filter.site !== "Todas") params.set("site", filter.site);
  if (filter.profileId !== "all") params.set("profileId", filter.profileId);
  return params;
}

export function readClinicalFilter(params: URLSearchParams): ClinicalFilter {
  return { site: params.get("site")?.trim() || "Todas", profileId: params.get("profileId")?.trim() || "all" };
}

export function upcomingCalendarPeriod(today: string) {
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 30);
  return { from: today, to: end.toISOString().slice(0, 10) };
}
