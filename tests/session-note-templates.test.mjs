import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SESSION_NOTE_TEMPLATE,
  formatSessionNoteText,
  missingRequiredSessionNoteFields,
  normalizeSessionNoteValues,
  sanitizeSessionNoteFields,
} from "../lib/session-note-templates.ts";

test("la plantilla ABA general incluye los componentes clínicos esenciales", () => {
  const labels = DEFAULT_SESSION_NOTE_TEMPLATE.fields.map((field) => field.label).join(" ");
  assert.match(labels, /Contexto y participantes/);
  assert.match(labels, /Programas y actividades/);
  assert.match(labels, /Respuesta del niño/);
  assert.match(labels, /Procedimientos, ayudas y reforzamiento/);
  assert.match(labels, /Conductas relevantes/);
  assert.match(labels, /Variables contextuales/);
  assert.match(labels, /Plan para la próxima sesión/);
});

test("una nota no puede cerrarse si falta un campo obligatorio", () => {
  const fields = sanitizeSessionNoteFields(DEFAULT_SESSION_NOTE_TEMPLATE.fields);
  const values = normalizeSessionNoteValues({ contexto_participantes: "Clínica con terapeuta." }, fields);
  const missing = missingRequiredSessionNoteFields(fields, values);
  assert.ok(missing.length > 0);
  assert.ok(missing.some((field) => field.id === "plan_proxima_sesion"));
});

test("la nota histórica se genera desde la copia estructurada de la plantilla", () => {
  const fields = sanitizeSessionNoteFields([
    { id: "observacion", label: "Observación objetiva", guidance: "", required: true },
    { id: "plan", label: "Plan", guidance: "", required: true },
  ]);
  const values = normalizeSessionNoteValues({ observacion: "Realizó 8 de 10 respuestas correctas.", plan: "Continuar adquisición." }, fields);
  assert.equal(missingRequiredSessionNoteFields(fields, values).length, 0);
  assert.equal(formatSessionNoteText(fields, values), "Observación objetiva\nRealizó 8 de 10 respuestas correctas.\n\nPlan\nContinuar adquisición.");
});

test("los campos creados desde cero reciben identificadores únicos y límites seguros", () => {
  const fields = sanitizeSessionNoteFields([
    { id: "campo", label: "A", guidance: "", required: true },
    { id: "campo", label: "B", guidance: "", required: false },
  ]);
  assert.equal(fields.length, 2);
  assert.notEqual(fields[0].id, fields[1].id);
});
