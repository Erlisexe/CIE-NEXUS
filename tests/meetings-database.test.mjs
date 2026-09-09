import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync,readFileSync } from 'node:fs';
function fixture(guards=true){
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')&&(guards||!n.startsWith('0022'))).sort())db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  db.exec("INSERT INTO personnel_profiles(id,full_name,site) VALUES('child-test','Caso ficticio de agenda','León')");
  const meeting=(id,requester='a',recipient='b',start='09:00',end='09:30')=>db.prepare("INSERT INTO meeting_requests(id,requester_account_id,recipient_account_id,meeting_date,start_time,end_time,subject,description) VALUES(?,?,?,'2026-09-10',?,?,'Asunto de prueba','Descripción de prueba')").run(id,requester,recipient,start,end);
  const session=(id,professional,start='09:00',end='09:30')=>db.prepare("INSERT INTO session_appointments(id,profile_id,professional_account_id,site,session_date,start_time,end_time,created_by_account_id) VALUES(?,'child-test',?,'León','2026-09-10',?,?,'owner-test')").run(id,professional,start,end);
  return {db,meeting,session};
}
test('la base impide una segunda reserva superpuesta incluso sin la comprobación de la API',()=>{
  const f=fixture();f.meeting('m1');
  assert.throws(()=>f.meeting('m2','c','b'),/meeting_schedule_conflict/);assert.throws(()=>f.meeting('m3','c','a'),/meeting_schedule_conflict/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM meeting_requests').get().n,1);f.db.close();
});
test('agenda clínica y reuniones se bloquean mutuamente para cualquiera de los participantes',()=>{
  const f=fixture();f.session('s1','a');assert.throws(()=>f.meeting('m1'),/meeting_schedule_conflict/);
  f.meeting('m2','b','c','10:00','10:30');assert.throws(()=>f.session('s2','b','10:15','10:45'),/meeting_schedule_conflict/);f.db.close();
});
test('las franjas contiguas se aceptan y cancelar libera el espacio',()=>{
  const f=fixture();f.meeting('m1');f.meeting('m2','a','b','09:30','10:00');f.db.exec("UPDATE meeting_requests SET status='cancelled' WHERE id='m1'");f.meeting('m3');
  assert.equal(f.db.prepare('SELECT count(*) n FROM meeting_requests').get().n,3);f.db.close();
});
test('los cambios de estado conservan evidencia de creación, aceptación y cancelación',()=>{
  const f=fixture();f.meeting('m1');f.db.exec("UPDATE meeting_requests SET status='accepted' WHERE id='m1'");f.db.exec("UPDATE meeting_requests SET status='cancelled' WHERE id='m1'");
  const audit=f.db.prepare("SELECT after_snapshot FROM clinical_data_audit WHERE resource_type='meeting_request' ORDER BY rowid").all();assert.deepEqual(audit.map(a=>JSON.parse(a.after_snapshot).status),['pending','accepted','cancelled']);f.db.close();
});
test('instalar las protecciones conserva todas las reservas anteriores',()=>{
  const f=fixture(false);f.meeting('m1');f.meeting('m2','c','b');f.db.exec(readFileSync(new URL('../drizzle/0022_meeting_booking_guards.sql',import.meta.url),'utf8'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM meeting_requests').get().n,2);f.db.exec("UPDATE meeting_requests SET status='cancelled' WHERE id='m2'");assert.equal(f.db.prepare('SELECT count(*) n FROM meeting_requests').get().n,2);f.db.close();
});
