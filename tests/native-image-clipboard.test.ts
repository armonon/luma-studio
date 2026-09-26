import test from "node:test";
import assert from "node:assert/strict";
import { hasNativeImageClipboard, readNativeImageClipboard, writePixelClipboard } from "../app/studio/selection-clipboard-events.ts";

test("native image clipboard routes own pixels, foreign images and external text without stale paste", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let marker = "own", count = 5, read = 0, writes = 0, textOnly = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI__: { core: { invoke: async (command: string, payload?: unknown, options?: { headers: Record<string, string> }) => {
    if (command === "native_clipboard_info") return { marker, changeCount: count };
    if (command === "read_native_clipboard") { read++; if (textOnly) throw new Error("No image"); return new Uint8Array([1, 2, 3]).buffer; }
    if (command === "write_native_clipboard") { assert.ok(payload instanceof ArrayBuffer); assert.equal(options?.headers["x-luma-change-count"], String(count)); marker = options!.headers["x-luma-marker"]; writes++; count++; return; }
    throw new Error(command);
  } } } } });
  try {
    assert.equal(hasNativeImageClipboard(), true);
    assert.equal(await readNativeImageClipboard("own", true), "internal"); assert.equal(read, 0);
    marker = "foreign";
    const file = await readNativeImageClipboard("own", true); assert.ok(file instanceof File); assert.equal(file.type, "image/png");
    textOnly = true; await assert.rejects(readNativeImageClipboard("own", true), /No image/);
    const canvas = { toBlob(callback: (blob: Blob) => void) { callback(new Blob(["png"])); } } as HTMLCanvasElement;
    assert.equal(await writePixelClipboard(canvas, "new"), true); assert.equal(writes, 1);
    assert.equal(await readNativeImageClipboard("new", true), "internal");
    const settling = writePixelClipboard(canvas, "after-dom-event");
    count++; // WKWebView finishes the DOM event before the native revision is read.
    assert.equal(await settling, true);
    const superseded = writePixelClipboard(canvas, "old-copy");
    const newest = writePixelClipboard(canvas, "new-copy");
    assert.equal(await superseded, false); assert.equal(await newest, true);
    marker = "foreign"; textOnly = false;
    const before = read;
    await assert.rejects(readNativeImageClipboard("new-copy", true, () => { throw new Error("Memory ceiling"); }), /Memory ceiling/);
    assert.equal(read, before, "admission must happen before native decoding");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window");
  }
});
