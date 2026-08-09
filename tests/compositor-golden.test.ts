import assert from "node:assert/strict";
import test from "node:test";
import { expectPixel, pixelAt, solidCanvas, testCanvas } from "./canvas-harness.ts";
import {
  NEUTRAL_LEVELS,
  createDocument,
  createGroupLayer,
  createLevelsLayer,
  createRasterLayer,
  newCanvas,
  type Document,
  type Layer,
} from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";

// End-to-end golden tests for the CPU compositor — the code that decides what
// every pixel on screen actually is. `tests/blend-golden.test.ts` proves the
// blend *formulas*; this proves the *pipeline* around them: stacking, opacity,
// masks, visibility, ordering and adjustment layers.
//
// renderClean() is used deliberately: it disables the checkerboard, selection
// overlay and soft-proofing, so assertions see composited pixels rather than
// presentation chrome.

const SIZE = 8;
const MID = 4;

function docWith(layers: Layer[]): Document {
  const doc = createDocument(SIZE, SIZE);
  doc.layers = layers;
  return doc;
}

function compose(layers: Layer[]) {
  const target = testCanvas(SIZE, SIZE);
  renderClean(docWith(layers), target);
  return pixelAt(target, MID, MID);
}

function raster(name: string, color: string, patch: Partial<Layer> = {}): Layer {
  return { ...createRasterLayer(name, solidCanvas(SIZE, SIZE, color)), ...patch };
}

function check(
  actual: { r: number; g: number; b: number; a: number },
  expected: { r: number; g: number; b: number; a?: number },
  message: string,
) {
  const failures = expectPixel(actual, expected);
  assert.equal(failures.length, 0, `${message} — ${failures.join("; ")}`);
}

test("a single opaque layer composites to its own colour", () => {
  check(compose([raster("red", "#ff0000")]), { r: 255, g: 0, b: 0, a: 255 }, "opaque red");
});

test("an empty document composites to fully transparent", () => {
  const px = compose([]);
  assert.equal(px.a, 0, `expected transparent, got alpha ${px.a}`);
});

test("layer opacity blends linearly against the layer below", () => {
  // 50% blue over opaque red -> half of each channel.
  check(
    compose([raster("blue", "#0000ff", { opacity: 0.5 }), raster("red", "#ff0000")]),
    { r: 128, g: 0, b: 128, a: 255 },
    "50% blue over red",
  );
});

test("opacity 0 leaves the layer below untouched", () => {
  check(
    compose([raster("blue", "#0000ff", { opacity: 0 }), raster("red", "#ff0000")]),
    { r: 255, g: 0, b: 0, a: 255 },
    "transparent top layer",
  );
});

test("a hidden layer is skipped entirely", () => {
  check(
    compose([raster("blue", "#0000ff", { visible: false }), raster("red", "#ff0000")]),
    { r: 255, g: 0, b: 0, a: 255 },
    "hidden top layer",
  );
});

test("index 0 is the topmost layer", () => {
  // Both opaque and Normal: whichever is on top wins outright.
  check(compose([raster("blue", "#0000ff"), raster("red", "#ff0000")]), { r: 0, g: 0, b: 255 }, "blue on top");
  check(compose([raster("red", "#ff0000"), raster("blue", "#0000ff")]), { r: 255, g: 0, b: 0 }, "red on top");
});

test("multiply composites through the native canvas path", () => {
  // 50% grey (0.502) multiplied onto red (1,0,0) -> (0.502, 0, 0).
  check(
    compose([raster("grey", "#808080", { blend: "multiply" }), raster("red", "#ff0000")]),
    { r: 128, g: 0, b: 0 },
    "multiply grey over red",
  );
});

test("screen composites through the native canvas path", () => {
  // Cb + Cs - Cb*Cs against red -> (1, 0.502, 0.502).
  check(
    compose([raster("grey", "#808080", { blend: "screen" }), raster("red", "#ff0000")]),
    { r: 255, g: 128, b: 128 },
    "screen grey over red",
  );
});

test("subtract composites through the custom (non-native) path", () => {
  // "subtract" has no canvas globalCompositeOperation, so this exercises the
  // getImageData maths in blend.ts rather than the browser's compositor.
  // Cb - Cs = (1 - 0.502, 0 - 0.502, 0 - 0.502) clamped -> (0.498, 0, 0).
  check(
    compose([raster("grey", "#808080", { blend: "subtract" }), raster("red", "#ff0000")]),
    { r: 127, g: 0, b: 0 },
    "subtract grey from red",
  );
});

test("a fully opaque mask leaves the layer visible", () => {
  const layer = raster("blue", "#0000ff");
  layer.mask = solidCanvas(SIZE, SIZE, "rgba(0,0,0,1)");
  check(compose([layer, raster("red", "#ff0000")]), { r: 0, g: 0, b: 255 }, "opaque mask");
});

test("a fully transparent mask hides the layer", () => {
  const layer = raster("blue", "#0000ff");
  layer.mask = newCanvas(SIZE, SIZE); // never painted -> alpha 0 everywhere
  check(compose([layer, raster("red", "#ff0000")]), { r: 255, g: 0, b: 0 }, "empty mask");
});

test("a half-alpha mask blends the layer at half strength", () => {
  const layer = raster("blue", "#0000ff");
  layer.mask = solidCanvas(SIZE, SIZE, "rgba(0,0,0,0.5)");
  check(compose([layer, raster("red", "#ff0000")]), { r: 128, g: 0, b: 128 }, "50% mask");
});

test("masks and layer opacity multiply together", () => {
  const layer = raster("blue", "#0000ff", { opacity: 0.5 });
  layer.mask = solidCanvas(SIZE, SIZE, "rgba(0,0,0,0.5)");
  // 0.5 opacity * 0.5 mask = 0.25 blue over red.
  check(compose([layer, raster("red", "#ff0000")]), { r: 191, g: 0, b: 64 }, "mask x opacity");
});

test("a levels adjustment layer rescales the layers beneath it", () => {
  // outWhite 0.5 halves the output range: white -> mid grey.
  const levels = createLevelsLayer("halve", { ...NEUTRAL_LEVELS, outWhite: 0.5 });
  check(compose([levels, raster("white", "#ffffff")]), { r: 128, g: 128, b: 128 }, "levels outWhite 0.5");
});

test("an adjustment layer only affects layers below it", () => {
  // The white layer sits ABOVE the adjustment, so it must come through clean.
  const levels = createLevelsLayer("halve", { ...NEUTRAL_LEVELS, outWhite: 0.5 });
  check(
    compose([raster("white", "#ffffff"), levels, raster("black", "#000000")]),
    { r: 255, g: 255, b: 255 },
    "layer above adjustment is unaffected",
  );
});

test("a hidden adjustment layer has no effect", () => {
  const levels = createLevelsLayer("halve", { ...NEUTRAL_LEVELS, outWhite: 0.5 });
  levels.visible = false;
  check(compose([levels, raster("white", "#ffffff")]), { r: 255, g: 255, b: 255 }, "hidden adjustment");
});

test("compositing is deterministic across repeated renders", () => {
  // The renderer keeps a viewport tile cache keyed by revision; rendering the
  // same document twice must not drift.
  const layers = [raster("grey", "#808080", { blend: "multiply" }), raster("red", "#ff0000")];
  const first = compose(layers);
  const second = compose(layers);
  assert.deepEqual(second, first, "identical input produced a different frame");
});

// ---------------------------------------------------------------------------
// Group layers.
//
// Added after mutation testing: neutering `layer.opacity` in the group branch
// of renderLayerSequence broke nothing, which meant isolated-group compositing
// had no coverage at all. Groups take a different path from ordinary layers —
// children render into an offscreen buffer that is then composited as a unit —
// so opacity, mask and blend all have to be re-proven here.
// ---------------------------------------------------------------------------

function group(name: string, patch: Partial<Layer> = {}): Layer {
  return { ...createGroupLayer(name), ...patch };
}

function child(parentId: string, name: string, color: string, patch: Partial<Layer> = {}): Layer {
  return { ...raster(name, color, patch), parentId };
}

test("a pass-through group renders its children unchanged", () => {
  const g = group("pass");
  check(
    compose([g, child(g.id, "blue", "#0000ff"), raster("red", "#ff0000")]),
    { r: 0, g: 0, b: 255 },
    "pass-through group",
  );
});

test("group opacity scales the whole group as one unit", () => {
  // opacity != 1 makes the group isolated: children composite offscreen first,
  // then the buffer is blended at 50% over red.
  const g = group("half", { opacity: 0.5 });
  check(
    compose([g, child(g.id, "blue", "#0000ff"), raster("red", "#ff0000")]),
    { r: 128, g: 0, b: 128 },
    "50% group over red",
  );
});

test("a group mask clips its children", () => {
  const g = group("masked");
  g.mask = solidCanvas(SIZE, SIZE, "rgba(0,0,0,0.5)");
  check(
    compose([g, child(g.id, "blue", "#0000ff"), raster("red", "#ff0000")]),
    { r: 128, g: 0, b: 128 },
    "50% group mask",
  );
});

test("an empty isolated group leaves the layers below untouched", () => {
  const g = group("empty", { opacity: 0.5 });
  check(compose([g, raster("red", "#ff0000")]), { r: 255, g: 0, b: 0 }, "empty group");
});

test("a hidden group hides its children", () => {
  const g = group("hidden", { visible: false });
  check(
    compose([g, child(g.id, "blue", "#0000ff"), raster("red", "#ff0000")]),
    { r: 255, g: 0, b: 0 },
    "hidden group",
  );
});

test("group opacity multiplies with child opacity", () => {
  const g = group("half", { opacity: 0.5 });
  check(
    compose([g, child(g.id, "blue", "#0000ff", { opacity: 0.5 }), raster("red", "#ff0000")]),
    { r: 191, g: 0, b: 64 },
    "0.5 group x 0.5 child",
  );
});

test("nested isolated groups retain independent reusable buffers", () => {
  const outer = group("outer", { opacity: 0.5 });
  const inner = group("inner", { opacity: 0.5, parentId: outer.id });
  check(
    compose([outer, inner, child(inner.id, "blue", "#0000ff"), raster("red", "#ff0000")]),
    { r: 191, g: 0, b: 64 },
    "0.5 outer group x 0.5 inner group",
  );
});
