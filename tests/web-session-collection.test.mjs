import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { normalizeCriteria } from '../lib/clinical-mastery.ts';
import {
  closeCollectionDraft,
  collectionDateTime,
  collectionPayload,
  isDuplicateTrialTap,
  targetDefinition,
  voidLastObservation,
} from '../lib/mobile-collection.ts';
import { syncWebCollection } from '../lib/mobile-collection-server.ts';
import {
  discardWebCollectionDraft,
  prepareWebCollection,
  prepareTodayWebCollection,
  saveWebCollectionDraft,
  startWebCollection,
  webDraftHasData,
} from '../lib/web-session-collection-server.ts';

const actor = { id: 'professional-web', displayName: 'Terapeuta Piloto', role: 'terapeuta', assignedProfileIds: ['child-web'], permissions: ['sessions.record', 'abc.record'] };
const today = collectionDateTime(new Date()).date;

function fixture({ maintenance = false } = {}) {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter((file) => file.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  sql.exec('PRAGMA foreign_keys=ON');
  const customFields = JSON.stringify([
    { label: 'Alergias', value: 'Maní' },
    { label: 'Medicamentos', value: 'Medicamento de prueba' },
    { label: 'Refuerzos preferidos', value: 'Burbujas' },
  ]);
  sql.prepare('INSERT INTO personnel_profiles(id,full_name,site,custom_fields) VALUES (?,?,?,?)').run('child-web', 'Niño piloto ficticio', 'León', customFields);
  sql.prepare('INSERT INTO intervention_programs(id,profile_id,name,participant_name,site,objective,instructions) VALUES (?,?,?,?,?,?,?)').run('program-web', 'child-web', 'Comunicación', 'Niño piloto ficticio', 'León', 'Pedir ayuda', 'Enseñanza naturalista');
  const criteria = normalizeCriteria({ baseline: { threshold: 50, minTrials: 2, requiredSessions: 1 } }, 'discrete_trials');
  const sessionConfig = JSON.stringify({ discriminativeStimulus: '¿Qué necesitas?', teachingInstructions: 'Espere tres segundos y use la ayuda mínima.', taskSteps: [], intervalSeconds: 30, maintenanceProbeEveryDays: 7 });
  sql.prepare('INSERT INTO intervention_targets(id,program_id,code,name,specific_objective,measurement,state,criteria,session_config) VALUES (?,?,?,?,?,?,?,?,?)').run('target-web', 'program-web', 'T01', 'Pedir ayuda', 'Pedirá ayuda de forma observable.', 'discrete_trials', maintenance ? 'maintenance' : 'baseline', JSON.stringify(criteria), sessionConfig);
  sql.prepare('INSERT INTO session_appointments(id,profile_id,professional_account_id,site,session_date,start_time,end_time,created_by_account_id) VALUES (?,?,?,?,?,?,?,?)').run('appointment-web', 'child-web', actor.id, 'León', today, '09:00', '10:00', actor.id);
  if (maintenance) {
    const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    sql.prepare('INSERT INTO intervention_sessions(id,program_id,session_date,context,notes,status,results,transitions,professional_account_id,created_at,updated_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'history-web', 'program-web', yesterday.toISOString().slice(0, 10), 'Mesa', '', 'closed', JSON.stringify([{ targetId: 'target-web', sampled: true, value: 100, correct: 1, opportunities: 1, trials: [1], trialDetails: [{ id: randomUUID(), at: yesterday.toISOString(), responseCode: 'I' }], note: '', stateAtSession: 'maintenance', criterionStatus: 'met', criterionReason: '' }]), '[]', actor.id, yesterday.toISOString(), yesterday.toISOString(), yesterday.toISOString(),
    );
  }
  const db = {
    prepare(query) {
      return { query, values: [], bind(...values) { this.values = values; return this; }, async all() { return { results: sql.prepare(query).all(...this.values) }; }, async first() { return sql.prepare(query).get(...this.values) || null; } };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        for (const statement of statements) sql.prepare(statement.query).all(...statement.values);
        sql.exec('COMMIT');
        return [];
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sql, db };
}

async function start(f, overrides = {}) {
  return startWebCollection(f.db, actor, {
    profileId: 'child-web', appointmentId: 'appointment-web', sessionDate: today,
    contextCategory: 'Mesa', contextOther: '', noteTemplateId: 'cie-nexus-aba-session-note-general-v1', selectedTargetIds: ['target-web'],
    ...overrides,
  });
}

test('la toma web prepara alertas, congela targets y crea un único borrador persistente', async () => {
  const f = fixture();
  const prepared = await prepareWebCollection(f.db, actor, 'child-web', 'appointment-web');
  assert.deepEqual(prepared.preparation.profile.clinicalAlerts, { allergies: 'Maní', medications: 'Medicamento de prueba', reinforcers: 'Burbujas' });
  assert.equal(prepared.preparation.programs[0].targets[0].sessionConfig.discriminativeStimulus, '¿Qué necesitas?');
  const opened = await start(f);
  assert.equal(opened.draft.preparation.programs[0].targets.length, 1);
  assert.equal(f.sql.prepare("SELECT status FROM session_appointments WHERE id='appointment-web'").get().status, 'in_progress');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM clinical_session_runs').get().n, 1);
  const resumed = await start(f);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.draft.id, opened.draft.id);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM clinical_session_runs').get().n, 1);
  f.sql.close();
});

test('Deshacer persiste el ensayo como anulado y mantiene agregado y eventos activos en acuerdo', async () => {
  const f = fixture();
  const draft = structuredClone((await start(f)).draft);
  const target = draft.preparation.programs[0].targets[0];
  const responses = ['I', 'G', 'X', 'V'];
  draft.captures[target.id] = { targetId: target.id, definition: targetDefinition(target), note: '', opportunities: 4, timerStartedAt: null, observations: responses.map((responseCode, index) => ({ id: randomUUID(), at: new Date(Date.parse(draft.startedAt) + index + 1).toISOString(), value: responseCode === 'I' ? 1 : 0, responseCode })) };
  const voidedAt = new Date(Date.parse(draft.startedAt) + 10).toISOString();
  draft.captures[target.id] = voidLastObservation(draft.captures[target.id], voidedAt, actor.id);
  await saveWebCollectionDraft(f.db, actor, draft);
  const stored = JSON.parse(f.sql.prepare("SELECT collection_snapshot FROM clinical_session_runs WHERE source='web' AND status='draft'").get().collection_snapshot);
  assert.equal(stored.captures[target.id].opportunities, 3);
  assert.equal(stored.captures[target.id].observations.length, 4);
  assert.deepEqual(stored.captures[target.id].observations.at(-1), { ...draft.captures[target.id].observations.at(-1), removedAt: voidedAt, voided: true, voidedAt, voidedByAccountId: actor.id, voidReason: 'undo_last_trial' });
  assert.deepEqual(stored.captures[target.id].observations.filter((event) => !event.voided && !event.removedAt).map((event) => event.responseCode), ['I', 'G', 'X']);
  f.sql.close();
});

test('ensayos, ABC, firma y cierre web se guardan atómicamente y evalúan el criterio', async () => {
  const f = fixture();
  const { draft: original } = await start(f);
  const draft = structuredClone(original);
  const target = draft.preparation.programs[0].targets[0];
  const firstAt = new Date(Math.max(Date.now(), Date.parse(draft.startedAt) + 10)).toISOString();
  const secondAt = new Date(Date.parse(firstAt) + 10).toISOString();
  draft.captures[target.id] = { targetId: target.id, definition: targetDefinition(target), note: 'Ensayos de prueba', opportunities: 2, timerStartedAt: null, frequencyObservationStartedAt: null, frequencyObservationElapsedMs: 0, observations: [
    { id: randomUUID(), at: firstAt, value: 0, responseCode: 'G' },
    { id: randomUUID(), at: secondAt, value: 1, responseCode: 'I' },
  ] };
  const abcAt = new Date(Date.parse(secondAt) + 10).toISOString();
  const local = collectionDateTime(abcAt);
  draft.abc.push({ id: randomUUID(), at: abcAt, eventDate: local.date, eventTime: local.time, programId: 'program-web', targetId: target.id, antecedent: 'Se presentó el SD', behavior: 'Pidió ayuda', consequence: 'Recibió apoyo', intensity: 2, context: 'Mesa', activity: 'Juego', note: '' });
  for (const field of draft.template.fields) draft.noteValues[field.id] = 'Dato clínico ficticio y observable.';
  draft.closing = { activities: 'Juego estructurado', incidents: 'No hubo incidentes.', guardianPresent: true, guardianName: 'Tutor ficticio', concernPresent: false, concernNote: '', coordinatorName: '' };
  await saveWebCollectionDraft(f.db, actor, draft);
  const end = new Date(Date.parse(abcAt) + 10).toISOString();
  draft.signature = { version: 1, accountId: actor.id, name: actor.displayName, signedAt: end, attested: true, strokes: [[{ x: .1, y: .5 }, { x: .4, y: .2 }, { x: .8, y: .6 }]] };
  const closed = closeCollectionDraft(draft, end, randomUUID);
  const receipt = await syncWebCollection(f.db, actor, collectionPayload(closed));
  assert.equal(receipt.status, 'closed');
  assert.equal(f.sql.prepare("SELECT status FROM session_appointments WHERE id='appointment-web'").get().status, 'completed');
  const result = JSON.parse(f.sql.prepare('SELECT results FROM intervention_sessions').get().results)[0];
  assert.deepEqual(result.trialDetails.map((trial) => trial.responseCode), ['G', 'I']);
  assert.equal(result.criterionStatus, 'met');
  const transitions = JSON.parse(f.sql.prepare('SELECT transitions FROM intervention_sessions').get().transitions);
  assert.deepEqual(transitions.map(({ from, to }) => [from, to]), [['baseline', 'generalization']]);
  assert.equal(f.sql.prepare("SELECT state FROM intervention_targets WHERE id='target-web'").get().state, 'generalization');
  assert.equal(f.sql.prepare("SELECT mastery_method FROM target_mastery_events WHERE target_id='target-web'").get().mastery_method, 'baseline');
  assert.equal(f.sql.prepare('SELECT intensity FROM abc_records').get().intensity, 2);
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM clinical_data_audit WHERE action='web_close'").get().n, 1);
  f.sql.close();
});

test('una sesión web vacía se puede descartar, pero una con datos no', async () => {
  const empty = fixture();
  const emptyDraft = (await start(empty)).draft;
  await discardWebCollectionDraft(empty.db, actor, emptyDraft.id);
  assert.equal(empty.sql.prepare('SELECT count(*) AS n FROM clinical_session_runs').get().n, 0);
  assert.equal(empty.sql.prepare("SELECT status FROM session_appointments WHERE id='appointment-web'").get().status, 'scheduled');
  empty.sql.close();

  const used = fixture();
  const usedDraft = structuredClone((await start(used)).draft);
  const target = usedDraft.preparation.programs[0].targets[0];
  usedDraft.captures[target.id] = { targetId: target.id, definition: targetDefinition(target), note: '', opportunities: 1, timerStartedAt: null, observations: [{ id: randomUUID(), at: new Date().toISOString(), value: 1, responseCode: 'I' }] };
  await saveWebCollectionDraft(used.db, actor, usedDraft);
  await assert.rejects(discardWebCollectionDraft(used.db, actor, usedDraft.id), (error) => error.code === 'draft_has_data');
  assert.equal(used.sql.prepare('SELECT count(*) AS n FROM clinical_session_runs').get().n, 1);
  used.sql.close();
});

test('mantenimiento sólo se ofrece cuando toca la sonda y Otro exige contexto', async () => {
  const f = fixture({ maintenance: true });
  const prepared = await prepareWebCollection(f.db, actor, 'child-web', 'appointment-web');
  assert.equal(prepared.preparation.programs[0].targets[0].maintenanceDue, false);
  await assert.rejects(start(f), (error) => error.code === 'maintenance_not_due');
  const other = fixture();
  await assert.rejects(start(other, { contextCategory: 'Otro', contextOther: '' }), (error) => error.code === 'context_required');
  f.sql.close(); other.sql.close();
});

test('los relojes activos cuentan como datos y el filtro evita duplicar un doble toque', () => {
  const f = fixture();
  const shell = { captures: { frequency: { targetId: 'frequency', definition: 'x', note: '', opportunities: 0, timerStartedAt: null, frequencyObservationStartedAt: new Date().toISOString(), frequencyObservationElapsedMs: 0, observations: [] } }, abc: [], noteValues: {}, closing: { activities: '', incidents: '', guardianPresent: false, guardianName: '', concernPresent: false, concernNote: '', coordinatorName: '' } };
  assert.equal(webDraftHasData(shell), true);
  assert.equal(isDuplicateTrialTap({ targetId: 'target-web', at: 1000 }, 'target-web', 1250), true);
  assert.equal(isDuplicateTrialTap({ targetId: 'target-web', at: 1000 }, 'target-web', 1500), false);
  assert.equal(isDuplicateTrialTap({ targetId: 'otro', at: 1000 }, 'target-web', 1100), false);
  f.sql.close();
});

test('la interfaz real conserva los controles clínicos solicitados y no usa la pantalla de práctica', () => {
  const source = readFileSync(new URL('../app/components/real-session-collector.tsx', import.meta.url), 'utf8');
  for (const text of ['Mesa', 'Piso', 'Patio', 'Baño', 'Comedor', 'Comunidad', 'Otro', 'Tomar', 'Hoja', 'Independiente', 'Física parcial', 'Física total', 'Ocurrió', 'No ocurrió', 'Registrar ABC', 'Firma del terapeuta']) assert.match(source, new RegExp(text));
  assert.match(source, /acquisitionCount > 5/);
  assert.match(source, /beforeunload/);
  assert.doesNotMatch(source, /Mateo R\./);
});


test('el acceso desde el niño encuentra la cita propia de hoy sin permiso de calendario', async () => {
  const f = fixture();
  const result = await prepareTodayWebCollection(f.db, actor, 'child-web');
  assert.equal(result.preparation.appointment.id, 'appointment-web');
  assert.equal(result.draft, null);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM clinical_session_runs').get().n, 0);
  f.sql.close();
});

test('el acceso de hoy excluye otras fechas, profesionales, canceladas, completadas y niños archivados', async () => {
  for (const change of [
    "UPDATE session_appointments SET session_date='2000-01-01'",
    "UPDATE session_appointments SET session_date='2099-01-01'",
    "UPDATE session_appointments SET professional_account_id='other-professional'",
    "UPDATE session_appointments SET status='cancelled'",
    "UPDATE session_appointments SET status='completed'",
    "UPDATE personnel_profiles SET status='archived'",
  ]) {
    const f = fixture(); f.sql.exec(change);
    await assert.rejects(prepareTodayWebCollection(f.db, actor, 'child-web'), (error) => error.code === 'appointment_required_today');
    await assert.rejects(prepareTodayWebCollection(f.db, actor, 'child-web', 'appointment-web'), (error) => error.code === 'appointment_unavailable_today');
    f.sql.close();
  }
});

test('dos citas del mismo día exigen elegir y la selección se vuelve a validar', async () => {
  const f = fixture();
  f.sql.prepare('INSERT INTO session_appointments(id,profile_id,professional_account_id,site,session_date,start_time,end_time,created_by_account_id) VALUES (?,?,?,?,?,?,?,?)').run('appointment-second', 'child-web', actor.id, 'León', today, '11:00', '12:00', actor.id);
  const choice = await prepareTodayWebCollection(f.db, actor, 'child-web');
  assert.equal(choice.preparation, null);
  assert.deepEqual(choice.appointments.map((item) => item.id), ['appointment-web', 'appointment-second']);
  const chosen = await prepareTodayWebCollection(f.db, actor, 'child-web', 'appointment-second');
  assert.equal(chosen.preparation.appointment.id, 'appointment-second');
  f.sql.exec("UPDATE session_appointments SET status='cancelled' WHERE id='appointment-second'");
  await assert.rejects(prepareTodayWebCollection(f.db, actor, 'child-web', 'appointment-second'), (error) => error.code === 'appointment_unavailable_today');
  f.sql.close();
});

test('entrar desde el niño retoma el mismo borrador web y conserva los ensayos', async () => {
  const f = fixture();
  const { draft } = await start(f);
  const target = draft.preparation.programs[0].targets[0];
  draft.captures[target.id] = { targetId: target.id, definition: targetDefinition(target), note: '', opportunities: 1, timerStartedAt: null, observations: [{ id: randomUUID(), at: new Date().toISOString(), value: 1, responseCode: 'I' }] };
  await saveWebCollectionDraft(f.db, actor, draft);
  const resumed = await prepareTodayWebCollection(f.db, actor, 'child-web');
  assert.equal(resumed.draft.id, draft.id);
  assert.equal(resumed.draft.captures[target.id].observations.length, 1);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM clinical_session_runs').get().n, 1);
  f.sql.close();
});

test('el acceso directo mantiene permisos y alcance de las sesiones sin cita', async () => {
  const f = fixture();
  await assert.rejects(prepareTodayWebCollection(f.db, { ...actor, permissions: ['sessions.view'] }, 'child-web'), (error) => error.code === 'permission_denied');
  f.sql.exec('DELETE FROM session_appointments');
  const coordinator = { ...actor, role: 'coordinador' };
  const ready = await prepareTodayWebCollection(f.db, coordinator, 'child-web');
  assert.equal(ready.preparation.appointment, null);
  await assert.rejects(prepareTodayWebCollection(f.db, { ...coordinator, assignedProfileIds: [] }, 'child-web'), (error) => error.code === 'profile_out_of_scope');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM session_appointments').get().n, 0);
  f.sql.close();
});
