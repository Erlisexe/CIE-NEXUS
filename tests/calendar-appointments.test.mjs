import assert from "node:assert/strict";
import test from "node:test";
import {
  CANCELLATION_CATEGORIES,
  appointmentHasLinkedClinicalEvidence,
  canAdministrativelyCancelAppointment,
  canAdministrativelyDeleteAppointment,
  canAdministrativelyEditAppointment,
  canAdministrativelyRestoreAppointment,
  cancellationLabel,
  validateCancellation,
} from "../lib/calendar-appointments.ts";

test("expone exactamente las categorías institucionales de cancelación", () => {
  assert.deepEqual(CANCELLATION_CATEGORIES.map((item) => item.label), [
    "Niño indispuesto", "Profesional ausente", "Familia no disponible", "Conflicto de horario", "Otro",
  ]);
});

test("cancelar exige una categoría válida", () => {
  assert.equal(validateCancellation("", "Texto").error, "Selecciona una categoría de cancelación.");
  assert.equal(validateCancellation("unknown", "Texto").error, "Selecciona una categoría de cancelación.");
});

test("sólo Otro exige justificación", () => {
  for (const category of CANCELLATION_CATEGORIES.filter((item) => item.value !== "other")) {
    assert.deepEqual(validateCancellation(category.value, "  "), { category: category.value, reason: "" });
  }
  assert.equal(validateCancellation("other", "  ").error, "Describe el motivo cuando seleccionas “Otro”.");
  assert.deepEqual(validateCancellation("other", "  Motivo excepcional  "), {
    category: "other", reason: "Motivo excepcional",
  });
});

test("las categorías actuales y anteriores conservan una etiqueta legible", () => {
  assert.equal(cancellationLabel("child_unwell"), "Niño indispuesto");
  assert.equal(cancellationLabel("other"), "Otro");
  assert.equal(cancellationLabel("therapist_absent"), "Profesional ausente");
  assert.equal(cancellationLabel(null), "Cancelación anterior");
});

test("detecta sesiones clínicas vinculadas a la cita", () => {
  assert.equal(appointmentHasLinkedClinicalEvidence({}), false);
  assert.equal(appointmentHasLinkedClinicalEvidence({ interventionSessionId: "session-1" }), true);
  assert.equal(appointmentHasLinkedClinicalEvidence({ clinicalSessionRunId: "run-1" }), true);
});

test("permite editar y eliminar citas administrativas programadas o canceladas", () => {
  assert.equal(canAdministrativelyEditAppointment({ status: "scheduled" }), true);
  assert.equal(canAdministrativelyEditAppointment({ status: "cancelled" }), true);
  assert.equal(canAdministrativelyDeleteAppointment({ status: "cancelled" }), true);
  assert.equal(canAdministrativelyDeleteAppointment({ status: "completed" }), false);
  assert.equal(canAdministrativelyDeleteAppointment({ status: "scheduled", clinicalSessionRunId: "run-1" }), false);
});

test("separa correctamente cancelar de restaurar", () => {
  assert.equal(canAdministrativelyCancelAppointment({ status: "scheduled" }), true);
  assert.equal(canAdministrativelyCancelAppointment({ status: "scheduled", clinicalSessionRunId: "run-1" }), false);
  assert.equal(canAdministrativelyCancelAppointment({ status: "scheduled", interventionSessionId: "session-1" }), false);
  assert.equal(canAdministrativelyCancelAppointment({ status: "cancelled" }), false);
  assert.equal(canAdministrativelyRestoreAppointment({ status: "cancelled" }), true);
  assert.equal(canAdministrativelyRestoreAppointment({ status: "scheduled" }), false);
  assert.equal(canAdministrativelyRestoreAppointment({ status: "cancelled", interventionSessionId: "session-1" }), false);
});
