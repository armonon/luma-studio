import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustmentLabel,
  adjustmentLayerKind,
  applyAdjustment,
  cloneAdjustmentParams,
  isAdjustmentLayer,
  snapshotForAdjustment,
} from "../app/engine/layer-mutations.ts";
import type { Curves, HslParams, Layer, LevelsParams, ToneParams } from "../app/engine/document.ts";

// Minimal fake layer that satisfies TypeScript for the shape-checks we run.
function layer(kind: Layer["kind"], extra: Partial<Layer> = {}): Layer {
  return { id: "l1", kind, name: "test", visible: true, opacity: 1, ...extra } as Layer;
}

test("kind maps and labels are in sync", () => {
  assert.equal(adjustmentLayerKind("tone"), "adjustment-tone");
  assert.equal(adjustmentLayerKind("curves"), "adjustment-curves");
  assert.equal(adjustmentLayerKind("levels"), "adjustment-levels");
  assert.equal(adjustmentLayerKind("hsl"), "adjustment-hsl");
  assert.match(adjustmentLabel("hsl"), /HSL/);
});

test("isAdjustmentLayer gates on exact kind", () => {
  assert.equal(isAdjustmentLayer(layer("adjustment-tone"), "tone"), true);
  assert.equal(isAdjustmentLayer(layer("adjustment-curves"), "tone"), false);
  assert.equal(isAdjustmentLayer(undefined, "tone"), false);
});

test("cloneAdjustmentParams returns fresh objects (curves gets deep clone)", () => {
  const tone: ToneParams = { exposure: 1, contrast: 5, highlights: 0, shadows: 0, temperature: 0, vibrance: 0 };
  const cloned = cloneAdjustmentParams("tone", tone);
  assert.notEqual(cloned, tone);
  assert.deepEqual(cloned, tone);

  const curves: Curves = {
    rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  };
  const cc = cloneAdjustmentParams("curves", curves);
  assert.notEqual(cc, curves);
  assert.notEqual(cc.rgb, curves.rgb);
  assert.deepEqual(cc, curves);
});

test("snapshotForAdjustment captures only the requested kind's field", () => {
  const levels: LevelsParams = { inBlack: 0, inWhite: 1, gamma: 1.2, outBlack: 0, outWhite: 1 };
  const l = layer("adjustment-levels", { levels });
  const snap = snapshotForAdjustment(l, "levels");
  assert.equal(snap.layerId, "l1");
  assert.deepEqual(snap.levels, levels);
  assert.equal(snap.levels === levels, false, "must be a fresh copy");
});

test("snapshotForAdjustment on a layer without the field returns an empty snapshot", () => {
  const snap = snapshotForAdjustment(layer("adjustment-tone"), "tone");
  assert.equal(snap.layerId, "l1");
  assert.equal(snap.tone, undefined);
});

test("applyAdjustment writes the params onto the layer", () => {
  const hsl: HslParams = { hue: 45, saturation: -20, lightness: 10 };
  const l = layer("adjustment-hsl");
  applyAdjustment(l, "hsl", hsl);
  assert.deepEqual(l.hsl, hsl);
  assert.equal(l.hsl === hsl, false, "must be a fresh copy");
});
