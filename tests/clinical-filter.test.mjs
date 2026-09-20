import test from "node:test";
import assert from "node:assert/strict";
import { matchesClinicalFilter, profileMatchesClinicalFilter, clinicalFilterParams, readClinicalFilter, upcomingCalendarPeriod } from "../lib/clinical-filter.ts";
import { calendarProfileIds, matchesSubmittedClinicalFilter } from "../lib/calendar-scope.ts";

const sites = ["Estelí", "León", "Las Colinas", "Santo Domingo", "Masaya"];
const profiles = sites.flatMap((site, i) => [0,1].map(n => ({id:`child-${i}-${n}`,site})));
const director = {role:"direccion_clinica",siteScope:[],assignedProfileIds:[]};
const all = {site:"Todas",profileId:"all"};

test("estrechar sede y niño sólo reduce resultados; se combinan por intersección", () => {
  const full = calendarProfileIds(director, profiles, all);
  for (const site of sites) {
    const siteIds = calendarProfileIds(director, profiles, {site,profileId:"all"});
    assert.equal(siteIds.length, 2);
    assert.ok(siteIds.every(id => full.includes(id)));
    for (const profile of profiles) {
      const ids = calendarProfileIds(director, profiles, {site,profileId:profile.id});
      assert.equal(ids.length, profile.site===site ? 1 : 0);
      assert.ok(ids.every(id=>siteIds.includes(id)));
    }
  }
  assert.deepEqual(calendarProfileIds(director, profiles, all), full);
});

test("los filtros nunca amplían el alcance de cada rol", () => {
  for (const role of ["terapeuta","coordinador","supervisor"]) {
    const account={role,siteScope:["Estelí"],assignedProfileIds:[profiles[0].id]};
    const allowed=calendarProfileIds(account, profiles, all);
    assert.equal(allowed.length,role==="supervisor" ? 2 : 1);
    assert.deepEqual(calendarProfileIds(account, profiles, {site:"León",profileId:"all"}),[]);
    assert.deepEqual(calendarProfileIds(account, profiles, {site:"Todas",profileId:profiles[2].id}),[]);
  }
});

test("el filtro conserva los valores exactos y no convierte un niño desconocido en Todos", () => {
  const filter={site:"Estelí",profileId:"missing-child"};
  assert.deepEqual(readClinicalFilter(clinicalFilterParams(filter)),filter);
  assert.deepEqual(calendarProfileIds(director,profiles,filter),[]);
  assert.equal(profileMatchesClinicalFilter(profiles[0],{site:"León",profileId:profiles[0].id}),false);
  assert.equal(matchesClinicalFilter({site:"León",profileId:profiles[0].id},{site:"Estelí",profileId:profiles[0].id}),false);
});

test("la ventana de próximas terapias es fija al cambiar filtros o mes visible", () => {
  assert.deepEqual(upcomingCalendarPeriod("2026-09-20"),{from:"2026-09-20",to:"2026-10-20"});
  assert.deepEqual(upcomingCalendarPeriod("2026-12-20"),{from:"2026-12-20",to:"2027-01-19"});
  const appointments=profiles.map((p,i)=>({profileId:p.id,site:p.site,sessionDate:i%2 ? "2026-09-21":"2026-10-22"}));
  const period=upcomingCalendarPeriod("2026-09-20");
  const inPeriod=appointments.filter(a=>a.sessionDate>=period.from&&a.sessionDate<=period.to);
  const filtered=inPeriod.filter(a=>matchesClinicalFilter(a,{site:"Estelí",profileId:"all"}));
  assert.equal(filtered.length,1);
  assert.ok(filtered.every(a=>inPeriod.includes(a)));
});

test("crear o editar una cita rechaza un niño ajeno al filtro enviado y conserva clientes anteriores", () => {
  const child=profiles[0];
  assert.equal(matchesSubmittedClinicalFilter(child,undefined),true);
  assert.equal(matchesSubmittedClinicalFilter(child,all),true);
  assert.equal(matchesSubmittedClinicalFilter(child,{site:"Estelí",profileId:child.id}),true);
  assert.equal(matchesSubmittedClinicalFilter(child,{site:"León",profileId:child.id}),false);
  assert.equal(matchesSubmittedClinicalFilter(child,{site:"Estelí",profileId:profiles[1].id}),false);
  assert.equal(matchesSubmittedClinicalFilter(child,null),false);
});
