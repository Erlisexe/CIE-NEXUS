export type GraphType = "line" | "bar" | "cumulative";
export type ClinicalGraphScope = "program" | "targets";
export type ClinicalGraphMetric = "percentage" | "count" | "opportunities" | "rate" | "value" | "mastered";
export type ClinicalGraphGrouping = "session" | "day" | "week" | "month";

export type LineDesign =
  | "simple"
  | "AB"
  | "ABA"
  | "ABAB"
  | "BAB"
  | "multiple-baseline"
  | "multielement"
  | "changing-criterion"
  | "custom";

export type GraphStatus = "active" | "archived";

export type GraphPoint = {
  id: string;
  label: string;
  value: number | null;
  series: string;
  criterion: number | null;
  note: string;
  source?: {
    sessionId: string;
    sessionDate: string;
    programId: string;
    targetId: string;
    targetName: string;
    opportunities: number;
    context: string;
    sessionNotes: string;
  };
};

export type PhaseBoundary = {
  id: string;
  afterIndex: number;
  beforeLabel: string;
  afterLabel: string;
  boundaryDate?: string;
};

export type VisualAnalysis = {
  level: string;
  trend: string;
  variability: string;
  immediacy: string;
  overlap: string;
  consistency: string;
  decision: string;
  nextReview: string;
};

export type GraphConfig = {
  yMin: number;
  yMax: number | null;
  showGrid: boolean;
  showMean: boolean;
  showTrend: boolean;
  connectPoints: boolean;
  showPoints: boolean;
  showLegend: boolean;
  showValues: boolean;
  dataSource: "manual" | "sessions";
  clinicalScope: ClinicalGraphScope;
  clinicalMetric: ClinicalGraphMetric;
  clinicalGrouping: ClinicalGraphGrouping;
  cumulativeValues: "increments" | "totals";
  sourceTargetIds: string[];
  dateFrom: string;
  dateTo: string;
  visualAnalysis: VisualAnalysis;
};

export type AnalyticGraph = {
  id: string;
  profileId: string | null;
  linkedProgramId: string | null;
  title: string;
  objective: string;
  graphType: GraphType;
  designType: LineDesign;
  measurement: string;
  xAxisLabel: string;
  yAxisLabel: string;
  linkedCycleId: string | null;
  status: GraphStatus;
  points: GraphPoint[];
  phases: PhaseBoundary[];
  config: GraphConfig;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const GRAPH_TYPE_LABELS: Record<GraphType, string> = {
  line: "Líneas",
  bar: "Barras",
  cumulative: "Acumulativa",
};

export const LINE_DESIGN_LABELS: Record<LineDesign, string> = {
  simple: "Línea de fase libre",
  AB: "AB",
  ABA: "ABA",
  ABAB: "ABAB",
  BAB: "BAB",
  "multiple-baseline": "Línea base múltiple",
  multielement: "Multielemento",
  "changing-criterion": "Criterio cambiante",
  custom: "Fases personalizadas",
};

export const MEASUREMENT_OPTIONS = [
  "Porcentaje",
  "Frecuencia",
  "Tasa",
  "Duración",
  "Latencia",
  "Conteo de criterios",
  "Puntuación",
  "Otra",
] as const;

export const EMPTY_ANALYSIS: VisualAnalysis = {
  level: "",
  trend: "",
  variability: "",
  immediacy: "",
  overlap: "",
  consistency: "",
  decision: "",
  nextReview: "",
};

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  yMin: 0,
  yMax: 100,
  showGrid: true,
  showMean: false,
  showTrend: false,
  connectPoints: true,
  showPoints: true,
  showLegend: true,
  showValues: false,
  dataSource: "manual",
  clinicalScope: "targets",
  clinicalMetric: "value",
  clinicalGrouping: "session",
  cumulativeValues: "increments",
  sourceTargetIds: [],
  dateFrom: "",
  dateTo: "",
  visualAnalysis: EMPTY_ANALYSIS,
};

export function cumulativeSeriesValues(points: GraphPoint[], mode: GraphConfig["cumulativeValues"]): Map<string, number | null> {
  const totals = new Map<string, number>();
  const values = new Map<string, number | null>();
  for (const point of points) {
    if (point.value === null) { values.set(point.id, null); continue; }
    const series = point.series || "Datos";
    const previous = totals.get(series) || 0;
    const total = mode === "totals" ? Math.max(previous, point.value) : previous + Math.max(0, point.value);
    totals.set(series, total);
    values.set(point.id, total);
  }
  return values;
}

export function stepGraphPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return `M ${points[0].x} ${points[0].y} ${points.slice(1).map((point) => `H ${point.x} V ${point.y}`).join(" ")}`.trim();
}

export function graphLocalId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `graph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function normalizeGraph(raw: Record<string, unknown>): AnalyticGraph {
  const graphType = (["line", "bar", "cumulative"] as const).includes(raw.graphType as GraphType)
    ? raw.graphType as GraphType
    : "line";
  const designType = Object.hasOwn(LINE_DESIGN_LABELS, String(raw.designType))
    ? raw.designType as LineDesign
    : "AB";
  const config = parseJson<Partial<GraphConfig>>(raw.config, {});
  return {
    id: String(raw.id || ""),
    profileId: typeof raw.profileId === "string" && raw.profileId ? raw.profileId : null,
    linkedProgramId: typeof raw.linkedProgramId === "string" && raw.linkedProgramId ? raw.linkedProgramId : null,
    title: String(raw.title || "Gráfica sin título"),
    objective: String(raw.objective || ""),
    graphType,
    designType,
    measurement: String(raw.measurement || "Porcentaje"),
    xAxisLabel: String(raw.xAxisLabel || "Sesiones"),
    yAxisLabel: String(raw.yAxisLabel || "Porcentaje"),
    linkedCycleId: typeof raw.linkedCycleId === "string" && raw.linkedCycleId ? raw.linkedCycleId : null,
    status: raw.status === "archived" ? "archived" : "active",
    points: parseJson<GraphPoint[]>(raw.points, []),
    phases: parseJson<PhaseBoundary[]>(raw.phases, []),
    config: {
      ...DEFAULT_GRAPH_CONFIG,
      ...config,
      dataSource: config.dataSource === "sessions" ? "sessions" : "manual",
      clinicalScope: config.clinicalScope === "program" ? "program" : "targets",
      clinicalMetric: (["percentage", "count", "opportunities", "rate", "value", "mastered"] as const).includes(config.clinicalMetric as ClinicalGraphMetric) ? config.clinicalMetric as ClinicalGraphMetric : "value",
      clinicalGrouping: (["session", "day", "week", "month"] as const).includes(config.clinicalGrouping as ClinicalGraphGrouping) ? config.clinicalGrouping as ClinicalGraphGrouping : "session",
      cumulativeValues: config.cumulativeValues === "totals" ? "totals" : "increments",
      sourceTargetIds: Array.isArray(config.sourceTargetIds) ? config.sourceTargetIds.filter((id): id is string => typeof id === "string") : [],
      dateFrom: typeof config.dateFrom === "string" ? config.dateFrom : "",
      dateTo: typeof config.dateTo === "string" ? config.dateTo : "",
      visualAnalysis: {
        ...EMPTY_ANALYSIS,
        ...(config.visualAnalysis || {}),
      },
    },
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
    createdAt: String(raw.createdAt || ""),
    updatedAt: String(raw.updatedAt || ""),
  };
}

export function newGraphPoint(index: number, graphType: GraphType, designType: LineDesign): GraphPoint {
  const isMulti = graphType === "line" && designType === "multielement";
  return {
    id: graphLocalId(),
    label: String(index + 1),
    value: null,
    series: isMulti ? (index % 2 === 0 ? "Condición A" : "Condición B") : "Datos",
    criterion: graphType === "line" && designType === "changing-criterion" && index >= 3
      ? 60 + Math.floor((index - 3) / 2) * 10
      : null,
    note: "",
  };
}

export function phaseTemplate(designType: LineDesign, pointCount: number): PhaseBoundary[] {
  const boundary = (afterIndex: number, beforeLabel: string, afterLabel: string): PhaseBoundary => ({
    id: graphLocalId(),
    afterIndex: Math.max(1, Math.min(afterIndex, Math.max(1, pointCount - 1))),
    beforeLabel,
    afterLabel,
  });
  if (designType === "AB") return [boundary(Math.max(2, Math.floor(pointCount / 2)), "Línea base", "Intervención")];
  if (designType === "ABA") return [
    boundary(Math.max(2, Math.floor(pointCount / 3)), "Línea base", "Intervención"),
    boundary(Math.max(4, Math.floor(pointCount * 2 / 3)), "Intervención", "Retiro"),
  ];
  if (designType === "ABAB") return [
    boundary(Math.max(2, Math.floor(pointCount / 4)), "Línea base", "Intervención 1"),
    boundary(Math.max(4, Math.floor(pointCount / 2)), "Intervención 1", "Retiro"),
    boundary(Math.max(6, Math.floor(pointCount * 3 / 4)), "Retiro", "Intervención 2"),
  ];
  if (designType === "BAB") return [
    boundary(Math.max(2, Math.floor(pointCount / 3)), "Intervención 1", "Retiro"),
    boundary(Math.max(4, Math.floor(pointCount * 2 / 3)), "Retiro", "Intervención 2"),
  ];
  if (designType === "changing-criterion") return [boundary(Math.max(3, Math.floor(pointCount / 3)), "Línea base", "Criterio 1")];
  return [];
}
