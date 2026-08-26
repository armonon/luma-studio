import assert from "node:assert/strict";
import test from "node:test";
import { RemoteCrashReporter, createCrashReporterFromEnv } from "../app/engine/crash-reporting.ts";
import type { DiagnosticEvent } from "../app/engine/diagnostics.ts";

const event: DiagnosticEvent = {
  id: "crash-1",
  kind: "crash",
  timestamp: "2026-08-25T00:00:00.000Z",
  message: "file:///Users/lillypad/private/design.psd failed",
  stack: "at https://example.com/account?id=7",
  context: { document: "/Users/lillypad/private/design.psd", layers: 8 },
};

test("remote crash reports are HTTPS-only, scrubbed, deduplicated, and credential-free", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const reporter = new RemoteCrashReporter({
    endpoint: "https://crashes.example.test/v1",
    release: "v0.6.0-rc0",
    edition: "pro",
    fetchImpl: (async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(null, { status: 202 });
    }) as typeof fetch,
  });
  assert.equal(await reporter.report(event), true);
  assert.equal(await reporter.report(event), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init?.credentials, "omit");
  assert.equal(requests[0].init?.referrerPolicy, "no-referrer");
  const body = String(requests[0].init?.body);
  assert.doesNotMatch(body, /lillypad|account\?id/);
  assert.match(body, /luma-crash\/1/);
});

test("unconfigured, insecure, and failed reporters stay non-fatal", async () => {
  assert.equal(createCrashReporterFromEnv("pro", {}).enabled, false);
  assert.equal(createCrashReporterFromEnv("pro", { NEXT_PUBLIC_LUMA_CRASH_ENDPOINT: "http://unsafe.test" }).enabled, false);
  const reporter = new RemoteCrashReporter({
    endpoint: "https://offline.example.test",
    release: "test",
    edition: "pro",
    fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
  });
  assert.equal(await reporter.report(event), false);

  let attempts = 0;
  const retryable = new RemoteCrashReporter({
    endpoint: "https://temporarily-unavailable.example.test",
    release: "test",
    edition: "pro",
    fetchImpl: (async () => new Response(null, { status: ++attempts === 1 ? 503 : 202 })) as typeof fetch,
  });
  assert.equal(await retryable.report(event), false);
  assert.equal(await retryable.report(event), true);
});

test("successful crash receipts persist and startup flush retries only undelivered fatal events", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  let requests = 0;
  const options = {
    endpoint: "https://crashes.example.test/v1",
    release: "v0.6.0-rc0",
    edition: "pro" as const,
    storage,
    fetchImpl: (async () => { requests++; return new Response(null, { status: 202 }); }) as typeof fetch,
  };
  const first = new RemoteCrashReporter(options);
  assert.equal(await first.flush([event, { ...event, id: "long-1", kind: "long-task" }]), 1);
  assert.equal(requests, 1);

  const afterRestart = new RemoteCrashReporter(options);
  assert.equal(await afterRestart.flush([event, { ...event, id: "rejection-2", kind: "rejection" }]), 1);
  assert.equal(requests, 2, "the acknowledged crash must not be sent twice");
});
