import { replayStroke, type BrushParams, type BrushSymmetry } from "../engine/brush";

export type BrushRecipe = {
  size: number; hardness: number; opacity: number; flow: number; spacing: number;
  roundness: number; angle: number; smoothing: number; scatter: number;
  tilt: number; texture: number; pressureSize: boolean; pressureOpacity: boolean;
  buildUp: boolean; blendMode: NonNullable<BrushParams["blendMode"]>;
};
export type BrushPreset = { id: string; name: string; category: string; description: string; settings: BrushRecipe };
const base: BrushRecipe = { size: 24, hardness: 0.85, opacity: 1, flow: 0.8, spacing: 0.12,
  roundness: 1, angle: 0, smoothing: 0.25, scatter: 0, tilt: 0, texture: 0,
  pressureSize: true, pressureOpacity: false, buildUp: false, blendMode: "normal" };
const preset = (id: string, name: string, category: string, description: string, settings: Partial<BrushRecipe>): BrushPreset =>
  ({ id, name, category, description, settings: { ...base, ...settings } });

/** Recipes for the actual dab engine, not external brush packs or fluid simulations. */
export const BRUSH_PRESETS: readonly BrushPreset[] = [
  preset("fine-liner", "Fine liner", "Ink", "Precise, steady ink", { size: 5, hardness: 1, flow: 1, smoothing: 0.55 }),
  preset("monoline", "Monoline", "Ink", "Even-width lettering", { size: 12, hardness: 1, flow: 1, pressureSize: false, smoothing: 0.6 }),
  preset("brush-pen", "Brush pen", "Ink", "Pressure-shaped inking", { size: 32, hardness: 0.95, flow: 1, smoothing: 0.4 }),
  preset("broad-nib", "Broad nib", "Ink", "Angled calligraphy", { size: 38, hardness: 1, roundness: 0.2, angle: -35, flow: 1 }),
  preset("graphite", "Graphite", "Dry", "Fine textured sketching", { size: 9, texture: 0.65, flow: 0.35, opacity: 0.8, pressureOpacity: true, buildUp: true }),
  preset("charcoal", "Charcoal", "Dry", "Soft, grainy marks", { size: 40, hardness: 0.3, texture: 0.85, flow: 0.5, roundness: 0.7, tilt: 0.8, buildUp: true }),
  preset("chalk", "Chalk", "Dry", "Broken-edge texture", { size: 30, texture: 0.95, spacing: 0.17, flow: 0.75, scatter: 0.12 }),
  preset("dry-flat", "Dry flat", "Dry", "Wide textured strokes", { size: 56, roundness: 0.25, angle: 20, texture: 0.8, flow: 0.65, spacing: 0.1 }),
  preset("solid-round", "Solid round", "Paint", "Clean opaque painting", { size: 48, hardness: 1, flow: 1 }),
  preset("soft-round", "Soft round", "Paint", "Soft-edged color", { size: 64, hardness: 0.2, flow: 0.45, buildUp: true }),
  preset("flat-color", "Flat color", "Paint", "Broad directional marks", { size: 64, roundness: 0.3, hardness: 0.9, angle: 30, flow: 0.9 }),
  preset("glaze", "Glaze", "Paint", "Low-opacity layered color", { size: 80, hardness: 0.3, opacity: 0.25, flow: 0.6, blendMode: "multiply" }),
  preset("airbrush", "Airbrush", "Air", "Gentle build-up", { size: 100, hardness: 0, flow: 0.08, buildUp: true, pressureOpacity: true }),
  preset("mist", "Mist", "Air", "Scattered soft dabs", { size: 80, hardness: 0, opacity: 0.45, flow: 0.2, scatter: 0.6, spacing: 0.3, buildUp: true }),
  preset("light", "Light glaze", "Air", "Screen-blended highlights", { size: 100, hardness: 0.1, opacity: 0.5, flow: 0.25, blendMode: "screen", buildUp: true }),
  preset("velvet", "Velvet", "Air", "Soft elliptical shading", { size: 90, hardness: 0, roundness: 0.45, angle: -25, flow: 0.18, buildUp: true }),
  preset("speckle", "Speckle", "Texture", "Scattered crisp dots", { size: 8, hardness: 1, scatter: 1.8, spacing: 0.8, flow: 1, pressureSize: false }),
  preset("grain", "Grain cloud", "Texture", "Diffuse grain texture", { size: 72, hardness: 0.1, texture: 0.95, scatter: 0.5, flow: 0.3, buildUp: true }),
  preset("confetti", "Confetti", "Texture", "Scattered angled marks", { size: 16, roundness: 0.35, angle: 45, scatter: 2, spacing: 0.9, hardness: 1, flow: 1 }),
  preset("scumble", "Scumble", "Texture", "Rough overlapping color", { size: 42, texture: 0.85, scatter: 0.3, spacing: 0.35, flow: 0.5, buildUp: true }),
  preset("pearls", "Pearls", "Pattern", "Evenly spaced round dots", { size: 20, hardness: 1, spacing: 0.95, flow: 1, pressureSize: false }),
  preset("stitch", "Stitch", "Pattern", "Fine repeating dashes", { size: 22, hardness: 1, roundness: 0.16, angle: 45, spacing: 0.85, flow: 1, pressureSize: false }),
  preset("ribbon", "Ribbon", "Pattern", "Thin angled ribbons", { size: 55, hardness: 1, roundness: 0.12, angle: -40, flow: 1, smoothing: 0.65 }),
  preset("petals", "Petal trail", "Pattern", "Spaced elliptical marks", { size: 34, hardness: 0.65, roundness: 0.35, angle: 70, spacing: 0.9, flow: 0.9 }),
];
export function matchesBrushRecipe(a: BrushRecipe, b: BrushRecipe) {
  return (Object.keys(base) as (keyof BrushRecipe)[]).every(key => a[key] === b[key]);
}
export type MirrorMode = "none" | "horizontal" | "vertical" | "both" | "radial" | "kaleidoscope";
export const MIRROR_MODES: readonly { id: MirrorMode; label: string }[] = [
  { id: "none", label: "Off" }, { id: "horizontal", label: "Left / right" },
  { id: "vertical", label: "Top / bottom" }, { id: "both", label: "Four-way" },
  { id: "radial", label: "Radial" }, { id: "kaleidoscope", label: "Kaleidoscope" },
];
export type MirrorSettings = { mode: MirrorMode; segments: number; x: number; y: number };
const bounded = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
export function brushMirror(settings: MirrorSettings, width: number, height: number): BrushSymmetry | undefined {
  if (settings.mode === "none" || !MIRROR_MODES.some(m => m.id === settings.mode)) return undefined;
  const radial = settings.mode === "radial" || settings.mode === "kaleidoscope";
  return {
    centerX: width * bounded(settings.x, 0, 1, 0.5), centerY: height * bounded(settings.y, 0, 1, 0.5),
    horizontal: settings.mode === "horizontal" || settings.mode === "both",
    vertical: settings.mode === "vertical" || settings.mode === "both",
    radialSegments: radial ? Math.round(bounded(settings.segments, 2, 12, 6)) : 1,
    mirrorAlternating: settings.mode === "kaleidoscope",
  };
}
export function recipeParams(settings: BrushRecipe): BrushParams {
  const { tilt, texture, ...rest } = settings;
  return { ...rest, tiltInfluence: tilt, texture: texture > 0 ? { strength: texture, scale: 0.35, seed: 917 } : undefined,
    color: "#aacfff", mode: "paint", seed: 1731, pressureCurve: 1.15, minimumPressureSize: 0.08 };
}
/** Fixed-size engine-rendered swatch; no document buffers, images or remote assets. */
export function brushPreview(settings: BrushRecipe) {
  const surface = { width: 160, height: 44, data: new Uint8ClampedArray(160 * 44 * 4) };
  replayStroke(surface, { layerId: "preview", params: { ...recipeParams(settings), size: Math.min(22, settings.size) },
    points: Array.from({ length: 36 }, (_, i) => ({ x: 12 + i * 3.85, y: 22 + Math.sin(i / 35 * Math.PI * 2) * 7, p: 0.3 + Math.sin(i / 35 * Math.PI) * 0.7 })) });
  return surface;
}
