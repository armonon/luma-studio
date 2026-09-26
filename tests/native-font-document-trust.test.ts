import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { writePsd } from "../app/engine/ag-psd-io.ts";
import { waitForDocumentFonts } from "../app/engine/text-font-resources.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { setPhotoshopLayerMetadata } from "../app/engine/psd-metadata.ts";
import { nativeImportedFontReady } from "../app/engine/native-font-resources.ts";
import { renderViewport } from "../app/engine/renderer.ts";

test("missing exact fonts block rerendered exports, not native save or untouched source preservation", async () => {
  const keys = ["FontFace", "__TAURI__"];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const fonts = Object.getOwnPropertyDescriptor(document, "fonts");
  const studio = new Studio(8, 8, testCanvas(1, 1));
  let missing = true;
  Object.defineProperty(document, "fonts", { configurable: true, value: { add() {} } });
  Object.defineProperties(globalThis, {
    FontFace: { configurable: true, value: class { async load() { return this; } } },
    __TAURI__: { configurable: true, value: { core: { invoke: async (command: string) => {
      assert.equal(command, "read_installed_font");
      if (missing) throw new Error("no substitute was loaded");
      const bytes = new ArrayBuffer(12); new DataView(bytes).setUint32(0, 0x00010000); return bytes;
    } } } },
  });
  try {
    const source = writePsd({ width: 32, height: 32, children: [{ name: "Imported text", text: {
      text: "A", transform: [1, 0, 0, 1, 2, 20], style: { font: { name: "ExactTrustFixture" }, fontSize: 15 },
    } }] }, { noBackground: true });
    await studio.importPsd(source);
    const preserved = await studio.exportPhotoshop({ format: "source" }, async () => true);
    assert.deepEqual(new Uint8Array(preserved.buffer), new Uint8Array(source));
    const project = await studio.exportProject("Unavailable font");
    const reopened = (await decodeLumaProject(project)).doc;
    assert.equal(reopened.layers[0].text?.text, "A");
    studio.doc.layers[0].text!.text = "B";
    const history = studio.historyState().currentId;
    await assert.rejects(studio.exportPhotoshop({}, async () => true), /no substitute/);
    assert.equal(studio.historyState().currentId, history); assert.equal(studio.doc.layers[0].text!.text, "B");

    const guard = (studio as unknown as { guardDocumentOperation(name: string): () => void }).guardDocumentOperation("font readiness");
    missing = false; await waitForDocumentFonts(studio.doc);
    assert.doesNotThrow(guard, "font-triggered cache redraw is not an edit");
    studio.requestRender(); assert.throws(guard, /document changed/, "other render invalidations still invalidate delayed edits");

    const blend = studio.addTextLayer("Blend", { font: "20px BlendTrustFixture", x: 2, y: 20 });
    blend.photoshop = { sourceIndex: 1 };
    setPhotoshopLayerMetadata(blend, { source: { text: { text: "Blend", style: { font: { name: "BlendTrustFixture" } } } }, preservation: "editable" });
    blend.blendStack = [{ id: "one", mode: "multiply", opacity: .5, enabled: true }, { id: "two", mode: "screen", opacity: .5, enabled: true }];
    renderViewport(studio.doc, testCanvas(32, 32), { x: 0, y: 0, width: 32, height: 32, zoom: 1, outputWidth: 32, outputHeight: 32, cssScale: 1, devicePixelRatio: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nativeImportedFontReady("BlendTrustFixture"), true, "blend-pass clones must not prevent viewport font preparation");
  } finally {
    studio.dispose();
    keys.forEach((key, index) => { if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!); else Reflect.deleteProperty(globalThis, key); });
    if (fonts) Object.defineProperty(document, "fonts", fonts); else Reflect.deleteProperty(document, "fonts");
  }
});
