export const CALENDAR_CANCELLATION_CATEGORIES = [
  { value: "child_unwell", label: "Niño indispuesto" },
  { value: "professional_absent", label: "Profesional ausente" },
  { value: "family_unavailable", label: "Familia no disponible" },
  { value: "schedule_conflict", label: "Conflicto de horario" },
  { value: "other", label: "Otro" },
] as const;

export type CalendarCancellationCategory = typeof CALENDAR_CANCELLATION_CATEGORIES[number]["value"];

const CATEGORY_VALUES = new Set<string>(CALENDAR_CANCELLATION_CATEGORIES.map((item) => item.value));

export function cancellationCategoryLabel(value: string) {
  return CALENDAR_CANCELLATION_CATEGORIES.find((item) => item.value === value)?.label || "Motivo no disponible";
}

export function normalizeCancellationInput(category: unknown, reason: unknown) {
  const cleanCategory = typeof category === "string" ? category.trim() : "";
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
  if (!CATEGORY_VALUES.has(cleanCategory)) throw new Error("Selecciona una categoría de cancelación.");
  if (cleanCategory === "other" && !cleanReason) throw new Error("Describe el motivo cuando seleccionas “Otro”.");
  return { category: cleanCategory as CalendarCancellationCategory, reason: cleanReason };
}

export function appointmentHasClinicalEvidence(appointment: { clinicalSessionRunId?: string | null; interventionSessionId?: string | null }) {
  return Boolean(appointment.clinicalSessionRunId || appointment.interventionSessionId);
}

export function canAdministrativelyDeleteAppointment(appointment: { status: string; clinicalSessionRunId?: string | null; interventionSessionId?: string | null }) {
  return (appointment.status === "scheduled" || appointment.status === "cancelled") && !appointmentHasClinicalEvidence(appointment);
}
