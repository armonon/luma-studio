import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedText, UploadLimitError, UploadTimeoutError } from "../app/engine/bounded-upload";
import { POST, resetCrashIngestRateLimitsForTests } from "../app/api/diagnostics/crash/handler";
import { RemoteCrashReporter } from "../app/engine/crash-reporting";
import type { DiagnosticEvent } from "../app/engine/diagnostics";

const event: DiagnosticEvent = { id: "first", kind: "crash", timestamp: new Date(0).toISOString(), message: "Test failure" };
const report = { schema: "luma-crash/1", edition: "web", release: "test", event };
function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://luma.test/api/diagnostics/crash", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

test("bounded text counts UTF-8 bytes, cancels excess streams, and times out stalled uploads", async () => {
  assert.equal(await readBoundedText(request("é"), 2), "é");
  await assert.rejects(readBoundedText(request("é"), 1), UploadLimitError);
  let cancelled = false, chunks = 0;
  const source = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(16384)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(readBoundedText(request(source), 32768), UploadLimitError);
  assert.equal(chunks, 3); assert.equal(cancelled, true);
  await assert.rejects(readBoundedText(request(new ReadableStream({})), 32768, 20), UploadTimeoutError);
  const interrupted = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("Disconnected")); } });
  await assert.rejects(readBoundedText(request(interrupted), 32768), /Disconnected/);
});

test("crash ingress rejects unknown-length oversized bodies and bounds concurrent reads", async () => {
  resetCrashIngestRateLimitsForTests();
  assert.equal((await POST(request("x".repeat(32769)))).status, 413);
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const pending = Array.from({ length: 4 }, () => POST(request(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }))));
  let reads = 0;
  const refused = await POST(request(new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.close(); } }, { highWaterMark: 0 })));
  assert.equal(refused.status, 429); assert.equal(reads, 0);
  controllers.forEach(controller => controller.close());
  assert.deepEqual((await Promise.all(pending)).map(response => response.status), [400, 400, 400, 400]);
  assert.equal((await POST(request("{}"))).status, 400, "admission must be released after errors");
});

test("web crash reports accept their own origin and reject unrelated origins", async () => {
  resetCrashIngestRateLimitsForTests();
  const previousUrl = process.env.LUMA_CRASH_WEBHOOK_URL;
  const previousFetch = globalThis.fetch;
  process.env.LUMA_CRASH_WEBHOOK_URL = "https://collector.example.test/crash";
  let redirects: RequestRedirect | undefined;
  globalThis.fetch = (async (_url, init) => { redirects = init?.redirect; return new Response(null, { status: 202 }); }) as typeof fetch;
  try {
    assert.equal((await POST(request(JSON.stringify(report), { origin: "https://luma.test" }))).status, 202);
    assert.equal(redirects, "error");
    assert.equal((await POST(request(JSON.stringify(report), { origin: "https://other.test" }))).status, 403);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.LUMA_CRASH_WEBHOOK_URL; else process.env.LUMA_CRASH_WEBHOOK_URL = previousUrl;
  }
});

test("only acknowledged crash receipts persist while parallel failures remain retryable", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let resolveFirst!: (response: Response) => void;
  let calls = 0;
  const options = { endpoint: "https://collector.example.test/crash", release: "test", edition: "pro" as const, storage,
    fetchImpl: (async () => { calls++; return calls === 1 ? new Promise<Response>(resolve => { resolveFirst = resolve; }) : new Response(null, { status: 202 }); }) as typeof fetch };
  const reporter = new RemoteCrashReporter(options);
  const pending = reporter.report(event);
  assert.equal(await reporter.report(event), false, "an in-flight duplicate must not start another request");
  assert.equal(await reporter.report({ ...event, id: "second" }), true);
  assert.deepEqual(JSON.parse([...values.values()][0]), ["second"]);
  resolveFirst(new Response(null, { status: 503 })); await pending;
  const restarted = new RemoteCrashReporter(options);
  assert.equal(await restarted.report(event), true, "first was never acknowledged and must survive restart");
  for (let id = 0; id < 110; id++) await restarted.report({ ...event, id: `later-${id}` });
  assert.equal(JSON.parse([...values.values()][0]).length, 100);
  assert.equal((restarted as unknown as { sent: Set<string> }).sent.size, 100);
});

test("crash client limits concurrency and refuses credentials or redirect destinations", async () => {
  for (const endpoint of ["https://user:secret@collector.test/", "https://collector.test/#secret"]) {
    assert.equal(new RemoteCrashReporter({ endpoint, release: "test", edition: "pro" }).enabled, false);
  }
  const resolvers: ((response: Response) => void)[] = [];
  const reporter = new RemoteCrashReporter({ endpoint: "https://collector.test/", release: "test", edition: "pro", storage: null,
    fetchImpl: (async (_url, init) => { assert.equal(init?.redirect, "error"); return new Promise<Response>(resolve => resolvers.push(resolve)); }) as typeof fetch });
  const pending = [reporter.report(event), reporter.report({ ...event, id: "two" })];
  assert.equal(await reporter.report({ ...event, id: "three" }), false);
  resolvers.forEach(resolve => resolve(new Response(null, { status: 202 })));
  assert.deepEqual(await Promise.all(pending), [true, true]);
});
