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
  type EffectField,
  type Layer,
  type LayerEffect,
  type LayerEffectKind,
} from "../app/engine/document.ts";
import { formatCssColor, parseCssColor } from "../app/engine/color.ts";
import { renderClean } from "../app/engine/renderer.ts";
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
  contour: { contour: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] },
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

test("the GPU path declines rather than ignoring an effect blend mode", () => {
  // rasterizeLayer builds each layer independently and has no backdrop, so a
  // blended effect cannot be right there. Declining sends it to the CPU
  // renderer instead of silently exporting a different image.
  const source = readFileSync(new URL("../app/engine/gl-renderer.ts", import.meta.url), "utf8");
  // Match the guard itself, not the import — the identifier alone survives
  // deleting the check, which is exactly how this test first passed hollow.
  assert.match(
    source,
    /resolvedEffectBlendMode\(effect\) !== "source-over"\)\)\) return false;/,
    "gl-renderer must decline documents whose effect blend modes it cannot honour",
  );
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
