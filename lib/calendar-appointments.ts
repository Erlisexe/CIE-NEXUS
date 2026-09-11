export const CANCELLATION_CATEGORIES = [
  { value: "child_unwell", label: "Niño indispuesto" },
  { value: "professional_absent", label: "Profesional ausente" },
  { value: "family_unavailable", label: "Familia no disponible" },
  { value: "schedule_conflict", label: "Conflicto de horario" },
  { value: "other", label: "Otro" },
] as const;

export type CancellationCategory = typeof CANCELLATION_CATEGORIES[number]["value"];

const CATEGORY_VALUES = new Set<string>(CANCELLATION_CATEGORIES.map((category) => category.value));
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  therapist_absent: "Profesional ausente",
  family_request: "Familia no disponible",
  center_closure: "Otro",
};

export function cancellationCategory(value: unknown): CancellationCategory | null {
  return typeof value === "string" && CATEGORY_VALUES.has(value) ? value as CancellationCategory : null;
}

export function cancellationLabel(value: string | null | undefined) {
  return CANCELLATION_CATEGORIES.find((category) => category.value === value)?.label
    || (value ? LEGACY_CATEGORY_LABELS[value] : "Cancelación anterior");
}

export function validateCancellation(categoryValue: unknown, reasonValue: unknown) {
  const category = cancellationCategory(categoryValue);
  const reason = typeof reasonValue === "string" ? reasonValue.trim().slice(0, 1000) : "";
  if (!category) return { error: "Selecciona una categoría de cancelación." } as const;
  if (category === "other" && !reason) return { error: "Describe el motivo cuando seleccionas “Otro”." } as const;
  return { category, reason } as const;
}

export function appointmentHasLinkedClinicalEvidence(appointment: {
  interventionSessionId?: string | null;
  clinicalSessionRunId?: string | null;
}) {
  return Boolean(appointment.interventionSessionId || appointment.clinicalSessionRunId);
}

export function canAdministrativelyEditAppointment(appointment: {
  status: string;
  interventionSessionId?: string | null;
  clinicalSessionRunId?: string | null;
}) {
  return (appointment.status === "scheduled" || appointment.status === "cancelled")
    && !appointmentHasLinkedClinicalEvidence(appointment);
}

export function canAdministrativelyCancelAppointment(appointment: {
  status: string;
  interventionSessionId?: string | null;
  clinicalSessionRunId?: string | null;
}) {
  return appointment.status === "scheduled" && !appointmentHasLinkedClinicalEvidence(appointment);
}

export function canAdministrativelyRestoreAppointment(appointment: {
  status: string;
  interventionSessionId?: string | null;
  clinicalSessionRunId?: string | null;
}) {
  return appointment.status === "cancelled" && !appointmentHasLinkedClinicalEvidence(appointment);
}

export const canAdministrativelyDeleteAppointment = canAdministrativelyEditAppointment;
