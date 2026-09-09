"use client";

import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Eye,
  EyeOff,
  Filter,
  Download,
  FileDown,
  FileImage,
  FileSpreadsheet,
  LineChart,
  LoaderCircle,
  LockKeyhole,
  MoveHorizontal,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sigma,
  Table2,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  DEFAULT_GRAPH_CONFIG,
  GRAPH_TYPE_LABELS,
  LINE_DESIGN_LABELS,
  MEASUREMENT_OPTIONS,
  graphLocalId,
  newGraphPoint,
  normalizeGraph,
  phaseTemplate,
  type AnalyticGraph,
  type GraphConfig,
  type GraphDataSource,
  type GraphGrouping,
  type GraphPoint,
  type GraphPeriod,
  type GraphRateUnit,
  type GraphType,
  type GraphXAxis,
  type GraphYAxis,
  type LineDesign,
  type PhaseBoundary,
  type VisualAnalysis,
} from "../../lib/graph-types";
import {
  CLINICAL_MEASUREMENT_LABELS,
  buildSessionGraph,
  measurementScale,
  type ClinicalProgram,
  type ClinicalSession,
  type ClinicalTarget,
} from "../../lib/automatic-graphs";
import { buildConfigurableGraph, type ConfigurableGraphDataset } from "../../lib/configurable-graphs";
import {
  areasForPackage,
  targetsForPackage,
  type EvaluationPackageDefinition,
  type EvaluationTarget,
} from "../../lib/evaluation-packages";

type HistoryEntry = { id: string; action: string; summary: string; details: string; createdAt: string };

type AutomaticItemScore = {
  interview?: "" | "1" | "0" | "SE";
  verification?: "" | "1" | "0" | "SO";
};

type AutomaticProgramTarget = ClinicalTarget;
type AutomaticProgram = ClinicalProgram;

type LinkableProfile = {
  id: string;
  fullName: string;
  site: string;
  status: string;
};

type AutomaticProgramSession = ClinicalSession;

export type AutomaticCycle = {
  id: string;
  profileId: string | null;
  site: string;
  participantName: string;
  programContext: string;
  status: string;
  routeType: "4A" | "4B";
  instrumentVersion: string;
  packageTemplateId: string | null;
  instrumentSnapshot: EvaluationPackageDefinition;
  initialScores: Record<string, AutomaticItemScore>;
  reevaluationScores: Record<string, AutomaticItemScore>;
  createdAt: string;
  updatedAt: string;
};

const SITE_LABELS = ["León", "Santo Domingo", "Las Colinas", "Estelí", "Masaya"];
const COLORS = ["#16654c", "#466b8f", "#b66b32", "#8a5d91", "#b34f55", "#5f7f35"];
const MARKERS = ["circle", "square", "triangle", "diamond"] as const;
const AUTO_GRAPH_LABELS = {
  line: "Trayectoria por área",
  bar: "Comparación entre sedes",
  cumulative: "Repertorio acumulado",
} as const;
type AutomaticGraphType = keyof typeof AUTO_GRAPH_LABELS;

const PROGRAM_MEASUREMENT_LABELS = CLINICAL_MEASUREMENT_LABELS;

type AutomaticMetric = "strengthPercent" | "strengthCount" | "coveragePercent";
type AutomaticMoment = "latest" | "initial" | "reevaluation" | "change";
type AutomaticGroupBy = "site" | "participant";
type AutomaticDensity = "compact" | "standard" | "large";

const AUTOMATIC_METRIC_LABELS: Record<AutomaticMetric, string> = {
  strengthPercent: "% de fortalezas confirmadas",
  strengthCount: "Cantidad de fortalezas confirmadas",
  coveragePercent: "% de evidencia concluyente",
};

const AUTOMATIC_MOMENT_LABELS: Record<AutomaticMoment, string> = {
  latest: "Último dato disponible",
  initial: "Solo evaluación inicial",
  reevaluation: "Solo reevaluación",
  change: "Cambio inicial → reevaluación",
};

const ANALYSIS_FIELDS: Array<{ key: keyof VisualAnalysis; title: string; help: string }> = [
  { key: "level", title: "Nivel", help: "Magnitud típica de los datos dentro y entre fases." },
  { key: "trend", title: "Tendencia", help: "Dirección y pendiente observada, sin inferir causalidad." },
  { key: "variability", title: "Variabilidad", help: "Dispersión y estabilidad de los datos dentro de cada fase." },
  { key: "immediacy", title: "Inmediatez", help: "Cambio al pasar de una condición a la siguiente." },
  { key: "overlap", title: "Solapamiento", help: "Grado en que los valores se superponen entre fases adyacentes." },
  { key: "consistency", title: "Consistencia", help: "Repetición del patrón en fases o comparaciones similares." },
];

function parseResponseGraph(raw: Record<string, unknown>) {
  return normalizeGraph(raw);
}

function initialPointCount(type: GraphType, design: LineDesign) {
  if (type === "bar") return 5;
  if (design === "ABAB") return 8;
  if (design === "ABA" || design === "BAB") return 7;
  if (design === "multielement") return 8;
  return 6;
}

function buildInitialPoints(type: GraphType, design: LineDesign) {
  const count = initialPointCount(type, design);
  return Array.from({ length: count }, (_, index) => {
    const point = newGraphPoint(index, type, design);
    if (type === "bar") return { ...point, label: SITE_LABELS[index] || `Categoría ${index + 1}`, series: "Resultado" };
    if (type === "cumulative") return { ...point, series: "Repertorio" };
    return point;
  });
}

function downloadBlob(content: BlobPart, type: string, name: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "grafica";
}

function graphSvg(graph: AnalyticGraph) {
  const source = document.getElementById(`graph-svg-${graph.id}`);
  if (!(source instanceof SVGSVGElement)) throw new Error("La gráfica todavía no está lista para exportarse.");
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

async function graphPng(graph: AnalyticGraph, scale = 2) {
  const clone = graphSvg(graph);
  const viewBox = clone.viewBox.baseVal;
  const width = viewBox.width || 1200;
  const height = viewBox.height || 680;
  const svg = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo preparar la imagen de la gráfica."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no pudo crear la exportación.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png", 1);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo generar el PNG.")), "image/png", 1));
    return { blob, dataUrl, width, height };
  } finally { URL.revokeObjectURL(url); }
}

async function exportPng(graph: AnalyticGraph) {
  const png = await graphPng(graph);
  downloadBlob(png.blob, "image/png", `${safeFileName(graph.title)}.png`);
}

async function exportPdf(graph: AnalyticGraph) {
  const [{ PDFDocument, StandardFonts, rgb }, png] = await Promise.all([import("pdf-lib"), graphPng(graph)]);
  const document = await PDFDocument.create();
  const page = document.addPage([841.89, 595.28]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const image = await document.embedPng(png.dataUrl);
  const maxWidth = 785;
  const maxHeight = 500;
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  page.drawImage(image, { x: (page.getWidth() - drawWidth) / 2, y: 38, width: drawWidth, height: drawHeight });
  page.drawText("CIE Nexus · Exportación clínica", { x: 28, y: 570, size: 9, font, color: rgb(.25, .34, .3) });
  page.drawText(`Generada: ${new Date().toLocaleString("es-NI")}`, { x: 650, y: 570, size: 8, font, color: rgb(.4, .45, .43) });
  const bytes = await document.save();
  const pdfBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(pdfBuffer).set(bytes);
  downloadBlob(pdfBuffer, "application/pdf", `${safeFileName(graph.title)}.pdf`);
}

function displayedGraphValues(graph: AnalyticGraph) {
  const totals = new Map<string, number>();
  return graph.points.map((point, index) => {
    let displayed = point.value;
    if (graph.graphType === "cumulative" && point.value !== null) {
      const total = (totals.get(point.series) || 0) + Math.max(0, point.value);
      totals.set(point.series, total);
      displayed = total;
    }
    return { order: index + 1, point, displayed };
  });
}

async function exportExcel(graph: AnalyticGraph) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CIE Nexus";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Gráfica", { views: [{ state: "frozen", ySplit: 9 }] });
  sheet.columns = [
    { key: "a", width: 18 }, { key: "b", width: 34 }, { key: "c", width: 18 }, { key: "d", width: 28 },
    { key: "e", width: 18 }, { key: "f", width: 18 }, { key: "g", width: 52 },
  ];
  sheet.addRow([graph.title]);
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF164E43" } };
  sheet.addRow([graph.objective]);
  sheet.mergeCells("A2:G2");
  graph.config.exportMetadata.forEach((line) => { const row = sheet.addRow([line]); sheet.mergeCells(`A${row.number}:G${row.number}`); });
  sheet.addRow([]);
  const header = sheet.addRow(["Orden", "Eje horizontal", "Valor", "Serie / agrupación", "Criterio", "Progreso del criterio", "Nota"]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176654" } };
  displayedGraphValues(graph).forEach(({ order, point, displayed }) => sheet.addRow([
    order, point.label, displayed ?? "No medido", point.series, point.criterion ?? "", point.criterionProgress?.label || "", point.note,
  ]));
  sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: 7 } };
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${safeFileName(graph.title)}.xlsx`);
}

function uniqueInOrder(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function hasRecordedScore(scores: Record<string, AutomaticItemScore>) {
  return Object.values(scores).some((score) => Boolean(score?.interview || score?.verification));
}

function automaticClassification(item: EvaluationTarget, score?: AutomaticItemScore) {
  const methods = item.methods?.length ? item.methods : (["interview", "verification"] as const);
  const usesInterview = methods.includes("interview");
  const usesVerification = methods.includes("verification");
  if ((usesInterview && !score?.interview) || (usesVerification && !score?.verification)) return "pending";
  if ((usesInterview && score?.interview === "SE" && !usesVerification) || (usesVerification && score?.verification === "SO")) return "pending";
  if (usesInterview && usesVerification) {
    if (score?.interview === "1" && score.verification === "1") return "strength";
    return "gap";
  }
  return (usesInterview && score?.interview === "1") || (usesVerification && score?.verification === "1") ? "strength" : "gap";
}

function automaticAreaSummary(items: EvaluationTarget[], scores: Record<string, AutomaticItemScore>) {
  return items.reduce((summary, item) => {
    const result = automaticClassification(item, scores[item.code]);
    if (result === "pending") summary.pending += 1;
    else {
      summary.conclusive += 1;
      if (result === "strength") summary.strength += 1;
    }
    return summary;
  }, { strength: 0, conclusive: 0, pending: 0 });
}

function automaticPercent(summary: { strength: number; conclusive: number }) {
  return summary.conclusive ? Math.round(summary.strength / summary.conclusive * 1000) / 10 : null;
}

function automaticPackageKey(cycle: AutomaticCycle) {
  const pack = cycle.instrumentSnapshot;
  return `${pack.familyId}|${pack.version}|${cycle.routeType}`;
}

function automaticPersonKey(cycle: AutomaticCycle) {
  return `${cycle.site}|${cycle.participantName}|${cycle.programContext}`;
}

function chronological(cycles: AutomaticCycle[]) {
  return [...cycles].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function automaticGraphBase(id: string, title: string, graphType: GraphType, points: GraphPoint[]): AnalyticGraph {
  return {
    id,
    profileId: null,
    linkedProgramId: null,
    title,
    objective: "Visualización calculada directamente desde las evaluaciones guardadas.",
    graphType,
    designType: "simple",
    measurement: graphType === "cumulative" ? "Conteo de criterios" : "Porcentaje",
    xAxisLabel: graphType === "bar" ? "Sedes" : "Momentos de evaluación",
    yAxisLabel: graphType === "cumulative" ? "Targets confirmados acumulados" : "% de fortalezas entre resultados concluyentes",
    linkedCycleId: null,
    status: "active",
    points,
    phases: [],
    config: {
      ...DEFAULT_GRAPH_CONFIG,
      yMax: graphType === "cumulative" ? null : 100,
      showValues: graphType !== "line",
      showMean: false,
      showTrend: false,
    },
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

function automaticMetricValue(summary: { strength: number; conclusive: number; pending: number }, metric: AutomaticMetric) {
  if (metric === "strengthCount") return summary.strength;
  if (metric === "coveragePercent") {
    const total = summary.conclusive + summary.pending;
    return total ? Math.round(summary.conclusive / total * 1000) / 10 : null;
  }
  return automaticPercent(summary);
}

function automaticMetricAxis(metric: AutomaticMetric) {
  return metric === "strengthCount" ? "Targets confirmados" : AUTOMATIC_METRIC_LABELS[metric];
}

function buildAutomaticGraphs(
  cycles: AutomaticCycle[],
  packageKey: string,
  personKey: string,
  options: {
    metric: AutomaticMetric;
    barMoment: AutomaticMoment;
    barGroupBy: AutomaticGroupBy;
    areaKeys: string[];
  },
) {
  const packageCycles = chronological(cycles.filter((cycle) => automaticPackageKey(cycle) === packageKey));
  const focusCycles = packageCycles.filter((cycle) => automaticPersonKey(cycle) === personKey);
  const reference = focusCycles[0] || packageCycles[0];
  const areas = reference ? areasForPackage(reference.instrumentSnapshot, reference.routeType) : [];
  const visibleAreas = areas.filter((area) => options.areaKeys.includes(area.key));
  const moments = focusCycles.flatMap((cycle, cycleIndex) => {
    const result: Array<{ label: string; phase: string; scores: Record<string, AutomaticItemScore>; cycle: AutomaticCycle }> = [];
    if (hasRecordedScore(cycle.initialScores)) result.push({ label: `LB ${cycleIndex + 1}`, phase: "Evaluación inicial", scores: cycle.initialScores, cycle });
    if (hasRecordedScore(cycle.reevaluationScores)) result.push({ label: `RE ${cycleIndex + 1}`, phase: "Reevaluación", scores: cycle.reevaluationScores, cycle });
    return result;
  });

  const momentPhases = moments.flatMap((moment, index) => {
    if (!index || moment.phase === moments[index - 1].phase) return [];
    return [{
      id: `auto-evaluation-phase-${index}`,
      afterIndex: index,
      beforeLabel: moments[index - 1].phase,
      afterLabel: moment.phase,
    } satisfies PhaseBoundary];
  });

  const linePoints = moments.flatMap((moment, momentIndex) => visibleAreas.map((area, areaIndex) => {
    const summary = automaticAreaSummary(area.items, moment.scores);
    return {
      id: `auto-line-${momentIndex}-${areaIndex}`,
      label: moment.label,
      value: automaticMetricValue(summary, options.metric),
      series: area.short,
      criterion: null,
      note: `${summary.conclusive}/${area.items.length} resultados concluyentes`,
    } satisfies GraphPoint;
  }));

  const barGroups = options.barGroupBy === "site"
    ? SITE_LABELS.map((site) => ({ key: site, label: site, cycles: packageCycles.filter((cycle) => cycle.site === site) }))
    : uniqueInOrder(packageCycles.map(automaticPersonKey)).map((key) => {
      const personCycles = packageCycles.filter((cycle) => automaticPersonKey(cycle) === key);
      const cycle = personCycles[0];
      return { key, label: cycle ? `${cycle.participantName} · ${cycle.site} · ${cycle.programContext}` : key, cycles: personCycles };
    });

  const barPoints = barGroups.flatMap((group, groupIndex) => visibleAreas.map((area, areaIndex) => {
    if (options.barMoment === "change") {
      const deltas = group.cycles.flatMap((cycle) => {
        if (!hasRecordedScore(cycle.initialScores) || !hasRecordedScore(cycle.reevaluationScores)) return [];
        const initial = automaticMetricValue(automaticAreaSummary(area.items, cycle.initialScores), options.metric);
        const reevaluation = automaticMetricValue(automaticAreaSummary(area.items, cycle.reevaluationScores), options.metric);
        return initial === null || reevaluation === null ? [] : [reevaluation - initial];
      });
      const value = deltas.length ? Math.round(deltas.reduce((sum, item) => sum + item, 0) / deltas.length * 10) / 10 : null;
      return {
        id: `auto-bar-${groupIndex}-${areaIndex}`,
        label: group.label,
        value,
        series: area.short,
        criterion: null,
        note: deltas.length ? `${deltas.length} comparación${deltas.length === 1 ? "" : "es"} pre–post completa${deltas.length === 1 ? "" : "s"}` : "Sin par inicial–reevaluación completo",
      } satisfies GraphPoint;
    }

    const aggregate = group.cycles.reduce((total, cycle) => {
      const scores = options.barMoment === "initial"
        ? cycle.initialScores
        : options.barMoment === "reevaluation"
          ? cycle.reevaluationScores
          : hasRecordedScore(cycle.reevaluationScores) ? cycle.reevaluationScores : cycle.initialScores;
      if (!hasRecordedScore(scores)) return total;
      const summary = automaticAreaSummary(area.items, scores);
      total.strength += summary.strength;
      total.conclusive += summary.conclusive;
      total.pending += summary.pending;
      total.records += 1;
      return total;
    }, { strength: 0, conclusive: 0, pending: 0, records: 0 });
    return {
      id: `auto-bar-${groupIndex}-${areaIndex}`,
      label: group.label,
      value: aggregate.records ? automaticMetricValue(aggregate, options.metric) : null,
      series: area.short,
      criterion: null,
      note: aggregate.records ? `${aggregate.records} expediente${aggregate.records === 1 ? "" : "s"} · ${aggregate.conclusive} concluyentes · ${aggregate.pending} pendientes` : "Sin datos para el momento seleccionado",
    } satisfies GraphPoint;
  }));

  const confirmed = new Set<string>();
  const cumulativePoints = moments.map((moment, momentIndex) => {
    const visibleCodes = new Set(visibleAreas.flatMap((area) => area.items.map((item) => item.code)));
    const newlyConfirmed = targetsForPackage(moment.cycle.instrumentSnapshot, moment.cycle.routeType)
      .filter((item) => visibleCodes.has(item.code))
      .filter((item) => automaticClassification(item, moment.scores[item.code]) === "strength" && !confirmed.has(item.code));
    newlyConfirmed.forEach((item) => confirmed.add(item.code));
    return {
      id: `auto-cumulative-${momentIndex}`,
      label: moment.label,
      value: newlyConfirmed.length,
      series: "Repertorio confirmado",
      criterion: null,
      note: newlyConfirmed.length ? newlyConfirmed.map((item) => item.code).join(", ") : "Sin targets nuevos confirmados",
    } satisfies GraphPoint;
  });

  const latestSummaries = packageCycles.flatMap((cycle) => {
    const scores = hasRecordedScore(cycle.reevaluationScores) ? cycle.reevaluationScores : cycle.initialScores;
    return visibleAreas.map((area) => automaticAreaSummary(area.items, scores));
  });
  const metrics = latestSummaries.reduce((total, summary) => ({
    strength: total.strength + summary.strength,
    conclusive: total.conclusive + summary.conclusive,
    pending: total.pending + summary.pending,
  }), { strength: 0, conclusive: 0, pending: 0 });

  return {
    packageCycles,
    focusCycles,
    moments,
    areas,
    visibleAreas,
    metrics,
    graphs: {
      line: {
        ...automaticGraphBase("automatic-line", "Trayectoria longitudinal por área", "line", linePoints),
        phases: momentPhases,
        yAxisLabel: automaticMetricAxis(options.metric),
        config: { ...DEFAULT_GRAPH_CONFIG, yMax: options.metric === "strengthCount" ? null : 100, showValues: false },
      },
      bar: {
        ...automaticGraphBase("automatic-bar", `${AUTOMATIC_MOMENT_LABELS[options.barMoment]} por ${options.barGroupBy === "site" ? "sede" : "participante"}`, "bar", barPoints),
        xAxisLabel: options.barGroupBy === "site" ? "Sedes" : "Participantes",
        yAxisLabel: options.barMoment === "change" ? `Cambio en ${automaticMetricAxis(options.metric)}` : automaticMetricAxis(options.metric),
        config: {
          ...DEFAULT_GRAPH_CONFIG,
          yMin: options.barMoment === "change"
            ? options.metric === "strengthCount"
              ? -Math.max(1, ...visibleAreas.map((area) => area.items.length))
              : -100
            : 0,
          yMax: options.metric === "strengthCount" ? null : 100,
          showValues: true,
        },
      },
      cumulative: automaticGraphBase("automatic-cumulative", "Repertorio de targets confirmados", "cumulative", cumulativePoints),
    },
  };
}

function markerShape(kind: typeof MARKERS[number], x: number, y: number, color: string, key: string) {
  if (kind === "square") return <rect key={key} x={x - 5} y={y - 5} width="10" height="10" rx="1" fill="white" stroke={color} strokeWidth="3"/>;
  if (kind === "triangle") return <path key={key} d={`M ${x} ${y - 6} L ${x + 6} ${y + 5} L ${x - 6} ${y + 5} Z`} fill="white" stroke={color} strokeWidth="3"/>;
  if (kind === "diamond") return <path key={key} d={`M ${x} ${y - 7} L ${x + 7} ${y} L ${x} ${y + 7} L ${x - 7} ${y} Z`} fill="white" stroke={color} strokeWidth="3"/>;
  return <circle key={key} cx={x} cy={y} r="5" fill="white" stroke={color} strokeWidth="3"/>;
}

function regression(points: Array<{ x: number; value: number }>) {
  if (points.length < 2) return null;
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (!denominator) return null;
  const slope = points.reduce((sum, point) => sum + (point.x - xMean) * (point.value - yMean), 0) / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

function pointTooltip(point: GraphPoint, value: number) {
  const source = point.source;
  return [
    `${point.label} · ${point.series}: ${value}`,
    source?.sessionId ? `Sesión ${source.sessionId}` : "",
    source?.targetName ? `Target ${source.targetName}` : "",
    source?.opportunities ? `${source.opportunities} oportunidades` : "",
    source?.context ? `Contexto: ${source.context}` : "",
    source?.sessionNotes ? `Notas: ${source.sessionNotes}` : "",
    point.note,
  ].filter(Boolean).join(" · ");
}

export function GraphCanvas({ graph, showLegend = true, density = "standard", edgeInset = false }: { graph: AnalyticGraph; showLegend?: boolean; density?: AutomaticDensity; edgeInset?: boolean }) {
  const width = density === "large" ? 1200 : 1000;
  const height = density === "compact" ? 470 : density === "large" ? 680 : 560;
  const categoryKeys = uniqueInOrder(graph.points.map((point) => point.xKey || point.label));
  const categoryLabel = new Map(graph.points.map((point) => [point.xKey || point.label, point.label]));
  const series = uniqueInOrder(graph.points.map((point) => point.series || "Datos"));
  const rotateXLabels = categoryKeys.length > 7 || categoryKeys.some((key) => (categoryLabel.get(key) || key).length > 15);
  const metadata = graph.config.exportMetadata.slice(0, 8);
  const margin = { left: 90, right: 34, top: metadata.length ? Math.max(142, 90 + metadata.length * 12) : 105, bottom: rotateXLabels ? 118 : 78 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const isColumn = graph.graphType === "bar" || graph.graphType === "stacked-bar";
  const horizontalInset = edgeInset && !isColumn && categoryKeys.length > 1 ? 30 : 0;
  const pointKey = (point: GraphPoint) => point.xKey || point.label;
  const cumulativeById = new Map<string, number | null>();
  if (graph.graphType === "cumulative") {
    series.forEach((name) => {
      let total = 0;
      graph.points.filter((point) => (point.series || "Datos") === name)
        .sort((a, b) => categoryKeys.indexOf(pointKey(a)) - categoryKeys.indexOf(pointKey(b)))
        .forEach((point) => {
        if (point.value === null) cumulativeById.set(point.id, null);
        else {
          total += Math.max(0, point.value);
          cumulativeById.set(point.id, total);
        }
      });
    });
  }
  const plottedValues = graph.points.flatMap((point) => {
    const value = graph.graphType === "cumulative" ? cumulativeById.get(point.id) : point.value;
    return [value, graph.config.showCriterion ? point.criterion : null].filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  });
  if (graph.graphType === "stacked-bar") {
    categoryKeys.forEach((key) => plottedValues.push(graph.points.filter((point) => pointKey(point) === key && point.value !== null).reduce((sum, point) => sum + Math.max(0, point.value || 0), 0)));
  }
  const yMin = graph.config.yMin;
  const observedMax = plottedValues.length ? Math.max(...plottedValues) : 10;
  const yMax = graph.config.yMax && graph.config.yMax > yMin
    ? graph.config.yMax
    : Math.max(yMin + 1, Math.ceil(observedMax / 10) * 10 || 10);
  const y = (value: number) => margin.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;
  const x = (key: string) => {
    const index = Math.max(0, categoryKeys.indexOf(key));
    if (isColumn) return margin.left + (index + .5) * (innerWidth / Math.max(1, categoryKeys.length));
    return margin.left + (categoryKeys.length <= 1 ? innerWidth / 2 : horizontalInset + index * (innerWidth - horizontalInset * 2) / (categoryKeys.length - 1));
  };
  const phaseRanges = (() => {
    const boundaries = [...new Set(graph.phases.map((phase) => phase.afterIndex))].sort((a, b) => a - b);
    const ranges: Array<{ start: number; end: number; label: string }> = [];
    let start = 0;
    boundaries.forEach((afterIndex) => {
      const end = Math.max(start, Math.min(categoryKeys.length - 1, afterIndex - 1));
      if (start <= end) ranges.push({ start, end, label: "" });
      start = Math.min(categoryKeys.length, afterIndex);
    });
    if (categoryKeys.length && start < categoryKeys.length) ranges.push({ start, end: categoryKeys.length - 1, label: "" });
    if (categoryKeys.length && !ranges.length) ranges.push({ start: 0, end: categoryKeys.length - 1, label: "" });
    return ranges;
  })();
  const phaseBoundaryIndices = new Set(graph.graphType === "line" ? graph.phases.map((phase) => phase.afterIndex) : []);
  const tickCount = 5;
  const xBand = categoryKeys.length ? innerWidth / categoryKeys.length : innerWidth;
  const desc = `${graph.title}. ${GRAPH_TYPE_LABELS[graph.graphType]}. ${graph.points.length} registros. Eje vertical: ${graph.yAxisLabel}.`;
  const trendInsufficient = graph.config.showTrend ? series.reduce((count, name) => count + phaseRanges.filter((range) => {
    const values = graph.points.filter((point) => (point.series || "Datos") === name && point.value !== null)
      .filter((point) => { const index = categoryKeys.indexOf(pointKey(point)); return index >= range.start && index <= range.end; });
    return values.length > 0 && values.length < 2;
  }).length, 0) : 0;

  return <svg id={`graph-svg-${graph.id}`} className="analytic-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`graph-title-${graph.id} graph-desc-${graph.id}`}>
    <title id={`graph-title-${graph.id}`}>{graph.title}</title>
    <desc id={`graph-desc-${graph.id}`}>{desc}</desc>
    <rect width={width} height={height} fill="#ffffff" rx="12"/>
    <text x={width / 2} y="31" textAnchor="middle" fontSize="20" fontWeight="800" fill="#14241e">{graph.title}</text>
    <text x={width / 2} y="54" textAnchor="middle" fontSize="11" fill="#64726c">{graph.measurement} · {graph.graphType === "line" ? LINE_DESIGN_LABELS[graph.designType] : GRAPH_TYPE_LABELS[graph.graphType]}</text>
    {metadata.map((line, index) => <text key={`metadata-${index}`} x={width / 2} y={72 + index * 12} textAnchor="middle" fontSize="9" fill="#6b7772">{line.length > 150 ? `${line.slice(0, 149)}…` : line}</text>)}
    {trendInsufficient > 0 && <text x={width - margin.right} y={margin.top - 12} textAnchor="end" fontSize="10" fontWeight="700" fill="#9b6a2e">Tendencia no calculada: {trendInsufficient} fase{trendInsufficient === 1 ? "" : "s"} con menos de 2 puntos</text>}

    {Array.from({ length: tickCount + 1 }, (_, index) => {
      const value = yMin + (yMax - yMin) * index / tickCount;
      const py = y(value);
      return <g key={`y-${index}`}>
        {graph.config.showGrid && <line x1={margin.left} x2={width - margin.right} y1={py} y2={py} stroke="#dfe6e2" strokeWidth="1"/>}
        <text x={margin.left - 13} y={py + 4} textAnchor="end" fontSize="11" fill="#57665f">{Number.isInteger(value) ? value : value.toFixed(1)}</text>
      </g>;
    })}
    <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + innerHeight} stroke="#22352d" strokeWidth="2"/>
    <line x1={margin.left} x2={width - margin.right} y1={margin.top + innerHeight} y2={margin.top + innerHeight} stroke="#22352d" strokeWidth="2"/>
    {categoryKeys.map((key, index) => { const label = categoryLabel.get(key) || key; return <g key={`x-${key}-${index}`}>
      <title>{label}</title>
      <line x1={x(key)} x2={x(key)} y1={margin.top + innerHeight} y2={margin.top + innerHeight + 6} stroke="#22352d"/>
      <text transform={rotateXLabels ? `translate(${x(key) - 2} ${margin.top + innerHeight + 20}) rotate(-45)` : undefined} x={rotateXLabels ? undefined : x(key)} y={rotateXLabels ? undefined : margin.top + innerHeight + 22} textAnchor={rotateXLabels ? "end" : "middle"} fontSize="10" fill="#57665f">{label.length > 20 ? `${label.slice(0, 19)}…` : label}</text>
    </g>; })}
    <text x={margin.left + innerWidth / 2} y={height - 18} textAnchor="middle" fontSize="12" fontWeight="700" fill="#33473e">{graph.xAxisLabel}</text>
    <text transform={`translate(24 ${margin.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fontWeight="700" fill="#33473e">{graph.yAxisLabel}</text>

    {graph.graphType === "bar" ? (() => {
      const groupWidth = Math.min(xBand * .78, 110);
      const barWidth = Math.max(6, groupWidth / Math.max(series.length, 1) - 4);
      return graph.points.filter((point) => point.value !== null).map((point) => {
        const seriesIndex = Math.max(0, series.indexOf(point.series || "Datos"));
        const categoryCenter = x(pointKey(point));
        const px = categoryCenter - groupWidth / 2 + seriesIndex * (barWidth + 4);
        const py = y(point.value as number);
        const baseY = y(Math.max(0, yMin));
        return <g key={point.id}>
          <title>{pointTooltip(point, point.value as number)}</title>
          <rect x={px} y={Math.min(py, baseY)} width={barWidth} height={Math.max(1, Math.abs(baseY - py))} rx="3" fill={COLORS[seriesIndex % COLORS.length]}/>
          {(graph.config.showValues || series.length === 1) && <text x={px + barWidth / 2} y={Math.min(py, baseY) - 7} textAnchor="middle" fontSize="10" fontWeight="800" fill="#33473e">{point.value}</text>}
        </g>;
      });
    })() : graph.graphType === "stacked-bar" ? categoryKeys.flatMap((key) => {
      let running = Math.max(0, yMin);
      return series.flatMap((name, seriesIndex) => {
        const point = graph.points.find((item) => pointKey(item) === key && (item.series || "Datos") === name && item.value !== null);
        if (!point || point.value === null || point.value < 0) return [];
        const start = running;
        running += point.value;
        const py = y(running);
        const baseY = y(start);
        const barWidth = Math.min(xBand * .64, 92);
        return [<g key={point.id}><title>{pointTooltip(point, point.value)}</title><rect x={x(key) - barWidth / 2} y={py} width={barWidth} height={Math.max(1, baseY - py)} fill={COLORS[seriesIndex % COLORS.length]}/>{graph.config.showValues && <text x={x(key)} y={(py + baseY) / 2 + 3} textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">{point.value}</text>}</g>];
      });
    }) : series.map((name, seriesIndex) => {
      const source = graph.points.filter((point) => (point.series || "Datos") === name)
        .sort((a, b) => categoryKeys.indexOf(pointKey(a)) - categoryKeys.indexOf(pointKey(b)));
      const plotted = source.map((point) => ({
        point,
        value: graph.graphType === "cumulative" ? cumulativeById.get(point.id) ?? null : point.value,
      })).filter((item): item is { point: GraphPoint; value: number } => item.value !== null && Number.isFinite(item.value));
      const segments: Array<Array<{ point: GraphPoint; value: number }>> = [];
      let currentSegment: Array<{ point: GraphPoint; value: number }> = [];
      source.forEach((point) => {
        const value = graph.graphType === "cumulative" ? cumulativeById.get(point.id) ?? null : point.value;
        const labelIndex = categoryKeys.indexOf(pointKey(point));
        if (currentSegment.length && phaseBoundaryIndices.has(labelIndex)) {
          segments.push(currentSegment);
          currentSegment = [];
        }
        if (value === null || !Number.isFinite(value)) {
          if (currentSegment.length) segments.push(currentSegment);
          currentSegment = [];
        } else currentSegment.push({ point, value });
      });
      if (currentSegment.length) segments.push(currentSegment);
      const color = COLORS[seriesIndex % COLORS.length];
      return <g key={name}>
        {graph.graphType !== "scatter" && graph.config.connectPoints && segments.map((segment, segmentIndex) => segment.length > 1 ? <path key={`${name}-segment-${segmentIndex}`} d={segment.map((item, index) => `${index ? "L" : "M"} ${x(pointKey(item.point))} ${y(item.value)}`).join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/> : null)}
        {plotted.map((item) => <g key={item.point.id}>
          <title>{pointTooltip(item.point, item.value)}</title>
          {graph.config.showPoints && markerShape(MARKERS[seriesIndex % MARKERS.length], x(pointKey(item.point)) + (graph.graphType === "scatter" ? (seriesIndex - (series.length - 1) / 2) * 5 : 0), y(item.value), color, `${item.point.id}-mark`)}
          {graph.config.showValues && <text x={x(pointKey(item.point))} y={y(item.value) - 12} textAnchor="middle" fontSize="10" fontWeight="800" fill={color}>{item.value}</text>}
        </g>)}
        {graph.config.showTrend && phaseRanges.map((range, index) => {
          const inRange = plotted.map((item) => ({ x: categoryKeys.indexOf(pointKey(item.point)), value: item.value })).filter((item) => item.x >= range.start && item.x <= range.end);
          const fit = regression(inRange);
          if (!fit || inRange.length < 2) return null;
          const first = inRange[0].x;
          const last = inRange[inRange.length - 1].x;
          return <line key={`${name}-trend-${index}`} x1={x(categoryKeys[first])} x2={x(categoryKeys[last])} y1={y(fit.slope * first + fit.intercept)} y2={y(fit.slope * last + fit.intercept)} stroke={color} strokeWidth="1.5" strokeDasharray="4 4" opacity=".75"/>;
        })}
        {graph.config.showMean && phaseRanges.map((range, index) => {
          const values = plotted.filter((item) => { const pointIndex = categoryKeys.indexOf(pointKey(item.point)); return pointIndex >= range.start && pointIndex <= range.end; }).map((item) => item.value);
          if (!values.length) return null;
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
          return <line key={`${name}-mean-${index}`} x1={x(categoryKeys[range.start])} x2={x(categoryKeys[range.end])} y1={y(mean)} y2={y(mean)} stroke={color} strokeWidth="2" strokeDasharray="8 5" opacity=".65"/>;
        })}
      </g>;
    })}

    {graph.graphType === "line" && graph.config.showCriterion && series.map((name, seriesIndex) => {
      const source = graph.points.filter((point) => (point.series || "Datos") === name)
        .sort((a, b) => categoryKeys.indexOf(pointKey(a)) - categoryKeys.indexOf(pointKey(b)));
      const criteria = source.filter((point) => point.criterion !== null);
      if (!criteria.length) return null;
      const parts: string[] = [];
      let open = false;
      source.forEach((point) => {
        if (point.criterion === null) { open = false; return; }
        const px = x(pointKey(point));
        const py = y(point.criterion as number);
        if (!open || phaseBoundaryIndices.has(categoryKeys.indexOf(pointKey(point)))) parts.push(`M ${px} ${py}`);
        else parts.push(`H ${px} V ${py}`);
        open = true;
      });
      const latest = criteria.at(-1)!;
      return <g key={`criterion-${name}`}><path d={parts.join(" ")} fill="none" stroke="#b34f55" strokeWidth="2" strokeDasharray="9 5" opacity={series.length > 1 ? .68 + seriesIndex * .04 : 1} aria-label={`Criterio de ${name}`}/>{latest.criterionProgress && <text x={Math.min(width - margin.right - 4, x(pointKey(latest)) + 8)} y={y(latest.criterion as number) - 8} textAnchor="end" fontSize="10" fontWeight="800" fill="#a14851">Criterio · {latest.criterionProgress.label}</text>}</g>;
    })}

    {graph.graphType === "line" && [...new Map([...graph.phases].sort((a, b) => a.afterIndex - b.afterIndex).map((phase) => [phase.afterIndex, graph.phases.filter((item) => item.afterIndex === phase.afterIndex)])).entries()].map(([afterIndex, phases]) => {
      if (!categoryKeys.length || afterIndex < 1 || afterIndex > categoryKeys.length) return null;
      const px = afterIndex === categoryKeys.length
        ? Math.min(width - margin.right, x(categoryKeys[categoryKeys.length - 1]) + Math.max(14, horizontalInset / 2))
        : (x(categoryKeys[afterIndex - 1]) + x(categoryKeys[afterIndex])) / 2;
      const label = phases.map((phase) => `${phase.targetLabel ? `${phase.targetLabel}: ` : ""}${phase.afterLabel}`).join(" · ");
      return <g key={`phase-${afterIndex}`}><line x1={px} x2={px} y1={margin.top - 15} y2={margin.top + innerHeight} stroke="#6c7771" strokeWidth="1.5" strokeDasharray="6 5"/><text transform={`translate(${px + 4} ${margin.top - 20}) rotate(-35)`} textAnchor="start" fontSize="9" fontWeight="800" fill="#46554e">{label.length > 70 ? `${label.slice(0, 69)}…` : label}</text></g>;
    })}

    {showLegend && graph.config.showLegend && series.length > 1 && <g transform={`translate(${margin.left} ${rotateXLabels ? 76 : height - 48})`}>
      {series.map((name, index) => <g key={`legend-${name}`} transform={`translate(${index * Math.min(180, innerWidth / series.length)} 0)`}>
        <line x1="0" x2="22" y1="0" y2="0" stroke={COLORS[index % COLORS.length]} strokeWidth="3"/>
        <text x="29" y="4" fontSize="10" fill="#46554e">{name}</text>
      </g>)}
    </g>}
  </svg>;
}

const CONFIG_SOURCE_LABELS: Record<Exclude<GraphDataSource, "manual">, string> = {
  sessions: "Sesiones",
  trials: "Ensayo por ensayo",
  abc: "Incidentes ABC",
};
const CONFIG_PERIOD_LABELS: Record<GraphPeriod, string> = {
  today: "Hoy", "7d": "Últimos 7 días", "30d": "Últimos 30 días", "3m": "Últimos 3 meses", "6m": "Últimos 6 meses", all: "Todo", custom: "Rango personalizado",
};
const CONFIG_X_LABELS: Record<GraphXAxis, string> = { date: "Fecha", session: "Sesión", target: "Objetivo", prompt: "Nivel de ayuda", therapist: "Terapeuta" };
const CONFIG_Y_LABELS: Record<GraphYAxis, string> = { percentage_correct: "% correcto", count: "Conteo", rate: "Tasa", duration: "Duración" };
const CONFIG_GROUP_LABELS: Record<GraphGrouping, string> = { none: "Sin agrupación", program: "Programa", target: "Objetivo", prompt: "Nivel de ayuda", therapist: "Terapeuta" };
const CONFIG_RATE_LABELS: Record<GraphRateUnit, string> = { minute: "Por minuto", hour: "Por hora", day: "Por día" };
const CONFIG_STATE_LABELS: Record<string, string> = { baseline: "Línea base", acquisition: "Adquisición", generalization: "Masterizado", maintenance: "Generalizado", closed: "Cerrado" };

function newConfigurableConfig(initialProgramId?: string | null): GraphConfig {
  return {
    ...DEFAULT_GRAPH_CONFIG,
    version: 2,
    dataSource: "sessions",
    period: "30d",
    xAxis: "date",
    yAxis: "percentage_correct",
    grouping: "target",
    rateUnit: "hour",
    filters: { programIds: initialProgramId ? [initialProgramId] : [], targetIds: [], targetStates: [], therapistIds: [] },
    sourceTargetIds: [],
    showMean: true,
    showTrend: true,
    showCriterion: true,
    exportMetadata: [],
    warnings: [],
  };
}

function ConfigurableGraphWorkspace({
  profiles,
  selectedProfileId,
  initialProgramId,
  canManage,
  notify,
  onSaved,
}: {
  profiles: LinkableProfile[];
  selectedProfileId: string;
  initialProgramId: string | null;
  canManage: boolean;
  notify: (text: string) => void;
  onSaved: (graph: AnalyticGraph) => void;
}) {
  const initialProfile = selectedProfileId !== "all" ? selectedProfileId : profiles.find((profile) => profile.status === "active")?.id || "";
  const [profileId, setProfileId] = useState(initialProfile);
  const effectiveProfileId = selectedProfileId !== "all" ? selectedProfileId : profileId;
  const [dataset, setDataset] = useState<ConfigurableGraphDataset | null>(null);
  const [loading, setLoading] = useState(Boolean(initialProfile));
  const [error, setError] = useState("");
  const [config, setConfig] = useState<GraphConfig>(() => newConfigurableConfig(initialProgramId));
  const [graphType, setGraphType] = useState<GraphType>("line");
  const [title, setTitle] = useState("Progreso clínico configurable");
  const [objective, setObjective] = useState("Analizar el progreso con datos clínicos conectados al expediente.");
  const [manualPhases, setManualPhases] = useState<PhaseBoundary[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState("");

  useEffect(() => {
    if (!effectiveProfileId) return;
    const controller = new AbortController();
    fetch(`/api/graph-data?profileId=${encodeURIComponent(effectiveProfileId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as ConfigurableGraphDataset & { error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron preparar los datos clínicos.");
        setDataset(data);
        setConfig((current) => ({
          ...current,
          filters: {
            ...current.filters,
            programIds: initialProgramId && data.programs.some((program) => program.id === initialProgramId) ? [initialProgramId] : current.filters.programIds.filter((id) => data.programs.some((program) => program.id === id)),
            targetIds: current.filters.targetIds.filter((id) => data.programs.some((program) => program.targets.some((target) => target.id === id))),
            therapistIds: current.filters.therapistIds.filter((id) => data.professionals.some((professional) => professional.id === id)),
          },
        }));
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "No se pudieron preparar los datos clínicos.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [effectiveProfileId, initialProgramId]);

  const selectedPrograms = dataset?.programs.filter((program) => !config.filters.programIds.length || config.filters.programIds.includes(program.id)) || [];
  const availableTargets = selectedPrograms.flatMap((program) => program.targets);
  const xAxisLabel = CONFIG_X_LABELS[config.xAxis];
  const yAxisLabel = config.yAxis === "rate" ? `${CONFIG_Y_LABELS.rate} · ${CONFIG_RATE_LABELS[config.rateUnit].toLowerCase()}` : CONFIG_Y_LABELS[config.yAxis];
  const graph = useMemo(() => dataset ? buildConfigurableGraph({
    id: `configurable-${dataset.profile.id}`,
    dataset,
    config,
    graphType,
    title,
    objective,
    measurement: CONFIG_SOURCE_LABELS[config.dataSource as Exclude<GraphDataSource, "manual">],
    xAxisLabel,
    yAxisLabel,
    manualPhases,
  }) : null, [dataset, config, graphType, title, objective, xAxisLabel, yAxisLabel, manualPhases]);
  const categoryKeys = graph ? uniqueInOrder(graph.points.map((point) => point.xKey || point.label)) : [];

  function patchConfig(patch: Partial<GraphConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function patchFilters(key: keyof GraphConfig["filters"], value: string) {
    setConfig((current) => {
      const values = current.filters[key];
      return { ...current, filters: { ...current.filters, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] } };
    });
    setManualPhases([]);
  }

  function changeSource(source: Exclude<GraphDataSource, "manual">) {
    if (source === "abc") {
      setGraphType("bar");
      patchConfig({ dataSource: source, xAxis: "date", yAxis: "count", grouping: "none", showCriterion: false });
    } else if (source === "trials") {
      setGraphType("line");
      patchConfig({ dataSource: source, xAxis: "session", yAxis: "percentage_correct", grouping: "target", showCriterion: true });
    } else {
      setGraphType("line");
      patchConfig({ dataSource: source, xAxis: "date", yAxis: "percentage_correct", grouping: "target", showCriterion: true });
    }
    setManualPhases([]);
  }

  function changeGraphType(type: GraphType) {
    setGraphType(type);
    if (type === "cumulative") {
      patchConfig({ dataSource: "sessions", xAxis: "date", yAxis: "count", grouping: "program", showCriterion: false, showMean: false, showTrend: false });
      setManualPhases([]);
    }
  }

  function addManualPhase() {
    if (categoryKeys.length < 2) { notify("Se necesitan al menos dos posiciones para agregar una fase manual."); return; }
    const used = new Set(manualPhases.map((phase) => phase.afterIndex));
    const afterIndex = Array.from({ length: categoryKeys.length - 1 }, (_, index) => index + 1).find((index) => !used.has(index));
    if (!afterIndex) { notify("Ya existe una fase manual entre cada par de posiciones."); return; }
    setManualPhases((current) => [...current, { id: graphLocalId(), afterIndex, beforeLabel: "Fase anterior", afterLabel: "Fase siguiente", boundaryKey: categoryKeys[afterIndex], origin: "manual" }]);
  }

  function updateManualPhase(id: string, patch: Partial<PhaseBoundary>) {
    setManualPhases((current) => current
      .map((phase) => phase.id === id ? { ...phase, ...patch } : phase)
      .sort((a, b) => a.afterIndex - b.afterIndex));
  }

  async function saveConfiguration() {
    if (!graph || !canManage) return;
    if (!title.trim()) { notify("Escribe un nombre para guardar la configuración."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/graphs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...graph, id: undefined, phases: graph.phases }) });
      const data = await response.json() as { graph?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.graph) throw new Error(data.error || "No se pudo guardar la configuración.");
      const saved = normalizeGraph(data.graph);
      onSaved(saved);
      notify("Configuración guardada con sus fuentes, ejes, filtros, agrupación y fases.");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "No se pudo guardar la configuración."); }
    finally { setSaving(false); }
  }

  async function runExport(kind: "png" | "pdf" | "xlsx") {
    if (!graph) return;
    setExporting(kind);
    try {
      if (kind === "png") await exportPng(graph);
      else if (kind === "pdf") await exportPdf(graph);
      else await exportExcel(graph);
      notify(`Exportación ${kind === "xlsx" ? "Excel" : kind.toUpperCase()} generada con período y filtros.`);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "No se pudo exportar la gráfica."); }
    finally { setExporting(""); }
  }

  return <section className="formation-panel configurable-graph-shell">
    <div className="configurable-heading"><div><p className="section-kicker">Gráfica clínica unificada</p><h2>Configura la pregunta, no una plantilla fija</h2><p>Sesiones, ensayos e incidentes ABC utilizan el mismo expediente. Un cero observado permanece como dato y lo no medido permanece como hueco.</p></div><div><button className="secondary-formation-button" onClick={() => setControlsOpen((value) => !value)}><SlidersHorizontal size={15}/>{controlsOpen ? "Ocultar controles" : "Configurar"}</button></div></div>
    <div className="configurable-profile-row"><label><span>Niño</span><select value={effectiveProfileId} disabled={selectedProfileId !== "all"} onChange={(event) => { const next = event.target.value; setProfileId(next); setDataset(null); setLoading(Boolean(next)); setError(""); setConfig(newConfigurableConfig(null)); setManualPhases([]); }}><option value="">Selecciona un niño</option>{profiles.filter((profile) => profile.status === "active").map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label>{dataset?.capabilities.privacyMode === "assigned_child_aggregate_own_raw" && <div className="graph-privacy-banner"><LockKeyhole size={16}/><span>Ves el progreso general del niño. El detalle identificable y los ensayos se limitan a tus propias sesiones.</span></div>}</div>
    {loading ? <div className="empty-state automatic-empty"><LoaderCircle className="spin" size={27}/><strong>Preparando una sola fuente clínica…</strong></div> : error ? <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>No se pudieron cargar los datos</strong><p>{error}</p></div> : !dataset ? <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>Selecciona un niño</strong><p>La configuración se vinculará a su expediente y respetará tu alcance.</p></div> : <div className={`configurable-layout ${controlsOpen ? "with-controls" : ""}`}>
      {controlsOpen && <aside className="configurable-controls">
        <fieldset><legend>Configuración guardable</legend><label><span>Nombre</span><input value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)}/></label><label><span>Objetivo del análisis</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)}/></label></fieldset>
        <fieldset><legend>Período</legend><select value={config.period} onChange={(event) => patchConfig({ period: event.target.value as GraphPeriod })}>{Object.entries(CONFIG_PERIOD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{config.period === "custom" && <div className="configurable-date-grid"><label><span>Desde</span><input type="date" value={config.dateFrom} onChange={(event) => patchConfig({ dateFrom: event.target.value })}/></label><label><span>Hasta</span><input type="date" value={config.dateTo} onChange={(event) => patchConfig({ dateTo: event.target.value })}/></label></div>}</fieldset>
        <fieldset><legend>Datos</legend><div className="configurable-choice-grid">{(["sessions", "trials", "abc"] as const).map((source) => <button type="button" className={config.dataSource === source ? "active" : ""} disabled={source === "abc" ? !dataset.capabilities.canViewAbcSource : !dataset.capabilities.canViewSessionSource} onClick={() => changeSource(source)} key={source}>{CONFIG_SOURCE_LABELS[source]}</button>)}</div></fieldset>
        <fieldset><legend>Ejes y agrupación</legend><label><span>Eje horizontal</span><select value={config.xAxis} onChange={(event) => { patchConfig({ xAxis: event.target.value as GraphXAxis }); setManualPhases([]); }}>{Object.entries(CONFIG_X_LABELS).filter(([value]) => dataset.capabilities.canCompareTherapists || value !== "therapist").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Eje vertical</span><select value={config.yAxis} onChange={(event) => patchConfig({ yAxis: event.target.value as GraphYAxis })}>{Object.entries(CONFIG_Y_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{config.yAxis === "rate" && <label><span>Unidad de tasa</span><select value={config.rateUnit} onChange={(event) => patchConfig({ rateUnit: event.target.value as GraphRateUnit })}>{Object.entries(CONFIG_RATE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}<label><span>Agrupar por</span><select value={config.grouping} onChange={(event) => patchConfig({ grouping: event.target.value as GraphGrouping })}>{Object.entries(CONFIG_GROUP_LABELS).filter(([value]) => dataset.capabilities.canCompareTherapists || value !== "therapist").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></fieldset>
        <fieldset><legend>Filtros · programas</legend><div className="configurable-filter-list">{dataset.programs.map((program) => <label key={program.id}><input type="checkbox" checked={config.filters.programIds.includes(program.id)} onChange={() => patchFilters("programIds", program.id)}/><span><strong>{program.name}</strong><small>{program.status === "active" ? "Activo" : "Histórico"}</small></span></label>)}</div><small>Sin selección explícita se incluyen todos.</small></fieldset>
        <fieldset><legend>Filtros · objetivos</legend><div className="configurable-filter-list targets">{availableTargets.map((target) => <label key={target.id}><input type="checkbox" checked={config.filters.targetIds.includes(target.id)} onChange={() => patchFilters("targetIds", target.id)}/><span><strong>{target.code} · {target.name}</strong><small>{CONFIG_STATE_LABELS[target.state]} · {target.unitLabel}</small></span></label>)}</div><small>Sin selección explícita se incluyen todos los objetivos de los programas elegidos.</small></fieldset>
        <fieldset><legend>Estado del objetivo</legend><div className="configurable-choice-grid compact">{Object.entries(CONFIG_STATE_LABELS).map(([value, label]) => <button type="button" key={value} className={config.filters.targetStates.includes(value) ? "active" : ""} onClick={() => patchFilters("targetStates", value)}>{label}</button>)}</div></fieldset>
        {dataset.capabilities.canCompareTherapists && <fieldset><legend>Terapeuta</legend><div className="configurable-filter-list">{dataset.professionals.map((professional) => <label key={professional.id}><input type="checkbox" checked={config.filters.therapistIds.includes(professional.id)} onChange={() => patchFilters("therapistIds", professional.id)}/><span><strong>{professional.name}</strong></span></label>)}</div><small>Sin selección explícita se incluyen todos dentro de tu alcance.</small></fieldset>}
        <fieldset><legend>Tipo</legend><div className="configurable-type-grid">{(["line", "bar", "stacked-bar", "scatter", "cumulative"] as GraphType[]).map((type) => <button type="button" className={graphType === type ? "active" : ""} key={type} onClick={() => changeGraphType(type)}>{type === "line" ? <LineChart size={15}/> : type === "cumulative" ? <TrendingUp size={15}/> : <BarChart3 size={15}/>}<span>{GRAPH_TYPE_LABELS[type]}</span></button>)}</div></fieldset>
        {graphType === "line" && <fieldset><legend>Validez conductual</legend><div className="automatic-toggle-grid"><label><input type="checkbox" checked={config.showMean} onChange={(event) => patchConfig({ showMean: event.target.checked })}/><span>Promedio por fase</span></label><label><input type="checkbox" checked={config.showTrend} onChange={(event) => patchConfig({ showTrend: event.target.checked })}/><span>Tendencia por fase</span></label><label><input type="checkbox" checked={config.showCriterion} onChange={(event) => patchConfig({ showCriterion: event.target.checked })}/><span>Criterio y avance</span></label><label><input type="checkbox" checked={config.connectPoints} onChange={(event) => patchConfig({ connectPoints: event.target.checked })}/><span>Conectar dentro de fase</span></label></div><button type="button" className="automatic-add-phase" onClick={addManualPhase}><Plus size={14}/> Añadir fase manual</button>{graph?.phases.length ? <div className="configurable-phase-list">{graph.phases.map((phase) => <article key={phase.id}><span className={phase.origin === "automatic" ? "automatic" : "manual"}>{phase.origin === "automatic" ? "Automática" : "Manual"}</span>{phase.origin === "manual" ? <div className="configurable-phase-fields"><label><small>Ubicación</small><select value={phase.afterIndex} onChange={(event) => { const afterIndex = Number(event.target.value); updateManualPhase(phase.id, { afterIndex, boundaryKey: categoryKeys[afterIndex] }); }}>{categoryKeys.slice(1).map((key, index) => <option value={index + 1} key={key}>Después de {graph.points.find((point) => (point.xKey || point.label) === categoryKeys[index])?.label || categoryKeys[index]}</option>)}</select></label><label><small>Antes</small><input value={phase.beforeLabel} maxLength={80} onChange={(event) => updateManualPhase(phase.id, { beforeLabel: event.target.value })}/></label><label><small>Después</small><input value={phase.afterLabel} maxLength={80} onChange={(event) => updateManualPhase(phase.id, { afterLabel: event.target.value })}/></label></div> : <div><strong>{phase.targetLabel || `${phase.beforeLabel} → ${phase.afterLabel}`}</strong><small>{phase.beforeLabel} → {phase.afterLabel} · posición {phase.afterIndex}</small></div>}{phase.origin === "manual" && <button type="button" aria-label="Eliminar fase manual" onClick={() => setManualPhases((current) => current.filter((item) => item.id !== phase.id))}><Trash2 size={13}/></button>}</article>)}</div> : null}</fieldset>}
        <fieldset><legend>Presentación</legend><div className="automatic-toggle-grid"><label><input type="checkbox" checked={config.showGrid} onChange={(event) => patchConfig({ showGrid: event.target.checked })}/><span>Cuadrícula</span></label><label><input type="checkbox" checked={config.showPoints} onChange={(event) => patchConfig({ showPoints: event.target.checked })}/><span>Puntos</span></label><label><input type="checkbox" checked={config.showValues} onChange={(event) => patchConfig({ showValues: event.target.checked })}/><span>Valores</span></label><label><input type="checkbox" checked={config.showLegend} onChange={(event) => patchConfig({ showLegend: event.target.checked })}/><span>Leyenda</span></label><label><input type="checkbox" checked={showTable} onChange={(event) => setShowTable(event.target.checked)}/><span>Tabla</span></label></div></fieldset>
        {canManage && <button className="primary-formation-button configurable-save" disabled={saving || !graph?.points.some((point) => point.value !== null)} onClick={saveConfiguration}>{saving ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} Guardar configuración</button>}
      </aside>}
      <div className="configurable-stage">
        <div className="automatic-chart-toolbar"><div><span className="automatic-view-label">{dataset.profile.fullName} · {dataset.profile.site}</span><strong>{title}</strong><small>{CONFIG_SOURCE_LABELS[config.dataSource as Exclude<GraphDataSource, "manual">]} · {CONFIG_PERIOD_LABELS[config.period]} · agrupado por {CONFIG_GROUP_LABELS[config.grouping].toLowerCase()}</small></div><div><button className="secondary-formation-button" disabled={Boolean(exporting) || !graph?.points.length} onClick={() => void runExport("png")}><FileImage size={15}/>{exporting === "png" ? "…" : "PNG"}</button><button className="secondary-formation-button" disabled={Boolean(exporting) || !graph?.points.length} onClick={() => void runExport("pdf")}><FileDown size={15}/>{exporting === "pdf" ? "…" : "PDF"}</button><button className="secondary-formation-button" disabled={Boolean(exporting) || !graph?.points.length} onClick={() => void runExport("xlsx")}><FileSpreadsheet size={15}/>{exporting === "xlsx" ? "…" : "Excel"}</button></div></div>
        {graph?.config.warnings.length ? <div className="graph-validity-warnings">{graph.config.warnings.map((warning, index) => <p key={`${warning}-${index}`}><CircleDashed size={14}/><span>{warning}</span></p>)}</div> : null}
        {graph?.points.some((point) => point.value !== null) ? <><div className="graph-canvas-scroll automatic-canvas"><GraphCanvas graph={graph} showLegend edgeInset density="large"/></div>{showTable && <div className="automatic-data-table-wrap"><div><strong>Datos utilizados</strong><span>{graph.points.filter((point) => point.value !== null).length} medidos · {graph.points.filter((point) => point.value === null).length} no medidos</span></div><div className="graph-data-scroll"><table className="automatic-data-table"><thead><tr><th>{xAxisLabel}</th><th>Agrupación</th><th>{yAxisLabel}</th><th>Criterio</th><th>Avance</th><th>Procedencia permitida</th></tr></thead><tbody>{graph.points.map((point) => <tr key={point.id}><td>{point.label}</td><td>{point.series}</td><td>{point.value ?? <em>No medido</em>}</td><td>{point.criterion ?? "—"}</td><td>{point.criterionProgress?.label || "—"}</td><td>{point.note || "Detalle restringido o no documentado"}</td></tr>)}</tbody></table></div></div>}</> : <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>No hay una serie válida con esta combinación</strong><p>Revisa las advertencias, permisos, período y filtros. La plataforma no inventará ceros, tiempos, prompts ni tendencias.</p></div>}
      </div>
    </div>}
  </section>;
}

export default function GraphManager({
  cycles,
  profiles,
  selectedProfileId,
  initialProgramId = null,
  notify,
  canManage = true,
}: {
  cycles: AutomaticCycle[];
  profiles: LinkableProfile[];
  selectedProfileId: string;
  initialProgramId?: string | null;
  notify: (text: string) => void;
  canManage?: boolean;
}) {
  const [graphs, setGraphs] = useState<AnalyticGraph[]>([]);
  const [programs, setPrograms] = useState<AutomaticProgram[]>([]);
  const [programSessions, setProgramSessions] = useState<AutomaticProgramSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [archiveView, setArchiveView] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnalyticGraph | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [historyTarget, setHistoryTarget] = useState<AnalyticGraph | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [automaticType, setAutomaticType] = useState<AutomaticGraphType>("line");
  const [automaticSource, setAutomaticSource] = useState<"evaluations" | "programs" | "legacy-programs">(selectedProfileId !== "all" || initialProgramId ? "programs" : "evaluations");
  const [automaticProfileId, setAutomaticProfileId] = useState("");
  const [automaticProgramId, setAutomaticProgramId] = useState("");
  const [automaticTargetIds, setAutomaticTargetIds] = useState<string[]>([]);
  const [automaticDateFrom, setAutomaticDateFrom] = useState("");
  const [automaticDateTo, setAutomaticDateTo] = useState("");
  const [automaticDesign, setAutomaticDesign] = useState<LineDesign>("AB");
  const [automaticPhases, setAutomaticPhases] = useState<PhaseBoundary[] | null>(null);
  const [automaticTitle, setAutomaticTitle] = useState("Progreso clínico automático");
  const [automaticObjective, setAutomaticObjective] = useState("Visualizar la evolución de los datos registrados en sesiones cerradas.");
  const [automaticXAxis, setAutomaticXAxis] = useState("Fechas de sesión");
  const [automaticYAxis, setAutomaticYAxis] = useState("");
  const [automaticProgramLoading, setAutomaticProgramLoading] = useState(false);
  const [automaticPackage, setAutomaticPackage] = useState("");
  const [automaticPerson, setAutomaticPerson] = useState("");
  const [automaticMetric, setAutomaticMetric] = useState<AutomaticMetric>("strengthPercent");
  const [automaticMoment, setAutomaticMoment] = useState<AutomaticMoment>("latest");
  const [automaticGroupBy, setAutomaticGroupBy] = useState<AutomaticGroupBy>("site");
  const [hiddenAutomaticAreas, setHiddenAutomaticAreas] = useState<string[]>([]);
  const [automaticControlsOpen, setAutomaticControlsOpen] = useState(true);
  const [automaticShowGrid, setAutomaticShowGrid] = useState(true);
  const [automaticShowValues, setAutomaticShowValues] = useState(false);
  const [automaticConnectPoints, setAutomaticConnectPoints] = useState(true);
  const [automaticShowPoints, setAutomaticShowPoints] = useState(true);
  const [automaticShowLegend, setAutomaticShowLegend] = useState(true);
  const [automaticShowTable, setAutomaticShowTable] = useState(false);
  const [automaticDensity, setAutomaticDensity] = useState<AutomaticDensity>("standard");
  const [form, setForm] = useState({
    title: "",
    objective: "",
    graphType: "line" as GraphType,
    designType: "AB" as LineDesign,
    measurement: "Porcentaje",
    xAxisLabel: "Sesiones",
    yAxisLabel: "Porcentaje",
    profileId: "",
    linkedProgramId: "",
    linkedCycleId: "",
  });

  const selected = useMemo(() => graphs.find((graph) => graph.id === selectedId) || null, [graphs, selectedId]);
  const activeProgramOptions = programs.filter((program) => program.status === "active");
  const profilesWithPrograms = profiles.filter((profile) => activeProgramOptions.some((program) => program.profileId === profile.id));
  const effectiveAutomaticProfileId = profilesWithPrograms.some((profile) => profile.id === automaticProfileId)
    ? automaticProfileId
    : profilesWithPrograms.some((profile) => profile.id === selectedProfileId)
      ? selectedProfileId
      : profilesWithPrograms[0]?.id || "";
  const automaticProgramOptions = activeProgramOptions.filter((program) => program.profileId === effectiveAutomaticProfileId);
  const effectiveAutomaticProgramId = automaticProgramOptions.some((program) => program.id === automaticProgramId)
    ? automaticProgramId
    : automaticProgramOptions[0]?.id || "";
  const effectiveAutomaticProgram = automaticProgramOptions.find((program) => program.id === effectiveAutomaticProgramId) || null;
  const validAutomaticTargets = effectiveAutomaticProgram?.targets.filter((target) => automaticTargetIds.includes(target.id)) || [];
  const effectiveAutomaticTargets = automaticType === "cumulative"
    ? effectiveAutomaticProgram?.targets || []
    : validAutomaticTargets.length ? validAutomaticTargets : effectiveAutomaticProgram?.targets.slice(0, 1) || [];
  const effectiveAutomaticTargetIds = effectiveAutomaticTargets.map((target) => target.id);
  const effectiveAutomaticMeasurement = effectiveAutomaticTargets[0]?.measurement || "percentage";
  const automaticScale = measurementScale(effectiveAutomaticMeasurement);
  const cycleOptions = useMemo(() => cycles.map((cycle) => ({ id: cycle.id, profileId: cycle.profileId, label: `${cycle.participantName} · ${cycle.programContext}`, site: cycle.site, status: cycle.status })), [cycles]);
  const profileName = (profileId: string | null) => profiles.find((profile) => profile.id === profileId)?.fullName || "Sin niño vinculado";
  const programName = (programId: string | null) => programs.find((program) => program.id === programId)?.name || "";
  const automaticPackageOptions = useMemo(() => {
    const seen = new Set<string>();
    return cycles.flatMap((cycle) => {
      const key = automaticPackageKey(cycle);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, label: `${cycle.instrumentSnapshot.name} · v${cycle.instrumentSnapshot.version}.0 · ruta ${cycle.routeType}` }];
    });
  }, [cycles]);
  const effectiveAutomaticPackage = automaticPackageOptions.some((option) => option.key === automaticPackage)
    ? automaticPackage
    : automaticPackageOptions[0]?.key || "";
  const automaticPersonOptions = useMemo(() => {
    const seen = new Set<string>();
    return cycles.filter((cycle) => automaticPackageKey(cycle) === effectiveAutomaticPackage).flatMap((cycle) => {
      const key = automaticPersonKey(cycle);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, label: `${cycle.participantName} · ${cycle.site} · ${cycle.programContext}` }];
    });
  }, [cycles, effectiveAutomaticPackage]);
  const effectiveAutomaticPerson = automaticPersonOptions.some((option) => option.key === automaticPerson)
    ? automaticPerson
    : automaticPersonOptions[0]?.key || "";
  const automaticAreaOptions = useMemo(() => {
    const reference = cycles.find((cycle) => automaticPackageKey(cycle) === effectiveAutomaticPackage);
    return reference ? areasForPackage(reference.instrumentSnapshot, reference.routeType) : [];
  }, [cycles, effectiveAutomaticPackage]);
  const visibleAutomaticAreaKeys = automaticAreaOptions.filter((area) => !hiddenAutomaticAreas.includes(area.key)).map((area) => area.key);
  const automatic = useMemo(
    () => buildAutomaticGraphs(cycles, effectiveAutomaticPackage, effectiveAutomaticPerson, {
      metric: automaticMetric,
      barMoment: automaticMoment,
      barGroupBy: automaticGroupBy,
      areaKeys: visibleAutomaticAreaKeys,
    }),
    [cycles, effectiveAutomaticPackage, effectiveAutomaticPerson, automaticMetric, automaticMoment, automaticGroupBy, visibleAutomaticAreaKeys],
  );
  const automaticGraph = useMemo(() => {
    const graph = automatic.graphs[automaticType];
    return {
      ...graph,
      config: {
        ...graph.config,
        showGrid: automaticShowGrid,
        showValues: automaticShowValues,
        connectPoints: automaticConnectPoints,
      },
    };
  }, [automatic, automaticType, automaticShowGrid, automaticShowValues, automaticConnectPoints]);
  const presentedProgramGraph = effectiveAutomaticProgram ? buildSessionGraph({
    id: `automatic-program-${effectiveAutomaticProgram.id}`,
    program: effectiveAutomaticProgram,
    sessions: programSessions,
    targetIds: effectiveAutomaticTargetIds,
    graphType: automaticType,
    designType: automaticDesign,
    title: automaticTitle,
    objective: automaticObjective,
    xAxisLabel: automaticXAxis,
    yAxisLabel: automaticType === "cumulative" ? "Targets adquiridos" : automaticYAxis || effectiveAutomaticTargets[0]?.unitLabel || PROGRAM_MEASUREMENT_LABELS[effectiveAutomaticMeasurement],
    config: {
      ...DEFAULT_GRAPH_CONFIG,
      yMin: automaticScale.yMin,
      yMax: automaticScale.yMax,
      showGrid: automaticShowGrid,
      showValues: automaticShowValues,
      connectPoints: automaticConnectPoints,
      showPoints: automaticShowPoints,
      showLegend: automaticShowLegend,
      dataSource: "sessions",
      sourceTargetIds: effectiveAutomaticTargetIds,
      dateFrom: automaticDateFrom,
      dateTo: automaticDateTo,
    },
    phases: automaticPhases ?? undefined,
  }) : automaticGraphBase("automatic-program-empty", "Datos de sesiones", automaticType, []);
  const filtered = graphs.filter((graph) => {
    const matchesArchive = archiveView ? graph.status === "archived" : graph.status === "active";
    const matchesType = typeFilter === "all" || graph.graphType === typeFilter;
    const graphProfileId = graph.profileId || cycles.find((cycle) => cycle.id === graph.linkedCycleId)?.profileId || null;
    const matchesProfile = selectedProfileId === "all" || graphProfileId === selectedProfileId;
    const text = `${graph.title} ${graph.objective} ${graph.measurement} ${profileName(graphProfileId)} ${programName(graph.linkedProgramId)}`.toLowerCase();
    return matchesArchive && matchesType && matchesProfile && text.includes(query.trim().toLowerCase());
  });
  const formProgramOptions = activeProgramOptions.filter((program) => !form.profileId || program.profileId === form.profileId);
  const formCycleOptions = cycleOptions.filter((cycle) => !form.profileId || cycle.profileId === form.profileId);

  function applyProgramPresentation(program: AutomaticProgram) {
    const config = program.graphConfig;
    const target = program.targets.find((item) => item.id === config?.primaryTargetId) || program.targets[0];
    setAutomaticSource("programs");
    setAutomaticTargetIds(target ? [target.id] : []);
    setAutomaticType(config?.graphType === "bar" || config?.graphType === "cumulative" ? config.graphType : "line");
    setAutomaticDesign(config?.designType || "AB");
    setAutomaticShowPoints(config?.showPoints !== false);
    setAutomaticShowLegend(config?.showLegend !== false);
    setAutomaticTitle(`${program.name} · Progreso clínico`);
    setAutomaticObjective(program.objective);
    setAutomaticPhases(null);
  }

  useEffect(() => {
    Promise.all([fetch("/api/graphs"), fetch("/api/intervention-programs?catalog=1")])
      .then(async ([graphResponse, programResponse]) => {
        const graphData = await graphResponse.json() as { graphs?: Record<string, unknown>[]; error?: string };
        const programData = await programResponse.json() as { programs?: AutomaticProgram[]; sessions?: AutomaticProgramSession[]; error?: string };
        if (!graphResponse.ok) throw new Error(graphData.error || "No se pudieron cargar las gráficas.");
        if (!programResponse.ok) throw new Error(programData.error || "No se pudieron cargar los programas.");
        setGraphs((graphData.graphs || []).map(parseResponseGraph));
        setPrograms(programData.programs || []);
        setProgramSessions([]);
        const loadedPrograms = programData.programs || [];
        const program = loadedPrograms.find((item) => item.id === initialProgramId)
          || loadedPrograms.find((item) => item.profileId === selectedProfileId)
          || loadedPrograms[0];
        if (program) {
          setAutomaticProfileId(program.profileId || "");
          setAutomaticProgramId(program.id);
          applyProgramPresentation(program);
        }
      })
      .catch((error: Error) => notify(error.message))
      .finally(() => setLoading(false));
    // Notifications are user feedback, not a data dependency for this initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProgramId]);

  useEffect(() => {
    if (automaticSource !== "legacy-programs" || !effectiveAutomaticProgramId) return;
    const controller = new AbortController();
    fetch(`/api/intervention-programs?programId=${encodeURIComponent(effectiveAutomaticProgramId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { programs?: AutomaticProgram[]; sessions?: AutomaticProgramSession[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las sesiones del programa.");
        const refreshed = data.programs?.[0];
        if (refreshed) setPrograms((current) => current.map((program) => program.id === refreshed.id ? refreshed : program));
        setProgramSessions(data.sessions || []);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "No se pudieron cargar las sesiones del programa.");
      })
      .finally(() => setAutomaticProgramLoading(false));
    return () => controller.abort();
    // Program selection is the only data dependency; notification identity must not refetch clinical data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAutomaticProgramId, automaticSource]);

  useEffect(() => {
    const saved = graphs.find((graph) => graph.id === selectedId);
    if (!saved || saved.config.dataSource === "manual") return;
    const controller = new AbortController();
    const configurable = saved.config.version === 2 && Boolean(saved.profileId);
    const url = configurable
      ? `/api/graph-data?profileId=${encodeURIComponent(saved.profileId || "")}`
      : saved.linkedProgramId
        ? `/api/intervention-programs?programId=${encodeURIComponent(saved.linkedProgramId)}`
        : "";
    if (!url) return;
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as (ConfigurableGraphDataset & { error?: string }) | { programs?: AutomaticProgram[]; sessions?: AutomaticProgramSession[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudo actualizar la gráfica desde su fuente clínica.");
        let refreshed: AnalyticGraph;
        if (configurable) {
          const dataset = data as ConfigurableGraphDataset;
          if (!dataset.profile) throw new Error("La fuente clínica de esta configuración ya no está disponible.");
          refreshed = buildConfigurableGraph({
            id: saved.id,
            dataset,
            config: saved.config,
            graphType: saved.graphType,
            title: saved.title,
            objective: saved.objective,
            measurement: saved.measurement,
            xAxisLabel: saved.xAxisLabel,
            yAxisLabel: saved.yAxisLabel,
            manualPhases: saved.phases.filter((phase) => phase.origin === "manual"),
          });
        } else {
          const legacy = data as { programs?: AutomaticProgram[]; sessions?: AutomaticProgramSession[]; error?: string };
          if (!legacy.programs?.[0]) throw new Error(legacy.error || "No se pudo actualizar la gráfica desde sus sesiones.");
          refreshed = buildSessionGraph({
            id: saved.id,
            program: legacy.programs[0],
            sessions: legacy.sessions || [],
            targetIds: saved.config.sourceTargetIds,
            graphType: saved.graphType,
            designType: saved.designType,
            title: saved.title,
            objective: saved.objective,
            xAxisLabel: saved.xAxisLabel,
            yAxisLabel: saved.yAxisLabel,
            config: saved.config,
            phases: saved.phases,
          });
        }
        setGraphs((current) => current.map((graph) => graph.id === saved.id ? {
          ...graph,
          ...refreshed,
          status: graph.status,
          archivedAt: graph.archivedAt,
          createdAt: graph.createdAt,
          updatedAt: graph.updatedAt,
        } : graph));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "No se pudo actualizar la gráfica desde sus sesiones.");
      });
    return () => controller.abort();
    // Opening a saved configuration performs exactly one live refresh from its linked program.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function updateSelected(patch: Partial<AnalyticGraph>) {
    if (!selected) return;
    setGraphs((current) => current.map((graph) => graph.id === selected.id ? { ...graph, ...patch } : graph));
  }

  function resetForm() {
    const profileId = profiles.some((profile) => profile.id === selectedProfileId && profile.status === "active") ? selectedProfileId : "";
    setForm({ title: "", objective: "", graphType: "line", designType: "AB", measurement: "Porcentaje", xAxisLabel: "Sesiones", yAxisLabel: "Porcentaje", profileId, linkedProgramId: "", linkedCycleId: "" });
  }

  function changeFormProfile(profileId: string) {
    setForm((current) => ({
      ...current,
      profileId,
      linkedProgramId: programs.some((program) => program.id === current.linkedProgramId && program.profileId === profileId) ? current.linkedProgramId : "",
      linkedCycleId: cycles.some((cycle) => cycle.id === current.linkedCycleId && cycle.profileId === profileId) ? current.linkedCycleId : "",
    }));
  }

  function changeSelectedProfile(profileId: string) {
    if (!selected) return;
    updateSelected({
      profileId: profileId || null,
      linkedProgramId: profileId && programs.some((program) => program.id === selected.linkedProgramId && program.profileId === profileId) ? selected.linkedProgramId : null,
      linkedCycleId: profileId && cycles.some((cycle) => cycle.id === selected.linkedCycleId && cycle.profileId === profileId) ? selected.linkedCycleId : null,
    });
  }

  function changeSelectedProgram(linkedProgramId: string) {
    if (!selected) return;
    const program = programs.find((item) => item.id === linkedProgramId);
    updateSelected({ linkedProgramId: linkedProgramId || null, profileId: program?.profileId || selected.profileId });
  }

  function changeSelectedCycle(linkedCycleId: string) {
    if (!selected) return;
    const cycle = cycles.find((item) => item.id === linkedCycleId);
    updateSelected({ linkedCycleId: linkedCycleId || null, profileId: cycle?.profileId || selected.profileId });
  }

  async function createGraph() {
    if (!form.title.trim() || !form.objective.trim()) { notify("Completa el nombre y el objetivo principal."); return; }
    const points = buildInitialPoints(form.graphType, form.designType);
    const phases = form.graphType === "line" ? phaseTemplate(form.designType, points.length) : [];
    const defaultMax = form.measurement === "Porcentaje" ? 100 : null;
    setSaving(true);
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, profileId: form.profileId || null, linkedProgramId: form.linkedProgramId || null, linkedCycleId: form.linkedCycleId || null, points, phases, config: { ...DEFAULT_GRAPH_CONFIG, yMax: defaultMax } }),
      });
      const data = await response.json() as { graph?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.graph) throw new Error(data.error || "No se pudo crear la gráfica.");
      const graph = parseResponseGraph(data.graph);
      setGraphs((current) => [graph, ...current]);
      setSelectedId(graph.id);
      setNewOpen(false);
      resetForm();
      notify("Gráfica creada. Ya puedes ingresar datos y ajustar las fases.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo crear la gráfica."); }
    finally { setSaving(false); }
  }

  async function saveGraph() {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch("/api/graphs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      });
      const data = await response.json() as { graph?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.graph) throw new Error(data.error || "No se pudo guardar la gráfica.");
      const saved = parseResponseGraph(data.graph);
      setGraphs((current) => current.map((graph) => graph.id === saved.id ? saved : graph));
      notify("Gráfica, datos y análisis visual guardados.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar la gráfica."); }
    finally { setSaving(false); }
  }

  function updatePoint(id: string, patch: Partial<GraphPoint>) {
    if (!selected) return;
    updateSelected({ points: selected.points.map((point) => point.id === id ? { ...point, ...patch } : point) });
  }

  function addPoint() {
    if (!selected) return;
    const next = newGraphPoint(selected.points.length, selected.graphType, selected.designType);
    if (selected.graphType === "bar") next.series = selected.points[0]?.series || "Resultado";
    if (selected.graphType === "cumulative") next.series = selected.points[0]?.series || "Repertorio";
    updateSelected({ points: [...selected.points, next] });
  }

  function deletePoint(id: string) {
    if (!selected || selected.points.length <= 1) return;
    const index = selected.points.findIndex((point) => point.id === id);
    const points = selected.points.filter((point) => point.id !== id);
    const phases = selected.phases.map((phase) => ({ ...phase, afterIndex: phase.afterIndex > index ? Math.max(1, phase.afterIndex - 1) : phase.afterIndex })).filter((phase) => phase.afterIndex < points.length);
    updateSelected({ points, phases });
  }

  function movePoint(index: number, direction: -1 | 1) {
    if (!selected) return;
    const destination = index + direction;
    if (destination < 0 || destination >= selected.points.length) return;
    const points = [...selected.points];
    [points[index], points[destination]] = [points[destination], points[index]];
    updateSelected({ points });
  }

  function changeDesign(designType: LineDesign) {
    if (!selected) return;
    if (selected.config.dataSource === "sessions") {
      updateSelected({ designType, phases: selected.phases.length ? selected.phases : phaseTemplate(designType, selected.points.length) });
      return;
    }
    const points = selected.points.map((point, index) => ({
      ...point,
      series: designType === "multielement" && (point.series === "Datos" || !point.series) ? (index % 2 === 0 ? "Condición A" : "Condición B") : point.series,
      criterion: designType === "changing-criterion" ? (point.criterion ?? (index >= 3 ? 60 + Math.floor((index - 3) / 2) * 10 : null)) : point.criterion,
    }));
    updateSelected({ designType, points, phases: phaseTemplate(designType, points.length) });
  }

  function updatePhase(id: string, patch: Partial<PhaseBoundary>) {
    if (!selected) return;
    updateSelected({ phases: selected.phases.map((phase) => phase.id === id ? { ...phase, ...patch } : phase).sort((a, b) => a.afterIndex - b.afterIndex) });
  }

  function addPhase() {
    if (!selected || selected.points.length < 2) return;
    const used = new Set(selected.phases.map((phase) => phase.afterIndex));
    const available = Array.from({ length: selected.points.length - 1 }, (_, index) => index + 1).find((index) => !used.has(index));
    if (!available) { notify("Ya existe una línea de fase entre cada par de registros."); return; }
    updateSelected({ phases: [...selected.phases, { id: graphLocalId(), afterIndex: available, beforeLabel: "Fase anterior", afterLabel: "Fase siguiente" }].sort((a, b) => a.afterIndex - b.afterIndex) });
  }

  function updateConfig(patch: Partial<GraphConfig>) {
    if (!selected) return;
    updateSelected({ config: { ...selected.config, ...patch } });
  }

  function updateAnalysis(key: keyof VisualAnalysis, value: string) {
    if (!selected) return;
    updateConfig({ visualAnalysis: { ...selected.config.visualAnalysis, [key]: value } });
  }

  async function archiveOrRestore(graph: AnalyticGraph) {
    setSaving(true);
    try {
      const action = graph.status === "archived" ? "restore" : "archive";
      const response = await fetch("/api/graphs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: graph.id, action }) });
      const data = await response.json() as { graph?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.graph) throw new Error(data.error || "No se pudo cambiar el estado.");
      const saved = parseResponseGraph(data.graph);
      setGraphs((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (selectedId === saved.id) setSelectedId(null);
      notify(action === "archive" ? "Gráfica archivada como solo lectura." : "Gráfica restaurada para edición.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo cambiar el estado."); }
    finally { setSaving(false); }
  }

  async function deleteGraph() {
    if (!deleteTarget || deleteText.trim().toUpperCase() !== "ELIMINAR") return;
    setSaving(true);
    try {
      const response = await fetch("/api/graphs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar la gráfica.");
      setGraphs((current) => current.filter((graph) => graph.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      setDeleteText("");
      notify("Gráfica e historial eliminados permanentemente.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo eliminar la gráfica."); }
    finally { setSaving(false); }
  }

  async function openHistory(graph: AnalyticGraph) {
    setHistoryTarget(graph);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/graphs?historyFor=${encodeURIComponent(graph.id)}`);
      const data = await response.json() as { history?: HistoryEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial.");
      setHistory(data.history || []);
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo cargar el historial."); }
    finally { setHistoryLoading(false); }
  }

  function exportCsv(graph: AnalyticGraph) {
    const header = ["orden", "etiqueta", "valor_o_incremento", "serie_o_condicion", "criterio", "nota"];
    const rows = graph.points.map((point, index) => [index + 1, point.label, point.value ?? "", point.series, point.criterion ?? "", point.note]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadBlob(`\uFEFF${csv}`, "text/csv;charset=utf-8", `${safeFileName(graph.title)}.csv`);
  }

  function exportSvg(graph: AnalyticGraph) {
    const source = document.getElementById(`graph-svg-${graph.id}`);
    if (!(source instanceof SVGSVGElement)) return;
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    downloadBlob(new XMLSerializer().serializeToString(clone), "image/svg+xml;charset=utf-8", `${safeFileName(graph.title)}.svg`);
  }

  function toggleAutomaticArea(areaKey: string) {
    setHiddenAutomaticAreas((current) => current.includes(areaKey)
      ? current.filter((key) => key !== areaKey)
      : [...current, areaKey]);
  }

  function toggleAutomaticTarget(target: AutomaticProgramTarget) {
    if (effectiveAutomaticTargetIds.includes(target.id)) {
      if (effectiveAutomaticTargetIds.length === 1) { notify("La gráfica necesita al menos un target visible."); return; }
      setAutomaticTargetIds(effectiveAutomaticTargetIds.filter((id) => id !== target.id));
      setAutomaticPhases(null);
      return;
    }
    if (effectiveAutomaticTargets[0] && target.measurement !== effectiveAutomaticTargets[0].measurement) {
      notify("Para proteger la interpretación clínica, combina únicamente targets con el mismo sistema de medición.");
      return;
    }
    setAutomaticTargetIds([...effectiveAutomaticTargetIds, target.id]);
    setAutomaticPhases(null);
  }

  function updateAutomaticPhase(id: string, patch: Partial<PhaseBoundary>) {
    const source = automaticPhases ?? presentedProgramGraph.phases;
    setAutomaticPhases(source.map((phase) => phase.id === id ? { ...phase, ...patch } : phase).sort((a, b) => a.afterIndex - b.afterIndex));
  }

  function addAutomaticPhase() {
    const labels = uniqueInOrder(presentedProgramGraph.points.map((point) => point.label));
    if (labels.length < 2) { notify("Se necesitan al menos dos sesiones con datos para agregar una fase."); return; }
    const source = automaticPhases ?? presentedProgramGraph.phases;
    const used = new Set(source.map((phase) => phase.afterIndex));
    const afterIndex = Array.from({ length: labels.length - 1 }, (_, index) => index + 1).find((index) => !used.has(index));
    if (!afterIndex) { notify("Ya existe una línea de fase entre cada par de sesiones."); return; }
    const boundaryPoint = presentedProgramGraph.points.find((point) => point.label === labels[afterIndex]);
    setAutomaticPhases([...source, {
      id: graphLocalId(),
      afterIndex,
      beforeLabel: "Fase anterior",
      afterLabel: "Fase siguiente",
      boundaryDate: boundaryPoint?.source?.sessionDate,
    }].sort((a, b) => a.afterIndex - b.afterIndex));
  }

  async function saveAutomaticConfiguration() {
    if (!canManage || !effectiveAutomaticProgram || !effectiveAutomaticTargetIds.length) return;
    if (!automaticTitle.trim() || !automaticObjective.trim()) { notify("Completa el título y el objetivo de la configuración."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...presentedProgramGraph,
          id: undefined,
          profileId: effectiveAutomaticProgram.profileId,
          linkedProgramId: effectiveAutomaticProgram.id,
          linkedCycleId: null,
          phases: automaticPhases ?? presentedProgramGraph.phases,
          config: {
            ...presentedProgramGraph.config,
            dataSource: "sessions",
            sourceTargetIds: effectiveAutomaticTargetIds,
            dateFrom: automaticDateFrom,
            dateTo: automaticDateTo,
          },
        }),
      });
      const data = await response.json() as { graph?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.graph) throw new Error(data.error || "No se pudo guardar la configuración automática.");
      const saved = parseResponseGraph(data.graph);
      setGraphs((current) => [saved, ...current]);
      notify("Configuración guardada. Seguirá leyendo las sesiones del programa al abrirla.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar la configuración automática."); }
    finally { setSaving(false); }
  }

  function resetAutomaticControls() {
    setAutomaticMetric("strengthPercent");
    setAutomaticMoment("latest");
    setAutomaticGroupBy("site");
    setHiddenAutomaticAreas([]);
    setAutomaticShowGrid(true);
    setAutomaticShowValues(false);
    setAutomaticConnectPoints(true);
    setAutomaticShowPoints(true);
    setAutomaticShowLegend(true);
    setAutomaticShowTable(false);
    setAutomaticDensity("standard");
    setAutomaticDateFrom("");
    setAutomaticDateTo("");
    setAutomaticDesign("AB");
    setAutomaticPhases(null);
    notify("Visualización restablecida a la configuración recomendada.");
  }

  if (selected) {
    const readOnly = selected.status === "archived" || !canManage;
    const automaticSelected = selected.config.dataSource !== "manual";
    const selectedProgramOptions = activeProgramOptions.filter((program) => !selected.profileId || program.profileId === selected.profileId);
    const selectedCycleOptions = cycleOptions.filter((cycle) => !selected.profileId || cycle.profileId === selected.profileId);
    return <>
      <div className="graph-work-header">
        <button className="back-button" onClick={() => setSelectedId(null)}><ArrowLeft size={17}/> Biblioteca</button>
        <div><p className="section-kicker">Centro de análisis</p><h1>{selected.title}</h1><p>{selected.objective}</p></div>
        <div className="graph-header-actions">
          <button className="secondary-formation-button" onClick={() => void exportPng(selected).catch((error: unknown) => notify(error instanceof Error ? error.message : "No se pudo exportar el PNG."))}><FileImage size={16}/> PNG</button>
          <button className="secondary-formation-button" onClick={() => void exportPdf(selected).catch((error: unknown) => notify(error instanceof Error ? error.message : "No se pudo exportar el PDF."))}><FileDown size={16}/> PDF</button>
          <button className="secondary-formation-button" onClick={() => void exportExcel(selected).catch((error: unknown) => notify(error instanceof Error ? error.message : "No se pudo exportar el Excel."))}><FileSpreadsheet size={16}/> Excel</button>
          {!readOnly && <button className="primary-formation-button" disabled={saving} onClick={saveGraph}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar</button>}
        </div>
      </div>
      {readOnly && <section className="archive-banner"><Archive size={21}/><div><strong>{selected.status === "archived" ? "Gráfica archivada" : "Permiso de consulta"} · solo lectura</strong><p>Los datos, fases y análisis permanecen disponibles, pero tu rol no puede modificarlos en esta vista.</p></div></section>}
      <section className="graph-safety-note"><CheckCircle2 size={20}/><div><strong>{automaticSelected ? "Configuración automática conectada a sesiones" : "Apoyo para análisis visual, no decisión automática"}</strong><p>{automaticSelected ? "Los puntos se reconstruyen desde las sesiones cerradas cada vez que abres la gráfica. Los cambios visuales no modifican los registros clínicos." : "Examina nivel, tendencia, variabilidad, inmediatez, solapamiento y consistencia. El sistema no declara por sí solo una relación funcional ni eficacia definitiva."}</p></div></section>

      <section className="formation-panel graph-preview-panel">
        <div className="graph-preview-toolbar">
          <div><span className="graph-kind-chip">{GRAPH_TYPE_LABELS[selected.graphType]}</span>{selected.graphType === "line" && <span>{LINE_DESIGN_LABELS[selected.designType]}</span>}</div>
          <div><label><input type="checkbox" disabled={readOnly} checked={selected.config.showGrid} onChange={(event) => updateConfig({ showGrid: event.target.checked })}/> Cuadrícula</label><label><input type="checkbox" disabled={readOnly} checked={selected.config.showPoints} onChange={(event) => updateConfig({ showPoints: event.target.checked })}/> Puntos</label><label><input type="checkbox" disabled={readOnly} checked={selected.config.showValues} onChange={(event) => updateConfig({ showValues: event.target.checked })}/> Valores</label><label><input type="checkbox" disabled={readOnly} checked={selected.config.showLegend} onChange={(event) => updateConfig({ showLegend: event.target.checked })}/> Leyenda</label>{selected.graphType === "line" && <><label><input type="checkbox" disabled={readOnly} checked={selected.config.showMean} onChange={(event) => updateConfig({ showMean: event.target.checked })}/> Media por fase</label><label><input type="checkbox" disabled={readOnly} checked={selected.config.showTrend} onChange={(event) => updateConfig({ showTrend: event.target.checked })}/> Tendencia por fase</label></>}</div>
        </div>
        <div className="graph-canvas-scroll"><GraphCanvas graph={selected} edgeInset/></div>
        <div className="graph-summary-strip"><span><Table2 size={15}/><strong>{selected.points.length}</strong> registros</span><span><MoveHorizontal size={15}/><strong>{selected.phases.length}</strong> cambios de fase</span><span><Sigma size={15}/><strong>{uniqueInOrder(selected.points.map((point) => point.series)).length}</strong> serie(s)</span></div>
        <div className="graph-clinical-link-summary"><span><strong>Niño</strong>{profileName(selected.profileId)}</span><span><strong>Programa</strong>{programName(selected.linkedProgramId) || "Sin programa específico"}</span></div>
      </section>

      <div className="graph-editor-layout">
        <section className="formation-panel graph-config-panel">
          <div className="graph-section-title"><div><p className="section-kicker">Configuración</p><h2>Diseño y ejes</h2></div></div>
          <div className="graph-config-grid">
            <label><span>Nombre</span><input disabled={readOnly} value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })}/></label>
            <label className="field-wide"><span>Objetivo principal</span><textarea disabled={readOnly} value={selected.objective} onChange={(event) => updateSelected({ objective: event.target.value })}/></label>
            <label><span>Niño vinculado</span><select disabled={readOnly || automaticSelected} value={selected.profileId || ""} onChange={(event) => changeSelectedProfile(event.target.value)}><option value="">Institucional o independiente</option>{profiles.filter((profile) => profile.status === "active" || profile.id === selected.profileId).map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label>
            <label><span>Programa vinculado {automaticSelected ? "(fuente clínica)" : "(opcional)"}</span><select disabled={readOnly || automaticSelected || !selected.profileId} value={selected.linkedProgramId || ""} onChange={(event) => changeSelectedProgram(event.target.value)}><option value="">Sin programa específico</option>{selectedProgramOptions.map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}</select></label>
            <label className="field-wide"><span>Evaluación vinculada (opcional)</span><select disabled={readOnly || !selected.profileId} value={selected.linkedCycleId || ""} onChange={(event) => changeSelectedCycle(event.target.value)}><option value="">Sin evaluación específica</option>{selectedCycleOptions.map((cycle) => <option value={cycle.id} key={cycle.id}>{cycle.label} · {cycle.site}</option>)}</select></label>
            <label><span>Tipo de gráfica</span><select disabled={readOnly} value={selected.graphType} onChange={(event) => updateSelected({ graphType: event.target.value as GraphType })}>{Object.entries(GRAPH_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {selected.graphType === "line" && <label><span>Diseño</span><select disabled={readOnly} value={selected.designType} onChange={(event) => changeDesign(event.target.value as LineDesign)}>{Object.entries(LINE_DESIGN_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
            <label><span>Medición</span><select disabled={readOnly || automaticSelected} value={selected.measurement} onChange={(event) => updateSelected({ measurement: event.target.value })}>{MEASUREMENT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label><span>Eje horizontal</span><input disabled={readOnly} value={selected.xAxisLabel} onChange={(event) => updateSelected({ xAxisLabel: event.target.value })}/></label>
            <label><span>Eje vertical</span><input disabled={readOnly} value={selected.yAxisLabel} onChange={(event) => updateSelected({ yAxisLabel: event.target.value })}/></label>
            <label><span>Mínimo Y</span><input disabled={readOnly} type="number" value={selected.config.yMin} onChange={(event) => updateConfig({ yMin: Number(event.target.value) })}/></label>
            <label><span>Máximo Y</span><input disabled={readOnly} type="number" placeholder="Automático" value={selected.config.yMax ?? ""} onChange={(event) => updateConfig({ yMax: event.target.value === "" ? null : Number(event.target.value) })}/></label>
          </div>
        </section>

        <section className="formation-panel phase-control-panel">
          <div className="graph-section-title"><div><p className="section-kicker">Manipulación exacta</p><h2>Líneas de fase</h2></div>{selected.graphType === "line" && !readOnly && <button className="secondary-formation-button" onClick={addPhase}><Plus size={15}/> Agregar</button>}</div>
          {selected.graphType !== "line" ? <div className="phase-empty"><BarChart3 size={24}/><p>Las fases se utilizan en las gráficas de líneas. En barras, utiliza series para representar condiciones.</p></div> : selected.phases.length ? <div className="phase-stack">{selected.phases.map((phase, index) => <article key={phase.id}>
            <div className="phase-index"><span>{index + 1}</span><strong>Después del registro</strong><select disabled={readOnly} value={phase.afterIndex} onChange={(event) => updatePhase(phase.id, { afterIndex: Number(event.target.value) })}>{Array.from({ length: Math.max(0, selected.points.length - 1) }, (_, itemIndex) => <option value={itemIndex + 1} key={itemIndex + 1}>{itemIndex + 1} · {selected.points[itemIndex]?.label}</option>)}</select></div>
            <div className="phase-label-fields"><label><span>Fase anterior</span><input disabled={readOnly} value={phase.beforeLabel} onChange={(event) => updatePhase(phase.id, { beforeLabel: event.target.value })}/></label><label><span>Fase siguiente</span><input disabled={readOnly} value={phase.afterLabel} onChange={(event) => updatePhase(phase.id, { afterLabel: event.target.value })}/></label></div>
            {!readOnly && <button className="icon-danger" aria-label={`Eliminar línea de fase ${index + 1}`} onClick={() => updateSelected({ phases: selected.phases.filter((item) => item.id !== phase.id) })}><Trash2 size={16}/></button>}
          </article>)}</div> : <div className="phase-empty"><MoveHorizontal size={24}/><p>Este diseño todavía no tiene líneas de fase. Puedes agregarlas y ubicarlas entre cualquier par de registros.</p></div>}
        </section>
      </div>

      <section className="formation-panel graph-data-panel">
        <div className="graph-section-title"><div><p className="section-kicker">Datos primarios</p><h2>{automaticSelected ? "Datos clínicos de origen" : selected.graphType === "cumulative" ? "Adquisiciones por sesión" : selected.graphType === "bar" ? "Categorías y condiciones" : "Sesiones, valores y condiciones"}</h2></div>{!readOnly && !automaticSelected && <button className="secondary-formation-button" onClick={addPoint}><Plus size={15}/> Agregar registro</button>}</div>
        {automaticSelected ? <>
          <div className="cumulative-rule"><LockKeyhole size={18}/><p>Esta tabla es de <strong>solo lectura</strong>. Para corregir un valor, edita la sesión de origen; la gráfica se actualizará al volver a abrirla.</p></div>
          <div className="graph-data-scroll"><table className="graph-data-table"><thead><tr><th>Fecha</th><th>Serie / target</th><th>Valor</th><th>Sesión</th><th>Oportunidades</th><th>Contexto y notas</th></tr></thead><tbody>{selected.points.map((point) => <tr key={point.id}><td><strong>{point.label}</strong></td><td>{point.series}</td><td>{point.value ?? <em>Sin dato</em>}</td><td>{point.source?.sessionId || "—"}</td><td>{point.source?.opportunities ?? "—"}</td><td>{point.note || "—"}</td></tr>)}</tbody></table></div>
        </> : <>
        {selected.graphType === "cumulative" && <div className="cumulative-rule"><TrendingUp size={18}/><p>Ingresa únicamente las <strong>conductas nuevas</strong> adquiridas en cada sesión. La gráfica calcula el repertorio acumulado y no permite que el total disminuya.</p></div>}
        <div className="graph-data-scroll"><table className="graph-data-table"><thead><tr><th>Orden</th><th>{selected.graphType === "bar" ? "Categoría" : "Sesión / fecha"}</th><th>{selected.graphType === "cumulative" ? "Nuevas" : "Valor"}</th><th>{selected.graphType === "bar" ? "Condición / grupo" : "Serie / condición"}</th>{selected.graphType === "line" && selected.designType === "changing-criterion" && <th>Criterio</th>}<th>Nota / evento</th><th>Acciones</th></tr></thead><tbody>{selected.points.map((point, index) => <tr key={point.id}>
          <td><strong>{index + 1}</strong></td>
          <td><input aria-label={`Etiqueta del registro ${index + 1}`} disabled={readOnly} value={point.label} onChange={(event) => updatePoint(point.id, { label: event.target.value })}/></td>
          <td><input aria-label={`Valor del registro ${index + 1}`} disabled={readOnly} type="number" step="any" min={selected.graphType === "cumulative" ? 0 : undefined} value={point.value ?? ""} onChange={(event) => updatePoint(point.id, { value: event.target.value === "" ? null : selected.graphType === "cumulative" ? Math.max(0, Number(event.target.value)) : Number(event.target.value) })}/></td>
          <td><input aria-label={`Serie del registro ${index + 1}`} disabled={readOnly} value={point.series} onChange={(event) => updatePoint(point.id, { series: event.target.value })}/></td>
          {selected.graphType === "line" && selected.designType === "changing-criterion" && <td><input aria-label={`Criterio del registro ${index + 1}`} disabled={readOnly} type="number" step="any" value={point.criterion ?? ""} onChange={(event) => updatePoint(point.id, { criterion: event.target.value === "" ? null : Number(event.target.value) })}/></td>}
          <td><input aria-label={`Nota del registro ${index + 1}`} disabled={readOnly} value={point.note} onChange={(event) => updatePoint(point.id, { note: event.target.value })} placeholder="Cambio contextual, ausencia, decisión…"/></td>
          <td><div className="data-row-actions"><button disabled={readOnly || index === 0} aria-label="Mover arriba" onClick={() => movePoint(index, -1)}><ArrowUp size={15}/></button><button disabled={readOnly || index === selected.points.length - 1} aria-label="Mover abajo" onClick={() => movePoint(index, 1)}><ArrowDown size={15}/></button><button disabled={readOnly || selected.points.length <= 1} aria-label="Eliminar registro" onClick={() => deletePoint(point.id)}><Trash2 size={15}/></button></div></td>
        </tr>)}</tbody></table></div></>}
      </section>

      <section className="formation-panel visual-analysis-panel">
        <div className="graph-section-title"><div><p className="section-kicker">Interpretación documentada</p><h2>Análisis visual estructurado</h2><p>Describe lo observado; distingue datos, inferencias y decisiones.</p></div></div>
        <div className="analysis-grid">{ANALYSIS_FIELDS.map((field) => <label key={field.key}><span>{field.title}</span><small>{field.help}</small><textarea disabled={readOnly} value={selected.config.visualAnalysis[field.key]} onChange={(event) => updateAnalysis(field.key, event.target.value)} placeholder="Registrar observación…"/></label>)}</div>
        <div className="analysis-decision"><label><span>Decisión y justificación</span><small>Vincula la decisión con los datos, la validez clínica, la fidelidad y las limitaciones observadas.</small><textarea disabled={readOnly} value={selected.config.visualAnalysis.decision} onChange={(event) => updateAnalysis("decision", event.target.value)} placeholder="Decisión descriptiva, evidencia utilizada y seguimiento…"/></label><label><span>Próxima revisión</span><input disabled={readOnly} type="date" value={selected.config.visualAnalysis.nextReview} onChange={(event) => updateAnalysis("nextReview", event.target.value)}/></label></div>
      </section>
    </>;
  }

  return <>
    <div className="formation-heading graph-library-heading"><div><p className="section-kicker">Centro de análisis</p><h1>Gráficas</h1></div>{canManage && <button className="primary-formation-button" onClick={() => { resetForm(); setNewOpen(true); }}><Plus size={17}/> Gráfica manual</button>}</div>
    <div className="automatic-source-switch" role="tablist" aria-label="Fuente de las gráficas automáticas">
      <button role="tab" aria-selected={automaticSource === "evaluations"} className={automaticSource === "evaluations" ? "active" : ""} onClick={() => setAutomaticSource("evaluations")}><ClipboardCheck size={17}/> Evaluaciones</button>
      <button role="tab" aria-selected={automaticSource === "programs"} className={automaticSource === "programs" ? "active" : ""} onClick={() => setAutomaticSource("programs")}><Target size={17}/> Programas y sesiones</button>
    </div>
    {automaticSource === "evaluations" && <section className="formation-panel automatic-graph-panel">
      <div className="automatic-graph-heading"><div><span className="automatic-source"><CircleDashed size={14}/> Fuente automática</span><h2>Evaluaciones registradas</h2></div><CheckCircle2 size={25}/></div>
      {automaticPackageOptions.length ? <>
        <div className="automatic-graph-tabs" role="tablist" aria-label="Gráficas automáticas">
          {(Object.keys(AUTO_GRAPH_LABELS) as AutomaticGraphType[]).map((type) => <button role="tab" aria-selected={automaticType === type} className={automaticType === type ? "active" : ""} onClick={() => setAutomaticType(type)} key={type}>{type === "line" ? <LineChart size={17}/> : type === "bar" ? <BarChart3 size={17}/> : <TrendingUp size={17}/>}<span>{AUTO_GRAPH_LABELS[type]}</span></button>)}
        </div>
        <div className="automatic-metrics">
          <article><small>Expedientes comparables</small><strong>{automatic.packageCycles.length}</strong><span>Mismo paquete, versión y ruta</span></article>
          <article><small>Áreas visibles</small><strong>{automatic.visibleAreas.length}/{automatic.areas.length}</strong><span>Controladas por tu selección</span></article>
          <article><small>Evidencia pendiente</small><strong>{automatic.metrics.pending}</strong><span>SE, SO o campos incompletos</span></article>
          <article><small>Cobertura visible</small><strong>{automatic.metrics.conclusive + automatic.metrics.pending ? Math.round(automatic.metrics.conclusive / (automatic.metrics.conclusive + automatic.metrics.pending) * 100) : 0}%</strong><span>Del alcance actualmente filtrado</span></article>
        </div>

        <div className={`automatic-workbench ${automaticControlsOpen ? "controls-open" : "controls-closed"}`}>
          <aside className="automatic-control-panel" aria-label="Controles de visualización">
            <div className="automatic-control-heading"><div><span><SlidersHorizontal size={16}/></span><div><strong>Configurar vista</strong><small>Los filtros no cambian los datos originales</small></div></div><button aria-label={automaticControlsOpen ? "Ocultar controles" : "Mostrar controles"} onClick={() => setAutomaticControlsOpen((current) => !current)}>{automaticControlsOpen ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
            {automaticControlsOpen && <div className="automatic-control-body">
              <fieldset><legend><Filter size={14}/> Fuente y alcance</legend>
                <label><span>Paquete, versión y ruta</span><select value={effectiveAutomaticPackage} onChange={(event) => { setAutomaticPackage(event.target.value); setHiddenAutomaticAreas([]); }}>{automaticPackageOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>
                {automaticType !== "bar" && <label><span>Persona y programa</span><select value={effectiveAutomaticPerson} onChange={(event) => setAutomaticPerson(event.target.value)}>{automaticPersonOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>}
                {automaticType !== "cumulative" && <label><span>Métrica vertical</span><select value={automaticMetric} onChange={(event) => setAutomaticMetric(event.target.value as AutomaticMetric)}>{Object.entries(AUTOMATIC_METRIC_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
                {automaticType === "bar" && <><label><span>Comparar por</span><select value={automaticGroupBy} onChange={(event) => setAutomaticGroupBy(event.target.value as AutomaticGroupBy)}><option value="site">Sede</option><option value="participant">Participante</option></select></label><label><span>Momento de comparación</span><select value={automaticMoment} onChange={(event) => setAutomaticMoment(event.target.value as AutomaticMoment)}>{Object.entries(AUTOMATIC_MOMENT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></>}
              </fieldset>
              <fieldset><legend><Eye size={14}/> Áreas visibles</legend><div className="area-selection-actions"><button onClick={() => setHiddenAutomaticAreas([])}>Mostrar todas</button><button onClick={() => setHiddenAutomaticAreas(automaticAreaOptions.map((area) => area.key))}>Ocultar todas</button></div><div className="automatic-area-picker">{automaticAreaOptions.map((area) => {
                const visible = !hiddenAutomaticAreas.includes(area.key);
                const visibleIndex = automatic.visibleAreas.findIndex((item) => item.key === area.key);
                return <button type="button" aria-pressed={visible} className={visible ? "selected" : ""} onClick={() => toggleAutomaticArea(area.key)} key={area.key}><span style={{ "--series-color": COLORS[Math.max(0, visibleIndex) % COLORS.length] } as CSSProperties}/><div><strong>{area.short}</strong><small>{area.items.length} targets</small></div>{visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>;
              })}</div></fieldset>
              <fieldset><legend><SlidersHorizontal size={14}/> Presentación</legend><div className="automatic-toggle-grid"><label><input type="checkbox" checked={automaticShowGrid} onChange={(event) => setAutomaticShowGrid(event.target.checked)}/><span>Cuadrícula</span></label><label><input type="checkbox" checked={automaticShowValues} onChange={(event) => setAutomaticShowValues(event.target.checked)}/><span>Valores</span></label>{automaticType !== "bar" && <label><input type="checkbox" checked={automaticConnectPoints} onChange={(event) => setAutomaticConnectPoints(event.target.checked)}/><span>Conectar puntos</span></label>}<label><input type="checkbox" checked={automaticShowLegend} onChange={(event) => setAutomaticShowLegend(event.target.checked)}/><span>Leyenda</span></label><label><input type="checkbox" checked={automaticShowTable} onChange={(event) => setAutomaticShowTable(event.target.checked)}/><span>Tabla de datos</span></label></div><label><span>Tamaño de la gráfica</span><select value={automaticDensity} onChange={(event) => setAutomaticDensity(event.target.value as AutomaticDensity)}><option value="compact">Compacta</option><option value="standard">Estándar</option><option value="large">Amplia</option></select></label></fieldset>
              <button className="automatic-reset-button" onClick={resetAutomaticControls}><RotateCcw size={15}/> Restablecer vista</button>
            </div>}
          </aside>

          <div className="automatic-chart-stage">
            <div className="automatic-chart-toolbar"><div><span className="automatic-view-label">Vista actual</span><strong>{AUTO_GRAPH_LABELS[automaticType]}</strong><small>{automaticType === "bar" ? `${AUTOMATIC_MOMENT_LABELS[automaticMoment]} · por ${automaticGroupBy === "site" ? "sede" : "participante"}` : automaticType === "cumulative" ? `${automaticPersonOptions.find((item) => item.key === effectiveAutomaticPerson)?.label || "Trayectoria individual"}` : `${AUTOMATIC_METRIC_LABELS[automaticMetric]} · trayectoria individual`}</small></div><div><button className="secondary-formation-button" disabled={!automaticGraph.points.length} onClick={() => exportCsv(automaticGraph)}><FileDown size={15}/> CSV</button><button className="secondary-formation-button" disabled={!automaticGraph.points.length} onClick={() => exportSvg(automaticGraph)}><Download size={15}/> SVG</button></div></div>
            {!automatic.visibleAreas.length ? <div className="empty-state automatic-empty"><EyeOff size={27}/><strong>No hay áreas visibles</strong><p>Selecciona al menos un área en el panel de configuración para construir la gráfica.</p></div> : automaticGraph.points.length ? <>
              <div className={`graph-canvas-scroll automatic-canvas density-${automaticDensity}`}><GraphCanvas graph={automaticGraph} showLegend={automaticShowLegend} density={automaticDensity}/></div>
              {automaticShowTable && <div className="automatic-data-table-wrap"><div><strong>Datos representados</strong><span>{automaticGraph.points.filter((point) => point.value !== null).length} valores disponibles de {automaticGraph.points.length}</span></div><div className="graph-data-scroll"><table className="automatic-data-table"><thead><tr><th>{automaticType === "bar" ? "Grupo" : "Momento"}</th><th>Área / serie</th><th>{automaticType === "cumulative" ? "Targets nuevos" : "Valor"}</th><th>Evidencia asociada</th></tr></thead><tbody>{automaticGraph.points.map((point) => <tr key={point.id}><td>{point.label}</td><td>{point.series}</td><td>{point.value ?? "Sin dato"}</td><td>{point.note || "—"}</td></tr>)}</tbody></table></div></div>}
            </> : <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>No hay valores para esta combinación</strong><p>Ajusta el momento, la persona o las áreas. Los datos ausentes no se representan como cero.</p></div>}
          </div>
        </div>
      </> : <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>Aún no existen evaluaciones vinculables</strong><p>Crea una evaluación desde un paquete y comienza a registrar targets. No tendrás que crear la gráfica por separado.</p></div>}
    </section>}

    {automaticSource === "programs" && <ConfigurableGraphWorkspace
      key={`${selectedProfileId}:${initialProgramId || "all"}`}
      profiles={profiles}
      selectedProfileId={selectedProfileId}
      initialProgramId={initialProgramId}
      canManage={canManage}
      notify={notify}
      onSaved={(graph) => setGraphs((current) => [graph, ...current.filter((item) => item.id !== graph.id)])}
    />}

    {automaticSource === "legacy-programs" && <section className="formation-panel automatic-graph-panel program-automatic-panel">
      <div className="automatic-graph-heading"><div><span className="automatic-source"><CircleDashed size={14}/> Fuente clínica automática</span><h2>Sesiones → mediciones → gráfica</h2><p>La configuración visual es independiente; los valores permanecen en sus sesiones de origen.</p></div><CheckCircle2 size={25}/></div>
      {profilesWithPrograms.length && effectiveAutomaticProgram && effectiveAutomaticTargets[0] ? <>
        <div className="automatic-metrics program-automatic-metrics">
          <article><small>Sesiones representadas</small><strong>{new Set(presentedProgramGraph.points.flatMap((point) => point.value !== null && point.source?.sessionId ? [point.source.sessionId] : [])).size}</strong><span>Dentro del rango seleccionado</span></article>
          <article><small>{automaticType === "cumulative" ? "Targets del programa" : "Targets visibles"}</small><strong>{effectiveAutomaticTargets.length}</strong><span>{automaticType === "cumulative" ? "Cada uno aporta como máximo +1" : "Mismo sistema de medición"}</span></article>
          <article><small>{automaticType === "cumulative" ? "Eventos de dominio" : "Datos faltantes"}</small><strong>{automaticType === "cumulative" ? effectiveAutomaticProgram.masteryEvents?.length || 0 : presentedProgramGraph.points.filter((point) => point.value === null).length}</strong><span>{automaticType === "cumulative" ? "Únicos por target" : "Nunca se convierten en cero"}</span></article>
          <article><small>Medición</small><strong className="metric-text">{automaticType === "cumulative" ? "Dominio acumulado" : PROGRAM_MEASUREMENT_LABELS[effectiveAutomaticMeasurement]}</strong><span>{automaticType === "cumulative" ? "Targets adquiridos" : effectiveAutomaticTargets[0].unitLabel}</span></article>
        </div>
        <div className={`automatic-workbench clinical-automatic-workbench ${automaticControlsOpen ? "controls-open" : "controls-closed"}`}>
          <aside className="automatic-control-panel" aria-label="Configuración de la gráfica automática">
            <div className="automatic-control-heading"><div><span><SlidersHorizontal size={16}/></span><div><strong>Constructor automático</strong><small>Filtros, diseño y presentación</small></div></div><button aria-label={automaticControlsOpen ? "Ocultar controles" : "Mostrar controles"} onClick={() => setAutomaticControlsOpen((current) => !current)}>{automaticControlsOpen ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
            {automaticControlsOpen && <div className="automatic-control-body">
              <fieldset><legend><Filter size={14}/> Fuente clínica</legend>
                <label><span>Niño</span><select value={effectiveAutomaticProfileId} onChange={(event) => { const profileId = event.target.value; const program = activeProgramOptions.find((item) => item.profileId === profileId); setAutomaticProgramLoading(true); setAutomaticProfileId(profileId); setAutomaticProgramId(program?.id || ""); setAutomaticYAxis(""); if (program) applyProgramPresentation(program); else { setAutomaticTargetIds([]); setAutomaticPhases(null); setAutomaticType("line"); } }}>{profilesWithPrograms.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label>
                <label><span>Programa</span><select value={effectiveAutomaticProgramId} onChange={(event) => { const program = automaticProgramOptions.find((item) => item.id === event.target.value); setAutomaticProgramLoading(true); setAutomaticProgramId(event.target.value); setAutomaticYAxis(""); if (program) applyProgramPresentation(program); }}>{automaticProgramOptions.map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}</select></label>
              </fieldset>
              {automaticType === "cumulative" ? <fieldset><legend><Target size={14}/> Repertorio del programa</legend><small className="clinical-control-note">La acumulativa incluye automáticamente cada target dominado una sola vez. Las selecciones de series no alteran este conteo.</small></fieldset> : <fieldset><legend><Target size={14}/> Targets / series</legend><div className="automatic-target-picker">{effectiveAutomaticProgram.targets.map((target) => {
                const selectedTarget = effectiveAutomaticTargetIds.includes(target.id);
                const incompatible = Boolean(effectiveAutomaticTargets[0] && target.measurement !== effectiveAutomaticTargets[0].measurement && !selectedTarget);
                return <button type="button" disabled={incompatible} aria-pressed={selectedTarget} className={selectedTarget ? "selected" : ""} onClick={() => toggleAutomaticTarget(target)} key={target.id}><span>{selectedTarget ? <CheckCircle2 size={15}/> : <CircleDashed size={15}/>}</span><div><strong>{target.code} · {target.name}</strong><small>{PROGRAM_MEASUREMENT_LABELS[target.measurement]} · {target.unitLabel}{incompatible ? " · escala diferente" : ""}</small></div></button>;
              })}</div></fieldset>}
              <fieldset><legend><Filter size={14}/> Rango y formato</legend>
                <div className="automatic-date-range"><label><span>Desde</span><input type="date" value={automaticDateFrom} onChange={(event) => setAutomaticDateFrom(event.target.value)}/></label><label><span>Hasta</span><input type="date" value={automaticDateTo} onChange={(event) => setAutomaticDateTo(event.target.value)}/></label></div>
                <div className="automatic-graph-tabs compact" role="tablist">{(["line", "bar", "cumulative"] as AutomaticGraphType[]).map((type) => <button type="button" role="tab" aria-selected={automaticType === type} className={automaticType === type ? "active" : ""} onClick={() => setAutomaticType(type)} key={type}>{type === "line" ? <LineChart size={15}/> : type === "bar" ? <BarChart3 size={15}/> : <TrendingUp size={15}/>}<span>{GRAPH_TYPE_LABELS[type]}</span></button>)}</div>
                {automaticType === "line" && <label><span>Diseño experimental</span><select value={automaticDesign} onChange={(event) => { setAutomaticDesign(event.target.value as LineDesign); setAutomaticPhases(null); }}>{Object.entries(LINE_DESIGN_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
                {automaticType === "cumulative" && <small className="clinical-control-note">Esta vista representa el total histórico de targets adquiridos; nunca suma respuestas ni porcentajes de sesión.</small>}
              </fieldset>
              <fieldset><legend><SlidersHorizontal size={14}/> Identificación y ejes</legend>
                <label><span>Título</span><input value={automaticTitle} maxLength={140} onChange={(event) => setAutomaticTitle(event.target.value)}/></label>
                <label><span>Objetivo</span><textarea value={automaticObjective} onChange={(event) => setAutomaticObjective(event.target.value)}/></label>
                <label><span>Eje horizontal</span><input value={automaticXAxis} onChange={(event) => setAutomaticXAxis(event.target.value)}/></label>
                <label><span>Eje vertical</span><input value={automaticYAxis} placeholder={effectiveAutomaticTargets[0].unitLabel} onChange={(event) => setAutomaticYAxis(event.target.value)}/></label>
              </fieldset>
              {automaticType === "line" && <fieldset><legend><MoveHorizontal size={14}/> Fases</legend>
                <button className="automatic-add-phase" type="button" onClick={addAutomaticPhase}><Plus size={14}/> Agregar cambio de fase</button>
                <div className="automatic-phase-list">{presentedProgramGraph.phases.map((phase, index) => {
                  const labels = uniqueInOrder(presentedProgramGraph.points.map((point) => point.label));
                  return <article key={phase.id}><label><span>Ubicación</span><select value={phase.afterIndex} onChange={(event) => { const afterIndex = Number(event.target.value); const boundaryPoint = presentedProgramGraph.points.find((point) => point.label === labels[afterIndex]); updateAutomaticPhase(phase.id, { afterIndex, boundaryDate: boundaryPoint?.source?.sessionDate }); }}>{labels.slice(0, -1).map((label, labelIndex) => <option value={labelIndex + 1} key={`${label}-${labelIndex}`}>Después de {label}</option>)}</select></label><label><span>Antes</span><input value={phase.beforeLabel} onChange={(event) => updateAutomaticPhase(phase.id, { beforeLabel: event.target.value })}/></label><label><span>Después</span><input value={phase.afterLabel} onChange={(event) => updateAutomaticPhase(phase.id, { afterLabel: event.target.value })}/></label><button className="icon-danger" aria-label={`Eliminar fase ${index + 1}`} onClick={() => setAutomaticPhases((automaticPhases ?? presentedProgramGraph.phases).filter((item) => item.id !== phase.id))}><Trash2 size={14}/></button></article>;
                })}</div>
              </fieldset>}
              <fieldset><legend><Eye size={14}/> Presentación</legend><div className="automatic-toggle-grid"><label><input type="checkbox" checked={automaticShowGrid} onChange={(event) => setAutomaticShowGrid(event.target.checked)}/><span>Cuadrícula</span></label><label><input type="checkbox" checked={automaticShowPoints} onChange={(event) => setAutomaticShowPoints(event.target.checked)}/><span>Puntos</span></label><label><input type="checkbox" checked={automaticShowValues} onChange={(event) => setAutomaticShowValues(event.target.checked)}/><span>Valores</span></label><label><input type="checkbox" checked={automaticConnectPoints} onChange={(event) => setAutomaticConnectPoints(event.target.checked)}/><span>Líneas</span></label><label><input type="checkbox" checked={automaticShowLegend} onChange={(event) => setAutomaticShowLegend(event.target.checked)}/><span>Leyenda</span></label><label><input type="checkbox" checked={automaticShowTable} onChange={(event) => setAutomaticShowTable(event.target.checked)}/><span>Tabla</span></label></div><label><span>Tamaño</span><select value={automaticDensity} onChange={(event) => setAutomaticDensity(event.target.value as AutomaticDensity)}><option value="compact">Compacta</option><option value="standard">Estándar</option><option value="large">Amplia</option></select></label></fieldset>
              <button className="automatic-reset-button" onClick={resetAutomaticControls}><RotateCcw size={15}/> Restablecer vista</button>
              {canManage && <button className="primary-formation-button automatic-save-config" disabled={saving || automaticProgramLoading || !presentedProgramGraph.points.some((point) => point.value !== null)} onClick={saveAutomaticConfiguration}>{saving ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} Guardar configuración</button>}
            </div>}
          </aside>
          <div className="automatic-chart-stage program-chart-stage">
            <div className="automatic-chart-toolbar"><div><span className="automatic-view-label">{effectiveAutomaticProgram.participantName} · {effectiveAutomaticProgram.site}</span><strong>{automaticTitle}</strong><small>{effectiveAutomaticProgram.name} · {automaticType === "cumulative" ? "Todos los targets del programa" : effectiveAutomaticTargets.map((target) => target.code).join(", ")}</small></div><div><button className="secondary-formation-button" disabled={!presentedProgramGraph.points.some((point) => point.value !== null)} onClick={() => exportCsv(presentedProgramGraph)}><FileDown size={15}/> CSV</button><button className="secondary-formation-button" disabled={!presentedProgramGraph.points.some((point) => point.value !== null)} onClick={() => exportSvg(presentedProgramGraph)}><Download size={15}/> SVG</button></div></div>
            {automaticProgramLoading ? <div className="empty-state automatic-empty"><LoaderCircle className="spin" size={27}/><strong>Cargando sesiones del programa…</strong></div> : presentedProgramGraph.points.some((point) => point.value !== null) ? <><div className={`graph-canvas-scroll automatic-canvas density-${automaticDensity}`}><GraphCanvas graph={presentedProgramGraph} showLegend={automaticShowLegend} density={automaticDensity} edgeInset/></div>{automaticShowTable && <div className="automatic-data-table-wrap"><div><strong>{automaticType === "cumulative" ? "Historial acumulado de dominio" : "Datos de sesión y procedencia"}</strong><span>{presentedProgramGraph.points.filter((point) => point.value !== null).length} valores · {presentedProgramGraph.points.filter((point) => point.value === null).length} faltantes</span></div><div className="graph-data-scroll"><table className="automatic-data-table"><thead><tr><th>Fecha</th><th>Target / serie</th><th>{automaticType === "cumulative" ? "Total acumulado" : "Valor"}</th><th>Sesión</th><th>Oportunidades</th><th>Contexto y notas</th></tr></thead><tbody>{presentedProgramGraph.points.map((point) => <tr key={point.id}><td>{point.label}</td><td>{point.series}</td><td>{point.value ?? <em>Sin dato</em>}</td><td>{point.source?.sessionId || "—"}</td><td>{point.source?.opportunities ?? "—"}</td><td>{point.note || "—"}</td></tr>)}</tbody></table></div></div>}</> : <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>No hay mediciones cerradas en este rango</strong><p>Las sesiones inexistentes o targets no muestreados no se convierten en cero.</p></div>}
          </div>
        </div>
      </> : <div className="empty-state automatic-empty"><CircleDashed size={27}/><strong>Aún no existen programas con targets</strong><p>Crea un programa, registra sesiones y vuelve a esta vista.</p></div>}
    </section>}

    <div className="manual-graph-heading"><div><p className="section-kicker">Herramientas manuales</p><h2>{selectedProfileId === "all" ? "Diseños y registros vinculables" : `Gráficas de ${profileName(selectedProfileId)}`}</h2></div></div>
    <section className="graph-family-grid">
      <article><span className="green"><LineChart size={21}/></span><div><strong>Líneas y fases</strong><p>AB, ABA, ABAB, BAB, multielemento, criterio cambiante y fases libres.</p></div></article>
      <article><span className="navy"><BarChart3 size={21}/></span><div><strong>Comparaciones</strong><p>Sedes, coordinadores o condiciones; descriptivas y sin rankings automáticos.</p></div></article>
      <article><span className="amber"><TrendingUp size={21}/></span><div><strong>Acumulativas</strong><p>Conductas nuevas por sesión y total de repertorio calculado automáticamente.</p></div></article>
    </section>
    <section className="formation-panel graph-library-panel">
      <div className="graph-library-tools"><label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, objetivo o medida"/></label><label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos</option><option value="line">Líneas</option><option value="bar">Barras</option><option value="cumulative">Acumulativas</option></select></label><div className="graph-view-toggle" role="group" aria-label="Estado de las gráficas"><button className={!archiveView ? "active" : ""} onClick={() => setArchiveView(false)}>Activas</button><button className={archiveView ? "active" : ""} onClick={() => setArchiveView(true)}>Archivadas</button></div><span>{filtered.length} resultado{filtered.length === 1 ? "" : "s"}</span></div>
      {loading ? <div className="empty-state"><LoaderCircle className="spin" size={26}/><strong>Cargando gráficas…</strong></div> : filtered.length ? <div className="graph-card-grid">{filtered.map((graph) => {
        const populated = graph.points.filter((point) => point.value !== null).length;
        const graphProfileId = graph.profileId || cycles.find((cycle) => cycle.id === graph.linkedCycleId)?.profileId || null;
        return <article className="graph-library-card" key={graph.id}><div className="graph-card-icon">{graph.graphType === "line" ? <LineChart size={22}/> : graph.graphType === "bar" ? <BarChart3 size={22}/> : <TrendingUp size={22}/>}</div><div className="graph-card-copy"><div><span>{GRAPH_TYPE_LABELS[graph.graphType]}</span>{graph.graphType === "line" && <em>{LINE_DESIGN_LABELS[graph.designType]}</em>}</div><h2>{graph.title}</h2><p>{graph.objective}</p><div className="graph-link-chips"><span>{profileName(graphProfileId)}</span>{graph.linkedProgramId && <span>{programName(graph.linkedProgramId)}</span>}</div><small>{populated}/{graph.points.length} registros con datos · {graph.measurement}</small></div><div className="graph-card-actions"><button className="primary-formation-button" onClick={() => setSelectedId(graph.id)}>Abrir</button><button title="Historial" aria-label={`Historial de ${graph.title}`} onClick={() => openHistory(graph)}><Clock3 size={16}/></button>{canManage && <><button title={graph.status === "archived" ? "Restaurar" : "Archivar"} aria-label={`${graph.status === "archived" ? "Restaurar" : "Archivar"} ${graph.title}`} onClick={() => archiveOrRestore(graph)}>{graph.status === "archived" ? <RotateCcw size={16}/> : <Archive size={16}/>}</button><button className="danger-action" title="Eliminar" aria-label={`Eliminar ${graph.title}`} onClick={() => { setDeleteTarget(graph); setDeleteText(""); }}><Trash2 size={16}/></button></>}</div></article>;
      })}</div> : <div className="empty-state"><CircleDashed size={27}/><strong>{archiveView ? "No hay gráficas archivadas" : "Todavía no hay gráficas en esta vista"}</strong><p>Crea una gráfica y selecciona el diseño que corresponda a la pregunta analítica.</p></div>}
    </section>
    <section className="graph-safety-note institutional"><CheckCircle2 size={20}/><div><strong>Las comparaciones agregadas se mantienen no punitivas</strong><p>La plataforma conserva el orden que definas y no genera puestos, ganadores, perdedores ni conclusiones de competencia entre sedes o personas.</p></div></section>

    {newOpen && <div className="modal-backdrop"><section className="graph-create-modal" role="dialog" aria-modal="true" aria-labelledby="graph-create-title"><div className="modal-title"><div><p className="section-kicker">Nueva visualización</p><h2 id="graph-create-title">Crear gráfica</h2></div><button aria-label="Cerrar" onClick={() => setNewOpen(false)}><X size={19}/></button></div><p className="modal-intro">Selecciona el formato según la pregunta que necesitas responder. Podrás cambiar los datos, ejes y fases dentro del editor.</p><div className="graph-type-picker">{(["line", "bar", "cumulative"] as GraphType[]).map((type) => <button key={type} className={form.graphType === type ? "selected" : ""} onClick={() => setForm({ ...form, graphType: type, designType: type === "line" ? form.designType : "simple", xAxisLabel: type === "bar" ? "Categorías" : "Sesiones", yAxisLabel: type === "cumulative" ? "Repertorio acumulado" : form.measurement })}>{type === "line" ? <LineChart size={22}/> : type === "bar" ? <BarChart3 size={22}/> : <TrendingUp size={22}/>}<strong>{GRAPH_TYPE_LABELS[type]}</strong><small>{type === "line" ? "Seguimiento y diseños" : type === "bar" ? "Comparar condiciones" : "Sumar repertorio"}</small></button>)}</div><div className="modal-form graph-create-form">
      <label><span>Nombre de la gráfica</span><input autoFocus maxLength={140} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ej. Integridad de implementación"/></label>
      {form.graphType === "line" && <label><span>Diseño inicial</span><select value={form.designType} onChange={(event) => setForm({ ...form, designType: event.target.value as LineDesign })}>{Object.entries(LINE_DESIGN_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
      <label className="field-wide"><span>Objetivo principal</span><textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} placeholder="Qué medida representa, para qué decisión se utilizará y cuál es su unidad de análisis."/></label>
      <label className="field-wide graph-profile-link-field"><span>Niño vinculado</span><select value={form.profileId} onChange={(event) => changeFormProfile(event.target.value)}><option value="">Gráfica institucional o independiente</option>{profiles.filter((profile) => profile.status === "active").map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select><small>Al vincularla, la gráfica aparecerá en el expediente del niño y en sus informes.</small></label>
      <label><span>Programa vinculado (opcional)</span><select disabled={!form.profileId} value={form.linkedProgramId} onChange={(event) => setForm({ ...form, linkedProgramId: event.target.value })}><option value="">Sin programa específico</option>{formProgramOptions.map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}</select></label>
      <label><span>Método de medición</span><select value={form.measurement} onChange={(event) => setForm({ ...form, measurement: event.target.value, yAxisLabel: event.target.value })}>{MEASUREMENT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label><span>Evaluación vinculada (opcional)</span><select disabled={!form.profileId} value={form.linkedCycleId} onChange={(event) => setForm({ ...form, linkedCycleId: event.target.value })}><option value="">Sin evaluación específica</option>{formCycleOptions.map((cycle) => <option value={cycle.id} key={cycle.id}>{cycle.label} · {cycle.site}</option>)}</select></label>
      <label><span>Eje horizontal</span><input value={form.xAxisLabel} onChange={(event) => setForm({ ...form, xAxisLabel: event.target.value })}/></label><label><span>Eje vertical</span><input value={form.yAxisLabel} onChange={(event) => setForm({ ...form, yAxisLabel: event.target.value })}/></label>
    </div><div className="modal-foot"><span><CheckCircle2 size={15}/> Datos persistentes e historial de cambios</span><div><button className="secondary-formation-button" onClick={() => setNewOpen(false)}>Cancelar</button><button className="primary-formation-button" disabled={saving || !form.title.trim() || !form.objective.trim()} onClick={createGraph}>{saving ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} Crear gráfica</button></div></div></section></div>}
    {deleteTarget && <div className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-graph-title"><span className="danger-mark"><Trash2 size={23}/></span><h2 id="delete-graph-title">Eliminar gráfica permanentemente</h2><p>Se eliminarán la configuración, todos los datos, el análisis visual y <strong>todo el historial</strong> de “{deleteTarget.title}”. Esta acción no se puede deshacer.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)}/></label><div><button className="secondary-formation-button" onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="danger-button" disabled={deleteText.trim().toUpperCase() !== "ELIMINAR" || saving} onClick={deleteGraph}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></div>}
    {historyTarget && <div className="modal-backdrop"><section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="graph-history-title"><div className="modal-title"><div><p className="section-kicker">Trazabilidad</p><h2 id="graph-history-title">Historial de la gráfica</h2></div><button aria-label="Cerrar historial" onClick={() => setHistoryTarget(null)}><X size={19}/></button></div><p className="modal-intro"><strong>{historyTarget.title}</strong>. El historial se elimina automáticamente si eliminas esta gráfica.</p><div className="history-timeline">{historyLoading ? <div className="empty-state"><LoaderCircle className="spin" size={24}/><strong>Cargando historial…</strong></div> : history.length ? history.map((entry) => <article key={entry.id}><span><Clock3 size={15}/></span><div><strong>{entry.summary}</strong>{entry.details && <p>{entry.details}</p>}<small>{new Date(entry.createdAt).toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" })}</small></div></article>) : <div className="empty-state"><CircleDashed size={26}/><strong>Sin modificaciones registradas</strong></div>}</div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setHistoryTarget(null)}>Cerrar</button></div></section></div>}
  </>;
}
