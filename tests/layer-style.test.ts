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

/** A neutral starting point so any field change is visible if it is read. */
function baseEffect(kind: LayerEffectKind): LayerEffect {
  return {
    id: "e1", kind, enabled: true, opacity: 1, color: "#00ff00",
    blur: 0, offsetX: 0, offsetY: 0,
    width: 4, position: "outside",
    depth: 4, angle: 135, highlightColor: "#ffffff", shadowColor: "#000000",
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

test("a locked layer refuses new effects", () => {
  const { studio, layerId } = studioWithLayer();
  studio.setLayerProp(layerId, "locked", true, "Lock");
  assert.equal(studio.addLayerEffect(layerId, "stroke"), null);
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
