import assert from "node:assert/strict";
import test from "node:test";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import {
  BLEND_IF_HANDLES,
  EFFECT_FIELDS,
  EFFECT_LABELS,
  LAYER_EFFECT_KINDS,
  createDocument,
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

function docWith(effect: LayerEffect): Document {
  const bitmap = newCanvas(SIZE, SIZE);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(20, 20, 20, 20);
  const layer: Layer = { ...createRasterLayer("box", bitmap), effects: [effect] };
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [layer];
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
    id: "e1", kind, enabled: true, opacity: 1, color: "#00ff00",
    blur: 0, offsetX: 8, offsetY: 0,
    width: 4, position: "outside",
    depth: 4, angle: 135, highlightColor: "#ffffff", shadowColor: "#000000",
    glowSource: "edge", invert: false,
    stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }],
    gradientAngle: 90, gradientStyle: "linear",
    pattern: "checker", patternScale: 8,
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
  globalLight: { useGlobalLight: true },
  glowSource: { glowSource: "center" },
  invert: { invert: true },
  gradientStops: { stops: [{ offset: 0, color: "#00ff00" }, { offset: 1, color: "#ffff00" }] },
  gradientAngle: { gradientAngle: 0 },
  gradientStyle: { gradientStyle: "radial" },
  gradientReverse: { reverse: true },
  pattern: { pattern: "stripes" },
  patternScale: { patternScale: 20 },
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
