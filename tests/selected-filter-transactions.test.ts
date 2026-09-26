import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { selectRect } from "../app/engine/selection.ts";
import { createRasterLayer } from "../app/engine/document.ts";
import { desaturate, gaussianBlur, hueRotate, invertColors, unsharpMask } from "../app/engine/filters.ts";

const filters = ["blur", "sharpen", "invert", "desaturate", "hue"] as const;
for (const kind of filters) test(`selected ${kind} matches the original filter and retains regional reopen/undo/redo`, async () => {
  const studio = new Studio(128, 96, testCanvas(1, 1));
  const reopened = new Studio(8, 8, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Pixels"), ctx = layer.bitmap!.getContext("2d")!;
    const original = ctx.createImageData(128, 96);
    for (let i = 0; i < original.data.length; i += 4) original.data.set([(i / 4) % 251, (i / 16) % 251, (i / 64) % 251, 255], i);
    ctx.putImageData(original, 0, 0);
    layer.transform = { tx: 110, ty: 3, sx: 1, sy: 1, rotation: 90 };
    selectRect(studio.doc, 80, 20, 12, 9, "replace");
    const expected = testCanvas(128, 96); expected.getContext("2d")!.putImageData(original, 0, 0);
    const reference = createRasterLayer("Reference", expected); reference.transform = layer.transform;
    if (kind === "blur") gaussianBlur(studio.doc, reference, 8);
    if (kind === "sharpen") unsharpMask(studio.doc, reference, 2, 0.6);
    if (kind === "invert") invertColors(studio.doc, reference);
    if (kind === "desaturate") desaturate(studio.doc, reference, 1);
    if (kind === "hue") hueRotate(studio.doc, reference, 45);
    const bytes = studio.historyState().bytes;
    studio.filter(layer.id, kind);
    assert.deepEqual(ctx.getImageData(0, 0, 128, 96).data, expected.getContext("2d")!.getImageData(0, 0, 128, 96).data);
    assert.ok(studio.historyState().bytes - bytes < 2_000, "12 × 9 pixel diff, not whole-layer snapshots");
    await reopened.importProject(await studio.exportProject(`Selected ${kind}`));
    const pixels = () => reopened.doc.layers[0].bitmap!.getContext("2d")!.getImageData(0, 0, 128, 96).data;
    const edited = new Uint8ClampedArray(pixels());
    assert.notDeepEqual(edited, original.data);
    reopened.undo(); assert.deepEqual(pixels(), original.data);
    reopened.redo(); assert.deepEqual(pixels(), edited);
  } finally { studio.dispose(); reopened.dispose(); }
});

test("selected blur preserves float master outside selection, including its read-only halo", async () => {
  const studio = new Studio(32, 32, testCanvas(1, 1));
  const reopened = new Studio(8, 8, testCanvas(1, 1));
  try {
    studio.setDocumentPrecision(32, "srgb");
    const layer = studio.addBlankRaster("Float");
    layer.surface!.writePixel(20, 20, [0.123456, 0.654321, 1.2, 1]);
    layer.surface!.writePixel(10, 10, [0.123456, 0.654321, 1.2, 1]);
    const key = layer.surface!.grid.address(0, 0).key, original = layer.surface!.store.read(key);
    const untouched = layer.surface!.readPixel(20, 20);
    selectRect(studio.doc, 8, 8, 5, 5, "replace");
    studio.filter(layer.id, "blur", { radius: 8 });
    assert.deepEqual(layer.surface!.readPixel(20, 20), untouched);
    const edited = layer.surface!.store.read(key);
    assert.notDeepEqual(edited, original);
    await reopened.importProject(await studio.exportProject("Float selection"));
    reopened.undo(); assert.deepEqual(reopened.doc.layers[0].surface!.store.read(key), original);
    reopened.redo(); assert.deepEqual(reopened.doc.layers[0].surface!.store.read(key), edited);
  } finally { studio.dispose(); reopened.dispose(); }
});

test("filter no-ops and invalid input do not create history or recorded actions", () => {
  const studio = new Studio(32, 32, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Pixels"), node = studio.historyState().currentId;
    studio.startRecording("No ops");
    studio.filter(layer.id, "blur", {radius:0}); studio.filter(layer.id, "sharpen", {amount:0});
    studio.filter(layer.id, "desaturate", {amount:0}); studio.filter(layer.id, "hue", {degrees:360});
    assert.throws(() => studio.filter(layer.id, "blur", {radius:NaN}), /finite/);
    assert.throws(() => studio.filter(layer.id, "blur", {radius:1e308}), /safe sampling/);
    selectRect(studio.doc, 40, 40, 4, 4, "replace"); studio.filter(layer.id, "invert");
    assert.equal(studio.historyState().currentId, node);
    assert.equal(studio.stopRecording()?.steps.length, 0);
  } finally { studio.dispose(); }
});

test("transformed selection scratch is admitted before any bitmap read or mutation", () => {
  const studio = new Studio(32, 32, testCanvas(1, 1));
  try {
    const layer = studio.addBlankRaster("Pixels"), node = studio.historyState().currentId;
    selectRect(studio.doc, 2, 2, 3, 3, "replace");
    layer.transform.sx = 1e9; layer.transform.sy = 1e9;
    const ctx = layer.bitmap!.getContext("2d")!, original = ctx.getImageData.bind(ctx);
    ctx.getImageData = () => { throw new Error("Bitmap read before admission"); };
    assert.throws(() => studio.filter(layer.id, "invert"), /known-memory admission ceiling/);
    ctx.getImageData = original;
    assert.equal(studio.historyState().currentId, node);
  } finally { studio.dispose(); }
});
