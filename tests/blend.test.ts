import assert from "node:assert/strict";
import test from "node:test";
import { blendRgb } from "../app/engine/blend.ts";
import {
  BLEND_MODES,
  MAX_LAYER_BLEND_PASSES,
  resolvedBlendPasses,
} from "../app/engine/document.ts";
import { GL_BLEND_ORDER } from "../app/engine/gl-shaders.ts";

const round = (values: readonly number[]) => values.map((value) => Number(value.toFixed(4)));

test("catalog exposes every Photoshop layer blend mode exactly once", () => {
  assert.equal(BLEND_MODES.length, 27);
  assert.equal(new Set(BLEND_MODES).size, BLEND_MODES.length);
  assert.equal(BLEND_MODES[0], "source-over");
  assert.equal(BLEND_MODES.at(-1), "luminosity");
  assert.deepEqual([...GL_BLEND_ORDER], [...BLEND_MODES]);
  assert.equal(MAX_LAYER_BLEND_PASSES, 8);
});

test("extended arithmetic blend modes match their channel formulas", () => {
  const base = [0.25, 0.5, 0.75] as const;
  const source = [0.8, 0.2, 0.5] as const;
  assert.deepEqual(round(blendRgb("linear-burn", base, source)), [0.05, 0, 0.25]);
  assert.deepEqual(round(blendRgb("linear-dodge", base, source)), [1, 0.7, 1]);
  assert.deepEqual(round(blendRgb("subtract", base, source)), [0, 0.3, 0.25]);
  assert.deepEqual(round(blendRgb("divide", base, source)), [0.3125, 1, 1]);
});

test("darker and lighter color select a whole color by luminosity", () => {
  const dark = [0.1, 0.2, 0.3] as const;
  const light = [0.8, 0.7, 0.6] as const;
  assert.deepEqual(blendRgb("darker-color", light, dark), dark);
  assert.deepEqual(blendRgb("lighter-color", dark, light), light);
});

test("legacy layers resolve to one pass and stored pass opacity is bounded", () => {
  assert.deepEqual(resolvedBlendPasses({ id: "layer-a", blend: "screen" }), [
    { id: "layer-a-blend-0", mode: "screen", opacity: 1, enabled: true },
  ]);
  assert.deepEqual(resolvedBlendPasses({
    id: "layer-b",
    blend: "multiply",
    blendStack: [
      { id: "low", mode: "multiply", opacity: -1, enabled: true },
      { id: "high", mode: "screen", opacity: 3, enabled: false },
    ],
  }).map((pass) => pass.opacity), [0, 1]);
});
