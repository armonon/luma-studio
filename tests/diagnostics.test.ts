import assert from "node:assert/strict";
import test from "node:test";
import { LocalDiagnostics } from "../app/engine/diagnostics.ts";

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
