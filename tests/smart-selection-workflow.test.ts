import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Studio } from "../app/engine/studio.ts";
import { bestSamProposal } from "../app/engine/smart-selection.ts";
import { pixelPasteSource } from "../app/studio/selection-clipboard-events.ts";
import { COMMAND_DEFINITIONS } from "../app/studio/command-registry.ts";
import { SparseAlphaSurface } from "../app/engine/alpha-surface.ts";
import { pixelAt, testCanvas } from "./canvas-harness.ts";

function fixture() {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Source");
  studio.fillLayer(layer.id, "#ff0000");
  return { studio, layer };
}

test("native clipboard import reserves bounded memory and invalidates after document edits", () => {
  const { studio, layer } = fixture();
  const first = studio.beginClipboardImport();
  assert.throws(() => studio.beginClipboardImport(), /ceiling/);
  studio.fillLayer(layer.id, "#00ff00");
  assert.throws(first.assertCurrent, /changed|edited/);
  first.release(); first.release();
  const next = studio.beginClipboardImport(); next.assertCurrent(); next.release();
  studio.dispose();
});

test("selected pixels copy, paste in place and undo independently of their source", () => {
  const { studio, layer } = fixture();
  studio.selectRect(3, 4, 5, 6);
  const copied = studio.copyPixels(layer.id);
  assert.equal(copied.width, 5); assert.equal(copied.height, 6);
  assert.equal(pixelAt(copied, 2, 2).r, 255);
  studio.clearPixels(layer.id);
  const pasted = studio.pastePixels(true);
  assert.equal(pasted.transform.tx, 3); assert.equal(pasted.transform.ty, 4);
  assert.equal(pixelAt(pasted.bitmap!, 2, 2).r, 255);
  studio.undo(); assert.equal(studio.doc.layers.some(l => l.id === pasted.id), false);
  studio.redo(); assert.equal(studio.doc.layers.some(l => l.id === pasted.id), true);
  studio.dispose();
});

test("Cut is undoable and does not remove pixels outside the selection", () => {
  const { studio, layer } = fixture();
  studio.selectRect(2, 2, 4, 4);
  studio.cutPixels(layer.id);
  assert.equal(pixelAt(layer.bitmap!, 3, 3).a, 0);
  assert.equal(pixelAt(layer.bitmap!, 8, 8).a, 255);
  studio.undo(); assert.equal(pixelAt(layer.bitmap!, 3, 3).a, 255);
  studio.redo(); assert.equal(pixelAt(layer.bitmap!, 3, 3).a, 0);
  assert.equal(studio.hasPixelClipboard(), true);
  studio.dispose();
});

test("clipboard preserves soft selection alpha and Delete removes only that coverage", () => {
  const { studio, layer } = fixture();
  const surface = new SparseAlphaSurface(16, 16);
  surface.fillRect({ x: 2, y: 2, width: 4, height: 4 }, 128);
  studio.doc.selection = { surface, bounds: surface.bounds() };
  const copy = studio.copyPixels(layer.id);
  assert.ok(Math.abs(pixelAt(copy, 1, 1).a - 128) <= 1);
  studio.clearPixels(layer.id);
  assert.ok(Math.abs(pixelAt(layer.bitmap!, 3, 3).a - 127) <= 1);
  studio.undo(); assert.equal(pixelAt(layer.bitmap!, 3, 3).a, 255);
  studio.dispose();
});

test("clipboard follows document coordinates on transformed layers and survives tab changes", () => {
  const { studio, layer } = fixture();
  layer.transform.tx = 4; layer.transform.ty = 3;
  studio.selectRect(5, 5, 3, 3);
  const copy = studio.copyPixels(layer.id);
  assert.equal(pixelAt(copy, 0, 0).a, 255);
  studio.resetDocument(32, 32, "Destination");
  const pasted = studio.pastePixels();
  assert.equal(pasted.transform.tx, 15);
  assert.equal(pasted.transform.ty, 15);
  assert.equal(pasted.bitmap!.width, 3);
  studio.dispose();
});

test("failed/locked/empty copies preserve clipboard and document history", () => {
  const { studio, layer } = fixture();
  studio.selectRect(1, 1, 2, 2); studio.copyPixels(layer.id);
  layer.locked = true;
  const history = studio.historyState().currentId;
  assert.throws(() => studio.cutPixels(layer.id), /unlocked/);
  assert.equal(studio.historyState().currentId, history);
  layer.locked = false; studio.clearPixels(layer.id);
  assert.throws(() => studio.copyPixels(layer.id), /No visible pixels/);
  assert.equal(studio.pastePixels().bitmap!.width, 2);
  studio.dispose();
});

test("Copy Merged captures visible compositing rather than just the active layer", () => {
  const { studio, layer } = fixture();
  const upper = studio.addBlankRaster("Upper"); studio.fillLayer(upper.id, "#0000ff");
  studio.selectRect(0, 0, 4, 4);
  assert.equal(pixelAt(studio.copyPixels(layer.id), 1, 1).r, 255);
  assert.equal(pixelAt(studio.copyPixels(undefined, true), 1, 1).b, 255);
  studio.dispose();
});

test("50K delete visits resident tiles and undo restores them; huge copies fail before mutation", () => {
  const studio = new Studio(50_000, 50_000, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Sparse");
  const tile = layer.surface!.grid.address(90, 90);
  const values = new Float32Array(tile.width * tile.height * 4);
  for (let i = 0; i < values.length; i += 4) { values[i] = 1; values[i + 3] = 1; }
  layer.surface!.writeWorkingFloat32Tile(tile.key, values);
  studio.selectRect(tile.x, tile.y, 8, 8);
  const copy = studio.copyPixels(layer.id); assert.equal(copy.width, 8);
  studio.clearPixels(layer.id);
  assert.equal(layer.surface!.tileToWorkingFloat32(tile.key)[3], 0);
  studio.undo(); assert.equal(layer.surface!.tileToWorkingFloat32(tile.key)[3], 1);
  studio.redo(); assert.equal(layer.surface!.tileToWorkingFloat32(tile.key)[3], 0);
  studio.selectAll();
  const history = studio.historyState().currentId;
  assert.throws(() => studio.copyPixels(layer.id), /16 megapixels/);
  assert.equal(studio.historyState().currentId, history);
  assert.ok(layer.surface!.store.stats().residentBytes < 2 * 1024 * 1024);
  studio.dispose();
});

test("Quick Selection stroke produces one undo step and cancellation restores its starting selection", () => {
  const { studio, layer } = fixture();
  studio.selectRect(0, 0, 8, 8);
  const before = studio.historyState().currentId;
  studio.beginSelectionGesture("subtract");
  for (let i = 1; i < 6; i++) studio.selectByColor(layer.id, i, i, 10, "subtract");
  assert.equal(studio.historyState().currentId, before);
  studio.endSelectionGesture();
  assert.notEqual(studio.historyState().currentId, before);
  studio.undo(); assert.equal(studio.historyState().currentId, before);
  assert.equal(studio.doc.selection!.surface!.sample(2, 2), 255);
  studio.beginSelectionGesture(); studio.selectByColor(layer.id, 1, 1, 10);
  studio.cancelSelectionGesture();
  assert.equal(studio.doc.selection!.surface!.sample(10, 10), 0);
  studio.dispose();
});

test("Quick Selection Intersect applies to the union of the stroke, not each dab", () => {
  const { studio, layer } = fixture();
  studio.selectRect(8, 0, 8, 16); studio.fillLayer(layer.id, "blue"); studio.selectAll();
  studio.beginSelectionGesture("intersect");
  studio.selectByColor(layer.id, 2, 2, 1, "intersect");
  studio.selectByColor(layer.id, 10, 2, 1, "intersect");
  studio.endSelectionGesture();
  assert.equal(studio.doc.selection!.surface!.sample(2, 2), 255);
  assert.equal(studio.doc.selection!.surface!.sample(10, 2), 255);
  studio.dispose();
});

test("SAM chooses highest confidence with prompt agreement, not largest area", () => {
  const masks = { dims: [1, 3, 2, 2], data: new Uint8Array([1,1,1,1, 1,0,0,0, 0,1,1,1]) };
  assert.equal(bestSamProposal(masks, [.6, .95, .99], [{x:0,y:0}]).index, 1);
  assert.equal(bestSamProposal(masks, [.99, .8, .7], [{x:0,y:0}, {x:1,y:1,label:"exclude"}]).index, 1);
  assert.throws(() => bestSamProposal(masks, [.9,.8,.7], [{x:NaN,y:0}]), /No predicted mask/);
  assert.throws(() => bestSamProposal({...masks, dims:[1,3,999999,999999]}, [], []), /dimensions/);
});

test("high-depth Delete preserves unaffected HDR values while destructive 8-bit Cut is refused", () => {
  const { studio, layer } = fixture();
  studio.setDocumentPrecision(32, "linear-srgb");
  const values = layer.surface!.tileToWorkingFloat32("0:0");
  values[0] = 3.25; values[4] = .123456;
  layer.surface!.writeWorkingFloat32Tile("0:0", values);
  studio.selectRect(1, 0, 1, 1);
  const history = studio.historyState().currentId;
  assert.throws(() => studio.cutPixels(layer.id), /clipboard is 8-bit/);
  assert.equal(studio.historyState().currentId, history);
  studio.clearPixels(layer.id);
  assert.equal(layer.surface!.tileToWorkingFloat32("0:0")[0], 3.25);
  assert.equal(layer.surface!.tileToWorkingFloat32("0:0")[7], 0);
  studio.undo();
  assert.deepEqual(layer.surface!.tileToWorkingFloat32("0:0"), values);
  studio.dispose();
});

test("a failed tile Delete rolls pixels and history back and preserves the old clipboard", () => {
  const { studio, layer } = fixture();
  studio.selectRect(1, 1, 2, 2); studio.copyPixels(layer.id);
  studio.selectRect(2, 2, 4, 4);
  const history = studio.historyState().currentId;
  const before = layer.surface!.store.read("0:0");
  const write = layer.surface!.writeWorkingFloat32Tile.bind(layer.surface);
  layer.surface!.writeWorkingFloat32Tile = (key, values) => { write(key, values); throw new Error("Injected tile failure"); };
  assert.throws(() => studio.cutPixels(layer.id), /Injected tile failure/);
  assert.deepEqual(layer.surface!.store.read("0:0"), before);
  assert.equal(pixelAt(layer.bitmap!, 3, 3).a, 255);
  assert.equal(studio.historyState().currentId, history);
  layer.surface!.writeWorkingFloat32Tile = write;
  assert.equal(studio.pastePixels().bitmap!.width, 2);
  studio.dispose();
});

test("changing documents cancels a live Quick Selection without touching the new document", () => {
  const { studio, layer } = fixture();
  const a = studio.activeDocumentState().id;
  studio.selectRect(0, 0, 2, 2);
  studio.resetDocument(8, 8, "Other"); const b = studio.activeDocumentState().id;
  studio.switchDocument(a);
  studio.beginSelectionGesture(); studio.selectByColor(layer.id, 3, 3, 10);
  studio.switchDocument(b); assert.equal(studio.doc.selection, null);
  studio.switchDocument(a); assert.equal(studio.doc.selection!.surface!.sample(3, 3), 0);
  assert.equal(studio.doc.selection!.surface!.sample(1, 1), 255);
  studio.dispose();
});

test("paste routes internal pixels without replacing external text with stale pixels", () => {
  assert.equal(pixelPasteSource(["text/plain"], "own", "own", true, false), "internal");
  assert.equal(pixelPasteSource(["text/plain"], "external", "own", true, false), "none");
  assert.equal(pixelPasteSource(["Files"], "", "own", true, true), "image");
  assert.equal(pixelPasteSource([], "", "own", true, false), "internal");
  assert.equal(COMMAND_DEFINITIONS["copy-merged"].shortcut, "CmdOrCtrl+Shift+C");
  assert.equal(COMMAND_DEFINITIONS["paste-in-place"].shortcut, "CmdOrCtrl+Shift+V");
  assert.equal(COMMAND_DEFINITIONS["selection-to-layer"].shortcut, "CmdOrCtrl+Alt+J");
});

test("the document canvas binds on mount, not only after viewport effects", () => {
  const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<canvas\s+key=\{activeDocumentId\}\s+ref=\{bindDisplayCanvas\}/);
  assert.match(page, /if \(canvas\) studio\?\.attachDisplayTarget\(canvas\)/);
});

test("queued preview frames follow the attached canvas and cannot repaint after disposal", () => {
  const { studio, layer } = fixture();
  const host = globalThis as unknown as Record<string, unknown>;
  const oldWindow = host.window, oldRaf = host.requestAnimationFrame;
  const frames: Array<() => void> = [];
  host.window = { setTimeout: () => 1, clearTimeout: () => {} };
  host.requestAnimationFrame = (callback: () => void) => { frames.push(callback); return frames.length; };
  try {
    const target = testCanvas(16, 16);
    studio.requestRender(); studio.attachDisplayTarget(target);
    const viewport = { x: 0, y: 0, width: 16, height: 16, outputWidth: 16, outputHeight: 16, zoom: 1, cssScale: 1, devicePixelRatio: 1 };
    studio.setVirtualViewport(viewport);
    while (frames.length) frames.shift()!();
    assert.equal(pixelAt(target, 8, 8).r, 255);
    studio.fillLayer(layer.id, "blue"); studio.dispose();
    while (frames.length) frames.shift()!();
    assert.equal(pixelAt(target, 8, 8).r, 255);
  } finally {
    if (oldWindow === undefined) delete host.window; else host.window = oldWindow;
    if (oldRaf === undefined) delete host.requestAnimationFrame; else host.requestAnimationFrame = oldRaf;
  }
});
