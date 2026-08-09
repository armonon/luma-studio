import assert from "node:assert/strict";
import test from "node:test";
import { blendRgb } from "../app/engine/blend.ts";
import { BLEND_LABELS, type BlendMode } from "../app/engine/document.ts";
import { GL_BLEND_ORDER } from "../app/engine/gl-shaders.ts";

// Golden values for the separable blend modes, derived by hand from the W3C
// Compositing and Blending Level 1 formulas (and the standard Photoshop
// definitions for the modes that spec does not cover). Inputs are chosen per
// mode so the result does not clamp — a clamped result would pass regardless
// of whether the formula is right.
//
// These are the pixel-correctness anchors for the compositor. If one fails,
// work out which side is wrong before touching the expectation.

type Case = { mode: BlendMode; base: number; source: number; expected: number; why: string };

const CASES: Case[] = [
  { mode: "source-over", base: 0.6, source: 0.3, expected: 0.3, why: "Cs" },
  { mode: "multiply", base: 0.6, source: 0.3, expected: 0.18, why: "Cb*Cs" },
  { mode: "screen", base: 0.6, source: 0.3, expected: 0.72, why: "Cb+Cs-Cb*Cs" },
  { mode: "overlay", base: 0.6, source: 0.3, expected: 0.44, why: "Cb>0.5: 1-2(1-Cb)(1-Cs)" },
  { mode: "darken", base: 0.6, source: 0.3, expected: 0.3, why: "min" },
  { mode: "lighten", base: 0.6, source: 0.3, expected: 0.6, why: "max" },
  { mode: "color-dodge", base: 0.4, source: 0.5, expected: 0.8, why: "min(1, Cb/(1-Cs))" },
  { mode: "color-burn", base: 0.6, source: 0.5, expected: 0.2, why: "1-min(1,(1-Cb)/Cs)" },
  { mode: "hard-light", base: 0.6, source: 0.3, expected: 0.36, why: "Cs<=0.5: 2*Cs*Cb" },
  { mode: "soft-light", base: 0.6, source: 0.3, expected: 0.504, why: "Cb-(1-2Cs)Cb(1-Cb)" },
  { mode: "difference", base: 0.6, source: 0.3, expected: 0.3, why: "|Cb-Cs|" },
  { mode: "exclusion", base: 0.6, source: 0.3, expected: 0.54, why: "Cb+Cs-2*Cb*Cs" },
  { mode: "linear-burn", base: 0.6, source: 0.7, expected: 0.3, why: "Cb+Cs-1" },
  { mode: "linear-dodge", base: 0.6, source: 0.3, expected: 0.9, why: "Cb+Cs" },
  { mode: "linear-light", base: 0.6, source: 0.3, expected: 0.2, why: "Cb+2Cs-1" },
  { mode: "pin-light", base: 0.6, source: 0.3, expected: 0.6, why: "Cs<=0.5: min(Cb,2Cs)" },
  { mode: "vivid-light", base: 0.6, source: 0.3, expected: 1 / 3, why: "Cs<=0.5: burn(Cb,2Cs)" },
  { mode: "subtract", base: 0.6, source: 0.3, expected: 0.3, why: "Cb-Cs" },
  { mode: "divide", base: 0.3, source: 0.6, expected: 0.5, why: "Cb/Cs" },
];

for (const { mode, base, source, expected, why } of CASES) {
  test(`blend "${mode}" matches its reference formula (${why})`, () => {
    const [r, g, b] = blendRgb(mode, [base, base, base], [source, source, source]);
    for (const [name, got] of [["r", r], ["g", g], ["b", b]] as const) {
      assert.ok(
        Math.abs(got - expected) < 1e-6,
        `${mode}.${name}: expected ${expected}, got ${got}`,
      );
    }
  });
}

test("every blend result stays within [0,1]", () => {
  // Extremes are where unclamped formulas (add, divide, linear-light) escape.
  const probes = [0, 0.25, 0.5, 0.75, 1];
  for (const mode of Object.keys(BLEND_LABELS) as BlendMode[]) {
    for (const b of probes) {
      for (const s of probes) {
        const out = blendRgb(mode, [b, b, b], [s, s, s]);
        for (const v of out) {
          assert.ok(
            Number.isFinite(v) && v >= 0 && v <= 1,
            `${mode} produced ${v} for base=${b} source=${s}`,
          );
        }
      }
    }
  }
});

test("blending is pure — inputs are never mutated", () => {
  const base: [number, number, number] = [0.6, 0.5, 0.4];
  const source: [number, number, number] = [0.3, 0.2, 0.1];
  for (const mode of Object.keys(BLEND_LABELS) as BlendMode[]) blendRgb(mode, base, source);
  assert.deepEqual(base, [0.6, 0.5, 0.4]);
  assert.deepEqual(source, [0.3, 0.2, 0.1]);
});

test("CPU and GPU implement the identical blend-mode set", () => {
  // The two compositors carry separate implementations (blend.ts vs the GLSL
  // in gl-shaders.ts). If the mode lists drift, exports silently render some
  // layers with the wrong mode.
  const cpu = [...Object.keys(BLEND_LABELS)].sort();
  const gpu = [...GL_BLEND_ORDER].sort();
  assert.deepEqual(gpu, cpu, "GL_BLEND_ORDER must cover exactly the catalogued modes");
});

test("GL_BLEND_ORDER indices are unique and dense", () => {
  // renderGL maps a mode to a shader branch by array index, so duplicates or
  // gaps would silently mis-render.
  assert.equal(new Set(GL_BLEND_ORDER).size, GL_BLEND_ORDER.length, "no duplicate modes");
});
