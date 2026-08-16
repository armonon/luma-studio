import assert from "node:assert/strict";
import test from "node:test";
import {
  planCanvasGesture,
  resolveSelectionMode,
  type CanvasGestureContext,
  type CanvasDragDraft,
} from "../app/studio/canvas-gesture.ts";

const context: CanvasGestureContext = {
  preferredSelectionMode: "replace",
  modifiers: { shiftKey: false, altKey: false },
  feather: 6,
  activeRasterLayerId: "raster-1",
  brushColor: "#abcdef",
  secondaryColor: "#102030",
  gradientType: "radial",
  text: "A paragraph",
  textSize: 72,
  warpRadius: 180,
};

function drag(kind: CanvasDragDraft["kind"], x0 = 10, y0 = 20, x1 = 50, y1 = 80): CanvasDragDraft {
  return { kind, x0, y0, x1, y1 };
}

test("selection modifiers override the toolbar mode with Shift taking precedence", () => {
  assert.equal(resolveSelectionMode("intersect", { shiftKey: false, altKey: false }), "intersect");
  assert.equal(resolveSelectionMode("intersect", { shiftKey: false, altKey: true }), "subtract");
  assert.equal(resolveSelectionMode("intersect", { shiftKey: true, altKey: false }), "add");
  assert.equal(resolveSelectionMode("intersect", { shiftKey: true, altKey: true }), "add");
});

test("a reverse rectangular marquee becomes normalized document bounds", () => {
  const intent = planCanvasGesture(drag("sel-rect", 50, 80, 10, 20), context);
  assert.deepEqual(intent, {
    kind: "select-rect",
    bounds: { x: 10, y: 20, width: 40, height: 60 },
    mode: "replace",
    feather: 6,
  });
});

test("selection gestures preserve their distinct geometry and modifier mode", () => {
  const intent = planCanvasGesture(drag("sel-ellipse"), {
    ...context,
    modifiers: { shiftKey: false, altKey: true },
  });
  assert.deepEqual(intent, {
    kind: "select-ellipse",
    bounds: { x: 10, y: 20, width: 40, height: 60 },
    mode: "subtract",
    feather: 6,
  });
});

test("two-pixel marquee and shape slivers are rejected at the exact boundary", () => {
  assert.equal(planCanvasGesture(drag("sel-rect", 0, 0, 2, 20), context), null);
  assert.equal(planCanvasGesture(drag("rect", 0, 0, 20, 2), context), null);
  assert.notEqual(planCanvasGesture(drag("sel-rect", 0, 0, 2.01, 20), context), null);
  assert.notEqual(planCanvasGesture(drag("rect", 0, 0, 20, 2.01), context), null);
});

test("lasso completion requires five sampled points and does not alias the draft", () => {
  const four = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  assert.equal(planCanvasGesture({ ...drag("sel-lasso"), path: four }, context), null);

  const five = [...four, { x: 0, y: 0 }];
  const intent = planCanvasGesture({ ...drag("sel-lasso"), path: five }, context);
  assert.equal(intent?.kind, "select-lasso");
  if (!intent || intent.kind !== "select-lasso") return;
  assert.deepEqual(intent.path, five);
  assert.notEqual(intent.path, five);
  five[0].x = 99;
  assert.equal(intent.path[0].x, 0);
});

test("rectangle and ellipse drags carry the chosen fill into different shape intents", () => {
  assert.deepEqual(planCanvasGesture(drag("rect"), context), {
    kind: "shape",
    shape: "rect",
    bounds: { x: 10, y: 20, width: 40, height: 60 },
    fill: "#abcdef",
  });
  assert.deepEqual(planCanvasGesture(drag("ellipse"), context), {
    kind: "shape",
    shape: "ellipse",
    bounds: { x: 10, y: 20, width: 40, height: 60 },
    fill: "#abcdef",
  });
});

test("geometric path gestures retain which geometry the user chose", () => {
  for (const shape of ["triangle", "polygon", "line", "custom-shape"] as const) {
    assert.deepEqual(planCanvasGesture(drag(shape), context), {
      kind: "path-shape",
      shape,
      bounds: { x: 10, y: 20, width: 40, height: 60 },
      fill: "#abcdef",
    });
  }
});

test("frame placement preserves the Shift modifier", () => {
  assert.deepEqual(planCanvasGesture(drag("frame"), {
    ...context,
    modifiers: { shiftKey: true, altKey: false },
  }), {
    kind: "frame",
    bounds: { x: 10, y: 20, width: 40, height: 60 },
    shifted: true,
  });
});

test("paragraph boxes reject the eight-pixel boundary and carry text layout values", () => {
  assert.equal(planCanvasGesture(drag("paragraph-text", 0, 0, 8, 20), context), null);
  assert.deepEqual(planCanvasGesture(drag("paragraph-text", 2, 3, 12, 23), context), {
    kind: "paragraph-text",
    bounds: { x: 2, y: 3, width: 10, height: 20 },
    text: "A paragraph",
    color: "#abcdef",
    font: "700 72px 'Inter', system-ui, sans-serif",
  });
});

test("gradient retains direction while crop normalizes its rectangle", () => {
  assert.deepEqual(planCanvasGesture(drag("gradient", 50, 80, 10, 20), context), {
    kind: "gradient",
    layerId: "raster-1",
    from: { x: 50, y: 80 },
    to: { x: 10, y: 20 },
    startColor: "#abcdef",
    endColor: "#102030",
    gradientType: "radial",
  });
  assert.deepEqual(planCanvasGesture(drag("crop", 50, 80, 10, 20), context), {
    kind: "crop",
    bounds: { x: 10, y: 20, width: 40, height: 60 },
  });
});

test("straightening uses the negative drag angle", () => {
  const horizontal = planCanvasGesture(drag("straighten", 0, 0, 10, 0), context);
  const downRight = planCanvasGesture(drag("straighten", 0, 0, 10, 10), context);
  assert.deepEqual(horizontal, { kind: "straighten", radians: -0 });
  assert.ok(downRight?.kind === "straighten");
  if (downRight?.kind === "straighten") {
    assert.ok(Math.abs(downRight.radians + Math.PI / 4) < 1e-12);
  }
});

test("content move and radial warp target only the active raster layer", () => {
  assert.deepEqual(planCanvasGesture(drag("content-move", 4, 9, 17, 30), context), {
    kind: "content-move",
    layerId: "raster-1",
    deltaX: 13,
    deltaY: 21,
  });
  assert.deepEqual(planCanvasGesture(drag("radial-warp", 4, 9, 17, 30), context), {
    kind: "radial-warp",
    layerId: "raster-1",
    from: { x: 4, y: 9 },
    to: { x: 17, y: 30 },
    radius: 180,
  });

  const withoutRaster = { ...context, activeRasterLayerId: null };
  assert.equal(planCanvasGesture(drag("gradient"), withoutRaster), null);
  assert.equal(planCanvasGesture(drag("content-move"), withoutRaster), null);
  assert.equal(planCanvasGesture(drag("radial-warp"), withoutRaster), null);
});

test("a ruler click remains a valid zero-length measurement", () => {
  assert.deepEqual(planCanvasGesture(drag("ruler", 12, 14, 12, 14), context), {
    kind: "measurement",
    start: { x: 12, y: 14 },
    end: { x: 12, y: 14 },
  });
});

