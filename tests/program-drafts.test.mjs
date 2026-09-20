import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  programDraftStorageKey,
  programFormSnapshot,
  readProgramDraft,
  removeProgramDraft,
  writeProgramDraft,
} from "../lib/program-drafts.ts";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const form = { id: "program-1", profileId: "child-1", name: "Comunicación", targets: [{ code: "T01" }] };

test("el borrador local queda aislado por cuenta y programa", () => {
  const first = programDraftStorageKey("account-1", "program-1", "child-1");
  assert.notEqual(first, programDraftStorageKey("account-2", "program-1", "child-1"));
  assert.notEqual(first, programDraftStorageKey("account-1", "program-2", "child-1"));
  assert.notEqual(programDraftStorageKey("account-1", undefined, "child-1"), programDraftStorageKey("account-1", undefined, "child-2"));
});

test("autoguarda y recupera sólo contra la misma versión del servidor", () => {
  const storage = memoryStorage();
  const key = programDraftStorageKey("account-1", form.id, form.profileId);
  const now = new Date("2026-09-20T12:00:00.000Z");
  writeProgramDraft(storage, key, { ...form, name: "Comunicación funcional" }, "server-v1", now);
  assert.equal(readProgramDraft(storage, key, "server-v1", now.getTime())?.form.name, "Comunicación funcional");
  assert.equal(readProgramDraft(storage, key, "server-v2", now.getTime()), null);
  assert.equal(storage.getItem(key), null);
});

test("descarta borradores vencidos o dañados y permite borrado explícito", () => {
  const storage = memoryStorage();
  const key = "draft";
  writeProgramDraft(storage, key, form, null, new Date("2026-08-01T00:00:00.000Z"));
  assert.equal(readProgramDraft(storage, key, null, Date.parse("2026-09-20T00:00:00.000Z")), null);
  storage.setItem(key, "{malformado");
  assert.equal(readProgramDraft(storage, key, null), null);
  writeProgramDraft(storage, key, form, null);
  removeProgramDraft(storage, key);
  assert.equal(storage.getItem(key), null);
  assert.equal(programFormSnapshot(form), JSON.stringify(form));
});

test("el editor confirma antes de descartar y muestra el autoguardado", () => {
  const source = readFileSync(new URL("../app/components/intervention-session-manager.tsx", import.meta.url), "utf8");
  assert.match(source, /Hay cambios sin guardar[\s\S]*window\.confirm/);
  assert.match(source, /writeProgramDraft\(window\.localStorage/);
  assert.match(source, /Borrador local recuperado/);
  assert.match(source, /onClose=\{closeProgramEditor\}/);
});
