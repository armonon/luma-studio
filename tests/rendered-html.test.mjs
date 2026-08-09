import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
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
}

test("renders the finished Luma Studio marketing site", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Luma Studio/);
  assert.match(html, /Make anything/);
  assert.match(html, /Open Studio/);
  assert.match(html, /Neural Lab/);
  assert.match(html, /\/studio/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("renders the unified interactive studio route", async () => {
  const response = await render("/studio");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Primary tools/);
  assert.match(html, />Move</);
  assert.match(html, />Paint</);
  assert.match(html, />Select</);
  assert.match(html, />Retouch</);
  assert.match(html, />Create</);
  assert.match(html, /More Tools/);
  assert.match(html, /Batch processing/);
  assert.match(html, /Neural Lab/);
  assert.match(html, /Layers/);
  assert.match(html, /Saved locally/);
  assert.match(html, /Inspector panels/);
  assert.match(html, />Inspector</);
  assert.match(html, />Tray</);
  assert.match(html, />Variations</);
});

test("protects the generative image endpoint", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-ai`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/ai/edit", { method: "POST", body: new FormData() }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Sign in with ChatGPT/);
});
