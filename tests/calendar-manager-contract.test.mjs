import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../app/components/calendar-manager.tsx", import.meta.url);

test("la gestión completa se limita al calendario principal", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /canManage && !compact && <button className="manage-appointment"/);
  assert.match(source, /selectedAppointment && !compact/);
  assert.match(source, /draft && !compact/);
  assert.match(source, /cancelTarget && !compact/);
  assert.match(source, /deleteTarget && !compact/);
});

test("la vista compacta conserva el flujo sencillo de iniciar terapia", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /if \(canManage && !compact\) return openManagement\(appointment\);/);
  assert.match(source, /if \(appointment\.canStart && \(appointment\.status === "scheduled" \|\| appointment\.status === "in_progress"\)\) onOpenSession\(appointment\);/);
  assert.match(source, /onDoubleClick=\{\(\) => canManage && !compact && openNew\(dayIso\)\}/);
});

test("el calendario principal muestra las acciones administrativas separadas", async () => {
  const source = await readFile(componentPath, "utf8");
  for (const label of ["Editar", "Cancelar sesión", "Restaurar", "Eliminar del calendario"]) {
    assert.match(source, new RegExp(`>${label.replace(" ", "\\s*")}<|${label}`));
  }
});
