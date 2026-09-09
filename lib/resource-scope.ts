export type ResourceScopeAccount = {
  role: "direccion_clinica" | "subdirector" | "supervisor" | "coordinador" | "terapeuta";
  assignedProfileIds: string[];
  siteScope: string[];
};

export function canAccessProfileByScope(account: ResourceScopeAccount, profile: { id: string; site: string }) {
  if (account.role === "direccion_clinica" || account.role === "subdirector") return true;
  if (account.assignedProfileIds.includes(profile.id)) return true;
  return account.role === "supervisor" && account.siteScope.includes(profile.site);
}

export function canViewAssignedSession(account: ResourceScopeAccount & { id: string }, session: { professionalAccountId: string | null }, profile: { id: string; site: string }) {
  if (!canAccessProfileByScope(account, profile)) return false;
  return account.role !== "terapeuta" || session.professionalAccountId === account.id;
}

export function canRecordScheduledSession(account: ResourceScopeAccount & { id: string }, professionalAccountId: string | null) {
  if (!professionalAccountId) return account.role !== "terapeuta";
  return professionalAccountId === account.id;
}

export function canClinicalProfessionalServeChild(account: ResourceScopeAccount, profile: { id: string; site: string }) {
  return canAccessProfileByScope(account, profile);
}
