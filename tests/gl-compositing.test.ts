import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import "./canvas-harness.ts";
import {
  isLinearCompositing,
  layerNeedsBackdrop,
  setLinearCompositing,
} from "../app/engine/gl-renderer.ts";
import { BACKDROP_READING_KINDS } from "../app/engine/layer-effects.ts";
import {
  EFFECT_BLEND_DEFAULTS,
  LAYER_EFFECT_KINDS,
  createRasterLayer,
  newCanvas,
} from "../app/engine/document.ts";
import type { Layer, LayerEffect, LayerEffectKind } from "../app/engine/document.ts";

// ---------------------------------------------------------------------------
// The GPU compositor itself cannot run here: node has no WebGL2, and there is
// no headless implementation of it worth trusting. What *can* be pinned here
// are the pure decisions the GPU path makes before it touches a context —
// which is where its bugs have historically lived, because they are the parts
// a source-text test can pretend to cover.
//
// The pixel-level GPU/CPU parity behind these decisions was measured in a real
// browser against the dev server, on a 400x300 document with a translucent
// panel over a striped gradient. Every one of the seventeen effect kinds
// individually, and all seventeen stacked on one layer, came out within 1/255
// max and 0.043 mean channel delta. Re-run that by driving `window.luma` with
// scripting enabled if this file changes.
// ---------------------------------------------------------------------------

function effectOn(kind: LayerEffectKind, patch: Partial<LayerEffect> = {}): Layer {
  const effect: LayerEffect = {
    id: "e1", kind, enabled: true, opacity: 1, color: "#4080c0", blur: 4,
    offsetX: 4, offsetY: 4, ...patch,
  };
  return { ...createRasterLayer("box", newCanvas(8, 8)), effects: [effect] };
}

test("linear compositing is off, so GPU export agrees with CPU export", () => {
  // This is not a preference. The CPU renderer composites through canvas 2D,
  // which is sRGB and has no linear mode, so turning this on makes the two
  // export paths disagree about what the image looks like — measured at 64 on
  // the CPU against 137 on the GPU for a 25% white panel over black, which is
  // not a rounding difference but a different picture.
  //
  // It shipped as `true` under a comment saying "off by default". That was
  // survivable only while effects sent half the documents back to the CPU
  // path; now that they do not, every GPU export would have drifted.
  assert.equal(isLinearCompositing(), false);

  const source = readFileSync(new URL("../app/engine/gl-renderer.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /let linearCompositing = false;/,
    "the initialiser is the default; a setter call elsewhere would not fix export parity",
  );
});

test("the linear compositing switch still works when something asks for it", () => {
  setLinearCompositing(true);
  assert.equal(isLinearCompositing(), true);
  setLinearCompositing(false);
  assert.equal(isLinearCompositing(), false);
});

test("every effect that samples what is beneath it asks for a backdrop", () => {
  for (const kind of BACKDROP_READING_KINDS) {
    assert.equal(layerNeedsBackdrop(effectOn(kind)), true, `${kind} samples the backdrop`);
  }
});

test("a blended effect asks for a backdrop whatever its kind", () => {
  // Blending is a property of the effect, not of the kind, so the check cannot
  // be a list. Every kind carrying a non-default blend mode needs one.
  for (const kind of LAYER_EFFECT_KINDS) {
    const layer = effectOn(kind, { blendMode: "multiply" });
    assert.equal(layerNeedsBackdrop(layer), true, `${kind} blended with multiply needs a backdrop`);
  }
});

test("self-contained effects do not pay for the readback", () => {
  // The readback is a full GPU sync. Charging it to layers that cannot use it
  // would be the whole cost of the feature with none of the benefit.
  //
  // "Self-contained" is narrower than "not in BACKDROP_READING_KINDS": Inner
  // Shadow, Satin, Inner Glow, Bloom and Relief all default to a real blend
  // mode, so they need something beneath them even though they never sample it
  // by name. Deriving the set from EFFECT_BLEND_DEFAULTS rather than listing it
  // means changing a default cannot silently strand an effect.
  const selfContained = LAYER_EFFECT_KINDS.filter((kind) =>
    !BACKDROP_READING_KINDS.includes(kind) && EFFECT_BLEND_DEFAULTS[kind] === "source-over");
  assert.ok(selfContained.length > 5, "expected most kinds to be self-contained");
  for (const kind of selfContained) {
    assert.equal(layerNeedsBackdrop(effectOn(kind)), false, `${kind} needs nothing beneath it`);
  }

  // And the ones that do blend by default must be asking for one.
  const blendsByDefault = LAYER_EFFECT_KINDS.filter((kind) => EFFECT_BLEND_DEFAULTS[kind] !== "source-over");
  for (const kind of blendsByDefault) {
    assert.equal(layerNeedsBackdrop(effectOn(kind)), true, `${kind} blends by default and needs a backdrop`);
  }
  assert.equal(layerNeedsBackdrop(createRasterLayer("bare", newCanvas(8, 8))), false);
  assert.equal(layerNeedsBackdrop(effectOn("backdrop-blur", { enabled: false })), false);
});
