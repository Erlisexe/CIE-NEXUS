import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { collectionHash, prepareMobileCollection, syncMobileCollection } from '../lib/mobile-collection-server.ts';
import { createCollectionDraft, closeCollectionDraft, collectionPayload, targetDefinition, capturedResult, reviewCollectionConfiguration, stopCollectionClocks, validateCollectionPayload } from '../lib/mobile-collection.ts';
import { normalizeCriteria } from '../lib/clinical-mastery.ts';

const actor = { id: 'professional-1', displayName: 'Prueba aislada', role: 'terapeuta', assignedProfileIds: ['child-1'], permissions: ['sessions.record', 'abc.record'] };
function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  sql.exec('PRAGMA foreign_keys=ON');
  sql.prepare("INSERT INTO personnel_profiles(id,full_name,site) VALUES ('child-1','Caso aislado','León'),('child-2','Otro caso aislado','León')").run();
  for (const id of ['p1','p2']) {
    sql.prepare('INSERT INTO intervention_programs(id,profile_id,name,participant_name,site,objective,instructions) VALUES (?,?,?,?,?,?,?)').run(id,'child-1',id,'Caso aislado','León','Objetivo','Instrucciones');
    const criteria = normalizeCriteria({ baseline: { threshold:90,minTrials:10 } });
    sql.prepare('INSERT INTO intervention_targets(id,program_id,code,name,specific_objective,measurement,criteria) VALUES (?,?,?,?,?,?,?)').run(id+'t',id,'T1','Target','Objetivo','occurrence',JSON.stringify(criteria));
  }
  const addAppointment = (id='a1', date='2026-09-01', professional=actor.id) => sql.prepare('INSERT INTO session_appointments(id,profile_id,professional_account_id,site,session_date,start_time,end_time,created_by_account_id) VALUES (?,?,?,?,?,?,?,?)').run(id,'child-1',professional,'León',date,'09:00','10:00',actor.id);
  addAppointment();
  const db = {
    beforeBatch: null, failAt: -1,
    prepare(query) {
      return { query, values: [], bind(...v) { this.values=v; return this; }, async all() { return { results: sql.prepare(query).all(...this.values) }; }, async first() { return sql.prepare(query).get(...this.values) || null; } };
    },
    async batch(statements) {
      if(this.beforeBatch) { const fn=this.beforeBatch; this.beforeBatch=null; fn(); }
      sql.exec('BEGIN');
      try {
        for(let i=0;i<statements.length;i++) { if(i===this.failAt) throw new Error('Injected interruption'); const s=statements[i]; sql.prepare(s.query).all(...s.values); }
        sql.exec('COMMIT'); return [];
      } catch(e) { sql.exec('ROLLBACK'); throw e; }
    }
  };
  return {sql,db,addAppointment,count:(table)=>sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n};
}
async function payloadFor(f, {appointment='a1',date='2026-09-01',correct=9,total=10,programs=2}={}) {
  const prep=await prepareMobileCollection(f.db,actor,'child-1',appointment);
  const d=createCollectionDraft(prep,randomUUID(),`${date}T15:00:00.000Z`);
  d.preflight={version:1,accountId:actor.id,profileId:'child-1',checkedAt:d.startedAt,timing:'before_start',checks:{identity:true,programs:true,materials:true}};
  d.signature={version:1,accountId:actor.id,name:actor.displayName,signedAt:`${date}T16:00:00.000Z`,attested:true,strokes:[[{x:0.1,y:0.5},{x:0.4,y:0.2},{x:0.8,y:0.6}]]};
  for(const p of prep.programs.slice(0,programs)) for(const t of p.targets) d.captures[t.id]={targetId:t.id,definition:targetDefinition(t),opportunities:total,timerStartedAt:null,note:'',observations:Array.from({length:total},(_,i)=>({id:randomUUID(),at:`${date}T15:01:${String(i%60).padStart(2,'0')}.000Z`,value:i<correct?1:0}))};
  for(const field of d.template.fields) d.noteValues[field.id]='Descripción de prueba en memoria.';
  d.abc=[{id:randomUUID(),at:`${date}T15:20:00.000Z`,eventDate:date,eventTime:'09:20',programId:'p1',targetId:'p1t',antecedent:'A',behavior:'B',consequence:'C',context:'León',activity:'Actividad',note:''}];
  return collectionPayload(closeCollectionDraft(d,`${date}T16:00:00.000Z`,randomUUID));
}

test('cierre multiprograma atómico: un encuentro, dos programas, ABC y dominio único',async()=>{
  const f=fixture(); const payload=await payloadFor(f); const receipt=await syncMobileCollection(f.db,actor,payload);
  assert.equal(receipt.sessionIds.length,2); assert.equal(f.count('clinical_session_runs'),1); assert.equal(f.count('intervention_sessions'),2); assert.equal(f.count('abc_records'),1); assert.equal(f.count('target_mastery_events'),2);
  assert.equal(f.sql.prepare("SELECT status FROM session_appointments WHERE id='a1'").get().status,'completed');
  const run=f.sql.prepare('SELECT * FROM clinical_session_runs').get(); assert.equal(run.duration_seconds,3600); assert.equal(JSON.parse(run.collection_snapshot).captures.p1t.observations.length,10);
  const again=await syncMobileCollection(f.db,actor,JSON.parse(JSON.stringify(payload))); assert.equal(again.duplicate,true); assert.equal(f.count('clinical_session_runs'),1); assert.equal(f.count('abc_records'),1); assert.equal(f.count('target_mastery_events'),2);
  f.sql.close();
});
test('reenvío con el mismo id y diferente contenido se rechaza',async()=>{
  const f=fixture(),p=await payloadFor(f); await syncMobileCollection(f.db,actor,p); p.context='Otro contexto';
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='idempotency_conflict'); assert.equal(f.count('clinical_session_runs'),1); f.sql.close();
});
test('interrupción a mitad del lote no deja sesiones, ABC ni dominio parciales',async()=>{
  const f=fixture(),p=await payloadFor(f); f.db.failAt=11;
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='sync_retry');
  for(const table of ['clinical_session_runs','intervention_sessions','target_mastery_events','abc_records','clinical_data_audit']) assert.equal(f.count(table),0,table);
  assert.equal(f.sql.prepare("SELECT status FROM session_appointments WHERE id='a1'").get().status,'scheduled');
  f.db.failAt=-1; await syncMobileCollection(f.db,actor,p); assert.equal(f.count('clinical_session_runs'),1); f.sql.close();
});
test('cambio concurrente en la cita aborta el lote y conserva el cambio externo',async()=>{
  const f=fixture(),p=await payloadFor(f); f.db.beforeBatch=()=>f.sql.exec("UPDATE session_appointments SET status='cancelled' WHERE id='a1'");
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='sync_retry'); assert.equal(f.count('clinical_session_runs'),0);
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='appointment_conflict'); f.sql.close();
});
test('9/9 con mínimo 10 se conserva como 100% sin dominio',async()=>{
  const f=fixture(),p=await payloadFor(f,{correct:9,total:9}); await syncMobileCollection(f.db,actor,p);
  const r=JSON.parse(f.sql.prepare("SELECT results FROM intervention_sessions WHERE program_id='p1'").get().results)[0];
  assert.equal(r.value,100); assert.equal(r.trials.length,9); assert.equal(r.criterionStatus,'insufficient_sample'); assert.equal(f.count('target_mastery_events'),0); f.sql.close();
});
test('el mínimo no limita el registro: 11/12 se evalúa y cierra Línea Base',async()=>{
  const f=fixture(),p=await payloadFor(f,{correct:11,total:12}); await syncMobileCollection(f.db,actor,p);
  const r=JSON.parse(f.sql.prepare("SELECT results FROM intervention_sessions WHERE program_id='p1'").get().results)[0];
  assert.equal(r.value,91.7); assert.equal(r.trials.length,12); assert.equal(f.count('target_mastery_events'),2); f.sql.close();
});
test('8/10 lleva a Adquisición sin dominio',async()=>{
  const f=fixture(),p=await payloadFor(f,{correct:8,total:10}); await syncMobileCollection(f.db,actor,p);
  assert.equal(f.count('target_mastery_events'),0); assert.equal(f.sql.prepare("SELECT state FROM intervention_targets WHERE id='p1t'").get().state,'acquisition'); f.sql.close();
});
test('permisos, asignación y profesional se verifican al sincronizar',async()=>{
  const f=fixture(),p=await payloadFor(f);
  await assert.rejects(syncMobileCollection(f.db,{...actor,permissions:[]},p),e=>e.code==='permission_denied');
  await assert.rejects(syncMobileCollection(f.db,{...actor,id:'otro'},p),e=>e.code==='collector_mismatch');
  await assert.rejects(syncMobileCollection(f.db,{...actor,permissions:['sessions.record']},p),e=>e.code==='abc_permission_denied');
  f.sql.exec("UPDATE session_appointments SET professional_account_id='otro' WHERE id='a1'");
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='appointment_out_of_scope'); assert.equal(f.count('clinical_session_runs'),0); f.sql.close();
});
test('los roles superiores tampoco obtienen acceso móvil global',async()=>{
  const f=fixture(); await assert.rejects(prepareMobileCollection(f.db,{...actor,role:'direccion_clinica',assignedProfileIds:[]},'child-2',null),e=>e.code==='profile_out_of_scope');
  await assert.rejects(prepareMobileCollection(f.db,actor,'child-1',null),e=>e.code==='appointment_required'); f.sql.close();
});
test('criterio o plantilla alterados se rechazan antes de guardar',async()=>{
  const f=fixture(),p=await payloadFor(f); p.template.fields[0].required=false;
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='template_changed');
  const p2=await payloadFor(f); f.sql.exec("UPDATE intervention_targets SET criteria='{}' WHERE id='p1t'");
  await assert.rejects(syncMobileCollection(f.db,actor,p2),e=>e.code==='configuration_changed'); assert.equal(f.count('clinical_session_runs'),0); f.sql.close();
});
test('targets o ensayos duplicados no pueden inflar resultados',async()=>{
  const f=fixture(),p=await payloadFor(f); p.captures.p1t.observations.push(p.captures.p1t.observations[0]);
  assert.throws(()=>validateCollectionPayload(p),e=>e.code==='invalid_collection');
  const p2=await payloadFor(f); p2.preparation.programs[0].targets.push(p2.preparation.programs[0].targets[0]);
  assert.throws(()=>validateCollectionPayload(p2),e=>e.code==='invalid_collection'); f.sql.close();
});
test('recuperación de relojes y deshacer conservan la evidencia de captura',async()=>{
  const f=fixture(); const prep=await prepareMobileCollection(f.db,actor,'child-1','a1'); const t=prep.programs[0].targets[0];
  let d=createCollectionDraft(prep,randomUUID(),'2026-09-01T15:00:00.000Z');
  d.captures[t.id]={targetId:t.id,definition:targetDefinition(t),note:'',opportunities:1,timerStartedAt:'2026-09-01T15:00:05.000Z',observations:[]};
  d=stopCollectionClocks(d,'2026-09-01T15:00:15.000Z',randomUUID);
  assert.equal(d.elapsedMs,15000); assert.equal(d.runningSince,null); assert.equal(d.captures[t.id].observations[0].value,10);
  d.captures[t.id].observations=[{id:randomUUID(),at:'2026-09-01T15:00:01.000Z',value:1,removedAt:'2026-09-01T15:00:05.000Z'},{id:randomUUID(),at:'2026-09-01T15:00:02.000Z',value:0}];
  assert.deepEqual(capturedResult(t,d.captures[t.id]).trials,[0]); assert.equal(d.captures[t.id].observations.length,2); f.sql.close();
});

test('dos reenvíos simultáneos de la misma sesión obtienen un único recibo',async()=>{
  const f=fixture(),p=await payloadFor(f);
  const receipts=await Promise.all([syncMobileCollection(f.db,actor,p),syncMobileCollection(f.db,actor,p)]);
  assert.equal(receipts[0].id,receipts[1].id); assert.equal(f.count('clinical_session_runs'),1); assert.equal(f.count('abc_records'),1); f.sql.close();
});
test('una sesión offline anterior exige confirmar el impacto histórico y no duplica dominio',async()=>{
  const f=fixture(); f.addAppointment('a2','2026-09-02');
  const earlier=await payloadFor(f),later=await payloadFor(f,{appointment:'a2',date:'2026-09-02'});
  await syncMobileCollection(f.db,actor,later);
  await assert.rejects(syncMobileCollection(f.db,actor,earlier),e=>e.code==='historical_mastery_review');
  assert.equal(f.count('clinical_session_runs'),1); earlier.confirmHistoricalImpact=true;
  await syncMobileCollection(f.db,actor,earlier);
  assert.equal(f.count('target_mastery_events'),2);
  assert.equal(f.sql.prepare("SELECT mastered_at FROM target_mastery_events WHERE target_id='p1t'").get().mastered_at,'2026-09-01');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM clinical_data_audit WHERE action='mobile_close_historical_confirmed'").get().n,1); f.sql.close();
});
test('una cita de otro día no puede cambiar la fecha real de los datos',async()=>{
  const f=fixture(),p=await payloadFor(f);
  f.sql.exec("UPDATE session_appointments SET session_date='2026-09-02' WHERE id='a1'");
  await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='appointment_date_mismatch');
  assert.equal(f.count('clinical_session_runs'),0); f.sql.close();
});
test('un ABC de un programa sin resultados nunca se enlaza a la sesión de otro programa',async()=>{
  const f=fixture(),p=await payloadFor(f,{programs:1});p.abc[0].programId='p2';p.abc[0].targetId='p2t';
  await syncMobileCollection(f.db,actor,p);const a=f.sql.prepare('SELECT * FROM abc_records').get();
  assert.equal(a.program_id,'p2');assert.equal(a.target_id,'p2t');assert.equal(a.session_id,null);assert.equal(a.appointment_id,'a1');f.sql.close();
});
test('la fecha y hora del ABC deben corresponder al evento en Nicaragua',async()=>{
  const f=fixture(),p=await payloadFor(f);p.abc[0].eventDate='2026-08-01';
  assert.throws(()=>validateCollectionPayload(p),e=>e.code==='invalid_collection');f.sql.close();
});
test('el servidor exige checklist completo y firma de la misma cuenta',async()=>{
  const f=fixture();
  for(const corrupt of [p=>{delete p.signature;},p=>{p.preflight.checks.identity=false;},p=>{p.signature.accountId='otra-cuenta';},p=>{p.signature.strokes=[[{x:0.5,y:0.5}]];}]){
    const p=await payloadFor(f);corrupt(p);await assert.rejects(syncMobileCollection(f.db,actor,p),e=>e.code==='session_review_required');assert.equal(f.count('clinical_session_runs'),0);
  }f.sql.close();
});
test('la firma y el checklist se conservan dentro del contenido verificado y auditado',async()=>{
  const f=fixture(),p=await payloadFor(f);await syncMobileCollection(f.db,actor,p);
  const r=f.sql.prepare('SELECT collection_snapshot,payload_hash FROM clinical_session_runs').get(),saved=JSON.parse(r.collection_snapshot);
  assert.deepEqual(saved.signature,p.signature);assert.deepEqual(saved.preflight,p.preflight);assert.equal(r.payload_hash,await collectionHash(p));
  const audit=JSON.parse(f.sql.prepare("SELECT after_snapshot FROM clinical_data_audit WHERE resource_type='clinical_session_run'").get().after_snapshot);
  assert.equal(audit.signedByAccountId,actor.id);assert.equal(audit.preflightTiming,'before_start');f.sql.close();
});
test('un recibo de v0.3.0 ya confirmado sigue siendo idempotente sin inventar una firma',async()=>{
  const f=fixture(),p=await payloadFor(f);await syncMobileCollection(f.db,actor,p);delete p.preflight;delete p.signature;
  f.sql.prepare('UPDATE clinical_session_runs SET collection_snapshot=?,payload_hash=? WHERE id=?').run(JSON.stringify(p),await collectionHash(p),p.id);
  const r=await syncMobileCollection(f.db,actor,p);assert.equal(r.duplicate,true);assert.equal(f.count('clinical_session_runs'),1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT collection_snapshot FROM clinical_session_runs').get().collection_snapshot).signature,undefined);f.sql.close();
});
test('revisar un borrador antiguo preserva fecha de captura, ensayos y cierre original',async()=>{
  const f=fixture(),p=await payloadFor(f);
  const d={...p,elapsedMs:p.durationSeconds*1000,runningSince:null,status:'conflict',syncErrorCode:'session_review_required',syncError:'',syncedAt:null,lastActiveAt:p.endedAt};
  d.preflight={...p.preflight,checkedAt:'2026-09-02T17:00:00Z',timing:'recovered_draft'};d.signature={...p.signature,signedAt:'2026-09-02T17:00:00Z'};
  const reviewed=closeCollectionDraft(d,'2026-09-02T17:00:00Z',randomUUID);assert.equal(reviewed.endedAt,p.endedAt);assert.equal(reviewed.startedAt,p.startedAt);assert.deepEqual(reviewed.captures,p.captures);
  await syncMobileCollection(f.db,actor,collectionPayload(reviewed));assert.equal(f.count('clinical_session_runs'),1);f.sql.close();
});
test('un envío pendiente no se puede volver a cerrar con otro contenido',async()=>{
  const f=fixture(),p=await payloadFor(f),d={...p,elapsedMs:p.durationSeconds*1000,runningSince:null,status:'pending'};
  assert.throws(()=>closeCollectionDraft(d,'2026-09-02T17:00:00Z',randomUUID),e=>e.code==='immutable_submission');f.sql.close();
});
test('actualizar criterios de un cierre conserva fechas, duración, ABC y observaciones',async()=>{
  const f=fixture(),p=await payloadFor(f);
  const d={...p,elapsedMs:p.durationSeconds*1000,runningSince:null,status:'conflict',syncErrorCode:'configuration_changed',syncError:'',syncedAt:null,lastActiveAt:p.endedAt};
  f.sql.exec("UPDATE intervention_programs SET instructions='Instrucciones revisadas' WHERE id='p1'");
  const fresh=await prepareMobileCollection(f.db,actor,'child-1','a1');
  const reviewed=reviewCollectionConfiguration(d,fresh);
  for(const key of ['startedAt','endedAt','elapsedMs','abc','noteValues'])assert.deepEqual(reviewed[key],d[key],key);
  assert.equal(reviewed.status,'conflict');assert.equal(reviewed.runningSince,null);assert.equal(reviewed.signature,undefined);
  assert.deepEqual(reviewed.captures.p1t.observations,d.captures.p1t.observations);
  assert.throws(()=>closeCollectionDraft(reviewed,'2026-09-02T17:00:00Z',randomUUID),e=>e.code==='session_review_required');
  reviewed.signature={...p.signature,signedAt:'2026-09-02T17:00:00Z'};
  const closed=closeCollectionDraft(reviewed,'2026-09-02T17:00:00Z',randomUUID);
  await syncMobileCollection(f.db,actor,collectionPayload(closed));
  assert.equal(f.sql.prepare('SELECT closed_at FROM clinical_session_runs').get().closed_at,p.endedAt);f.sql.close();
});
test('revisar configuración no permite trasladar datos a otro niño ni convertir mediciones',async()=>{
  const f=fixture(),p=await payloadFor(f);
  const d={...p,elapsedMs:p.durationSeconds*1000,runningSince:null,status:'conflict'};
  for(const mutate of [x=>{x.profile.id='child-2';},x=>{x.programs[0].targets[0].measurement='duration';},x=>{x.programs[0].targets=[];}]){
    const fresh=structuredClone(p.preparation);mutate(fresh);
    assert.throws(()=>reviewCollectionConfiguration(d,fresh),e=>e.code==='configuration_changed');
    assert.deepEqual(d.captures,p.captures);assert.equal(d.endedAt,p.endedAt);
  }
  assert.throws(()=>reviewCollectionConfiguration({...d,status:'pending'},p.preparation),e=>e.code==='immutable_submission');f.sql.close();
});
test('alterar el tipo de medición no permite convertir valores numéricos en ensayos',async()=>{
  const f=fixture(),p=await payloadFor(f); p.preparation.programs[0].targets[0].measurement='frequency'; p.captures.p1t.observations[0].value=100;
  assert.throws(()=>validateCollectionPayload(p),e=>e.code==='invalid_collection'); f.sql.close();
});
