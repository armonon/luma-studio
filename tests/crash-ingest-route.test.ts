import assert from "node:assert/strict";
import test from "node:test";
import { OPTIONS, POST, resetCrashIngestRateLimitsForTests } from "../app/api/diagnostics/crash/route.ts";

const validReport = {
  schema: "luma-crash/1",
  release: "v0.6.0-rc0",
  edition: "pro",
  event: {
    id: "crash-remote-1",
    kind: "crash",
    timestamp: "2026-08-25T00:00:00.000Z",
    message: "file:///Users/lillypad/private/design.psd failed",
    stack: "at https://example.com/account?id=7",
    context: { document: "/Users/lillypad/private/design.psd", layers: 8 },
  },
};

test("crash ingest validates, scrubs, authenticates upstream, and returns a receipt", async () => {
  resetCrashIngestRateLimitsForTests();
  const previousUrl = process.env.LUMA_CRASH_WEBHOOK_URL;
  const previousToken = process.env.LUMA_CRASH_WEBHOOK_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.LUMA_CRASH_WEBHOOK_URL = "https://collector.example.test/luma";
  process.env.LUMA_CRASH_WEBHOOK_TOKEN = "server-secret";
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  try {
    const response = await POST(new Request("https://luma.test/api/diagnostics/crash", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "tauri://localhost", "cf-connecting-ip": "192.0.2.1" },
      body: JSON.stringify(validReport),
    }));
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("access-control-allow-origin"), "tauri://localhost");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "https://collector.example.test/luma");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer server-secret");
    const forwarded = String(calls[0].init?.body);
    assert.doesNotMatch(forwarded, /lillypad|account\?id/);
    assert.match(forwarded, /receiptId/);
    assert.equal((await response.json() as { accepted: boolean }).accepted, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.LUMA_CRASH_WEBHOOK_URL; else process.env.LUMA_CRASH_WEBHOOK_URL = previousUrl;
    if (previousToken === undefined) delete process.env.LUMA_CRASH_WEBHOOK_TOKEN; else process.env.LUMA_CRASH_WEBHOOK_TOKEN = previousToken;
  }
});

test("crash ingest fails closed for malformed, oversized, foreign-origin, and unconfigured requests", async () => {
  resetCrashIngestRateLimitsForTests();
  const previousUrl = process.env.LUMA_CRASH_WEBHOOK_URL;
  delete process.env.LUMA_CRASH_WEBHOOK_URL;
  try {
    const malformed = await POST(new Request("https://luma.test/api/diagnostics/crash", { method: "POST", body: "{}" }));
    assert.equal(malformed.status, 400);
    const oversized = await POST(new Request("https://luma.test/api/diagnostics/crash", {
      method: "POST", headers: { "content-length": "40000" }, body: "{}",
    }));
    assert.equal(oversized.status, 413);
    const foreign = await POST(new Request("https://luma.test/api/diagnostics/crash", {
      method: "POST", headers: { origin: "https://attacker.example" }, body: JSON.stringify(validReport),
    }));
    assert.equal(foreign.status, 403);
    const unconfigured = await POST(new Request("https://luma.test/api/diagnostics/crash", {
      method: "POST", body: JSON.stringify(validReport),
    }));
    assert.equal(unconfigured.status, 503);
    assert.equal(OPTIONS(new Request("https://luma.test", { method: "OPTIONS", headers: { origin: "tauri://localhost" } })).status, 204);
  } finally {
    if (previousUrl === undefined) delete process.env.LUMA_CRASH_WEBHOOK_URL; else process.env.LUMA_CRASH_WEBHOOK_URL = previousUrl;
  }
});
