import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_CANCELLATION_CATEGORIES,
  appointmentHasClinicalEvidence,
  canAdministrativelyDeleteAppointment,
  cancellationCategoryLabel,
  normalizeCancellationInput,
} from "../lib/calendar-appointments.ts";

test("expone categorías institucionales de cancelación", () => {
  assert.deepEqual(CALENDAR_CANCELLATION_CATEGORIES.map((item) => item.label), [
    "Niño indispuesto",
    "Profesional ausente",
    "Familia no disponible",
    "Conflicto de horario",
    "Otro",
  ]);
  assert.equal(cancellationCategoryLabel("child_unwell"), "Niño indispuesto");
});

test("requiere categoría y justificación cuando el motivo es Otro", () => {
  assert.throws(() => normalizeCancellationInput("", ""), /categoría/);
  assert.throws(() => normalizeCancellationInput("other", ""), /Describe/);
  assert.deepEqual(normalizeCancellationInput("professional_absent", "Permiso informado"), {
    category: "professional_absent",
    reason: "Permiso informado",
  });
});

test("detecta evidencia clínica vinculada a la cita", () => {
  assert.equal(appointmentHasClinicalEvidence({ clinicalSessionRunId: null, interventionSessionId: null }), false);
  assert.equal(appointmentHasClinicalEvidence({ clinicalSessionRunId: "run-1", interventionSessionId: null }), true);
  assert.equal(appointmentHasClinicalEvidence({ clinicalSessionRunId: null, interventionSessionId: "session-1" }), true);
});

test("sólo permite eliminar citas administrativas programadas o canceladas", () => {
  assert.equal(canAdministrativelyDeleteAppointment({ status: "scheduled", clinicalSessionRunId: null, interventionSessionId: null }), true);
  assert.equal(canAdministrativelyDeleteAppointment({ status: "cancelled", clinicalSessionRunId: null, interventionSessionId: null }), true);
  assert.equal(canAdministrativelyDeleteAppointment({ status: "completed", clinicalSessionRunId: null, interventionSessionId: null }), false);
  assert.equal(canAdministrativelyDeleteAppointment({ status: "scheduled", clinicalSessionRunId: "run-1", interventionSessionId: null }), false);
});
