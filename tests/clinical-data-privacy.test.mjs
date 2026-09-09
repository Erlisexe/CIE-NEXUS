import test from "node:test";
import assert from "node:assert/strict";
import { aggregateOnlySessionResult, canViewRawClinicalDetail, redactAbcRecordForViewer, redactGraphPointForViewer } from "../lib/clinical-data-privacy.ts";

const therapist = { id: "therapist-1", role: "terapeuta" };

test("terapia conserva el agregado del niño asignado pero no el detalle crudo ajeno", () => {
  assert.equal(canViewRawClinicalDetail(therapist, "therapist-1"), true);
  assert.equal(canViewRawClinicalDetail(therapist, "therapist-2"), false);
  assert.equal(canViewRawClinicalDetail({ id: "coord-1", role: "coordinador" }, "therapist-2"), true);
  const aggregate = aggregateOnlySessionResult({ targetId: "t1", sampled: true, value: 80, correct: 8, opportunities: 10, trials: [1, 0], trialDetails: [{ promptLevel: "verbal" }], note: "nota", stateAtSession: "acquisition", criterionStatus: "met", criterionReason: "detalle" });
  assert.equal(aggregate.value, 80);
  assert.equal(aggregate.correct, 8);
  assert.equal(aggregate.opportunities, 10);
  assert.deepEqual(aggregate.trials, []);
  assert.deepEqual(aggregate.trialDetails, []);
  assert.equal(aggregate.note, "");
});

test("un ABC ajeno conserva el conteo y fecha, pero no la narrativa ni la identidad", () => {
  const raw = { id: "abc-1", targetId: "t1", recordedByAccountId: "therapist-2", recordedByName: "Persona B", eventDate: "2026-09-08", eventTime: "09:15", locationContext: "Aula", activity: "Transición", antecedentLabel: "Demanda", antecedentDescription: "detalle A", behaviorLabel: "Grito", behaviorDescription: "detalle B", consequenceLabel: "Pausa", consequenceDescription: "detalle C", additionalObservation: "nota" };
  const redacted = redactAbcRecordForViewer(raw, therapist);
  assert.equal(redacted.eventDate, raw.eventDate);
  assert.equal(redacted.targetId, raw.targetId);
  assert.equal(redacted.eventTime, "");
  assert.equal(redacted.recordedByName, "Equipo clínico");
  assert.equal(redacted.behaviorLabel, "Objetivo vinculado");
  assert.equal(redacted.behaviorDescription, "");
  assert.equal(redacted.additionalObservation, "");
  assert.equal(redacted.rawDetailAvailable, false);
  assert.deepEqual(redactAbcRecordForViewer({ ...raw, recordedByAccountId: therapist.id }, therapist), { ...raw, recordedByAccountId: therapist.id, rawDetailAvailable: true });
});

test("una gráfica guardada tampoco reexpone narrativas o identidad de otra sesión", () => {
  const raw = { id: "point", value: 80, note: "nota target", source: { sessionId: "s2", professionalAccountId: "therapist-2", professionalName: "Persona B", rawDetailAvailable: true, context: "Casa", sessionNotes: "Narrativa", promptLevel: "verbal" } };
  const redacted = redactGraphPointForViewer(raw, therapist);
  assert.equal(redacted.value, 80);
  assert.equal(redacted.note, "");
  assert.equal(redacted.source.professionalName, "Equipo clínico");
  assert.equal(redacted.source.context, "");
  assert.equal(redacted.source.sessionNotes, "");
  assert.equal(redacted.source.rawDetailAvailable, false);
  assert.deepEqual(redactGraphPointForViewer({ ...raw, source: { ...raw.source, professionalAccountId: therapist.id } }, therapist), { ...raw, source: { ...raw.source, professionalAccountId: therapist.id } });
});
