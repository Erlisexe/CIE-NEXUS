export function programsForClinicalSession<T extends {
  profileId: string | null;
  status: string;
  targets: Array<{ state: string }>;
}>(programs: T[], profileId: string) {
  return programs.filter((program) => (
    program.profileId === profileId
    && program.status === "active"
    && program.targets.some((target) => target.state !== "closed")
  ));
}

export function groupProgramSessions<T extends { id: string; clinicalSessionRunId?: string | null }>(sessions: T[]) {
  return Array.from(sessions.reduce((groups, session) => {
    const key = session.clinicalSessionRunId || session.id;
    groups.set(key, [...(groups.get(key) || []), session]);
    return groups;
  }, new Map<string, T[]>()).entries()).map(([id, rows]) => ({ id, rows }));
}
