import assert from "node:assert/strict";
import test from "node:test";
import { LocalDiagnostics, sanitizeDiagnosticValue } from "../app/engine/diagnostics.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

test("local diagnostics are privacy-sanitized, bounded, and exportable", async () => {
  const storage = memoryStorage();
  const diagnostics = new LocalDiagnostics(storage);
  const error = new Error("Failed at file:///Users/lillypad/private/project.ts and https://example.com/account?id=7");
  for (let index = 0; index < 55; index += 1) diagnostics.record("crash", error, { layers: index });
  const events = diagnostics.list();
  assert.equal(events.length, 50);
  assert.doesNotMatch(events[0].message, /lillypad|account\?id/);
  assert.match(events[0].message, /\[local-file\]|\[user\]/);
  assert.equal(diagnostics.summary().crashes, 50);

  const exported = JSON.parse(await diagnostics.exportReport({ edition: "pro" }).text());
  assert.equal(exported.schema, "luma-diagnostics/1");
  assert.equal(exported.context.edition, "pro");
  assert.equal(exported.events.length, 50);
});

test("blocked storage degrades to an in-memory crash ring", () => {
  const diagnostics = new LocalDiagnostics({
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  });
  assert.doesNotThrow(() => diagnostics.record("rejection", "offline"));
  assert.equal(diagnostics.summary().events, 1);
});

test("diagnostics redact a Windows home directory as well as a POSIX one", () => {
  // The desktop build ships for Windows, where a stack frame reads
  // C:\Users\<name>\… — and the redaction pattern matched forward slashes
  // only, so the username rode along into every persisted crash report.
  assert.equal(
    sanitizeDiagnosticValue("at C:\\Users\\armon\\Documents\\design.psd", 200),
    "at C:\\Users\\[user]\\Documents\\design.psd",
  );
  assert.equal(sanitizeDiagnosticValue("at /Users/armon/secret/a.psd", 200), "at /Users/[user]/secret/a.psd");
  assert.equal(sanitizeDiagnosticValue("at /home/armon/work/a.psd", 200), "at /home/[user]/work/a.psd");
  assert.equal(sanitizeDiagnosticValue("at D:\\home\\armon\\x.psd", 200), "at D:\\home\\[user]\\x.psd");
});
