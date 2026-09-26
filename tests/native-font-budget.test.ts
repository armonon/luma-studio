import test from "node:test";
import assert from "node:assert/strict";
import { loadNativeImportedFont, nativeFontResourceStats } from "../app/engine/native-font-resources.ts";

test("font byte ceiling is admitted before IPC, separately from face count", async () => {
  const descriptors = new Map(["FontFace", "document", "__TAURI__"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let calls = 0;
  Object.defineProperties(globalThis, {
    FontFace: { configurable: true, value: class { async load() { return this; } } },
    document: { configurable: true, value: { fonts: { add() {} } } },
    __TAURI__: { configurable: true, value: { core: { invoke: async () => {
      calls++;
      const data = new ArrayBuffer(16 * 1024 * 1024); new DataView(data).setUint32(0, 0x00010000); return data;
    } } } },
  });
  try {
    await Promise.all(["One", "Two", "Three", "Four"].map(loadNativeImportedFont));
    await assert.rejects(loadNativeImportedFont("OverBudget"), /memory budget/);
    assert.equal(calls, 4, "fifth response must not be allocated");
    assert.equal(nativeFontResourceStats().residentBytes, 64 * 1024 * 1024);
    assert.equal(nativeFontResourceStats().pendingFaces, 0);
  } finally {
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
