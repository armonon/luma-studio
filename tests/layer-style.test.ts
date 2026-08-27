import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import {
  BLEND_IF_HANDLES,
  EFFECT_FIELDS,
  EFFECT_LABELS,
  LAYER_EFFECT_KINDS,
  createDocument,
  createGroupLayer,
  createRasterLayer,
  effectUses,
  newCanvas,
  orderBlendIfHandles,
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedEffectOffset,
  resolvedFillOpacity,
  resolvedGlobalLight,
  type BlendIfRange,
  type Document,
  type BevelStyle,
  type EffectField,
  type GradientStyle,
  type Layer,
  type LayerEffect,
  type LayerEffectKind,
} from "../app/engine/document.ts";
import { formatCssColor, parseCssColor } from "../app/engine/color.ts";
import { BACKDROP_READING_KINDS, documentNeedsFullBackdrop, layerEffectReach } from "../app/engine/layer-effects.ts";
import { glCanRenderDocument, layerNeedsBackdrop } from "../app/engine/gl-renderer.ts";
import { BUILT_IN_LAYER_STYLES, captureStyle } from "../app/engine/layer-styles.ts";
import { renderClean, renderViewport } from "../app/engine/renderer.ts";
import { Studio } from "../app/engine/studio.ts";

// The Layer Style dialog decides which controls to show from EFFECT_FIELDS, and
// paints swatches by round-tripping colours through parseCssColor. Both are
// claims about the renderer, so they are tested against the renderer.

// --- colour parsing --------------------------------------------------------

test("parseCssColor reads every colour form the engine stores", () => {
  assert.deepEqual(parseCssColor("#abc"), { hex: "#aabbcc", alpha: 1 });
  assert.deepEqual(parseCssColor("#AABBCC"), { hex: "#aabbcc", alpha: 1 });
  assert.deepEqual(parseCssColor("rgb(255, 0, 128)"), { hex: "#ff0080", alpha: 1 });

  const withAlpha = parseCssColor("rgba(0,0,0,0.9)");
  assert.equal(withAlpha.hex, "#000000");
  assert.ok(Math.abs(withAlpha.alpha - 0.9) < 1e-9);

  const hex8 = parseCssColor("#ff000080");
  assert.equal(hex8.hex, "#ff0000");
  assert.ok(Math.abs(hex8.alpha - 128 / 255) < 1e-9);
});

test("an unparseable colour degrades to opaque black instead of throwing", () => {
  for (const value of ["", "chartreuse", "hsl(200 50% 50%)", "#12345"]) {
    assert.deepEqual(parseCssColor(value), { hex: "#000000", alpha: 1 }, value);
  }
});

test("formatCssColor is the inverse of parseCssColor", () => {
  for (const value of ["#7656ef", "rgba(18,52,86,0.5)", "rgb(1,2,3)", "#00000080"]) {
    const { hex, alpha } = parseCssColor(value);
    const round = parseCssColor(formatCssColor(hex, alpha));
    assert.equal(round.hex, hex, value);
    assert.ok(Math.abs(round.alpha - alpha) < 0.005, `${value}: alpha drifted to ${round.alpha}`);
  }
});

test("formatCssColor keeps hex when opaque and only widens to rgba when it must", () => {
  assert.equal(formatCssColor("#7656ef", 1), "#7656ef");
  assert.equal(formatCssColor("#123456", 0.5), "rgba(18,52,86,0.5)");
});

// --- Blend If handles ------------------------------------------------------

const NEUTRAL: BlendIfRange = { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 };

test("dragging the white handle inwards pulls the fade handle with it", () => {
  // resolvedBlendIf only ever raises a handle to restore the ordering, so
  // without this the drag is silently undone and highlights never knock out.
  const dragged = orderBlendIfHandles({ ...NEUTRAL, white: 0.5 }, "white");
  assert.equal(dragged.white, 0.5);
  assert.equal(dragged.whiteFeather, 0.5, "the fade handle must be pushed along");
  const stored = resolvedBlendIf({ blendIf: { activeChannel: "gray", channels: {
    gray: { source: dragged, underlying: NEUTRAL },
    red: { source: NEUTRAL, underlying: NEUTRAL },
    green: { source: NEUTRAL, underlying: NEUTRAL },
    blue: { source: NEUTRAL, underlying: NEUTRAL },
  } } }).channels.gray.source;
  assert.equal(stored.white, 0.5, "the engine kept the dragged value");
});

test("dragging the black handle outwards pushes the handles above it", () => {
  const dragged = orderBlendIfHandles({ ...NEUTRAL, black: 0.8 }, "black");
  assert.equal(dragged.black, 0.8);
  assert.equal(dragged.blackFeather, 0.8);
  assert.equal(dragged.whiteFeather, 1, "handles already past the drag stay put");
  assert.equal(dragged.white, 1);
});

test("handles never end up out of order, whichever one moved", () => {
  for (const handle of BLEND_IF_HANDLES) {
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const next = orderBlendIfHandles({ black: 0.2, blackFeather: 0.4, whiteFeather: 0.6, white: 0.8, [handle]: value }, handle);
      assert.equal(next[handle], value, `${handle} did not keep its dragged value`);
      assert.ok(
        next.black <= next.blackFeather && next.blackFeather <= next.whiteFeather && next.whiteFeather <= next.white,
        `${handle}=${value} produced ${JSON.stringify(next)}`,
      );
    }
  }
});

// --- the dialog's field table, checked against the renderer -----------------

const SIZE = 60;

/**
 * A red square with a bright patch, over a striped coloured backdrop.
 *
 * Every part of this fixture earns its place: the bright patch gives Bloom
 * something above threshold and Relief a luminance edge to emboss, and the
 * striped backdrop gives Backdrop Blur detail to smear and colour to
 * desaturate. A flat fixture would make all three look like they ignored
 * their controls.
 */
function docWith(effect: LayerEffect): Document {
  const bitmap = newCanvas(SIZE, SIZE);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(20, 20, 20, 20);
  // A bright patch inside the shape. Bloom and Relief read pixel values rather
  // than the silhouette, and a uniformly-coloured box gives them nothing to
  // work with — bloom would find nothing above threshold and relief would
  // emboss a flat surface, so both would look like they ignored their controls.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(24, 24, 9, 9);
  const layer: Layer = { ...createRasterLayer("box", bitmap), effects: [effect] };

  // Striped and coloured, not flat: blurring a uniform backdrop returns the
  // same uniform colour, and desaturating a grey one changes nothing, so a
  // flat backdrop would make Backdrop Blur look like it ignored its controls.
  const backdrop = newCanvas(SIZE, SIZE);
  const backdropCtx = backdrop.getContext("2d")!;
  backdropCtx.fillStyle = "#808080";
  backdropCtx.fillRect(0, 0, SIZE, SIZE);
  backdropCtx.fillStyle = "#c04020";
  for (let x = 0; x < SIZE; x += 12) backdropCtx.fillRect(x, 0, 6, SIZE);

  const doc = createDocument(SIZE, SIZE);
  doc.layers = [layer, createRasterLayer("backdrop", backdrop)];
  return doc;
}

/** Every pixel of the composite, as a comparable string. */
function renderDigest(effect: LayerEffect) {
  const target = testCanvas(SIZE, SIZE);
  renderClean(docWith(effect), target);
  const { data } = target.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

/**
 * A neutral starting point so any field change is visible if it is read.
 *
 * The offset is non-zero and the angle differs from DEFAULT_GLOBAL_LIGHT, so
 * switching an effect to global light genuinely moves it.
 */
function baseEffect(kind: LayerEffectKind): LayerEffect {
  return {
    id: "e1", kind, enabled: true, opacity: 1, color: "#4080c0",
    blur: 6, offsetX: 8, offsetY: 0,
    width: 4, position: "center",
    depth: 4, angle: 135, altitude: 30, highlightColor: "#ffffff", shadowColor: "#000000",
    glowSource: "edge", invert: false,
    stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }],
    gradientAngle: 90, gradientStyle: "linear",
    pattern: "checker", patternScale: 8,
    saturation: 1.6, tint: 0, threshold: 0.6, steps: 24, strength: 10,
    dither: 0, fillType: "color", technique: "softer", range: 1,
    bevelStyle: "inner", direction: "up",
    contour: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }],
  };
}

/** A change large enough to move pixels, for each field the dialog can edit. */
const FIELD_CHANGES: Record<EffectField, Partial<LayerEffect>> = {
  offset: { offsetX: 12, offsetY: 12 },
  blur: { blur: 10 },
  width: { width: 9 },
  position: { position: "inside" },
  depth: { depth: 9 },
  angle: { angle: 315 },
  bevelColors: { highlightColor: "#00ff00", shadowColor: "#0000ff" },
  altitude: { altitude: 85 },
  globalLight: { useGlobalLight: true },
  blendMode: { blendMode: "difference" },
  spread: { spread: 0.9 },
  noise: { noise: 0.8 },
  contour: { contour: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
  glowSource: { glowSource: "center" },
  invert: { invert: true },
  gradientStops: { stops: [{ offset: 0, color: "#00ff00" }, { offset: 1, color: "#ffff00" }] },
  gradientAngle: { gradientAngle: 0 },
  gradientStyle: { gradientStyle: "radial" },
  gradientReverse: { reverse: true },
  pattern: { pattern: "stripes" },
  patternScale: { patternScale: 20 },
  saturation: { saturation: 0 },
  tint: { tint: 1 },
  threshold: { threshold: 0.05 },
  steps: { steps: 3 },
  strength: { strength: 40 },
  dither: { dither: 1 },
  fillType: { fillType: "gradient" },
  technique: { technique: "precise" },
  range: { range: 0.3 },
  bevelStyle: { bevelStyle: "outer" },
  direction: { direction: "down" },
  glossContour: { glossContour: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] },
};

const ALL_FIELDS = Object.keys(FIELD_CHANGES) as EffectField[];

test("EFFECT_FIELDS lists exactly the controls each effect actually reads", () => {
  for (const kind of LAYER_EFFECT_KINDS) {
    const base = renderDigest(baseEffect(kind));
    for (const field of ALL_FIELDS) {
      const changed = renderDigest({ ...baseEffect(kind), ...FIELD_CHANGES[field] });
      if (effectUses(kind, field)) {
        assert.notEqual(changed, base, `${kind} claims to use "${field}" but the render did not change`);
      } else {
        assert.equal(changed, base, `${kind} does not list "${field}" but the render changed`);
      }
    }
  }
});

test("every effect kind has a dialog entry and a label", () => {
  const kinds = new Set<LayerEffectKind>(LAYER_EFFECT_KINDS);
  assert.equal(kinds.size, LAYER_EFFECT_KINDS.length, "duplicate entry in the dialog list");
  for (const kind of Object.keys(EFFECT_FIELDS) as LayerEffectKind[]) {
    assert.ok(kinds.has(kind), `${kind} is missing from LAYER_EFFECT_KINDS`);
    assert.ok(EFFECT_LABELS[kind], `${kind} has no label`);
  }
});

// --- the commands the dialog drives ----------------------------------------

function studioWithLayer() {
  const studio = new Studio(64, 64, testCanvas(64, 64));
  studio.addBlankRaster("Styled");
  return { studio, layerId: studio.doc.layers[0].id };
}

test("every effect kind can be added and lands on the layer", () => {
  const { studio, layerId } = studioWithLayer();
  for (const kind of LAYER_EFFECT_KINDS) {
    const effect = studio.addLayerEffect(layerId, kind);
    assert.ok(effect, `${kind} was refused`);
    assert.equal(effect.kind, kind);
    assert.equal(effect.enabled, true, `${kind} should start enabled`);
  }
  assert.equal(studio.doc.layers[0].effects?.length, LAYER_EFFECT_KINDS.length);
  studio.dispose();
});

test("stroke and bevel presets fill in their own fields", () => {
  const { studio, layerId } = studioWithLayer();
  const stroke = studio.addLayerEffect(layerId, "stroke")!;
  assert.ok((stroke.width ?? 0) > 0, "stroke needs a width");
  assert.ok(stroke.position, "stroke needs a position");
  const bevel = studio.addLayerEffect(layerId, "bevel-emboss")!;
  assert.ok((bevel.depth ?? 0) > 0, "bevel needs a depth");
  assert.ok(bevel.highlightColor && bevel.shadowColor, "bevel needs both light colours");
  studio.dispose();
});

test("a locked layer refuses every effect change, not just adding", () => {
  const { studio, layerId } = studioWithLayer();
  const effect = studio.addLayerEffect(layerId, "drop-shadow")!;
  studio.setLayerProp(layerId, "locked", true, "Lock");

  assert.equal(studio.addLayerEffect(layerId, "stroke"), null, "add should be refused");
  studio.removeLayerEffect(layerId, effect.id);
  assert.equal(studio.doc.layers[0].effects?.length, 1, "remove should be refused");
  // Editing used to sail through while add and remove were both blocked.
  studio.updateLayerEffect(layerId, effect.id, { blur: 999 });
  assert.equal(studio.doc.layers[0].effects![0].blur, effect.blur, "edit should be refused");
  studio.dispose();
});

test("updateLayerEffect patches one effect and leaves its siblings alone", () => {
  const { studio, layerId } = studioWithLayer();
  const first = studio.addLayerEffect(layerId, "drop-shadow")!;
  const second = studio.addLayerEffect(layerId, "stroke")!;
  studio.updateLayerEffect(layerId, second.id, { width: 17, enabled: false });

  const effects = studio.doc.layers[0].effects!;
  const updated = effects.find((effect) => effect.id === second.id)!;
  assert.equal(updated.width, 17);
  assert.equal(updated.enabled, false);
  assert.equal(updated.kind, "stroke", "the kind must not be patchable");
  assert.equal(effects.find((effect) => effect.id === first.id)!.enabled, true);
  studio.dispose();
});

test("editing an effect is undoable", () => {
  const { studio, layerId } = studioWithLayer();
  const effect = studio.addLayerEffect(layerId, "outer-glow")!;
  const originalBlur = effect.blur;
  studio.updateLayerEffect(layerId, effect.id, { blur: originalBlur + 40 });
  assert.equal(studio.doc.layers[0].effects![0].blur, originalBlur + 40);
  studio.undo();
  assert.equal(studio.doc.layers[0].effects![0].blur, originalBlur, "undo did not restore the effect");
  studio.dispose();
});

// --- effect blend modes against the backdrop -------------------------------

test("an effect blend mode acts on the layer's own pixels", () => {
  // Inner shadow lands on the content, so its mode has something to blend
  // with. Multiply darkens the red square; screen lightens it.
  const shade = (blendMode: "multiply" | "screen"): LayerEffect => ({
    ...baseEffect("inner-shadow"),
    color: "#808080",
    blendMode,
    blur: 3,
    offsetX: 6,
    offsetY: 6,
    // Plain falloff: this is about how the effect composites, and the base
    // fixture's ringed contour reshapes it enough to saturate the sample.
    contour: undefined,
  });

  const darkened = testCanvas(SIZE, SIZE);
  renderClean(docWith(shade("multiply")), darkened);
  const lightened = testCanvas(SIZE, SIZE);
  renderClean(docWith(shade("screen")), lightened);

  const at = { x: 23, y: 23 };
  const multiplied = pixelAt(darkened, at.x, at.y);
  const screened = pixelAt(lightened, at.x, at.y);
  assert.ok(
    multiplied.r < screened.r - 20,
    `multiply should be darker than screen: ${multiplied.r} vs ${screened.r}`,
  );
});

function layerWith(effect: Partial<LayerEffect> & { kind: LayerEffectKind }): Layer {
  return {
    ...createRasterLayer("box", newCanvas(SIZE, SIZE)),
    effects: [{ ...baseEffect(effect.kind), ...effect }],
  };
}

test("the GPU path asks for a backdrop for every effect that needs one", () => {
  // This used to assert the opposite — that the GPU path *declined* these
  // documents, because it had no backdrop to offer. It has one now, so the
  // question is no longer whether to give up but whether the right layers get
  // one. A layer that needs a backdrop and is not offered one renders its
  // effects against nothing, which is the same silent divergence wearing a
  // different hat, so the check moved rather than went away.
  for (const kind of BACKDROP_READING_KINDS) {
    assert.equal(layerNeedsBackdrop(layerWith({ kind })), true, `${kind} samples the backdrop`);
  }

  // A blended effect has nothing to blend against without one either.
  assert.equal(layerNeedsBackdrop(layerWith({ kind: "inner-shadow", blendMode: "multiply" })), true);

  // Anything self-contained does not pay for the readback, and a disabled
  // effect never asks for one.
  assert.equal(layerNeedsBackdrop(layerWith({ kind: "color-overlay" })), false);
  assert.equal(layerNeedsBackdrop(layerWith({ kind: "backdrop-blur", enabled: false })), false);
  assert.equal(layerNeedsBackdrop(createRasterLayer("bare", newCanvas(SIZE, SIZE))), false);
});

test("effects no longer send the whole document back to the CPU renderer", () => {
  // Every effect kind, all at once, on one layer: the GPU path has to accept
  // it. Declining here is what made GPU export silently fall back for roughly
  // half of real documents.
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [{
    ...createRasterLayer("box", newCanvas(SIZE, SIZE)),
    effects: LAYER_EFFECT_KINDS.map((kind, index) => ({ ...baseEffect(kind), id: `e${index}`, kind })),
  }];
  assert.equal(glCanRenderDocument(doc), true);
});

test("an adjustment layer with custom blend passes still routes to the CPU", () => {
  // The adjustment programs transform the composite in place, so they have no
  // way to honour a stack of passes. That refusal is unrelated to effects and
  // has to survive them being allowed through.
  const doc = createDocument(SIZE, SIZE);
  const adjustment: Layer = {
    ...createRasterLayer("levels", newCanvas(1, 1)),
    kind: "adjustment-levels",
    levels: { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 },
  };
  doc.layers = [adjustment];
  assert.equal(glCanRenderDocument(doc), true, "a plain adjustment layer is fine");

  doc.layers = [{
    ...adjustment,
    blendStack: [
      { id: "p1", mode: "multiply", opacity: 1, enabled: true },
      { id: "p2", mode: "screen", opacity: 0.5, enabled: true },
    ],
  }];
  assert.equal(glCanRenderDocument(doc), false, "two passes cannot be honoured in place");
});

test("every backdrop-reading effect is listed as one", () => {
  // The list drives the GPU guard, so a new backdrop effect that forgets to
  // join it would silently export wrong again. Anything whose implementation
  // bails without a backdrop belongs here.
  const source = readFileSync(new URL("../app/engine/layer-effects.ts", import.meta.url), "utf8");
  // Stop at the next `case`, or the scan runs past one arm into another's
  // guard and blames the wrong effect.
  const bailing = [...source.matchAll(/case "([a-z-]+)": \{((?:(?!case ")[\s\S])*?)if \(!backdrop\) break;/g)]
    .map((match) => match[1]);
  assert.ok(bailing.length > 0, "expected to find effects that bail without a backdrop");
  for (const kind of bailing) {
    assert.ok(
      BACKDROP_READING_KINDS.includes(kind as LayerEffectKind),
      `${kind} bails without a backdrop but is missing from BACKDROP_READING_KINDS`,
    );
  }
});

test("every bevel style renders differently from the others", () => {
  // Same reasoning as the gradient styles: the field table only swaps one
  // value for one other, so it cannot show that all five are wired.
  const digests = new Map<string, string>();
  for (const bevelStyle of ["inner", "outer", "emboss", "pillow", "stroke"] as BevelStyle[]) {
    const digest = renderDigest({
      ...baseEffect("bevel-emboss"),
      id: "b1",
      bevelStyle,
      depth: 5,
      blur: 3,
      opacity: 1,
    });
    for (const [other, seen] of digests) {
      assert.notEqual(digest, seen, `${bevelStyle} renders identically to ${other}`);
    }
    digests.set(bevelStyle, digest);
  }
});

test("bevel direction swaps which edge is lit", () => {
  const raised = renderDigest({ ...baseEffect("bevel-emboss"), id: "b1", direction: "up", depth: 5, opacity: 1 });
  const carved = renderDigest({ ...baseEffect("bevel-emboss"), id: "b1", direction: "down", depth: 5, opacity: 1 });
  assert.notEqual(raised, carved, "up and down should not look the same");

  // Carving is the same relief with the light on the other side, so swapping
  // the two colours as well should bring it back.
  const swapped = renderDigest({
    ...baseEffect("bevel-emboss"),
    id: "b1",
    direction: "down",
    depth: 5,
    opacity: 1,
    highlightColor: "#000000",
    shadowColor: "#ffffff",
  });
  assert.equal(swapped, raised, "down with swapped colours should match up");
});

test("every gradient style renders differently from the others", () => {
  // The field table only ever swaps one style for one other, so it cannot tell
  // whether the rest are wired at all — removing the conic branch left it
  // green. Comparing all five against each other does.
  const digests = new Map<string, string>();
  for (const gradientStyle of ["linear", "radial", "angle", "reflected", "diamond"] as GradientStyle[]) {
    const digest = renderDigest({
      ...baseEffect("gradient-overlay"),
      id: "g1",
      gradientStyle,
      gradientAngle: 45,
      opacity: 1,
      dither: 0,
    });
    for (const [other, seen] of digests) {
      assert.notEqual(digest, seen, `${gradientStyle} renders identically to ${other}`);
    }
    digests.set(gradientStyle, digest);
  }
});

test("a stroke can be filled with a gradient or a pattern, not just a colour", () => {
  // fillType is in the field table; the parameters it switches between are
  // not, because each is read only under one setting. Tested here instead.
  const stroke = (patch: Partial<LayerEffect>) => renderDigest({
    ...baseEffect("stroke"),
    id: "st",
    width: 8,
    position: "outside",
    opacity: 1,
    ...patch,
  });

  const solid = stroke({ fillType: "color" });
  const gradient = stroke({ fillType: "gradient" });
  const pattern = stroke({ fillType: "pattern" });
  assert.notEqual(gradient, solid, "a gradient stroke should not match a colour one");
  assert.notEqual(pattern, solid, "a pattern stroke should not match a colour one");
  assert.notEqual(pattern, gradient, "gradient and pattern strokes should differ");

  // And the gradient's own parameters reach it.
  const rotated = stroke({ fillType: "gradient", gradientAngle: 0 });
  assert.notEqual(rotated, gradient, "the gradient angle should reach a gradient stroke");
  const restopped = stroke({
    fillType: "gradient",
    stops: [{ offset: 0, color: "#00ff00" }, { offset: 1, color: "#ffff00" }],
  });
  assert.notEqual(restopped, gradient, "the stops should reach a gradient stroke");
});

// --- the remaining blending options ----------------------------------------

test("a vector mask shapes the layer and carries its own hide-effects switch", () => {
  const square = newCanvas(SIZE, SIZE);
  const squareCtx = square.getContext("2d")!;
  squareCtx.fillStyle = "#ff0000";
  squareCtx.fillRect(10, 10, 40, 40);

  // A triangle covering only the left of the square.
  const vectorMask = {
    anchors: [
      { x: 0, y: 0, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
      { x: 30, y: 0, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
      { x: 30, y: SIZE, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
      { x: 0, y: SIZE, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
    ],
    closed: true,
    fill: "#ffffff",
    stroke: "none",
    strokeWidth: 0,
  };

  const render = (patch: Partial<Layer>) => {
    const doc = createDocument(SIZE, SIZE);
    doc.layers = [{ ...createRasterLayer("shaped", square), vectorMask, ...patch }];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    return target;
  };

  const masked = render({});
  assert.ok(pixelAt(masked, 20, 30).r > 200, "inside the vector mask the layer shows");
  assert.equal(pixelAt(masked, 45, 30).a, 0, "outside it the layer is hidden");

  // With the effect switch off (the default) a glow escapes the mask.
  const glow: LayerEffect = { ...baseEffect("outer-glow"), id: "g1", color: "#00ff00", blur: 8, opacity: 1 };
  const escapes = render({ effects: [glow] });
  const hides = render({ effects: [glow], vectorMaskHidesEffects: true });
  assert.ok(pixelAt(escapes, 34, 30).a > 20, "by default the effect reaches past the vector mask");
  assert.equal(pixelAt(hides, 34, 30).a, 0, "with the switch on it is cut back");
});

test("transparency shapes layer, off, stops the style following the artwork", () => {
  const dot = newCanvas(SIZE, SIZE);
  const dotCtx = dot.getContext("2d")!;
  dotCtx.fillStyle = "#ff0000";
  dotCtx.fillRect(26, 26, 8, 8);

  const overlay: LayerEffect = { ...baseEffect("color-overlay"), id: "o1", color: "#0000ff", opacity: 1 };
  const render = (transparencyShapesLayer: boolean) => {
    const doc = createDocument(SIZE, SIZE);
    doc.layers = [{ ...createRasterLayer("dot", dot), effects: [overlay], transparencyShapesLayer }];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    return target;
  };

  // On: the overlay is clipped to the little square.
  assert.equal(pixelAt(render(true), 5, 5).a, 0, "the overlay should follow the artwork");
  // Off: it fills the layer's extent instead.
  assert.ok(pixelAt(render(false), 5, 5).b > 200, "the overlay should cover the layer's extent");
});

test("clipped layers blend as one group by default", () => {
  // A half-opacity base with something clipped to it. Blended as a group the
  // opacity applies once to the assembled stack; blended separately it applies
  // to the base and then again through the clipped layer's own compositing.
  const base = newCanvas(SIZE, SIZE);
  const baseCtx = base.getContext("2d")!;
  baseCtx.fillStyle = "#ff0000";
  baseCtx.fillRect(10, 10, 40, 40);

  const paint = newCanvas(SIZE, SIZE);
  const paintCtx = paint.getContext("2d")!;
  paintCtx.fillStyle = "#0000ff";
  paintCtx.fillRect(0, 0, SIZE, SIZE);

  const render = (blendClippedAsGroup: boolean) => {
    const doc = createDocument(SIZE, SIZE);
    doc.layers = [
      { ...createRasterLayer("clipped", paint), clipping: true },
      { ...createRasterLayer("base", base), opacity: 0.5, blendClippedAsGroup },
    ];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    return pixelAt(target, 30, 30);
  };

  const grouped = render(true);
  const separate = render(false);
  assert.notDeepEqual(grouped, separate, "grouping should change how the opacity lands");
  // Grouped, the clipped blue reaches the canvas at the base's opacity.
  assert.ok(grouped.b > 100, `expected the clipped layer through the group, got b=${grouped.b}`);
});

// --- style presets and Create Layers ---------------------------------------

test("every built-in style applies and produces the effects it promises", () => {
  const studio = new Studio(SIZE, SIZE, testCanvas(SIZE, SIZE));
  studio.addBlankRaster("Styled");
  const layerId = studio.doc.layers[0].id;

  for (const preset of BUILT_IN_LAYER_STYLES) {
    assert.equal(studio.applyLayerStyle(layerId, preset), true, `${preset.name} was refused`);
    const applied = studio.doc.layers[0].effects ?? [];
    assert.equal(applied.length, preset.effects.length, `${preset.name} lost effects`);
    assert.deepEqual(
      applied.map((effect) => effect.kind),
      preset.effects.map((effect) => effect.kind),
      `${preset.name} changed kinds`,
    );
    // Ids must be minted, not shared with the preset or between layers.
    assert.equal(new Set(applied.map((effect) => effect.id)).size, applied.length);
  }
  studio.dispose();
});

test("capturing a style round-trips through applying it", () => {
  const studio = new Studio(SIZE, SIZE, testCanvas(SIZE, SIZE));
  studio.addBlankRaster("Source");
  const layerId = studio.doc.layers[0].id;
  studio.addLayerEffect(layerId, "stroke");
  studio.addLayerEffect(layerId, "outer-glow");
  studio.setLayerFillOpacity(layerId, 0.4);

  const captured = captureStyle(studio.doc.layers[0], "Mine");
  studio.clearLayerStyle(layerId);
  assert.equal(studio.doc.layers[0].effects?.length, 0);

  studio.applyLayerStyle(layerId, captured);
  assert.deepEqual(
    studio.doc.layers[0].effects?.map((effect) => effect.kind),
    ["stroke", "outer-glow"],
  );
  assert.equal(resolvedFillOpacity(studio.doc.layers[0]), 0.4);
  studio.dispose();
});

test("Create Layers reproduces the style it replaced", () => {
  // The test this replaces only counted layers, so it passed while every
  // above-content effect rasterized to nothing: the extraction subtracted the
  // bare layer by alpha, and the content's own silhouette erased them.
  const studio = new Studio(SIZE, SIZE, testCanvas(SIZE, SIZE));
  const square = testCanvas(24, 24);
  const squareCtx = square.getContext("2d")!;
  squareCtx.fillStyle = "#ff0000";
  squareCtx.fillRect(0, 0, 24, 24);
  studio.addRasterFromImage(
    "square",
    Object.assign(square, { naturalWidth: 24, naturalHeight: 24 }) as unknown as HTMLImageElement,
  );
  const layerId = studio.doc.layers[0].id;

  const shadow = studio.addLayerEffect(layerId, "drop-shadow")!;
  studio.updateLayerEffect(layerId, shadow.id, { blur: 6, offsetX: 8, offsetY: 8, opacity: 1, color: "#000000" });
  const overlay = studio.addLayerEffect(layerId, "color-overlay")!;
  studio.updateLayerEffect(layerId, overlay.id, { color: "#0000ff", opacity: 1 });
  const stroke = studio.addLayerEffect(layerId, "stroke")!;
  studio.updateLayerEffect(layerId, stroke.id, { color: "#00ff00", width: 3, position: "outside", opacity: 1 });

  const before = testCanvas(SIZE, SIZE);
  renderClean(studio.doc, before);

  const result = studio.createLayersFromStyle(layerId)!;
  assert.equal(result.created, 3, "expected one layer per splittable effect");
  assert.equal(studio.doc.layers.find((l) => l.id === layerId)?.effects?.length, 0, "the style must not remain");

  const after = testCanvas(SIZE, SIZE);
  renderClean(studio.doc, after);

  // Sample across the whole picture: overlay interior, stroke band, shadow.
  const points: Array<[number, number, string]> = [
    [30, 30, "overlay interior"],
    [19, 30, "stroke band"],
    [46, 46, "shadow"],
    [3, 3, "empty corner"],
  ];
  for (const [x, y, what] of points) {
    const wanted = pixelAt(before, x, y);
    const got = pixelAt(after, x, y);
    const drift = Math.max(
      Math.abs(wanted.r - got.r), Math.abs(wanted.g - got.g),
      Math.abs(wanted.b - got.b), Math.abs(wanted.a - got.a),
    );
    assert.ok(drift <= 3, `${what} drifted by ${drift}: ${JSON.stringify(wanted)} became ${JSON.stringify(got)}`);
  }
  studio.dispose();
});

test("Create Layers keeps backdrop-reading effects rather than breaking them", () => {
  // Separated from their layer they would sample a different backdrop — the
  // new layers included — and stop matching what they replaced.
  const studio = new Studio(SIZE, SIZE, testCanvas(SIZE, SIZE));
  studio.addBlankRaster("Glass");
  const layerId = studio.doc.layers[0].id;
  studio.addLayerEffect(layerId, "backdrop-blur");
  studio.addLayerEffect(layerId, "stroke");

  const result = studio.createLayersFromStyle(layerId)!;
  assert.equal(result.created, 1, "only the stroke can be split out");
  assert.equal(result.kept, 1, "the backdrop blur must be reported as kept");
  assert.deepEqual(
    studio.doc.layers.find((l) => l.id === layerId)?.effects?.map((e) => e.kind),
    ["backdrop-blur"],
    "the unsplittable effect should still be on the layer",
  );
  studio.dispose();
});

// --- contact shadow and reflection -----------------------------------------

/** A panel over a split backdrop, for the two effects that read behind it. */
function panelOverSplit(effect: LayerEffect, panelInset = 16) {
  const backdrop = newCanvas(SIZE, SIZE);
  const backdropCtx = backdrop.getContext("2d")!;
  backdropCtx.fillStyle = "#808080";
  backdropCtx.fillRect(0, 0, SIZE, SIZE);
  backdropCtx.fillStyle = "#ffffff";
  backdropCtx.fillRect(0, 0, SIZE, SIZE / 2);

  const panel = newCanvas(SIZE, SIZE);
  const panelCtx = panel.getContext("2d")!;
  panelCtx.fillStyle = "#4060a0";
  panelCtx.fillRect(panelInset, panelInset, SIZE - panelInset * 2, SIZE - panelInset * 2);

  const doc = createDocument(SIZE, SIZE);
  doc.layers = [
    { ...createRasterLayer("panel", panel), effects: [effect] },
    createRasterLayer("backdrop", backdrop),
  ];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);
  return target;
}

test("contact shadow occludes and so can never lighten what is under it", () => {
  // The discriminator that matters. A semi-transparent grey rim laid on top
  // *lifts* a dark backdrop; multiplying it cannot. An earlier version used
  // source-atop with black, which is algebraically identical to compositing
  // black — the backdrop sampling did nothing and the effect was a tight dark
  // outer glow wearing a different name.
  const render = (enabled: boolean) => {
    const backdrop = newCanvas(SIZE, SIZE);
    const backdropCtx = backdrop.getContext("2d")!;
    backdropCtx.fillStyle = "#050505";
    backdropCtx.fillRect(0, 0, SIZE, SIZE);

    const panel = newCanvas(SIZE, SIZE);
    const panelCtx = panel.getContext("2d")!;
    panelCtx.fillStyle = "#4060a0";
    panelCtx.fillRect(20, 20, 20, 20);

    const doc = createDocument(SIZE, SIZE);
    doc.layers = [
      {
        ...createRasterLayer("panel", panel),
        effects: [{
          ...baseEffect("contact-shadow"),
          id: "cs",
          // A light grey: as a veil this would visibly lift near-black.
          color: "#b0b0b0",
          strength: 8,
          blur: 2,
          opacity: 1,
          enabled,
        }],
      },
      createRasterLayer("backdrop", backdrop),
    ];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    return target;
  };

  const shadow = render(true);
  const none = render(false);
  const band = { x: 30, y: 16 };
  const occluded = pixelAt(shadow, band.x, band.y);
  const bare = pixelAt(none, band.x, band.y);
  assert.ok(
    occluded.r <= bare.r + 1,
    `occlusion must not lighten: ${bare.r} became ${occluded.r}`,
  );
});

test("contact shadow darkens proportionally to what is behind it", () => {
  // Multiplying scales the backdrop, so a bright backdrop loses more absolute
  // brightness than a dim one under the same band.
  const render = (backdropColor: string) => {
    const backdrop = newCanvas(SIZE, SIZE);
    const backdropCtx = backdrop.getContext("2d")!;
    backdropCtx.fillStyle = backdropColor;
    backdropCtx.fillRect(0, 0, SIZE, SIZE);

    const panel = newCanvas(SIZE, SIZE);
    const panelCtx = panel.getContext("2d")!;
    panelCtx.fillStyle = "#4060a0";
    panelCtx.fillRect(20, 20, 20, 20);

    const doc = createDocument(SIZE, SIZE);
    doc.layers = [
      {
        ...createRasterLayer("panel", panel),
        effects: [{ ...baseEffect("contact-shadow"), id: "cs", color: "#404040", strength: 8, blur: 2, opacity: 1 }],
      },
      createRasterLayer("backdrop", backdrop),
    ];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    return pixelAt(target, 30, 16).r;
  };

  const fromWhite = 255 - render("#ffffff");
  const fromMid = 128 - render("#808080");
  assert.ok(
    fromWhite > fromMid + 10,
    `expected proportional darkening, lost ${fromWhite} from white vs ${fromMid} from mid`,
  );
});

test("reflection mirrors the backdrop inside the layer", () => {
  // The backdrop's white half is on top. Mirrored, it appears in the lower
  // half of the panel, which is otherwise over grey.
  const reflected = panelOverSplit({
    ...baseEffect("reflection"),
    id: "rf",
    blur: 0,
    offsetX: 0,
    offsetY: 0,
    opacity: 1,
  });
  // y=40 maps back to source y=20, inside the backdrop's white half. The panel
  // ends at y=44, so sampling there sits exactly on the clip boundary.
  const lower = pixelAt(reflected, 30, 40);
  assert.ok(lower.r > 200, `expected the mirrored white half, got r=${lower.r}`);
  // Outside the panel the backdrop is untouched grey.
  assert.ok(pixelAt(reflected, 4, 40).r < 200, "the reflection escaped the layer");
});

test("a document with a reflection stops tiling instead of seaming", () => {
  const withReflection = createDocument(SIZE, SIZE);
  withReflection.layers = [{
    ...createRasterLayer("panel", newCanvas(SIZE, SIZE)),
    effects: [{ ...baseEffect("reflection"), id: "rf" }],
  }];
  assert.equal(documentNeedsFullBackdrop(withReflection.layers), true);

  const disabled = createDocument(SIZE, SIZE);
  disabled.layers = [{
    ...createRasterLayer("panel", newCanvas(SIZE, SIZE)),
    effects: [{ ...baseEffect("reflection"), id: "rf", enabled: false }],
  }];
  assert.equal(documentNeedsFullBackdrop(disabled.layers), false, "a disabled effect must not cost the tile cache");
});

// --- tile sampling reach ---------------------------------------------------

test("effects that sample beyond their silhouette declare a reach", () => {
  // layerEffectReach sets the tile margin, so it has to cover reading as well
  // as painting. These four are clipped to the layer but read from outside it,
  // and reporting 0 gave each tile only its own slice — visible as seams.
  const sampling: Array<[LayerEffectKind, Partial<LayerEffect>]> = [
    ["inner-shadow", { blur: 10, offsetX: 12, offsetY: 0 }],
    ["inner-glow", { blur: 10 }],
    ["satin", { blur: 10, offsetX: 12, offsetY: 0 }],
    ["relief", { depth: 9 }],
  ];
  for (const [kind, patch] of sampling) {
    const reach = layerEffectReach({ ...baseEffect(kind), ...patch });
    assert.ok(reach > 0, `${kind} samples outside the silhouette but reports reach ${reach}`);
  }

  // Genuinely per-pixel effects should stay at zero so tiles stay cheap.
  for (const kind of ["color-overlay", "gradient-overlay", "pattern-overlay"] as LayerEffectKind[]) {
    assert.equal(layerEffectReach(baseEffect(kind)), 0, `${kind} should need no margin`);
  }
});

test("a tiled viewport render matches the untiled one for a sampling effect", () => {
  // The behavioural half: an inner shadow far enough to cross tile boundaries
  // must look the same however the frame was cut up.
  const BIG = 512;
  const bitmap = newCanvas(BIG, BIG);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(40, 40, BIG - 80, BIG - 80);

  const doc = createDocument(BIG, BIG);
  doc.layers = [{
    ...createRasterLayer("box", bitmap),
    effects: [{
      ...baseEffect("inner-shadow"),
      id: "is",
      color: "#000000",
      blur: 20,
      offsetX: 24,
      offsetY: 24,
      opacity: 1,
    }],
  }];

  const untiled = testCanvas(BIG, BIG);
  renderClean(doc, untiled);

  const tiled = testCanvas(BIG, BIG);
  renderViewport(doc, tiled, {
    x: 0, y: 0, width: BIG, height: BIG, zoom: 1,
    outputWidth: BIG, outputHeight: BIG, cssScale: 1, devicePixelRatio: 1,
  }, {
    checkerboard: false,
    selectionOverlay: false,
    proofing: false,
  });

  // Sample along a horizontal line crossing several tile boundaries.
  let worst = 0;
  for (let x = 45; x < BIG - 45; x += 7) {
    const a = pixelAt(untiled, x, 70);
    const b = pixelAt(tiled, x, 70);
    worst = Math.max(worst, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
  }
  assert.ok(worst <= 2, `tiled and untiled renders diverge by ${worst}`);
});

// --- subject-restricted effects --------------------------------------------

test("an effect can be confined to the layer's subject matte", () => {
  // The matte is synthetic here: the point is the intersection, not the model.
  // On-device inference needs a model download, so the render path is tested
  // with a mask the same shape the model would produce.
  const bitmap = newCanvas(SIZE, SIZE);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(10, 20, 40, 20);

  // "Subject" is the left half of the bar.
  const subjectMask = newCanvas(SIZE, SIZE);
  const maskCtx = subjectMask.getContext("2d")!;
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(0, 0, 30, SIZE);

  const glow = (restrictToSubject: boolean): LayerEffect => ({
    ...baseEffect("outer-glow"),
    id: "g1",
    color: "#00ff00",
    blur: 8,
    opacity: 1,
    restrictToSubject,
  });

  const render = (restrict: boolean) => {
    const doc = createDocument(SIZE, SIZE);
    doc.layers = [{ ...createRasterLayer("bar", bitmap), subjectMask, effects: [glow(restrict)] }];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    return target;
  };

  const everywhere = render(false);
  const subjectOnly = render(true);

  // Below the left half, inside the matte: the glow survives either way.
  assert.ok(pixelAt(everywhere, 15, 44).a > 20, "expected a glow under the left end");
  assert.ok(pixelAt(subjectOnly, 15, 44).a > 20, "the matte should keep the left end");

  // Below the right half, outside the matte: only the unrestricted one glows.
  assert.ok(pixelAt(everywhere, 45, 44).a > 20, "expected a glow under the right end");
  assert.equal(pixelAt(subjectOnly, 45, 44).a, 0, "the matte should have cut the right end");
});

test("an effect awaiting its matte renders unrestricted rather than vanishing", () => {
  // Inference is async and rendering is not. A layer that has not been through
  // the model yet must not lose its effects while it waits.
  const bitmap = newCanvas(SIZE, SIZE);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(20, 20, 20, 20);

  const doc = createDocument(SIZE, SIZE);
  doc.layers = [{
    ...createRasterLayer("bar", bitmap),
    effects: [{ ...baseEffect("outer-glow"), id: "g1", color: "#00ff00", blur: 8, opacity: 1, restrictToSubject: true }],
  }];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);
  assert.ok(pixelAt(target, 30, 16).a > 20, "the effect should still render with no matte");
});

test("a vector mask confines an adjustment layer the way a raster mask does", () => {
  // Not mid grey: inverting 128 gives 127, which no assertion could tell apart.
  const base = newCanvas(SIZE, SIZE);
  const baseCtx = base.getContext("2d")!;
  baseCtx.fillStyle = "#303030";
  baseCtx.fillRect(0, 0, SIZE, SIZE);

  const doc = createDocument(SIZE, SIZE);
  doc.layers = [{
    ...createRasterLayer("invert", newCanvas(1, 1)),
    kind: "adjustment-levels",
    levels: { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 1, outWhite: 0 },
    // A rectangle covering only the left of the canvas.
    vectorMask: {
      anchors: [
        { x: 0, y: 0, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
        { x: 30, y: 0, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
        { x: 30, y: SIZE, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
        { x: 0, y: SIZE, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } },
      ],
      closed: true,
      fill: "#ffffff",
      stroke: "none",
      strokeWidth: 0,
    },
  }, createRasterLayer("base", base)];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);

  assert.ok(pixelAt(target, 10, 32).r > 180, "inside the path the adjustment applies");
  assert.ok(pixelAt(target, 50, 32).r < 80, "outside the path the base is untouched");
});

test("a style on an adjustment layer draws around the mask's shape", () => {
  // An adjustment layer has no pixels of its own; its shape is its mask. A
  // drop shadow should therefore fall off the edge of the masked region, and
  // the adjustment itself must still reach the pixels beneath.
  const base = newCanvas(SIZE, SIZE);
  const baseCtx = base.getContext("2d")!;
  baseCtx.fillStyle = "#808080";
  baseCtx.fillRect(0, 0, SIZE, SIZE);

  const mask = newCanvas(SIZE, SIZE);
  const maskCtx = mask.getContext("2d")!;
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(20, 20, 20, 20);

  const doc = createDocument(SIZE, SIZE);
  const adjustment: Layer = {
    ...createRasterLayer("invert", newCanvas(1, 1)),
    kind: "adjustment-levels",
    levels: { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 1, outWhite: 0 },
    mask,
    effects: [{
      ...baseEffect("drop-shadow"),
      id: "s1", color: "#000000", blur: 2, offsetX: 10, offsetY: 0, opacity: 1,
      useGlobalLight: false, contour: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    }],
  };
  doc.layers = [adjustment, createRasterLayer("base", base)];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);

  // Inside the mask the levels flip mid grey towards its complement.
  assert.ok(pixelAt(target, 30, 30).r < 130, "the adjustment should still apply inside the mask");
  // At angle 0 the shadow is thrown to the right of the masked square.
  const shadow = pixelAt(target, 46, 30);
  assert.ok(shadow.r < 110, `the shadow should darken outside the mask, got ${shadow.r}`);
  assert.ok(pixelAt(target, 5, 5).r > 120, "far from the mask the base is untouched");
});

// --- advanced blending options ---------------------------------------------

/** An opaque red backdrop under a blue square, both full-frame layers. */
function stackedDoc(patch: Partial<Layer>) {
  const square = newCanvas(SIZE, SIZE);
  const squareCtx = square.getContext("2d")!;
  squareCtx.fillStyle = "#0000ff";
  squareCtx.fillRect(20, 20, 20, 20);

  const backdrop = newCanvas(SIZE, SIZE);
  const backdropCtx = backdrop.getContext("2d")!;
  backdropCtx.fillStyle = "#ff0000";
  backdropCtx.fillRect(0, 0, SIZE, SIZE);

  const doc = createDocument(SIZE, SIZE);
  doc.layers = [
    { ...createRasterLayer("top", square), ...patch },
    createRasterLayer("backdrop", backdrop),
  ];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);
  return target;
}

test("knockout punches the layer's shape through what is beneath it", () => {
  // With fill opacity at zero the layer contributes no colour, so all that is
  // left is the hole — which is the whole point of knockout.
  const plain = stackedDoc({ fillOpacity: 0 });
  assert.ok(pixelAt(plain, 30, 30).r > 200, "without knockout the backdrop shows through");

  const knocked = stackedDoc({ fillOpacity: 0, knockout: "deep" });
  assert.equal(pixelAt(knocked, 30, 30).a, 0, "knockout should have cut through to nothing");
  assert.ok(pixelAt(knocked, 5, 5).r > 200, "outside the shape the backdrop is untouched");
});

test("a deep knockout inside a clipped stack still reaches the document", () => {
  // The base and its clipped members composite into their own buffer first. A
  // deep knockout has to punch through that buffer *and* the document beneath,
  // or the hole stops at the stack and the backdrop survives.
  const square = newCanvas(SIZE, SIZE);
  const squareCtx = square.getContext("2d")!;
  squareCtx.fillStyle = "#0000ff";
  squareCtx.fillRect(20, 20, 20, 20);

  // Covers only the left half of the base, so the right half is bare hole.
  const member = newCanvas(SIZE, SIZE);
  const memberCtx = member.getContext("2d")!;
  memberCtx.fillStyle = "#00ff00";
  memberCtx.fillRect(20, 20, 10, 20);

  const backdrop = newCanvas(SIZE, SIZE);
  const backdropCtx = backdrop.getContext("2d")!;
  backdropCtx.fillStyle = "#ff0000";
  backdropCtx.fillRect(0, 0, SIZE, SIZE);

  const doc = createDocument(SIZE, SIZE);
  doc.layers = [
    { ...createRasterLayer("clipped", member), clipping: true },
    { ...createRasterLayer("base", square), fillOpacity: 0, knockout: "deep" },
    createRasterLayer("backdrop", backdrop),
  ];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);

  assert.equal(pixelAt(target, 35, 30).a, 0, "the uncovered half of the base should be a hole");
  assert.ok(pixelAt(target, 25, 30).g > 200, "the clipped member still paints its half");
  assert.ok(pixelAt(target, 5, 5).r > 200, "outside the base the backdrop is untouched");
});

test("a layer restricted to one channel leaves the others alone", () => {
  const all = stackedDoc({});
  assert.ok(pixelAt(all, 30, 30).b > 200 && pixelAt(all, 30, 30).r < 60, "blue over red");

  // Allow only the blue channel: red must survive from the backdrop.
  const blueOnly = stackedDoc({ blendChannels: { r: false, g: true, b: true } });
  const px = pixelAt(blueOnly, 30, 30);
  assert.ok(px.r > 200, `the red channel should be preserved, got r=${px.r}`);
  assert.ok(px.b > 200, `the blue channel should still be written, got b=${px.b}`);
});

test("a layer mask shapes the pixels but not the effects, unless asked", () => {
  // Photoshop's default: the shadow still falls outside the mask.
  const mask = newCanvas(SIZE, SIZE);
  const maskCtx = mask.getContext("2d")!;
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(0, 0, SIZE / 2, SIZE);

  const glow: LayerEffect = {
    ...baseEffect("outer-glow"),
    id: "g1",
    color: "#00ff00",
    blur: 10,
    opacity: 1,
  };
  const outside = { x: 32, y: 30 };

  const shows = stackedDoc({ mask, effects: [glow] });
  assert.ok(
    pixelAt(shows, outside.x, outside.y).g > 30,
    `by default the effect should reach past the mask, got g=${pixelAt(shows, outside.x, outside.y).g}`,
  );

  const hides = stackedDoc({ mask, effects: [glow], maskHidesEffects: true });
  assert.equal(
    pixelAt(hides, outside.x, outside.y).g,
    0,
    "with the option on the mask should cut the effect off entirely",
  );
});

// --- luminance-driven effects ----------------------------------------------

/** A dim square with one bright corner: enough contrast to bloom or emboss. */
function contrastyDoc(effect: LayerEffect) {
  const bitmap = newCanvas(SIZE, SIZE);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#202020";
  ctx.fillRect(15, 15, 30, 30);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(15, 15, 10, 10);
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [{ ...createRasterLayer("box", bitmap), effects: [effect] }];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);
  return target;
}

test("bloom spreads light from bright pixels, not from the silhouette", () => {
  // The distinction from Outer Glow: a glow would spill from every edge of the
  // square, because it only knows the alpha. Bloom must spill from the white
  // corner and leave the dark edges alone.
  const target = contrastyDoc({
    ...baseEffect("bloom"),
    id: "b1",
    blur: 10,
    threshold: 0.6,
    opacity: 1,
  });

  const nearBright = pixelAt(target, 12, 20);
  const nearDark = pixelAt(target, 12, 42);
  assert.ok(nearBright.a > 20, `expected bloom beside the bright corner, got alpha ${nearBright.a}`);
  assert.ok(
    nearBright.a > nearDark.a + 20,
    `bloom should favour the bright corner: bright a=${nearBright.a} vs dark a=${nearDark.a}`,
  );
});

test("raising the bloom threshold above the brightest pixel yields nothing", () => {
  const target = contrastyDoc({ ...baseEffect("bloom"), id: "b1", blur: 10, threshold: 1, opacity: 1 });
  assert.equal(pixelAt(target, 12, 20).a, 0, "nothing is brighter than white");
});

test("relief embosses the image content, not its outline", () => {
  // The interior boundary between the white corner and the dark body has to
  // pick up light and shade; a bevel could only have lit the outer edge.
  const target = contrastyDoc({
    ...baseEffect("relief"),
    id: "r1",
    depth: 3,
    angle: 135,
    opacity: 1,
  });
  const above = pixelAt(target, 20, 23);
  const below = pixelAt(target, 20, 27);
  assert.notEqual(
    above.r + above.g + above.b,
    below.r + below.g + below.b,
    "expected relief across the interior luminance edge",
  );
});

test("a long shadow trails away from the shape and fades", () => {
  const target = contrastyDoc({
    ...baseEffect("long-shadow"),
    id: "l1",
    color: "#000000",
    offsetX: 18,
    offsetY: 18,
    steps: 40,
    opacity: 1,
  });
  const near = pixelAt(target, 47, 47);
  const far = pixelAt(target, 58, 58);
  assert.ok(near.a > 40, `expected a trail past the shape, got alpha ${near.a}`);
  assert.ok(far.a < near.a, `the trail should fade: near ${near.a} vs far ${far.a}`);
});

// --- backdrop blur ---------------------------------------------------------

test("backdrop blur averages what is behind the layer, not the layer itself", () => {
  // A hard black/white split behind a transparent panel. Blurring the backdrop
  // has to smear the two into greys at the boundary; blurring the layer's own
  // pixels could not, because the layer has none there.
  const backdrop = newCanvas(SIZE, SIZE);
  const backdropCtx = backdrop.getContext("2d")!;
  backdropCtx.fillStyle = "#000000";
  backdropCtx.fillRect(0, 0, SIZE / 2, SIZE);
  backdropCtx.fillStyle = "#ffffff";
  backdropCtx.fillRect(SIZE / 2, 0, SIZE / 2, SIZE);

  // The panel must be opaque. The effect is clipped to the layer's alpha, so a
  // near-transparent panel would scale the whole blur down to nothing — which
  // is correct behaviour, and was the first version of this test being wrong.
  // Its own colour does not matter: Backdrop Blur paints over the content.
  const panel = newCanvas(SIZE, SIZE);
  const panelCtx = panel.getContext("2d")!;
  panelCtx.fillStyle = "#00ff00";
  panelCtx.fillRect(10, 10, SIZE - 20, SIZE - 20);

  const glass: Layer = {
    ...createRasterLayer("glass", panel),
    effects: [{
      ...baseEffect("backdrop-blur"),
      id: "bb",
      blur: 12,
      saturation: 1,
      tint: 0,
      opacity: 1,
    }],
  };
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [glass, createRasterLayer("backdrop", backdrop)];

  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);

  // Just left of the seam the raw backdrop is pure black; the blur must have
  // pulled white across it.
  const nearSeam = pixelAt(target, SIZE / 2 - 3, 30);
  assert.ok(
    nearSeam.r > 30,
    `expected the white half smeared across the seam, got r=${nearSeam.r}`,
  );
  // Outside the panel the backdrop must be untouched. Sample just past the
  // seam on the white side and above the panel: raw backdrop is pure white
  // there, but an unclipped blur would have greyed it from the black half.
  const outside = pixelAt(target, SIZE / 2 + 3, 4);
  assert.ok(outside.r > 230, `the blur escaped the layer silhouette, got r=${outside.r}`);
});

test("refraction displaces the backdrop where the layer's alpha has a slope", () => {
  // Comparing against the same document with strength 0 keeps the assertion
  // about the effect rather than about my guess at which pixel moves: the
  // displacement is bounded and edge-driven, so picking a sample point by hand
  // is easy to get wrong in a way that hides a broken implementation.
  const render = (strength: number) => {
    const backdrop = newCanvas(SIZE, SIZE);
    const backdropCtx = backdrop.getContext("2d")!;
    backdropCtx.fillStyle = "#000000";
    backdropCtx.fillRect(0, 0, 24, SIZE);
    backdropCtx.fillStyle = "#ffffff";
    backdropCtx.fillRect(24, 0, SIZE - 24, SIZE);

    const panel = newCanvas(SIZE, SIZE);
    const panelCtx = panel.getContext("2d")!;
    panelCtx.fillStyle = "#00ff00";
    panelCtx.fillRect(10, 10, SIZE - 20, SIZE - 20);

    const doc = createDocument(SIZE, SIZE);
    doc.layers = [
      {
        ...createRasterLayer("glass", panel),
        effects: [{ ...baseEffect("refraction"), id: "rf", strength, blur: 5, opacity: 1 }],
      },
      createRasterLayer("backdrop", backdrop),
    ];
    const target = testCanvas(SIZE, SIZE);
    renderClean(doc, target);
    const { data } = target.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
  };

  assert.notEqual(render(16), render(0), "strength should change the composite");
});

test("refraction is a no-op with nothing behind the layer", () => {
  const panel = newCanvas(SIZE, SIZE);
  const panelCtx = panel.getContext("2d")!;
  panelCtx.fillStyle = "#00ff00";
  panelCtx.fillRect(10, 10, 30, 30);
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [{
    ...createRasterLayer("glass", panel),
    effects: [{ ...baseEffect("refraction"), id: "rf", strength: 16, blur: 5, opacity: 1 }],
  }];
  const target = testCanvas(SIZE, SIZE);
  assert.doesNotThrow(() => renderClean(doc, target));
  const inside = pixelAt(target, 25, 25);
  assert.ok(inside.g > 200, "the layer should be untouched with no backdrop");
});

test("backdrop blur is a no-op when nothing is behind the layer", () => {
  const panel = newCanvas(SIZE, SIZE);
  const panelCtx = panel.getContext("2d")!;
  panelCtx.fillStyle = "#ff0000";
  panelCtx.fillRect(20, 20, 20, 20);
  const layer: Layer = {
    ...createRasterLayer("solo", panel),
    effects: [{ ...baseEffect("backdrop-blur"), id: "bb", blur: 12, tint: 0, saturation: 1 }],
  };
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [layer];

  const target = testCanvas(SIZE, SIZE);
  assert.doesNotThrow(() => renderClean(doc, target));
  const inside = pixelAt(target, 30, 30);
  assert.ok(inside.r > 200 && inside.g < 60, "the layer should be untouched with no backdrop");
});

// --- layer styles on groups ------------------------------------------------

/** Two separate squares inside one group, with a gap between them. */
function groupedSquares() {
  const square = (x: number) => {
    const canvas = newCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(x, 20, 12, 12);
    return canvas;
  };
  const group = createGroupLayer("Group");
  const a = createRasterLayer("a", square(10));
  const b = createRasterLayer("b", square(38));
  a.parentId = group.id;
  b.parentId = group.id;
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [group, a, b];
  return { doc, group };
}

test("a group takes a layer style and it sees the whole group", () => {
  const { doc, group } = groupedSquares();

  const before = testCanvas(SIZE, SIZE);
  renderClean(doc, before);
  assert.equal(pixelAt(before, 30, 26).a, 0, "expected a gap between the two squares");

  group.effects = [{
    ...baseEffect("outer-glow"),
    id: "g1",
    color: "#00ff00",
    blur: 16,
    opacity: 1,
  }];

  const after = testCanvas(SIZE, SIZE);
  renderClean(doc, after);
  // The gap fills from both squares at once, which only happens if the style
  // saw the composited group rather than being applied per child.
  assert.ok(pixelAt(after, 30, 26).a > 10, "the group style did not render");
});

test("Studio accepts a layer style on a group", () => {
  const studio = new Studio(SIZE, SIZE, testCanvas(SIZE, SIZE));
  const group = createGroupLayer("Group");
  studio.doc.layers = [group];
  const effect = studio.addLayerEffect(group.id, "outer-glow");
  assert.ok(effect, "groups used to be refused outright");
  assert.equal(studio.doc.layers[0].effects?.length, 1);
  studio.dispose();
});

test("a group style is not applied twice when the group also has children styles", () => {
  // A styled group must not be flattened into its parent, or the group's own
  // effects would never get a buffer to act on.
  const { doc, group } = groupedSquares();
  group.effects = [{ ...baseEffect("color-overlay"), id: "g1", color: "#0000ff", opacity: 1 }];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);
  const inside = pixelAt(target, 16, 26);
  assert.ok(inside.b > 200 && inside.r < 60, `expected the group overlay, got rgb(${inside.r},${inside.g},${inside.b})`);
});

// --- global light ----------------------------------------------------------

test("global light shares a direction while each effect keeps its distance", () => {
  const near = { ...baseEffect("drop-shadow"), offsetX: 10, offsetY: 0, useGlobalLight: true };
  const far = { ...near, offsetX: 40, offsetY: 0 };
  const light = { angle: 0, altitude: 30 };
  assert.deepEqual(resolvedEffectOffset(near, light), { x: 10, y: -0 });
  const farOffset = resolvedEffectOffset(far, light);
  assert.ok(Math.abs(farOffset.x - 40) < 1e-9, "distance must be preserved");

  // Same angle for both, so every opted-in shadow points the same way.
  const rotated = { angle: 90, altitude: 30 };
  const a = resolvedEffectOffset(near, rotated);
  const b = resolvedEffectOffset(far, rotated);
  assert.ok(Math.abs(a.x) < 1e-9 && a.y < 0, `90deg should point up, got ${JSON.stringify(a)}`);
  assert.ok(Math.abs(b.x) < 1e-9 && b.y < 0);
});

test("an effect that opts out of global light is untouched by it", () => {
  const effect = { ...baseEffect("drop-shadow"), offsetX: 7, offsetY: 3 };
  assert.deepEqual(resolvedEffectOffset(effect, { angle: 0, altitude: 0 }), { x: 7, y: 3 });
});

test("setGlobalLight moves every opted-in effect and is undoable", () => {
  const { studio, layerId } = studioWithLayer();
  const effect = studio.addLayerEffect(layerId, "drop-shadow")!;
  studio.updateLayerEffect(layerId, effect.id, { useGlobalLight: true });
  const before = resolvedGlobalLight(studio.doc).angle;

  studio.setGlobalLight({ angle: before + 90 });
  assert.equal(resolvedGlobalLight(studio.doc).angle, before + 90);
  studio.undo();
  assert.equal(resolvedGlobalLight(studio.doc).angle, before, "undo did not restore the light");
  studio.dispose();
});

// --- scale effects ---------------------------------------------------------

test("scaling effects multiplies every size field and leaves the rest alone", () => {
  const { studio, layerId } = studioWithLayer();
  const stroke = studio.addLayerEffect(layerId, "stroke")!;
  const shadow = studio.addLayerEffect(layerId, "drop-shadow")!;
  const bevel = studio.addLayerEffect(layerId, "bevel-emboss")!;

  studio.scaleLayerEffects(layerId, 2);
  const byId = new Map(studio.doc.layers[0].effects!.map((effect) => [effect.id, effect]));
  assert.equal(byId.get(stroke.id)!.width, stroke.width! * 2);
  assert.equal(byId.get(shadow.id)!.blur, shadow.blur * 2);
  assert.equal(byId.get(shadow.id)!.offsetX, shadow.offsetX * 2);
  assert.equal(byId.get(bevel.id)!.depth, bevel.depth! * 2);
  // Angles and colours are not sizes.
  assert.equal(byId.get(bevel.id)!.angle, bevel.angle);
  assert.equal(byId.get(shadow.id)!.color, shadow.color);
  assert.equal(byId.get(shadow.id)!.opacity, shadow.opacity);

  studio.undo();
  assert.equal(studio.doc.layers[0].effects!.find((e) => e.id === stroke.id)!.width, stroke.width);
  studio.dispose();
});

test("scaling refuses a nonsense factor rather than producing NaN sizes", () => {
  const { studio, layerId } = studioWithLayer();
  const effect = studio.addLayerEffect(layerId, "stroke")!;
  for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    studio.scaleLayerEffects(layerId, factor);
    assert.equal(studio.doc.layers[0].effects![0].width, effect.width, `factor ${factor} was applied`);
  }
  studio.dispose();
});

// --- copy / paste / clear layer style --------------------------------------

test("a copied layer style carries effects and blending options to another layer", () => {
  const studio = new Studio(64, 64, testCanvas(64, 64));
  studio.addBlankRaster("Source");
  studio.addBlankRaster("Target");
  const [target, source] = studio.doc.layers;

  studio.addLayerEffect(source.id, "stroke");
  studio.setLayerFillOpacity(source.id, 0.25);
  studio.updateBlendPass(source.id, resolvedBlendPasses(source)[0].id, { mode: "multiply" });

  assert.equal(studio.hasCopiedLayerStyle(), false);
  studio.copyLayerStyle(source.id);
  assert.equal(studio.hasCopiedLayerStyle(), true);
  assert.equal(studio.pasteLayerStyle(target.id), true);

  assert.equal(target.effects?.length, 1);
  assert.equal(target.effects![0].kind, "stroke");
  assert.equal(resolvedFillOpacity(target), 0.25);
  assert.equal(resolvedBlendPasses(target)[0].mode, "multiply");
  studio.dispose();
});

test("a pasted style gets fresh ids so the two layers stay independent", () => {
  const studio = new Studio(64, 64, testCanvas(64, 64));
  studio.addBlankRaster("Source");
  studio.addBlankRaster("Target");
  const [target, source] = studio.doc.layers;
  const original = studio.addLayerEffect(source.id, "outer-glow")!;
  studio.copyLayerStyle(source.id);
  studio.pasteLayerStyle(target.id);

  const pasted = target.effects![0];
  assert.notEqual(pasted.id, original.id, "shared ids would make one edit hit both layers");
  studio.updateLayerEffect(target.id, pasted.id, { blur: 99 });
  assert.equal(source.effects![0].blur, original.blur, "editing the copy changed the original");
  studio.dispose();
});

test("pasting is refused on a locked layer", () => {
  const { studio, layerId } = studioWithLayer();
  studio.addLayerEffect(layerId, "stroke");
  studio.copyLayerStyle(layerId);
  studio.setLayerProp(layerId, "locked", true, "Lock");
  assert.equal(studio.pasteLayerStyle(layerId), false);
  studio.dispose();
});

test("clearing a layer style removes every effect and is undoable", () => {
  const { studio, layerId } = studioWithLayer();
  studio.addLayerEffect(layerId, "stroke");
  studio.addLayerEffect(layerId, "drop-shadow");
  assert.equal(studio.clearLayerStyle(layerId), true);
  assert.equal(studio.doc.layers[0].effects?.length, 0);
  studio.undo();
  assert.equal(studio.doc.layers[0].effects?.length, 2, "undo did not restore the style");
  studio.dispose();
});

test("effects added through the dialog actually change the composite", () => {
  const studio = new Studio(64, 64, testCanvas(64, 64));
  // A 24x24 square imported centred, so there is clear space around it.
  const square = testCanvas(24, 24);
  const squareCtx = square.getContext("2d")!;
  squareCtx.fillStyle = "#ff0000";
  squareCtx.fillRect(0, 0, 24, 24);
  studio.addRasterFromImage(
    "square",
    Object.assign(square, { naturalWidth: 24, naturalHeight: 24 }) as unknown as HTMLImageElement,
  );
  const layerId = studio.doc.layers[0].id;

  const before = testCanvas(64, 64);
  renderClean(studio.doc, before);
  assert.equal(pixelAt(before, 50, 32).a, 0, "expected clear space beside the square");

  const effect = studio.addLayerEffect(layerId, "outer-glow")!;
  studio.updateLayerEffect(layerId, effect.id, { blur: 12, opacity: 1 });

  const after = testCanvas(64, 64);
  renderClean(studio.doc, after);
  assert.ok(pixelAt(after, 50, 32).a > 10, "the glow should reach beyond the square");
  studio.dispose();
});

test("a locked layer refuses every appearance change, not just effects", () => {
  // The effects mutators learned this lesson already (see the locked-layer
  // effect test above, and pasteLayerStyle). The blending family, the
  // adjustment family and clearMask never did — so a locked adjustment layer
  // could still be re-curved and a locked layer could still lose its mask.
  const studio = new Studio(SIZE, SIZE, testCanvas(SIZE, SIZE));

  const raster = studio.addBlankRaster("raster");
  raster.mask = newCanvas(SIZE, SIZE);
  studio.setLayerProp(raster.id, "locked", true, "Lock");
  const live = () => studio.doc.layers.find((layer) => layer.id === raster.id)!;

  studio.setLayerFillOpacity(raster.id, 0.25);
  assert.notEqual(resolvedFillOpacity(live()), 0.25, "fill opacity is an appearance change");

  studio.setBlendStack(raster.id, [{ id: "p1", mode: "multiply", opacity: 1, enabled: true }]);
  assert.equal(live().blendStack, undefined, "blend stack is an appearance change");

  studio.clearMask(raster.id);
  assert.ok(live().mask || live().maskSurface, "clearing a locked layer's mask is destructive");

  const curves = studio.addCurvesLayer("Curves");
  studio.setLayerProp(curves.id, "locked", true, "Lock");
  const beforeCurves = JSON.stringify(studio.doc.layers.find((l) => l.id === curves.id)!.curves);
  studio.updateCurves(curves.id, {
    rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 1, y: 1 }],
    r: [{ x: 0, y: 0 }, { x: 1, y: 1 }], g: [{ x: 0, y: 0 }, { x: 1, y: 1 }], b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  assert.equal(
    JSON.stringify(studio.doc.layers.find((l) => l.id === curves.id)!.curves),
    beforeCurves,
    "a locked adjustment layer must not be re-curved",
  );

  // The lock must never be a one-way door.
  studio.setLayerProp(raster.id, "visible", false, "Hide");
  assert.equal(live().visible, false, "a locked layer stays hideable");
  studio.setLayerProp(raster.id, "locked", false, "Unlock");
  assert.equal(live().locked, false, "unlocking must always work");
});
