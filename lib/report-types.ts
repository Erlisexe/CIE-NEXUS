import type { AnalyticGraph } from "./graph-types";

export type ReportStatus = "draft" | "finalized";

export type ReportProfileSnapshot = {
  id: string;
  fullName: string;
  photoUrl: string | null;
  internalCode: string;
  dateOfBirth: string;
  diagnosis: string;
  site: string;
  address: string;
  phone: string;
  guardianName: string;
  guardianPhone: string;
  preferredLanguage: string;
  responsibles: {
    coordinador: string;
    supervisor: string;
    subdirector: string;
    terapeuta: string;
  };
  customFields: Array<{ label: string; value: string }>;
};

export type ReportTableData = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

export type ReportBlock =
  | { id: string; type: "cover"; title: string; subtitle: string }
  | { id: string; type: "heading"; content: string; level: 1 | 2 }
  | { id: string; type: "paragraph"; content: string }
  | { id: string; type: "profile_fields"; title: string; fields: string[] }
  | { id: string; type: "graph"; sourceId: string; title: string; graph: AnalyticGraph }
  | { id: string; type: "table"; sourceId: string; title: string; sourceType: string; data: ReportTableData }
  | { id: string; type: "metrics"; title: string; items: Array<{ label: string; value: string }> }
  | { id: string; type: "divider" }
  | { id: string; type: "signature"; label: string; name: string; role: string };

export type ReportTemplate = {
  id: string;
  name: string;
  reportType: string;
  description: string;
  blocks: ReportBlock[];
  builtIn: boolean;
  status: string;
  createdByAccountId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRecord = {
  id: string;
  profileId: string | null;
  profileName: string;
  templateId: string | null;
  title: string;
  reportType: string;
  status: ReportStatus;
  blocks: ReportBlock[];
  profileSnapshot: ReportProfileSnapshot;
  sourceSelection: string[];
  authorAccountId: string;
  authorName: string;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportSource = {
  id: string;
  kind: "graph" | "evaluation" | "program" | "sessions";
  title: string;
  detail: string;
  graph?: AnalyticGraph;
  table?: ReportTableData;
};

export const REPORT_VARIABLES = [
  { key: "nombre_cliente", label: "Nombre del niño" },
  { key: "diagnostico", label: "Diagnóstico" },
  { key: "fecha_actual", label: "Fecha actual" },
  { key: "fecha_nacimiento", label: "Fecha de nacimiento" },
  { key: "edad", label: "Edad" },
  { key: "sede", label: "Sede" },
  { key: "codigo_cliente", label: "Código interno" },
  { key: "coordinador", label: "Coordinador" },
  { key: "supervisor", label: "Supervisor" },
  { key: "subdirector", label: "Subdirector" },
  { key: "terapeuta", label: "Terapeuta" },
  { key: "autor", label: "Autor" },
] as const;

function reportAge(dateOfBirth: string) {
  if (!dateOfBirth) return "No registrado";
  const birth = new Date(`${dateOfBirth}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return "No registrado";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? `${age} años` : "No registrado";
}

function displayDate(value: string) {
  if (!value) return "No registrado";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-NI", { day: "2-digit", month: "long", year: "numeric" });
}

export function reportVariableMap(profile: ReportProfileSnapshot | null, authorName = "") {
  return {
    nombre_cliente: profile?.fullName || "Niño no seleccionado",
    diagnostico: profile?.diagnosis || "No registrado",
    fecha_actual: displayDate(new Date().toISOString()),
    fecha_nacimiento: displayDate(profile?.dateOfBirth || ""),
    edad: reportAge(profile?.dateOfBirth || ""),
    sede: profile?.site || "No registrada",
    codigo_cliente: profile?.internalCode || "No registrado",
    coordinador: profile?.responsibles.coordinador || "No vinculado",
    supervisor: profile?.responsibles.supervisor || "No vinculado",
    subdirector: profile?.responsibles.subdirector || "No vinculado",
    terapeuta: profile?.responsibles.terapeuta || "No vinculado",
    autor: authorName || "No registrado",
  };
}

export function replaceReportVariables(value: string, profile: ReportProfileSnapshot | null, authorName = "") {
  const variables = reportVariableMap(profile, authorName);
  return value.replace(/\{([a-z_]+)\}/gi, (match, key: string) => variables[key as keyof typeof variables] || match);
}

export const BUILT_IN_REPORT_TEMPLATES: Array<Pick<ReportTemplate, "id" | "name" | "reportType" | "description" | "blocks">> = [
  {
    id: "builtin-behavior-intervention",
    name: "Informe de intervención conductual",
    reportType: "Conductual",
    description: "Estructura clínica para describir conducta, objetivos, datos, interpretación y recomendaciones.",
    blocks: [
      { id: "behavior-cover", type: "cover", title: "Informe de intervención conductual", subtitle: "{nombre_cliente} · {sede} · {fecha_actual}" },
      { id: "behavior-profile", type: "profile_fields", title: "Datos del cliente", fields: ["nombre_cliente", "diagnostico", "edad", "sede", "coordinador", "supervisor", "terapeuta"] },
      { id: "behavior-description-title", type: "heading", level: 1, content: "Descripción y contexto clínico" },
      { id: "behavior-description", type: "paragraph", content: "Describe aquí la conducta objetivo, su definición operacional, antecedentes relevantes y contexto de observación." },
      { id: "behavior-objectives-title", type: "heading", level: 1, content: "Objetivos de intervención" },
      { id: "behavior-objectives", type: "paragraph", content: "Documenta los objetivos medibles, conductas de reemplazo y criterios clínicos de progreso." },
      { id: "behavior-data-title", type: "heading", level: 1, content: "Datos e interpretación" },
      { id: "behavior-data", type: "paragraph", content: "Inserta las gráficas o tablas relevantes y redacta una interpretación basada en nivel, tendencia, variabilidad y cambios entre fases." },
      { id: "behavior-recommendations", type: "heading", level: 1, content: "Recomendaciones" },
      { id: "behavior-recommendations-text", type: "paragraph", content: "Registra recomendaciones clínicas, próximos pasos y fecha de revisión." },
      { id: "behavior-signature", type: "signature", label: "Profesional responsable", name: "{autor}", role: "" },
    ],
  },
  {
    id: "builtin-monthly-progress",
    name: "Informe mensual de progreso",
    reportType: "Progreso",
    description: "Resumen reutilizable de programas, sesiones, evolución y próximos pasos.",
    blocks: [
      { id: "monthly-cover", type: "cover", title: "Informe mensual de progreso", subtitle: "{nombre_cliente} · {fecha_actual}" },
      { id: "monthly-profile", type: "profile_fields", title: "Información general", fields: ["nombre_cliente", "diagnostico", "edad", "sede", "coordinador", "supervisor"] },
      { id: "monthly-summary-title", type: "heading", level: 1, content: "Resumen del período" },
      { id: "monthly-summary", type: "paragraph", content: "Resume los avances clínicamente significativos observados durante el período y cualquier variable contextual relevante." },
      { id: "monthly-progress-title", type: "heading", level: 1, content: "Progreso por objetivos" },
      { id: "monthly-progress", type: "paragraph", content: "Selecciona programas, sesiones y gráficas para sustentar la descripción del progreso." },
      { id: "monthly-next-title", type: "heading", level: 1, content: "Plan para el próximo período" },
      { id: "monthly-next", type: "paragraph", content: "Especifica continuidad, modificaciones, generalización, mantenimiento y fecha de próxima revisión." },
      { id: "monthly-signature", type: "signature", label: "Elaborado por", name: "{autor}", role: "" },
    ],
  },
];
