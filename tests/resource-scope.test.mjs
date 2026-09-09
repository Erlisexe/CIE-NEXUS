import test from "node:test";
import assert from "node:assert/strict";
import { canAccessProfileByScope, canClinicalProfessionalServeChild, canRecordScheduledSession, canViewAssignedSession } from "../lib/resource-scope.ts";

const therapist = {
  id: "TEST-THERAPIST-001",
  role: "terapeuta",
  assignedProfileIds: ["TEST-CHILD-001"],
  siteScope: [],
};

const clinicalDirector = {
  id: "TEST-DIRECTOR-001",
  role: "direccion_clinica",
  assignedProfileIds: [],
  siteScope: [],
};

test("el terapeuta solo accede a niños asignados", () => {
  assert.equal(canAccessProfileByScope(therapist, { id: "TEST-CHILD-001", site: "León" }), true);
  assert.equal(canAccessProfileByScope(therapist, { id: "TEST-CHILD-002", site: "León" }), false);
});

test("el terapeuta solo visualiza sesiones que le fueron asignadas", () => {
  const profile = { id: "TEST-CHILD-001", site: "León" };
  assert.equal(canViewAssignedSession(therapist, { professionalAccountId: therapist.id }, profile), true);
  assert.equal(canViewAssignedSession(therapist, { professionalAccountId: "TEST-THERAPIST-002" }, profile), false);
  assert.equal(canRecordScheduledSession(therapist, therapist.id), true);
  assert.equal(canRecordScheduledSession(therapist, null), false);
  assert.equal(canRecordScheduledSession(therapist, "TEST-THERAPIST-002"), false);
});

test("Dirección Clínica conserva acceso global", () => {
  const outsideProfile = { id: "TEST-CHILD-999", site: "Masaya" };
  assert.equal(canAccessProfileByScope(clinicalDirector, outsideProfile), true);
  assert.equal(canViewAssignedSession(clinicalDirector, { professionalAccountId: therapist.id }, outsideProfile), true);
  assert.equal(canRecordScheduledSession(clinicalDirector, clinicalDirector.id), true);
  assert.equal(canRecordScheduledSession(clinicalDirector, therapist.id), false);
});

test("cualquier rol clínico puede brindar una sesión que le fue asignada", () => {
  const profile = { id: "TEST-CHILD-001", site: "León" };
  for (const role of ["coordinador", "supervisor", "subdirector", "direccion_clinica"]) {
    const professional = {
      id: `TEST-${role.toUpperCase()}`,
      role,
      assignedProfileIds: [profile.id],
      siteScope: [profile.site],
    };
    assert.equal(canClinicalProfessionalServeChild(professional, profile), true);
    assert.equal(canRecordScheduledSession(professional, professional.id), true);
    assert.equal(canRecordScheduledSession(professional, "TEST-OTHER-PROFESSIONAL"), false);
  }
});
