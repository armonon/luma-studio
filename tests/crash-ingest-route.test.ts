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

test("crash ingest normalizes the timestamp instead of forwarding what was sent", async () => {
  // Date.parse is not a validator: its legacy fallback silently ignores
  // anything in parentheses, so this string parses to a real instant. The
  // timestamp was the one field forwarded raw, bypassing the scrubbing every
  // other string on the report goes through.
  resetCrashIngestRateLimitsForTests();
  const previousUrl = process.env.LUMA_CRASH_WEBHOOK_URL;
  const previousFetch = globalThis.fetch;
  process.env.LUMA_CRASH_WEBHOOK_URL = "https://collector.example.test/luma";
  let forwarded = "";
  globalThis.fetch = (async (_input, init) => {
    forwarded = String((init as RequestInit).body);
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  try {
    const response = await POST(new Request("https://luma.test/api/diagnostics/crash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...validReport,
        event: { ...validReport.event, timestamp: "2020-01-01 (ATTACKER-CONTROLLED PAYLOAD)" },
      }),
    }));
    assert.equal(response.status, 202);
    assert.doesNotMatch(forwarded, /ATTACKER-CONTROLLED/, "the raw timestamp string must not reach the collector");
    assert.match(forwarded, /"timestamp":"20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ"/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.LUMA_CRASH_WEBHOOK_URL; else process.env.LUMA_CRASH_WEBHOOK_URL = previousUrl;
  }
});

test("rotating a forwarded-for header does not buy an unbounded crash quota", async () => {
  // cf-connecting-ip and x-forwarded-for are client-settable unless a proxy
  // in front of this route rewrites them, so keying the limiter on them let a
  // single sender mint a fresh bucket per request. Absent an explicit trusted
  // proxy the limiter now shares one bucket, and a global ceiling bounds the
  // trusted-proxy case too.
  resetCrashIngestRateLimitsForTests();
  const previousUrl = process.env.LUMA_CRASH_WEBHOOK_URL;
  const previousProxy = process.env.LUMA_TRUSTED_PROXY;
  const previousFetch = globalThis.fetch;
  process.env.LUMA_CRASH_WEBHOOK_URL = "https://collector.example.test/luma";
  delete process.env.LUMA_TRUSTED_PROXY;
  let delivered = 0;
  globalThis.fetch = (async () => { delivered += 1; return new Response(null, { status: 202 }); }) as typeof fetch;
  try {
    let limited = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await POST(new Request("https://luma.test/api/diagnostics/crash", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${attempt}` },
        body: JSON.stringify(validReport),
      }));
      if (response.status === 429) limited += 1;
    }
    assert.ok(limited > 0, "a header-rotating sender must still get rate limited");
    assert.ok(delivered <= 20, `at most one bucket's worth reaches the collector (got ${delivered})`);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.LUMA_CRASH_WEBHOOK_URL; else process.env.LUMA_CRASH_WEBHOOK_URL = previousUrl;
    if (previousProxy === undefined) delete process.env.LUMA_TRUSTED_PROXY; else process.env.LUMA_TRUSTED_PROXY = previousProxy;
  }
});
