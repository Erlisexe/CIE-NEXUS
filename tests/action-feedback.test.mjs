import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionCloseRequirement, sessionStartRequirement } from "../lib/session-action-feedback.ts";

const ready = {
  loading: false,
  starting: false,
  hasPreparation: true,
  selectedTargetCount: 1,
  contextCategory: "Mesa",
  contextOther: "",
  appointmentDate: "2026-09-20",
  institutionalDate: "2026-09-20",
};

test("la preparación explica cada condición que impide iniciar", () => {
  assert.equal(sessionStartRequirement(ready), "");
  assert.match(sessionStartRequirement({ ...ready, selectedTargetCount: 0 }), /al menos un target/i);
  assert.match(sessionStartRequirement({ ...ready, contextCategory: "" }), /contexto/i);
  assert.match(sessionStartRequirement({ ...ready, contextCategory: "Otro" }), /Describe el contexto/i);
  assert.match(sessionStartRequirement({ ...ready, appointmentDate: "2026-09-04" }), /sólo puede iniciarse en esa fecha/i);
});

test("el cierre explica la primera condición y resume las restantes", () => {
  assert.match(sessionCloseRequirement(false, []), /Registra al menos un dato/i);
  assert.equal(sessionCloseRequirement(true, []), "");
  assert.equal(sessionCloseRequirement(true, ["Completa la nota."]), "Completa la nota.");
  assert.match(sessionCloseRequirement(true, ["Completa la nota.", "Traza la firma."]), /falta 1 requisito/i);
});

test("el error del servidor queda dentro de la preparación además del aviso global", () => {
  const setup = readFileSync(new URL("../app/components/real-session-collector.tsx", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../app/components/intervention-session-manager.tsx", import.meta.url), "utf8");
  const launcher = readFileSync(new URL("../app/components/today-session-launcher.tsx", import.meta.url), "utf8");
  assert.match(setup, /actionError[\s\S]*role="alert"/);
  assert.match(manager, /setRealStartError\(message\)[\s\S]*notify\(message\)/);
  assert.match(launcher, /setStartError\(message\)[\s\S]*notify\(message\)/);
  assert.match(setup, /aria-describedby=.*real-session-start/);
  assert.match(setup, /aria-describedby=.*real-close-requirement/);
});
