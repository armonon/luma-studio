import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { addImageFileAsLayer } from "../app/studio/focus-import.ts";

test("a delayed image decode cannot add a layer to the wrong document", async (t) => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  studio.addBlankRaster("Original");
  const originalId = studio.activeDocumentState().id;
  const previousImage = globalThis.Image;
  t.after(() => { globalThis.Image = previousImage; studio.dispose(); });
  globalThis.Image = class {
    naturalWidth = 8;
    naturalHeight = 8;
    onload: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => { studio.resetDocument(16, 16, "Other"); this.onload?.(); });
    }
  } as unknown as typeof Image;
  const png = await new Promise<Blob>(resolve => testCanvas(8, 8).toBlob(blob => resolve(blob!), "image/png"));
  await assert.rejects(addImageFileAsLayer(studio, new File([png], "test.png", { type: "image/png" })), /active document changed/);
  assert.equal(studio.doc.width, 16);
  assert.equal(studio.doc.layers.length, 0);
  studio.switchDocument(originalId);
  assert.equal(studio.doc.layers.length, 1);
  assert.equal(studio.doc.layers[0].name, "Original");
});
