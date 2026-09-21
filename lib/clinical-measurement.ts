/**
 * Canonical clinical measurement taxonomy.
 *
 * `measurement` remains on a target as a compatibility code for historic
 * records and the mobile client.  New target definitions persist the two
 * fields below so that a teaching procedure is never presented as a
 * measurement dimension.
 */
export const MEASUREMENT_DIMENSIONS = ["occurrence", "frequency", "rate", "duration", "latency", "interval"] as const;
export type MeasurementDimension = typeof MEASUREMENT_DIMENSIONS[number];

export const RECORDING_FORMATS = ["trial_by_trial", "task_analysis", "opportunity_yes_no", "event_count", "timed_event", "partial_interval"] as const;
export type RecordingFormat = typeof RECORDING_FORMATS[number];

export type ClinicalMeasurementConfig = {
  measurementDimension: MeasurementDimension;
  recordingFormat: RecordingFormat;
  /** Compatibility code used by historic rows and older mobile releases. */
  measurement: string;
  unitLabel: string;
};

type MeasurementInput = {
  measurement?: unknown;
  measurementDimension?: unknown;
  recordingFormat?: unknown;
  unitLabel?: unknown;
};

const LEGACY_MEASUREMENTS = new Set(["percentage", "frequency", "duration", "latency", "occurrence", "discrete_trials", "partial_interval", "task_analysis"]);

export function isMeasurementDimension(value: unknown): value is MeasurementDimension {
  return typeof value === "string" && (MEASUREMENT_DIMENSIONS as readonly string[]).includes(value);
}

export function isRecordingFormat(value: unknown): value is RecordingFormat {
  return typeof value === "string" && (RECORDING_FORMATS as readonly string[]).includes(value);
}

export function isValidMeasurementPair(dimension: MeasurementDimension, format: RecordingFormat) {
  return (dimension === "occurrence" && ["trial_by_trial", "task_analysis", "opportunity_yes_no"].includes(format))
    || ((dimension === "frequency" || dimension === "rate") && format === "event_count")
    || ((dimension === "duration" || dimension === "latency") && format === "timed_event")
    || (dimension === "interval" && format === "partial_interval");
}

export function defaultRecordingFormatForDimension(dimension: MeasurementDimension): RecordingFormat {
  if (dimension === "occurrence") return "opportunity_yes_no";
  if (dimension === "frequency" || dimension === "rate") return "event_count";
  if (dimension === "duration" || dimension === "latency") return "timed_event";
  return "partial_interval";
}

export function recordingFormatsForDimension(dimension: MeasurementDimension): RecordingFormat[] {
  if (dimension === "occurrence") return ["trial_by_trial", "task_analysis", "opportunity_yes_no"];
  if (dimension === "frequency" || dimension === "rate") return ["event_count"];
  if (dimension === "duration" || dimension === "latency") return ["timed_event"];
  return ["partial_interval"];
}

export function legacyMeasurementForConfig(dimension: MeasurementDimension, format: RecordingFormat) {
  if (format === "trial_by_trial") return "discrete_trials";
  if (format === "task_analysis") return "task_analysis";
  if (format === "opportunity_yes_no") return "occurrence";
  if (format === "partial_interval") return "partial_interval";
  if (dimension === "duration") return "duration";
  if (dimension === "latency") return "latency";
  return "frequency";
}

export function measurementDimensionLabel(dimension: MeasurementDimension) {
  return {
    occurrence: "Ocurrencia",
    frequency: "Frecuencia",
    rate: "Tasa",
    duration: "Duración",
    latency: "Latencia",
    interval: "Intervalo",
  }[dimension];
}

export function recordingFormatLabel(format: RecordingFormat) {
  return {
    trial_by_trial: "Ensayo por ensayo con nivel de ayuda",
    task_analysis: "Análisis de tarea paso a paso",
    opportunity_yes_no: "Registro de ocurrencia (sí/no por oportunidad)",
    event_count: "Conteo de ocurrencias",
    timed_event: "Cronómetro por evento",
    partial_interval: "Muestreo por intervalo parcial",
  }[format];
}

export function unitForMeasurementConfig(dimension: MeasurementDimension, format: RecordingFormat) {
  if (["trial_by_trial", "task_analysis", "opportunity_yes_no", "partial_interval"].includes(format)) return "%";
  if (dimension === "rate") return "ocurrencias/min";
  if (dimension === "frequency") return "ocurrencias";
  return "segundos";
}

function legacyConfig(measurement: unknown): ClinicalMeasurementConfig {
  const legacy = typeof measurement === "string" && LEGACY_MEASUREMENTS.has(measurement) ? measurement : "percentage";
  if (legacy === "frequency") return { measurementDimension: "frequency", recordingFormat: "event_count", measurement: legacy, unitLabel: "ocurrencias" };
  if (legacy === "duration") return { measurementDimension: "duration", recordingFormat: "timed_event", measurement: legacy, unitLabel: "segundos" };
  if (legacy === "latency") return { measurementDimension: "latency", recordingFormat: "timed_event", measurement: legacy, unitLabel: "segundos" };
  if (legacy === "partial_interval") return { measurementDimension: "interval", recordingFormat: "partial_interval", measurement: legacy, unitLabel: "%" };
  if (legacy === "task_analysis") return { measurementDimension: "occurrence", recordingFormat: "task_analysis", measurement: legacy, unitLabel: "%" };
  if (legacy === "occurrence") return { measurementDimension: "occurrence", recordingFormat: "opportunity_yes_no", measurement: legacy, unitLabel: "%" };
  // Old percentage and discrete_trials rows both represented a trial-by-trial
  // result.  We preserve their original compatibility code on read.
  return { measurementDimension: "occurrence", recordingFormat: "trial_by_trial", measurement: legacy, unitLabel: "%" };
}

export function normalizeMeasurementConfig(input: MeasurementInput): ClinicalMeasurementConfig {
  const dimension = input.measurementDimension;
  const format = input.recordingFormat;
  if (isMeasurementDimension(dimension) && isRecordingFormat(format) && isValidMeasurementPair(dimension, format)) {
    const unit = typeof input.unitLabel === "string" && input.unitLabel.trim() ? input.unitLabel.trim().slice(0, 80) : unitForMeasurementConfig(dimension, format);
    return { measurementDimension: dimension, recordingFormat: format, measurement: legacyMeasurementForConfig(dimension, format), unitLabel: unit };
  }
  const legacy = legacyConfig(input.measurement);
  const unit = typeof input.unitLabel === "string" && input.unitLabel.trim() ? input.unitLabel.trim().slice(0, 80) : legacy.unitLabel;
  return { ...legacy, unitLabel: unit };
}

/** A supplied canonical field must be a complete, compatible pair. */
export function hasValidRequestedMeasurementConfig(input: MeasurementInput) {
  const hasDimension = input.measurementDimension !== undefined && input.measurementDimension !== null && input.measurementDimension !== "";
  const hasFormat = input.recordingFormat !== undefined && input.recordingFormat !== null && input.recordingFormat !== "";
  if (!hasDimension && !hasFormat) return true;
  return isMeasurementDimension(input.measurementDimension)
    && isRecordingFormat(input.recordingFormat)
    && isValidMeasurementPair(input.measurementDimension, input.recordingFormat);
}

export function measurementDisplayLabel(input: MeasurementInput) {
  const config = normalizeMeasurementConfig(input);
  if (config.recordingFormat === "event_count" && config.measurementDimension === "rate") return "Tasa · conteo de ocurrencias";
  if (config.recordingFormat === "event_count" && config.measurementDimension === "frequency") return "Frecuencia · conteo de ocurrencias";
  if (config.recordingFormat === "timed_event") return config.measurementDimension === "latency" ? "Latencia · cronómetro por evento" : "Duración · cronómetro por evento";
  return recordingFormatLabel(config.recordingFormat);
}

export function isBinaryOpportunityMeasurement(input: MeasurementInput) {
  const format = normalizeMeasurementConfig(input).recordingFormat;
  return format === "trial_by_trial" || format === "task_analysis" || format === "opportunity_yes_no" || format === "partial_interval";
}

export function usesPromptLevels(input: MeasurementInput) {
  const format = normalizeMeasurementConfig(input).recordingFormat;
  return format === "trial_by_trial" || format === "task_analysis";
}

export function usesTaskAnalysis(input: MeasurementInput) {
  return normalizeMeasurementConfig(input).recordingFormat === "task_analysis";
}

export function usesPartialIntervals(input: MeasurementInput) {
  return normalizeMeasurementConfig(input).recordingFormat === "partial_interval";
}

export function usesEventCount(input: MeasurementInput) {
  return normalizeMeasurementConfig(input).recordingFormat === "event_count";
}

export function usesObservationClock(input: MeasurementInput) {
  const config = normalizeMeasurementConfig(input);
  return config.recordingFormat === "event_count" && (config.measurementDimension === "frequency" || config.measurementDimension === "rate");
}

export function usesTimedMeasurement(input: MeasurementInput) {
  return normalizeMeasurementConfig(input).recordingFormat === "timed_event";
}

export function sampleUnitLabel(input: MeasurementInput) {
  const format = normalizeMeasurementConfig(input).recordingFormat;
  if (format === "trial_by_trial") return "ensayos";
  if (format === "task_analysis") return "pasos";
  if (format === "opportunity_yes_no") return "oportunidades";
  if (format === "partial_interval") return "intervalos";
  if (format === "event_count") return "ocurrencias";
  return "mediciones";
}

export function percentageCriterionLabel(input: MeasurementInput) {
  const format = normalizeMeasurementConfig(input).recordingFormat;
  if (format === "trial_by_trial" || format === "task_analysis") return "% respuestas independientes/correctas";
  if (format === "opportunity_yes_no") return "% oportunidades con ocurrencia";
  if (format === "partial_interval") return "% intervalos con ocurrencia";
  return "% del resultado";
}

export function sameMeasurementConfig(a: MeasurementInput, b: MeasurementInput) {
  const left = normalizeMeasurementConfig(a);
  const right = normalizeMeasurementConfig(b);
  return left.measurementDimension === right.measurementDimension && left.recordingFormat === right.recordingFormat;
}
