import assert from "node:assert/strict";
import test from "node:test";
import { blendIfFactor, blendIfOpacity, blendRgb, isNeutralBlendIf } from "../app/engine/blend.ts";
import {
  BLEND_MODES,
  MAX_LAYER_BLEND_PASSES,
  resolvedBlendPasses,
  resolvedBlendIf,
  resolvedFillOpacity,
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

test("Blend If uses split feather ramps on both ends", () => {
  const range = { black: 0.2, blackFeather: 0.4, whiteFeather: 0.7, white: 0.9 };
  assert.equal(blendIfFactor(0.1, range), 0);
  assert.equal(Number(blendIfFactor(0.3, range).toFixed(4)), 0.5);
  assert.equal(blendIfFactor(0.5, range), 1);
  assert.equal(Number(blendIfFactor(0.8, range).toFixed(4)), 0.5);
  assert.equal(blendIfFactor(0.95, range), 0);
});

test("Blend If can gate by source and underlying color channels", () => {
  const settings = resolvedBlendIf({
    blendIf: {
      activeChannel: "red",
      channels: {
        gray: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
        red: { source: { black: 0.2, blackFeather: 0.4, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 0.7, white: 0.9 } },
        green: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
        blue: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      },
    },
  });
  assert.equal(Number(blendIfOpacity([0.8, 0, 0], [0.3, 1, 1], settings).toFixed(4)), 0.25);
  assert.equal(isNeutralBlendIf(resolvedBlendIf({})), true);
  assert.equal(isNeutralBlendIf(settings), false);
});

test("fill opacity defaults to full and clamps imported values", () => {
  assert.equal(resolvedFillOpacity({}), 1);
  assert.equal(resolvedFillOpacity({ fillOpacity: -2 }), 0);
  assert.equal(resolvedFillOpacity({ fillOpacity: 4 }), 1);
});
