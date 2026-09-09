export type SessionNoteField = {
  id: string;
  label: string;
  guidance: string;
  required: boolean;
};

export type SessionNoteTemplateSnapshot = {
  id: string | null;
  name: string;
  description: string;
  fields: SessionNoteField[];
};

export const DEFAULT_SESSION_NOTE_TEMPLATE = {
  id: "cie-nexus-aba-session-note-general-v1",
  name: "Nota de sesión ABA — General",
  description: "Estructura clínica general para documentar la intervención, la respuesta observable y la continuidad del servicio.",
  fields: [
    { id: "contexto_participantes", label: "Contexto y participantes", guidance: "Lugar, personas presentes y cualquier condición relevante al inicio de la sesión.", required: true },
    { id: "programas_actividades", label: "Programas y actividades implementadas", guidance: "Programas trabajados, actividades realizadas y oportunidades de aprendizaje proporcionadas.", required: true },
    { id: "respuesta_progreso", label: "Respuesta del niño y progreso observado", guidance: "Describe respuestas observables y relaciona la síntesis con los datos registrados, sin inferencias no sustentadas.", required: true },
    { id: "procedimientos_apoyos", label: "Procedimientos, ayudas y reforzamiento", guidance: "Estrategias de enseñanza, nivel de ayuda, corrección de errores y reforzadores utilizados.", required: true },
    { id: "conductas_incidentes", label: "Conductas relevantes, eventos ABC o incidentes", guidance: "Documenta hechos observables. Si no ocurrieron, indícalo expresamente.", required: true },
    { id: "variables_barreras", label: "Variables contextuales o barreras", guidance: "Cambios ambientales, salud reportada, participación u otras variables que afectaron la sesión. Indica si no se identificaron.", required: true },
    { id: "generalizacion_coordinacion", label: "Generalización, mantenimiento y coordinación", guidance: "Registra generalización o mantenimiento y la comunicación con cuidadores o equipo cuando aplique.", required: false },
    { id: "plan_proxima_sesion", label: "Plan para la próxima sesión", guidance: "Continuidad prevista, prioridades clínicas y ajustes que requieren seguimiento.", required: true },
  ] satisfies SessionNoteField[],
} as const;

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function sanitizeSessionNoteFields(value: unknown): SessionNoteField[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.slice(0, 30).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const label = cleanText(item.label, 120);
    if (!label) return [];
    const baseId = cleanText(item.id, 80).replace(/[^a-zA-Z0-9_-]/g, "") || `campo_${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (used.has(id)) id = `${baseId}_${suffix++}`;
    used.add(id);
    return [{ id, label, guidance: cleanText(item.guidance, 500), required: item.required === true }];
  });
}

export function normalizeSessionNoteValues(value: unknown, fields: SessionNoteField[]) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(fields.map((field) => [field.id, cleanText(source[field.id], 12_000)]));
}

export function missingRequiredSessionNoteFields(fields: SessionNoteField[], values: Record<string, string>) {
  return fields.filter((field) => field.required && !values[field.id]?.trim());
}

export function formatSessionNoteText(fields: SessionNoteField[], values: Record<string, string>) {
  return fields.flatMap((field) => {
    const content = values[field.id]?.trim();
    return content ? [`${field.label}\n${content}`] : [];
  }).join("\n\n");
}
