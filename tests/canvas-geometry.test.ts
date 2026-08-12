import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { SNAP_SLACK_PX, cornerDragTransform, snapTranslation } from "../app/studio/canvas-geometry.ts";
import { createRasterLayer, layerCorners, newCanvas } from "../app/engine/document.ts";
import type { Layer, Transform } from "../app/engine/document.ts";

const DOC = { width: 400, height: 300, guides: [] as { orientation: "vertical" | "horizontal"; position: number }[] };

/** A layer at half scale, so its box is 200x150 and can sit anywhere. */
function halfScaleLayer(): Layer {
  const layer = createRasterLayer("box", newCanvas(400, 300));
  layer.transform = { ...layer.transform, sx: 0.5, sy: 0.5 };
  return layer;
}

// --- snapping ---------------------------------------------------------------

test("a layer close to the canvas edge is pulled flush against it", () => {
  const layer = halfScaleLayer();
  const snapped = snapTranslation(layer, DOC, 1, 3, 4);
  assert.equal(snapped.tx, 0, "3px from the left margin should snap to it");
  assert.equal(snapped.ty, 0, "4px from the top margin should snap to it");
});

test("a layer well clear of every target is left exactly where it was", () => {
  const layer = halfScaleLayer();
  const snapped = snapTranslation(layer, DOC, 1, 63, 47);
  assert.deepEqual(snapped, { tx: 63, ty: 47 });
});

test("the layer's centre snaps to the canvas centre, not just its edges", () => {
  const layer = halfScaleLayer();
  // Centred is tx = (400 - 200) / 2 = 100. Sit three pixels off.
  const snapped = snapTranslation(layer, DOC, 1, 103, 200);
  assert.equal(snapped.tx, 100, "the centre anchor should have caught the canvas centre");
});

test("a guide is a snap target alongside the canvas edges", () => {
  const layer = halfScaleLayer();
  const withGuide = { ...DOC, guides: [{ orientation: "vertical" as const, position: 250 }] };
  // The right edge of the box sits at tx + 200; put it two pixels short of 250.
  const snapped = snapTranslation(layer, withGuide, 1, 48, 200);
  assert.equal(snapped.tx, 50, "the right edge should have landed on the guide");
});

test("the snap threshold is measured in screen pixels, so it shrinks as you zoom in", () => {
  const layer = halfScaleLayer();
  // Six document pixels out: inside the 8px slack at 1x, outside it at 4x
  // (where the same gap is 24 screen pixels and should feel far away).
  const offset = 6;
  assert.equal(snapTranslation(layer, DOC, 1, offset, 200).tx, 0, "at 1x this is within reach");
  assert.equal(
    snapTranslation(layer, DOC, 4, offset, 200).tx,
    offset,
    "at 4x the same document gap is well past the slack",
  );
  // And the boundary is where the constant says it is.
  assert.equal(snapTranslation(layer, DOC, 1, SNAP_SLACK_PX + 0.5, 200).tx, SNAP_SLACK_PX + 0.5);
});

test("each axis snaps on its own", () => {
  const layer = halfScaleLayer();
  const snapped = snapTranslation(layer, DOC, 1, 2, 137);
  assert.equal(snapped.tx, 0, "x was in reach of the left margin");
  assert.equal(snapped.ty, 137, "y was not in reach of anything and must not move");
});

// --- corner drag ------------------------------------------------------------

const IDENTITY: Transform = { sx: 1, sy: 1, tx: 0, ty: 0, rotation: 0 };

function cornersAfter(corner: "tl" | "tr" | "br" | "bl", start: Transform, px: number, py: number) {
  const next = cornerDragTransform(corner, start, DOC.width, DOC.height, px, py);
  const layer = createRasterLayer("box", newCanvas(DOC.width, DOC.height));
  layer.transform = { ...start, ...next };
  return { transform: next, corners: layerCorners(layer, DOC.width, DOC.height) };
}

test("dragging a corner pins the opposite one exactly", () => {
  // Bottom-right is index 2 in layerCorners' clockwise-from-top-left order.
  const { corners } = cornersAfter("tl", IDENTITY, 90, 60);
  assert.ok(Math.abs(corners[2][0] - DOC.width) < 1e-6, "the pinned x must not have moved");
  assert.ok(Math.abs(corners[2][1] - DOC.height) < 1e-6, "the pinned y must not have moved");
});

test("the dragged corner lands under the pointer", () => {
  const { corners } = cornersAfter("tl", IDENTITY, 90, 60);
  assert.ok(Math.abs(corners[0][0] - 90) < 1e-6, `top-left x should track the pointer, got ${corners[0][0]}`);
  assert.ok(Math.abs(corners[0][1] - 60) < 1e-6, `top-left y should track the pointer, got ${corners[0][1]}`);
});

test("every corner pins its own opposite", () => {
  const opposite = { tl: 2, tr: 3, br: 0, bl: 1 } as const;
  const expected: Record<string, [number, number]> = {
    tl: [DOC.width, DOC.height], tr: [0, DOC.height], br: [0, 0], bl: [DOC.width, 0],
  };
  for (const corner of ["tl", "tr", "br", "bl"] as const) {
    const { corners } = cornersAfter(corner, IDENTITY, 137, 91);
    const pinned = corners[opposite[corner]];
    assert.ok(
      Math.abs(pinned[0] - expected[corner][0]) < 1e-6 && Math.abs(pinned[1] - expected[corner][1]) < 1e-6,
      `dragging ${corner} moved the pinned corner to ${pinned}`,
    );
  }
});

test("a rotated layer scales along its own axes, not the screen's", () => {
  const rotated: Transform = { ...IDENTITY, rotation: Math.PI / 2 };
  // At a quarter turn the pinned bottom-right corner sits at (-height, width).
  const { transform } = cornersAfter("tl", rotated, -150, 200);
  const dx = -150 - -DOC.height;
  const dy = 200 - DOC.width;
  // Local x runs along screen +y at this rotation, and local y along screen -x.
  assert.ok(Math.abs(transform.sx - -dy / DOC.width) < 1e-6, `sx should follow the rotated axis, got ${transform.sx}`);
  assert.ok(Math.abs(transform.sy - dx / DOC.height) < 1e-6, `sy should follow the rotated axis, got ${transform.sy}`);
});

test("dragging a corner past its opposite flips rather than collapsing", () => {
  const { transform } = cornersAfter("tl", IDENTITY, DOC.width + 100, DOC.height + 100);
  assert.ok(transform.sx < 0 && transform.sy < 0, "pulling through should invert the scale");
});

test("a corner dropped on its own opposite is clamped to a recoverable sliver", () => {
  // Zero scale would be unrecoverable: the layer would have no corners left to
  // grab and no way back to a positive size.
  const { transform } = cornersAfter("tl", IDENTITY, DOC.width, DOC.height);
  assert.ok(Math.abs(transform.sx) >= 0.02, `sx collapsed to ${transform.sx}`);
  assert.ok(Math.abs(transform.sy) >= 0.02, `sy collapsed to ${transform.sy}`);
});
