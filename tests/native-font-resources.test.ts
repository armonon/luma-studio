import test from "node:test";
import assert from "node:assert/strict";
import { loadNativeImportedFont, nativeImportedFontReady, nativeFontResourceStats } from "../app/engine/native-font-resources.ts";
import { fontResourceRevision } from "../app/engine/bundled-fonts.ts";
import { pendingDocumentFonts, waitForDocumentFonts } from "../app/engine/text-font-resources.ts";
import { setPhotoshopLayerMetadata } from "../app/engine/psd-metadata.ts";
import type { Layer } from "../app/engine/document.ts";

function sfnt(size = 12) { const bytes = new ArrayBuffer(size); new DataView(bytes).setUint32(0, 0x00010000); return bytes; }

test("native imported fonts are bounded, exact, serialized and retryable", async t => {
  const descriptors = new Map(["FontFace", "document", "__TAURI__"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let calls: string[] = [], added = 0, failLoad = false;
  let handler: (name: string) => Promise<ArrayBuffer | number[]> = async () => sfnt();
  class Face {
    constructor(readonly family: string, readonly bytes: ArrayBuffer) {}
    async load() { if (failLoad) throw new Error("invalid font tables"); return this; }
  }
  Object.defineProperties(globalThis, {
    FontFace: { configurable: true, value: Face },
    document: { configurable: true, value: { fonts: { add: () => { added++; } } } },
    __TAURI__: { configurable: true, value: { core: { invoke: async (command: string, args: { postscriptName: string }) => {
      assert.equal(command, "read_installed_font"); calls.push(args.postscriptName); return handler(args.postscriptName);
    } } } },
  });
  try {
    await t.test("concurrent requests deduplicate and later faces wait", async () => {
      let release!: (bytes: ArrayBuffer) => void;
      handler = name => name === "First" ? new Promise(resolve => { release = resolve; }) : Promise.resolve(sfnt());
      const revision = fontResourceRevision(), first = loadNativeImportedFont("First");
      assert.equal(loadNativeImportedFont("First"), first);
      const next = loadNativeImportedFont("Second");
      await Promise.resolve(); assert.deepEqual(calls, ["First"]);
      release(sfnt()); await Promise.all([first, next]);
      assert.deepEqual(calls, ["First", "Second"]); assert.equal(added, 2);
      assert.equal(fontResourceRevision(), revision + 2, "cached metrics and GPU textures must invalidate");
      assert.equal(nativeFontResourceStats().pendingFaces, 0);
      await loadNativeImportedFont("First"); assert.equal(calls.length, 2);
    });
    await t.test("missing or rejected fonts never become ready and do not starve the queue", async () => {
      handler = async name => { if (name === "Missing") throw new Error("no substitute was loaded"); return sfnt(); };
      await assert.rejects(loadNativeImportedFont("Missing"), /no substitute/);
      assert.equal(nativeImportedFontReady("Missing"), false);
      failLoad = true; await assert.rejects(loadNativeImportedFont("BrowserRejected"), /invalid font tables/);
      failLoad = false; await loadNativeImportedFont("BrowserRejected");
      assert.equal(nativeImportedFontReady("BrowserRejected"), true);
    });
    await t.test("malformed responses and names are refused without installing a face", async () => {
      const before = added;
      for (const [index, response] of [new ArrayBuffer(1), new ArrayBuffer(12), [0, -1, 256]].entries()) {
        handler = async () => response;
        await assert.rejects(loadNativeImportedFont(`Malformed${index}`), /Invalid native|not an admitted/);
      }
      for (const name of ["../font", "bad\u007fname", "é".repeat(129)]) await assert.rejects(loadNativeImportedFont(name), /Invalid imported/);
      assert.equal(added, before);
    });
    await t.test("export timeout keeps admission and retries the same operation, not a second allocation", async () => {
      let release!: (bytes: ArrayBuffer) => void;
      handler = () => new Promise(resolve => { release = resolve; });
      const layer = { text: { font: '20px "Slow"', defaultStyle: { fontFamily: "Slow" }, text: "Text" } } as Layer;
      setPhotoshopLayerMetadata(layer, { source: { text: { text: "Text", style: { font: { name: "Slow" } } } }, preservation: "editable" });
      const doc = { layers: [layer] };
      await assert.rejects(waitForDocumentFonts(doc, 5), /no delivery asset was rendered/);
      assert.equal(nativeFontResourceStats().pendingFaces, 1);
      const retry = pendingDocumentFonts(doc);
      assert.ok(retry); assert.equal(calls.filter(name => name === "Slow").length, 1);
      release(sfnt()); await retry; assert.equal(pendingDocumentFonts(doc), null);
    });
    await t.test("64 face admission happens before any excess native requests", async () => {
      calls = [];
      handler = async () => sfnt();
      const room = 64 - nativeFontResourceStats().readyFaces;
      const admitted = Array.from({ length: room }, (_, index) => loadNativeImportedFont(`Count${index}`));
      await assert.rejects(loadNativeImportedFont("TooMany"), /session limit/);
      await Promise.all(admitted); assert.equal(calls.length, room);
      assert.equal(nativeFontResourceStats().readyFaces, 64);
    });
  } finally {
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
