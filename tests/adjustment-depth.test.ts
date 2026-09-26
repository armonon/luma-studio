import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { parseCubeLut, sampleCubeLut } from "../app/engine/cube-lut.ts";
import { applyProAdjustmentToImageData, cloneProAdjustment, DEFAULT_BLACK_WHITE_MIX, type ProAdjustmentParams } from "../app/engine/pro-adjustments.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

const identity = 'TITLE "Identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const pixel = (r: number, g: number, b: number) => new ImageData(new Uint8ClampedArray([r, g, b, 123]), 1, 1);

test("cube parsing is bounded and rejects truncated, oversized, nonfinite and unsupported data", () => {
  for (const source of [identity.replace("SIZE 2", "SIZE 65"), identity.replace("1 1 1", "NaN 1 1"), identity.slice(0, -6), identity + "\n0 0 0", identity.replace("LUT_3D_SIZE", "LUT_1D_SIZE"), identity.replace("SIZE 2", "SIZE 2\nDOMAIN_MAX 0 1 1")]) assert.throws(() => parseCubeLut(source));
  assert.throws(() => parseCubeLut(" ".repeat(4 * 1024 * 1024 + 1)));
});

test("cube trilinear interpolation preserves RGB axes, domain mapping and alpha", () => {
  const lut = parseCubeLut(identity);
  const result = sampleCubeLut(lut, .2, .4, .7);
  result.forEach((v, i) => assert.ok(Math.abs(v - [.2, .4, .7][i]) < 1e-12));
  assert.deepEqual(sampleCubeLut({ ...lut, domainMin: [-1, -1, -1] }, 0, 0, 0), [.5, .5, .5]);
  assert.deepEqual([...applyProAdjustmentToImageData(pixel(63, 124, 199), { kind: "color-lookup", preset: "film", intensity: 1, lut }).data], [63, 124, 199, 123]);
});

test("six-band monochrome retains legacy conversion and targets colors without changing neutral grays", () => {
  const base = { kind: "black-white", amount: 1, tint: "#ffffff", tintAmount: 0 } as const;
  for (const rgb of [[230, 40, 20], [40, 240, 90], [75, 44, 241], [128, 128, 128]]) {
    assert.deepEqual(applyProAdjustmentToImageData(pixel(...rgb as [number, number, number]), { ...base, colorMix: [...DEFAULT_BLACK_WHITE_MIX] }).data, applyProAdjustmentToImageData(pixel(...rgb as [number, number, number]), base).data);
  }
  const params: ProAdjustmentParams = { ...base, colorMix: [100, 0, 0, 0, 0, 0] };
  assert.equal(applyProAdjustmentToImageData(pixel(255, 0, 0), params).data[0], 255);
  assert.equal(applyProAdjustmentToImageData(pixel(0, 255, 0), params).data[0], 0);
  assert.equal(applyProAdjustmentToImageData(pixel(128, 128, 128), params).data[0], 128);
});

test("gradient maps use interior stops and preserve independent history payloads", () => {
  const params: ProAdjustmentParams = { kind: "gradient-map", shadow: "#000000", highlight: "#ffffff", reverse: false, smoothness: 0,
    stops: [{ position: 0, color: "#000000" }, { position: 128 / 255, color: "#ff0000" }, { position: 1, color: "#ffffff" }] };
  assert.deepEqual([...applyProAdjustmentToImageData(pixel(128, 128, 128), params).data], [255, 0, 0, 123]);
  const clone = cloneProAdjustment(params);
  params.stops![1].color = "#00ff00";
  assert.equal(clone.kind === "gradient-map" && clone.stops![1].color, "#ff0000");
  assert.throws(() => cloneProAdjustment({ ...params, stops: [{ position: NaN, color: "red" }] }));
});

test("imported LUT editing is undoable and caller mutations cannot change stored LUTs", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  try {
    const layer = studio.addProAdjustmentLayer("color-lookup");
    const lut = parseCubeLut(identity);
    studio.updateProAdjustment(layer.id, { kind: "color-lookup", preset: "film", intensity: 1, lut });
    lut.values[0] = .75;
    assert.equal(layer.proAdjustment?.kind === "color-lookup" && layer.proAdjustment.lut?.values[0], 0);
    studio.undo();
    assert.equal(layer.proAdjustment?.kind === "color-lookup" && layer.proAdjustment.lut, undefined);
    studio.redo();
    assert.equal(layer.proAdjustment?.kind === "color-lookup" && layer.proAdjustment.lut?.values[0], 0);
  } finally { studio.dispose(); }
});
