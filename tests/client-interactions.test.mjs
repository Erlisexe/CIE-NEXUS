import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { clientRequest } from '../lib/client-request.ts';
import { createLatestSaveQueue } from '../lib/latest-save-queue.ts';

test('ráfagas conservan la última instantánea sin multiplicar peticiones concurrentes', async () => {
  const sent = [], states = [], releases = [];
  const queue = createLatestSaveQueue(async snapshot => { sent.push(snapshot); await new Promise(resolve => releases.push(resolve)); }, state => states.push(state));
  queue.push({ observations: [1] });
  queue.push({ observations: [1,2] });
  queue.push({ observations: [1,2,3] });
  assert.equal(sent.length, 1);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].observations, [1,2,3]);
  assert.notEqual(states.at(-1), 'saved');
  releases.shift()();
  await queue.flush();
  assert.equal(states.at(-1), 'saved');
});

test('el guardado fallido no se anuncia guardado y admite un reintento explícito', async () => {
  let fail = true; const states = [];
  const queue = createLatestSaveQueue(async () => { if (fail) throw new Error('Sin conexión'); }, state => states.push(state));
  queue.push({ observations: [1] });
  await assert.rejects(queue.flush(), /Sin conexión/);
  assert.equal(states.at(-1), 'error');
  fail = false; queue.push({ observations: [1] }); await queue.flush();
  assert.equal(states.at(-1), 'saved');
});

test('la petición cancela una carga bloqueada con un mensaje accionable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  try { await assert.rejects(clientRequest('/qa', {}, 10), error => error.name === 'TimeoutError' && error.message.includes('conexión')); }
  finally { globalThis.fetch = original; }
});

test('cambiar de pantalla cancela la petición anterior, sin reintentar escrituras', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))); };
  try { const controller = new AbortController(); const pending = clientRequest('/qa', { method:'POST', signal: controller.signal }); controller.abort(); await assert.rejects(pending, { name:'AbortError' }); assert.equal(calls,1); }
  finally { globalThis.fetch = original; }
});

test('el límite de tiempo cubre también una respuesta cuyo cuerpo no termina', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => ({ arrayBuffer: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  try { await assert.rejects(clientRequest('/qa', {}, 10), { name:'TimeoutError' }); }
  finally { globalThis.fetch = original; }
});

test('las ventanas clínicas usan el límite compartido de foco y Escape', () => {
  for (const file of ['calendar-manager','real-session-collector','intervention-session-manager','training-system','personnel-profile-manager','graph-manager','abc-manager','account-manager','package-manager','report-manager','site-manager']) {
    const source = readFileSync(new URL(`../app/components/${file}.tsx`, import.meta.url),'utf8');
    assert.match(source, /import ModalLayer/);
    assert.doesNotMatch(source, /<div className="(?:modal-backdrop|real-session-modal|session-modal-backdrop)/);
  }
  const collector=readFileSync(new URL('../app/components/real-session-collector.tsx',import.meta.url),'utf8');
  assert.match(collector, /<ModalLayer className="real-session-overlay"/);
  assert.match(collector, /finalSubmission.current \|\| closeCollectionDraft/);
  assert.match(collector, /await saveQueue.flush\(\)/);
  assert.match(collector, /real-save-feedback" role="alert"/);
});

test('las fuentes se sirven como activos públicos y no como rutas de la máquina de build', () => {
  const layout=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../app/accessibility.css',import.meta.url),'utf8');
  assert.doesNotMatch(layout,/next\/font\/google/);
  for (const font of readdirSync(new URL('../public/fonts/',import.meta.url))) assert.ok(readFileSync(new URL('../public/fonts/'+font,import.meta.url)).length>1000);
  assert.doesNotMatch(css, /url\([^)]*(?:workspace|\.vinext)/);
  assert.match(css,/prefers-reduced-motion/);
});
