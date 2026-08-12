import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import {
  EFFECTS_BELOW_CONTENT,
  bevelOffset,
  effectsInPaintOrder,
  createDocument,
  createRasterLayer,
  isEffectBelowContent,
  newCanvas,
  type Document,
  type Layer,
  type LayerEffect,
  type LayerEffectKind,
} from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";

// Layer style effects, asserted through the real renderer.
//
// The layer is a centred opaque square on a transparent document, so "inside
// the shape" and "outside the shape" are unambiguous sample points and each
// effect can be checked where it is supposed to act.

const SIZE = 60;
const BOX = { x0: 20, y0: 20, x1: 40, y1: 40 }; // 20x20 square in the middle

/** Document containing one centred red square with the given effects. */
function docWithEffects(effects: LayerEffect[]): Document {
  const bitmap = newCanvas(SIZE, SIZE);
  const ctx = bitmap.getContext("2d")!;
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(BOX.x0, BOX.y0, BOX.x1 - BOX.x0, BOX.y1 - BOX.y0);
  const layer: Layer = { ...createRasterLayer("box", bitmap), effects };
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [layer];
  return doc;
}

function render(effects: LayerEffect[]) {
  const target = testCanvas(SIZE, SIZE);
  renderClean(docWithEffects(effects), target);
  return target;
}

function effect(kind: LayerEffectKind, overrides: Partial<LayerEffect> = {}): LayerEffect {
  return {
    id: `e-${kind}`,
    kind,
    enabled: true,
    opacity: 1,
    color: "#00ff00",
    blur: 0,
    offsetX: 0,
    offsetY: 0,
    ...overrides,
  };
}

const centre = { x: 30, y: 30 };
const farOutside = { x: 3, y: 3 };

test("the effect ordering table matches the below/above helper", () => {
  for (const kind of EFFECTS_BELOW_CONTENT) {
    assert.equal(isEffectBelowContent(kind), true, `${kind} should be below`);
  }
  for (const kind of ["color-overlay", "stroke", "inner-shadow", "bevel-emboss"] as LayerEffectKind[]) {
    assert.equal(isEffectBelowContent(kind), false, `${kind} should be above`);
  }
});

test("with no effects the square renders plain", () => {
  const target = render([]);
  const px = pixelAt(target, centre.x, centre.y);
  assert.ok(px.r > 200 && px.g < 40, "expected untouched red");
  assert.equal(pixelAt(target, farOutside.x, farOutside.y).a, 0, "background stays clear");
});

test("color overlay repaints the layer and is clipped to it", () => {
  const target = render([effect("color-overlay", { color: "#0000ff" })]);
  const px = pixelAt(target, centre.x, centre.y);
  assert.ok(px.b > 200 && px.r < 40, `expected blue over the shape, got rgb(${px.r},${px.g},${px.b})`);
  // Must not leak outside the silhouette.
  assert.equal(pixelAt(target, farOutside.x, farOutside.y).a, 0, "overlay leaked outside the layer");
});

test("color overlay opacity mixes with the layer colour", () => {
  const target = render([effect("color-overlay", { color: "#0000ff", opacity: 0.5 })]);
  const px = pixelAt(target, centre.x, centre.y);
  assert.ok(px.r > 80 && px.b > 80, `expected a red/blue mix, got rgb(${px.r},${px.g},${px.b})`);
});

test("an outside stroke paints beyond the shape without covering it", () => {
  const target = render([effect("stroke", { color: "#00ff00", width: 4, position: "outside" })]);
  const ring = pixelAt(target, 30, 18); // 2px above the top edge
  assert.ok(ring.a > 100, `expected stroke outside the edge, got alpha ${ring.a}`);
  assert.ok(ring.g > 150 && ring.r < 120, `expected green stroke, got rgb(${ring.r},${ring.g},${ring.b})`);
  // The interior is still the layer's own colour.
  const inside = pixelAt(target, centre.x, centre.y);
  assert.ok(inside.r > 200 && inside.g < 60, "outside stroke must not cover the fill");
});

test("an inside stroke stays within the shape", () => {
  const target = render([effect("stroke", { color: "#00ff00", width: 4, position: "inside" })]);
  assert.equal(pixelAt(target, 30, 18).a, 0, "inside stroke must not paint outside the layer");
  const edge = pixelAt(target, 30, 21); // just inside the top edge
  assert.ok(edge.g > 120, `expected stroke inside the edge, got rgb(${edge.r},${edge.g},${edge.b})`);
});

test("a drop shadow paints outside and below the content", () => {
  const target = render([effect("drop-shadow", { color: "#000000", blur: 4, offsetX: 6, offsetY: 6 })]);
  const shadow = pixelAt(target, 44, 44); // down-right of the square
  assert.ok(shadow.a > 40, `expected shadow outside the shape, got alpha ${shadow.a}`);
  // Content still wins where they overlap.
  const inside = pixelAt(target, centre.x, centre.y);
  assert.ok(inside.r > 200, "shadow must not darken the content itself");
});

test("an outer glow is symmetric because it ignores offsets", () => {
  const target = render([effect("outer-glow", { color: "#00ff00", blur: 6, offsetX: 20, offsetY: 20 })]);
  const above = pixelAt(target, 30, 17);
  const below = pixelAt(target, 30, 43);
  assert.ok(above.a > 20 && below.a > 20, "glow should surround the shape");
  assert.ok(
    Math.abs(above.a - below.a) < 40,
    `glow should be symmetric, got ${above.a} vs ${below.a}`,
  );
});

test("an inner shadow darkens inside the shape only", () => {
  const target = render([effect("inner-shadow", { color: "#000000", blur: 3, offsetX: 4, offsetY: 4 })]);
  assert.equal(pixelAt(target, farOutside.x, farOutside.y).a, 0, "inner shadow must stay inside");
  // The lit edge (bottom-right) keeps more of the layer colour than the
  // shadowed edge (top-left), where the shadow falls.
  const shadowed = pixelAt(target, 22, 22);
  const lit = pixelAt(target, 38, 38);
  assert.ok(
    shadowed.r < lit.r,
    `expected the offset edge darker: shadowed r=${shadowed.r} vs lit r=${lit.r}`,
  );
});

test("bevel emboss lights one edge and shades the opposite one", () => {
  const target = render([
    effect("bevel-emboss", { depth: 4, angle: 135, blur: 2, highlightColor: "#ffffff", shadowColor: "#000000" }),
  ]);
  assert.equal(pixelAt(target, farOutside.x, farOutside.y).a, 0, "bevel must stay inside the layer");
  // 135deg points up-left, so the top-left edge is lit and bottom-right shaded.
  const lit = pixelAt(target, 22, 22);
  const shaded = pixelAt(target, 38, 38);
  const brightness = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b;
  assert.ok(
    brightness(lit) > brightness(shaded),
    `expected the lit edge brighter: ${brightness(lit)} vs ${brightness(shaded)}`,
  );
});

test("bevelOffset follows the light angle", () => {
  const up = bevelOffset(effect("bevel-emboss", { angle: 90, depth: 10 }));
  assert.ok(Math.abs(up.dx) < 1e-6, "90deg has no horizontal component");
  assert.ok(up.dy < -9, `90deg should point up (negative y), got ${up.dy}`);

  const right = bevelOffset(effect("bevel-emboss", { angle: 0, depth: 10 }));
  assert.ok(right.dx > 9, `0deg should point right, got ${right.dx}`);
  assert.ok(Math.abs(right.dy) < 1e-6);
});

test("a disabled effect renders nothing", () => {
  const target = render([effect("color-overlay", { color: "#0000ff", enabled: false })]);
  const px = pixelAt(target, centre.x, centre.y);
  assert.ok(px.r > 200 && px.b < 40, "disabled effect still applied");
});

test("a zero-opacity effect renders nothing", () => {
  const target = render([effect("color-overlay", { color: "#0000ff", opacity: 0 })]);
  const px = pixelAt(target, centre.x, centre.y);
  assert.ok(px.r > 200 && px.b < 40, "zero-opacity effect still applied");
});

test("effects stack: a stroke and an overlay both apply", () => {
  const target = render([
    effect("color-overlay", { id: "a", color: "#0000ff" }),
    effect("stroke", { id: "b", color: "#00ff00", width: 4, position: "outside" }),
  ]);
  const inside = pixelAt(target, centre.x, centre.y);
  assert.ok(inside.b > 200, "overlay should still recolour the fill");
  const ring = pixelAt(target, 30, 18);
  assert.ok(ring.g > 150, "stroke should still paint outside");
});

test("the result does not depend on the order effects were added", () => {
  // Photoshop paints layer styles in a fixed order. Rendering in array order
  // made a stroke added before an overlay look different from the reverse.
  const overlay = effect("color-overlay", { id: "a", color: "#0000ff" });
  const stroke = effect("stroke", { id: "b", color: "#00ff00", width: 4, position: "outside" });
  const digest = (effects: LayerEffect[]) => {
    const target = render(effects);
    const { data } = target.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
  };
  assert.equal(digest([overlay, stroke]), digest([stroke, overlay]));
});

test("effects paint in Photoshop's order, not insertion order", () => {
  // Colour overlay paints first, so a bevel stays visible on top of it.
  const ordered = effectsInPaintOrder([
    effect("bevel-emboss", { id: "bevel" }),
    effect("drop-shadow", { id: "shadow" }),
    effect("color-overlay", { id: "overlay" }),
  ]);
  assert.deepEqual(ordered.map((e) => e.kind), ["drop-shadow", "color-overlay", "bevel-emboss"]);
});

test("duplicate effects of one kind keep the order they were added", () => {
  const ordered = effectsInPaintOrder([
    effect("stroke", { id: "first" }),
    effect("stroke", { id: "second" }),
  ]);
  assert.deepEqual(ordered.map((e) => e.id), ["first", "second"]);
});

test("the GPU renderer draws effects through the shared pipeline", () => {
  // WebGL2 cannot run headlessly, so the guarantee is structural instead: the
  // GPU path used to carry its own effect code that handled drop-shadow and
  // silently skipped the other five, so exporting with GPU on produced a
  // different image. Reintroducing a second implementation fails here.
  const source = readFileSync(new URL("../app/engine/gl-renderer.ts", import.meta.url), "utf8");
  // Match the symbol and its origin, not the exact import line — pinning the
  // whole line means adding any second import from the module breaks a test
  // that has nothing to say about it.
  assert.match(
    source,
    /import \{[^}]*composeLayerWithEffects[^}]*\} from "\.\/layer-effects"/,
    "gl-renderer must use the shared effect pipeline",
  );
  for (const marker of ["shadowBlur", "shadowOffsetX", 'kind !== "drop-shadow"']) {
    assert.ok(
      !source.includes(marker),
      `gl-renderer contains "${marker}" — it is drawing effects itself again`,
    );
  }
});

test("every effect kind renders without throwing", () => {
  const kinds: LayerEffectKind[] = [
    "drop-shadow", "inner-shadow", "outer-glow", "color-overlay", "stroke", "bevel-emboss",
  ];
  for (const kind of kinds) {
    assert.doesNotThrow(() => render([effect(kind, { blur: 3, width: 3, depth: 3 })]), kind);
  }
});
