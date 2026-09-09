import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/login", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("la API móvil no acepta solicitudes anónimas ni cookies del sitio", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("mobile-auth-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/mobile/v1/bootstrap", {
      headers: { cookie: "fake-browser-session=1" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.deepEqual(await response.json(), {
    error: {
      code: "authentication_required",
      message: "Inicia sesión en CIE Nexus para utilizar la aplicación móvil.",
    },
  });
});

test("preparar y cerrar sesiones móviles exige un token explícito", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  for (const method of ["GET", "POST"]) {
    const response = await worker.fetch(new Request("http://localhost/api/mobile/v1/collection", {
      method, headers: { cookie: "fake-browser-session=1" }, ...(method === "POST" ? { body: "{}" } : {}),
    }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "authentication_required");
  }
});
