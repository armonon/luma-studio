import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { applyBrushSymmetry, planStroke, replayStroke, type BrushDab } from "../app/engine/brush";
import { BRUSH_PRESETS, MIRROR_MODES, brushMirror, brushPreview, matchesBrushRecipe, recipeParams } from "../app/studio/brush-library";

test("24 unique brush recipes render distinct bounded real-engine previews", () => {
  assert.equal(BRUSH_PRESETS.length, 24);
  assert.equal(new Set(BRUSH_PRESETS.map(p => p.id)).size, 24);
  const images = new Set<string>();
  for (const preset of BRUSH_PRESETS) {
    const surface = brushPreview(preset.settings);
    assert.equal(surface.data.length, 160 * 44 * 4);
    assert.ok(surface.data.some((value, index) => index % 4 === 3 && value > 0), preset.id);
    images.add(createHash("sha256").update(surface.data).digest("hex"));
    assert.deepEqual(brushPreview(preset.settings).data, surface.data, "replay must be deterministic");
    assert.ok(matchesBrushRecipe(preset.settings, { ...preset.settings }));
    assert.equal(matchesBrushRecipe(preset.settings, { ...preset.settings, size: preset.settings.size + 1 }), false);
  }
  assert.equal(images.size, 24, "not just different labels on the same brush");
});

const dab: BrushDab = { x: 17, y: 29, size: 5, hardness: 1, roundness: 1, rotation: 0, opacity: 1, pressure: 1, index: 0, textureSeed: 0 };
test("mirror buttons map to the intended axes and four-way symmetry", () => {
  const settings = { segments: 6, x: 0.5, y: 0.5 };
  const reflected = (mode: "horizontal" | "vertical" | "both") => applyBrushSymmetry(dab, brushMirror({ ...settings, mode }, 100, 80)).map(d => [d.x, d.y]);
  assert.deepEqual(reflected("horizontal"), [[17, 29], [83, 29]]);
  assert.deepEqual(reflected("vertical"), [[17, 29], [17, 51]]);
  assert.deepEqual(reflected("both"), [[17, 29], [83, 29], [17, 51], [83, 51]]);
});

test("radial and kaleidoscope are bounded and support off-center origins", () => {
  for (const mode of ["radial", "kaleidoscope"] as const) {
    const symmetry = brushMirror({ mode, segments: 999, x: 0.25, y: 0.75 }, 200, 100)!;
    assert.equal(symmetry.centerX, 50); assert.equal(symmetry.centerY, 75);
    assert.equal(symmetry.radialSegments, 12);
    assert.equal(symmetry.mirrorAlternating, mode === "kaleidoscope");
    assert.ok(applyBrushSymmetry(dab, symmetry).length <= 12);
  }
  const normalized = brushMirror({ mode: "radial", segments: NaN, x: NaN, y: -1 }, 200, 100)!;
  assert.equal(normalized.centerX, 100); assert.equal(normalized.centerY, 0); assert.equal(normalized.radialSegments, 6);
  assert.equal(brushMirror({ mode: "none", segments: 6, x: 0.5, y: 0.5 }, 100, 100), undefined);
});

test("each symmetry mode is retained in replayable stroke params, without touching color or edit mode", () => {
  for (const { id: mode } of MIRROR_MODES) {
    const params = { ...recipeParams(BRUSH_PRESETS[0].settings), color: "#ed5577", symmetry: brushMirror({ mode, segments: 6, x: 0.5, y: 0.5 }, 96, 96) };
    const stroke = { layerId: "test", params, points: [{ x: 18, y: 20, p: 1 }, { x: 24, y: 28, p: 1 }] };
    const before = JSON.stringify(stroke);
    const surface = { width: 96, height: 96, data: new Uint8ClampedArray(96 * 96 * 4) };
    const second = { ...surface, data: new Uint8ClampedArray(surface.data.length) };
    replayStroke(surface, stroke); replayStroke(second, JSON.parse(before));
    assert.deepEqual(second.data, surface.data);
    assert.equal(JSON.stringify(stroke), before);
    assert.ok(planStroke(stroke.points, params).every(d => Number.isFinite(d.x) && Number.isFinite(d.y)));
  }
});
