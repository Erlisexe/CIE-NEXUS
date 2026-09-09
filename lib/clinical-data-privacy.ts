export type ClinicalViewer = { id: string; role: string };

export function canViewRawClinicalDetail(viewer: ClinicalViewer, professionalAccountId: string | null | undefined) {
  return viewer.role !== "terapeuta" || professionalAccountId === viewer.id;
}

/** Keeps outcome aggregates while removing trial-level and narrative detail. */
export function aggregateOnlySessionResult(result: Record<string, unknown>) {
  return {
    targetId: result.targetId,
    sampled: result.sampled,
    value: result.value,
    correct: result.correct,
    opportunities: result.opportunities,
    trials: [],
    trialDetails: [],
    note: "",
    stateAtSession: result.stateAtSession,
    criterionSnapshot: result.criterionSnapshot,
    criterionStatus: result.criterionStatus,
    criterionReason: "",
  };
}

/** Keeps an ABC incident in aggregate counts while removing another therapist's observation detail. */
export function redactAbcRecordForViewer<T extends Record<string, unknown>>(record: T, viewer: ClinicalViewer) {
  if (canViewRawClinicalDetail(viewer, typeof record.recordedByAccountId === "string" ? record.recordedByAccountId : null)) {
    return { ...record, rawDetailAvailable: true };
  }
  return {
    ...record,
    appointmentId: null,
    sessionId: null,
    recordedByAccountId: "clinical-team",
    recordedByName: "Equipo clínico",
    eventTime: "",
    locationContext: "",
    activity: "",
    antecedentCategoryId: null,
    antecedentLabel: "Detalle restringido",
    antecedentDescription: "",
    behaviorLabel: record.targetId ? "Objetivo vinculado" : "Incidente ABC",
    behaviorDescription: "",
    consequenceCategoryId: null,
    consequenceLabel: "Detalle restringido",
    consequenceDescription: "",
    additionalObservation: "",
    createdAt: "",
    updatedAt: "",
    rawDetailAvailable: false,
  };
}

export function redactGraphPointForViewer(raw: unknown, viewer: ClinicalViewer) {
  if (!raw || typeof raw !== "object" || viewer.role !== "terapeuta") return raw;
  const point = raw as Record<string, unknown>;
  const source = point.source && typeof point.source === "object" ? point.source as Record<string, unknown> : null;
  if (!source || typeof source.sessionId !== "string" || !source.sessionId) return point;
  const ownRaw = source.rawDetailAvailable === true && source.professionalAccountId === viewer.id;
  if (ownRaw) return point;
  return {
    ...point,
    note: "",
    source: {
      ...source,
      context: "",
      sessionNotes: "",
      professionalAccountId: "team",
      professionalName: "Equipo clínico",
      promptLevel: "",
      rawDetailAvailable: false,
    },
  };
}
