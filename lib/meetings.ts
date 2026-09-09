export const MEETING_RECIPIENT_ROLES = ["subdirector", "direccion_clinica"] as const;
export const MEETING_BLOCKING_STATUSES = ["pending", "accepted"] as const;

export function meetingDateValue(value: unknown) {
  const text = typeof value === "string" ? value.trim().slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function meetingTimeValue(value: unknown) {
  const text = typeof value === "string" ? value.trim().slice(0, 5) : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

export function meetingRangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && endA > startB;
}

export function todayInNicaragua(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function meetingStatusLabel(status: string) {
  return ({
    pending: "Pendiente",
    accepted: "Aceptada",
    declined: "Rechazada",
    cancelled: "Cancelada",
  } as Record<string, string>)[status] || "Sin estado";
}
