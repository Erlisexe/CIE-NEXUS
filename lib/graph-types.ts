export type GraphType = "line" | "bar" | "stacked-bar" | "scatter" | "cumulative";

export type GraphDataSource = "manual" | "sessions" | "trials" | "abc";
export type GraphPeriod = "today" | "7d" | "30d" | "3m" | "6m" | "all" | "custom";
export type GraphXAxis = "date" | "session" | "target" | "prompt" | "therapist";
export type GraphYAxis = "percentage_correct" | "count" | "rate" | "duration";
export type GraphGrouping = "none" | "program" | "target" | "prompt" | "therapist";
export type GraphRateUnit = "minute" | "hour" | "day";

export type GraphFilters = {
  programIds: string[];
  targetIds: string[];
  targetStates: string[];
  therapistIds: string[];
};

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
  /** Stable categorical position. It may differ from the shortened display label. */
  xKey?: string;
  value: number | null;
  series: string;
  criterion: number | null;
  criterionProgress?: {
    met: number;
    required: number;
    label: string;
  } | null;
  targetId?: string;
  stateAtPoint?: string;
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
    professionalAccountId?: string;
    professionalName?: string;
    promptLevel?: string;
    rawDetailAvailable?: boolean;
  };
};

export type PhaseBoundary = {
  id: string;
  afterIndex: number;
  beforeLabel: string;
  afterLabel: string;
  boundaryDate?: string;
  boundaryKey?: string;
  targetId?: string;
  targetLabel?: string;
  origin?: "automatic" | "manual";
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
  version: 1 | 2;
  yMin: number;
  yMax: number | null;
  showGrid: boolean;
  showMean: boolean;
  showTrend: boolean;
  connectPoints: boolean;
  showPoints: boolean;
  showLegend: boolean;
  showValues: boolean;
  dataSource: GraphDataSource;
  sourceTargetIds: string[];
  dateFrom: string;
  dateTo: string;
  period: GraphPeriod;
  xAxis: GraphXAxis;
  yAxis: GraphYAxis;
  grouping: GraphGrouping;
  rateUnit: GraphRateUnit;
  filters: GraphFilters;
  showCriterion: boolean;
  exportMetadata: string[];
  warnings: string[];
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
  bar: "Columnas",
  "stacked-bar": "Columnas apiladas",
  scatter: "Dispersión",
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
  version: 1,
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
  sourceTargetIds: [],
  dateFrom: "",
  dateTo: "",
  period: "30d",
  xAxis: "date",
  yAxis: "percentage_correct",
  grouping: "target",
  rateUnit: "hour",
  filters: {
    programIds: [],
    targetIds: [],
    targetStates: [],
    therapistIds: [],
  },
  showCriterion: true,
  exportMetadata: [],
  warnings: [],
  visualAnalysis: EMPTY_ANALYSIS,
};

export function graphLocalId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `graph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function normalizeGraph(raw: Record<string, unknown>): AnalyticGraph {
  const graphType = (["line", "bar", "stacked-bar", "scatter", "cumulative"] as const).includes(raw.graphType as GraphType)
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
      version: config.version === 2 ? 2 : 1,
      dataSource: (["sessions", "trials", "abc"] as const).includes(config.dataSource as "sessions" | "trials" | "abc") ? config.dataSource as GraphDataSource : "manual",
      sourceTargetIds: Array.isArray(config.sourceTargetIds) ? config.sourceTargetIds.filter((id): id is string => typeof id === "string") : [],
      dateFrom: typeof config.dateFrom === "string" ? config.dateFrom : "",
      dateTo: typeof config.dateTo === "string" ? config.dateTo : "",
      period: (["today", "7d", "30d", "3m", "6m", "all", "custom"] as const).includes(config.period as GraphPeriod) ? config.period as GraphPeriod : "30d",
      xAxis: (["date", "session", "target", "prompt", "therapist"] as const).includes(config.xAxis as GraphXAxis) ? config.xAxis as GraphXAxis : "date",
      yAxis: (["percentage_correct", "count", "rate", "duration"] as const).includes(config.yAxis as GraphYAxis) ? config.yAxis as GraphYAxis : "percentage_correct",
      grouping: (["none", "program", "target", "prompt", "therapist"] as const).includes(config.grouping as GraphGrouping) ? config.grouping as GraphGrouping : "target",
      rateUnit: (["minute", "hour", "day"] as const).includes(config.rateUnit as GraphRateUnit) ? config.rateUnit as GraphRateUnit : "hour",
      filters: {
        programIds: Array.isArray(config.filters?.programIds) ? config.filters.programIds.filter((id): id is string => typeof id === "string") : [],
        targetIds: Array.isArray(config.filters?.targetIds) ? config.filters.targetIds.filter((id): id is string => typeof id === "string") : [],
        targetStates: Array.isArray(config.filters?.targetStates) ? config.filters.targetStates.filter((id): id is string => typeof id === "string") : [],
        therapistIds: Array.isArray(config.filters?.therapistIds) ? config.filters.therapistIds.filter((id): id is string => typeof id === "string") : [],
      },
      showCriterion: config.showCriterion !== false,
      exportMetadata: Array.isArray(config.exportMetadata) ? config.exportMetadata.filter((item): item is string => typeof item === "string") : [],
      warnings: Array.isArray(config.warnings) ? config.warnings.filter((item): item is string => typeof item === "string") : [],
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
