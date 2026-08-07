import assert from "node:assert/strict";
import test from "node:test";
import {
  bitmapBytes,
  documentSnapshotBytes,
  historyEntrySize,
  layerSnapshotBytes,
} from "../app/engine/history-payload.ts";
import type { HistoryEntry, LayerSnapshot } from "../app/engine/studio.ts";

// The byte estimator only reads width and height off canvases; a plain shape
// with those fields is enough for the calculation and lets these tests run
// without a canvas backend.
function canvas(w: number, h: number): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

test("bitmapBytes reports width * height * 4 or 0 for absent bitmaps", () => {
  assert.equal(bitmapBytes(undefined), 0);
  assert.equal(bitmapBytes(canvas(100, 50)), 100 * 50 * 4);
  assert.equal(bitmapBytes(canvas(0, 0)), 0);
});

test("layerSnapshotBytes sums bitmap and mask pixels", () => {
  const snap: LayerSnapshot = {
    layerId: "l1",
    bitmap: canvas(200, 200),
    mask: canvas(200, 200),
  };
  assert.equal(layerSnapshotBytes(snap), 200 * 200 * 4 * 2);
});

test("documentSnapshotBytes walks layers and selection", () => {
  const doc = {
    width: 100,
    height: 100,
    layers: [
      { bitmap: canvas(100, 100) },
      { mask: canvas(100, 100) },
    ],
    selection: { mask: canvas(100, 100), bounds: { x: 0, y: 0, w: 100, h: 100 } },
  } as unknown as Parameters<typeof documentSnapshotBytes>[0];
  const expected = 100 * 100 * 4 * 3; // 2 layer bitmaps/masks + 1 selection mask
  assert.equal(documentSnapshotBytes(doc), expected);
  assert.equal(documentSnapshotBytes(undefined), 0);
});

test("historyEntrySize adds fixed overhead plus every snapshot's pixels", () => {
  const before: LayerSnapshot = { layerId: "l1", bitmap: canvas(1024, 768) };
  const after: LayerSnapshot = { layerId: "l1", bitmap: canvas(1024, 768) };
  const entry: HistoryEntry = { label: "test", before: [before], after: [after] };
  const expected = 128 + 1024 * 768 * 4 * 2;
  assert.equal(historyEntrySize(entry), expected);
});

test("historyEntrySize scales with layersBefore/After and selection payload", () => {
  const entry: HistoryEntry = {
    label: "structural",
    before: [],
    after: [],
    layersBefore: [{ bitmap: canvas(256, 256), mask: canvas(256, 256) } as never],
    layersAfter: [{ bitmap: canvas(256, 256) } as never],
    selectionBefore: { mask: canvas(256, 256), bounds: { x: 0, y: 0, w: 256, h: 256 } },
    selectionAfter: null,
  };
  const layerBytes = 256 * 256 * 4;
  const expected = 128 + layerBytes * 2 /* before layer bitmap+mask */
    + layerBytes /* after layer bitmap */
    + layerBytes; /* selectionBefore mask */
  assert.equal(historyEntrySize(entry), expected);
});

test("historyEntrySize counts pixelPatches and surfacePatches", () => {
  const imgData = new Uint8ClampedArray(4 * 4);
  const patchImg = { data: imgData, width: 2, height: 2, colorSpace: "srgb" as const };
  const entry: HistoryEntry = {
    label: "patched",
    before: [],
    after: [],
    pixelPatches: [{
      layerId: "l1",
      target: "bitmap",
      x: 0,
      y: 0,
      before: patchImg as unknown as ImageData,
      after: patchImg as unknown as ImageData,
    }],
    surfacePatches: [{
      layerId: "l1",
      key: "0,0",
      before: new Uint8Array(64),
      after: new Uint8Array(64),
    }],
  };
  const pixelPatchBytes = imgData.byteLength * 2;
  const surfacePatchBytes = 64 * 2;
  assert.equal(historyEntrySize(entry), 128 + pixelPatchBytes + surfacePatchBytes);
});

test("a canvas shared between layersBefore and layersAfter is billed once", () => {
  // `shallowCloneLayer` does NOT copy pixels — structural entries hold the same
  // canvas objects on both sides. Billing them twice massively over-states the
  // entry and makes the byte cap fire far below real memory use.
  const shared = canvas(4000, 3000);
  const entry: HistoryEntry = {
    label: "layer reordered",
    before: [],
    after: [],
    layersBefore: [{ bitmap: shared } as never],
    layersAfter: [{ bitmap: shared } as never],
  };
  const once = 4000 * 3000 * 4;
  assert.equal(
    historyEntrySize(entry),
    128 + once,
    "the same canvas object must not be counted on both sides",
  );
});

test("distinct canvases are still billed separately", () => {
  const entry: HistoryEntry = {
    label: "two distinct",
    before: [{ layerId: "a", bitmap: canvas(100, 100) }],
    after: [{ layerId: "a", bitmap: canvas(100, 100) }],
  };
  assert.equal(historyEntrySize(entry), 128 + 100 * 100 * 4 * 2);
});
