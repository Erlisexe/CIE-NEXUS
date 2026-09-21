import test from "node:test";
import assert from "node:assert/strict";
import { maintenanceProbeStatus } from "../lib/mobile-collection.ts";

test("una sonda de mantenimiento vence en la misma fecha que la toma real", () => {
  assert.deepEqual(maintenanceProbeStatus("maintenance", "2026-09-01", 7, "2026-09-07"), { due: false, dueDate: "2026-09-08" });
  assert.deepEqual(maintenanceProbeStatus("maintenance", "2026-09-01", 7, "2026-09-08"), { due: true, dueDate: "2026-09-08" });
});

test("un target generalizado sin muestra previa pide su primera sonda", () => {
  assert.deepEqual(maintenanceProbeStatus("maintenance", null, 7, "2026-09-08"), { due: true, dueDate: null });
});

test("el cálculo no marca fases que no usan sondas de mantenimiento", () => {
  assert.deepEqual(maintenanceProbeStatus("acquisition", "2026-09-01", 7, "2026-09-20"), { due: false, dueDate: null });
});
