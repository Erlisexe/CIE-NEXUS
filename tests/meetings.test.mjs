import assert from "node:assert/strict";
import test from "node:test";
import { meetingDateValue, meetingRangesOverlap, meetingStatusLabel, meetingTimeValue, todayInNicaragua } from "../lib/meetings.ts";

test("valida fechas y horas sin interpretar texto libre", () => {
  assert.equal(meetingDateValue("2026-09-15"), "2026-09-15");
  assert.equal(meetingDateValue("15/09/2026"), "");
  assert.equal(meetingTimeValue("09:30"), "09:30");
  assert.equal(meetingTimeValue("25:00"), "");
});

test("detecta solapamientos y permite bloques contiguos", () => {
  assert.equal(meetingRangesOverlap("09:00", "10:00", "09:30", "10:30"), true);
  assert.equal(meetingRangesOverlap("09:00", "10:00", "10:00", "10:30"), false);
  assert.equal(meetingRangesOverlap("10:00", "10:30", "09:00", "10:00"), false);
});

test("mantiene estados comprensibles para el flujo de solicitud", () => {
  assert.equal(meetingStatusLabel("pending"), "Pendiente");
  assert.equal(meetingStatusLabel("accepted"), "Aceptada");
  assert.equal(meetingStatusLabel("declined"), "Rechazada");
  assert.equal(meetingStatusLabel("cancelled"), "Cancelada");
});

test("calcula la fecha institucional en zona horaria de Nicaragua", () => {
  assert.equal(todayInNicaragua(new Date("2026-09-01T03:30:00Z")), "2026-08-31");
});
