import test from "node:test";
import assert from "node:assert/strict";
import {
  MOBILE_API_VERSION,
  boundedMobileDateRange,
  deriveMobileCapabilities,
  extractBearerToken,
  mobileJson,
  mobileProfileIds,
} from "../lib/mobile-api-contract.ts";

const therapist = {
  id: "TEST-MOBILE-THERAPIST",
  authUserId: "TEST-AUTH-USER",
  email: "therapist@example.test",
  username: "therapist",
  displayName: "Terapeuta de prueba",
  role: "terapeuta",
  status: "active",
  personnelProfileId: null,
  siteScope: [],
  assignedProfileIds: ["TEST-CHILD-001"],
  permissions: ["children.view", "programs.view", "sessions.record", "calendar.view", "graphs.view", "abc.record"],
};

test("la API móvil acepta únicamente un bearer token explícito", () => {
  const valid = new Request("https://example.test/api/mobile/v1/bootstrap", {
    headers: { authorization: `Bearer ${"a".repeat(40)}` },
  });
  assert.equal(extractBearerToken(valid), "a".repeat(40));
  assert.equal(extractBearerToken(new Request("https://example.test", { headers: { authorization: "Basic abc" } })), null);
  assert.equal(extractBearerToken(new Request("https://example.test")), null);
});

test("el alcance móvil une asignaciones directas y citas propias sin duplicados", () => {
  assert.deepEqual(
    [...mobileProfileIds(therapist, ["TEST-CHILD-001", "TEST-CHILD-002"])].sort(),
    ["TEST-CHILD-001", "TEST-CHILD-002"],
  );
});

test("las capacidades móviles proceden de los permisos clínicos vigentes", () => {
  assert.deepEqual(deriveMobileCapabilities(therapist.role, therapist.permissions), {
    viewChildren: true,
    viewPrograms: true,
    viewGraphs: true,
    viewCalendar: true,
    recordSessions: true,
    recordAbc: true,
  });
});

test("el calendario móvil limita cada consulta a 93 días", () => {
  assert.deepEqual(
    boundedMobileDateRange("2026-09-05", "2027-01-30", new Date("2026-09-05T00:00:00.000Z")),
    { from: "2026-09-05", to: "2026-12-07" },
  );
});

test("las respuestas móviles son privadas, no cacheables y versionadas", async () => {
  const response = mobileJson({ ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.equal(response.headers.get("x-cie-nexus-api-version"), MOBILE_API_VERSION);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { ok: true });
});
