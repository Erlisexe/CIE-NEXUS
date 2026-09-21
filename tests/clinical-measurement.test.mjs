import test from "node:test";
import assert from "node:assert/strict";
import {
  hasValidRequestedMeasurementConfig,
  isBinaryOpportunityMeasurement,
  measurementDisplayLabel,
  normalizeMeasurementConfig,
  percentageCriterionLabel,
  recordingFormatsForDimension,
  usesEventCount,
  usesPromptLevels,
} from "../lib/clinical-measurement.ts";
import { capturedResult } from "../lib/mobile-collection.ts";

test("la taxonomía separa dimensión, formato y porcentaje derivado", () => {
  const trial = normalizeMeasurementConfig({ measurementDimension: "occurrence", recordingFormat: "trial_by_trial" });
  assert.deepEqual(trial, {
    measurementDimension: "occurrence",
    recordingFormat: "trial_by_trial",
    measurement: "discrete_trials",
    unitLabel: "%",
  });
  assert.equal(measurementDisplayLabel(trial), "Ensayo por ensayo con nivel de ayuda");
  assert.equal(percentageCriterionLabel(trial), "% respuestas independientes/correctas");
  assert.equal(usesPromptLevels(trial), true);
  assert.equal(isBinaryOpportunityMeasurement(trial), true);
  assert.equal(recordingFormatsForDimension("occurrence").includes("opportunity_yes_no"), true);
});

test("los targets occurrence históricos ya no se presentan como ensayos discretos", () => {
  const occurrence = normalizeMeasurementConfig({ measurement: "occurrence" });
  assert.equal(occurrence.measurementDimension, "occurrence");
  assert.equal(occurrence.recordingFormat, "opportunity_yes_no");
  assert.equal(measurementDisplayLabel(occurrence), "Registro de ocurrencia (sí/no por oportunidad)");
  assert.equal(percentageCriterionLabel(occurrence), "% oportunidades con ocurrencia");
  assert.equal(usesPromptLevels(occurrence), false);
  assert.equal(isBinaryOpportunityMeasurement(occurrence), true);
});

test("los códigos históricos conservan la lectura clínica y los nuevos formatos son compatibles", () => {
  assert.equal(normalizeMeasurementConfig({ measurement: "percentage" }).recordingFormat, "trial_by_trial");
  assert.equal(normalizeMeasurementConfig({ measurement: "task_analysis" }).recordingFormat, "task_analysis");
  assert.equal(normalizeMeasurementConfig({ measurement: "partial_interval" }).recordingFormat, "partial_interval");
  const rate = normalizeMeasurementConfig({ measurementDimension: "rate", recordingFormat: "event_count" });
  assert.equal(rate.measurement, "frequency");
  assert.equal(rate.unitLabel, "ocurrencias/min");
  assert.equal(usesEventCount(rate), true);
});

test("la API rechaza pares canónicos incompletos o incompatibles", () => {
  assert.equal(hasValidRequestedMeasurementConfig({ measurement: "occurrence" }), true);
  assert.equal(hasValidRequestedMeasurementConfig({ measurementDimension: "occurrence", recordingFormat: "event_count" }), false);
  assert.equal(hasValidRequestedMeasurementConfig({ measurementDimension: "frequency" }), false);
  assert.equal(hasValidRequestedMeasurementConfig({ measurementDimension: "interval", recordingFormat: "partial_interval" }), true);
});

test("el registro sí/no conserva O/N y calcula el porcentaje como resultado derivado", () => {
  const target = {
    id: "occurrence-target", code: "O01", name: "Ocurrencia", specificObjective: "",
    measurement: "occurrence", measurementDimension: "occurrence", recordingFormat: "opportunity_yes_no",
    unitLabel: "%", state: "acquisition",
    criteria: {}, sessionConfig: { discriminativeStimulus: "", teachingInstructions: "", taskSteps: [], intervalSeconds: 30, maintenanceProbeEveryDays: 7 },
  };
  const result = capturedResult(target, {
    targetId: target.id, definition: "", note: "", opportunities: 2, timerStartedAt: null,
    observations: [
      { id: "one", at: "2026-09-21T10:00:00.000Z", value: 1, responseCode: "O" },
      { id: "two", at: "2026-09-21T10:01:00.000Z", value: 0, responseCode: "N" },
    ],
  });
  assert.deepEqual(result.trials, [1, 0]);
  assert.equal(result.correct, 1);
  assert.equal(result.value, 50);
  assert.deepEqual(result.trialDetails.map((item) => item.responseCode), ["O", "N"]);
});
