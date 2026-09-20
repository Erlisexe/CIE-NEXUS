type StartRequirementInput = {
  loading: boolean;
  starting: boolean;
  hasPreparation: boolean;
  selectedTargetCount: number;
  contextCategory: string;
  contextOther: string;
  appointmentDate?: string | null;
  institutionalDate: string;
};

function readableDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-NI", { day: "numeric", month: "short", year: "numeric" });
}

export function sessionStartRequirement(input: StartRequirementInput) {
  if (input.loading || input.starting || !input.hasPreparation) return "";
  if (input.appointmentDate && input.appointmentDate !== input.institutionalDate) {
    return `Esta cita está programada para el ${readableDate(input.appointmentDate)}. La toma real sólo puede iniciarse en esa fecha.`;
  }
  if (!input.selectedTargetCount) return "Selecciona al menos un target para la sesión.";
  if (!input.contextCategory) return "Selecciona el contexto de la sesión.";
  if (input.contextCategory === "Otro" && !input.contextOther.trim()) return "Describe el contexto seleccionado como Otro.";
  return "";
}

export function sessionCloseRequirement(hasData: boolean, missingRequirements: string[]) {
  if (!hasData) return "Registra al menos un dato clínico o descarta la sesión vacía.";
  if (!missingRequirements.length) return "";
  const [first, ...rest] = missingRequirements;
  return rest.length ? `${first} Además, ${rest.length === 1 ? "falta" : "faltan"} ${rest.length} requisito${rest.length === 1 ? "" : "s"}.` : first;
}
