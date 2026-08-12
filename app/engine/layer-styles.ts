/**
 * Named layer styles: the presets Photoshop keeps in its Styles panel, plus
 * the machinery for turning a live style into ordinary layers.
 *
 * Deliberately not `.asl`. Photoshop's style files are an undocumented binary
 * descriptor format and ag-psd does not read them, so importing one would mean
 * writing a parser against guesses. These are our own presets in our own
 * vocabulary; the gap is named rather than papered over.
 */

import {
  EFFECT_LABELS,
  effectsInPaintOrder,
  isEffectBelowContent,
  nextId,
  type BlendPass,
  type Layer,
  type LayerEffect,
} from "./document";

/** A style is the effects plus the blending options that shape them. */
export type LayerStylePreset = {
  name: string;
  effects: Array<Omit<LayerEffect, "id">>;
  fillOpacity?: number;
  blendStack?: Array<Omit<BlendPass, "id">>;
};

/**
 * Starting points, not a catalogue.
 *
 * Each one exists to show a different part of the engine: the two backdrop
 * effects, the luminance effects, and the parameters that only became
 * available with the deeper bevel and gradient work.
 */
export const BUILT_IN_LAYER_STYLES: ReadonlyArray<LayerStylePreset> = [
  {
    name: "Soft Card",
    effects: [
      { kind: "drop-shadow", enabled: true, opacity: 0.28, color: "rgba(20,24,38,0.9)", blur: 34, offsetX: 0, offsetY: 14, spread: 0.1 },
      { kind: "stroke", enabled: true, opacity: 0.5, color: "#ffffff", blur: 0, offsetX: 0, offsetY: 0, width: 1, position: "inside" },
    ],
  },
  {
    name: "Frosted Glass",
    effects: [
      { kind: "backdrop-blur", enabled: true, opacity: 1, color: "#ffffff", blur: 30, offsetX: 0, offsetY: 0, saturation: 1.9, tint: 0.14 },
      { kind: "stroke", enabled: true, opacity: 0.4, color: "#ffffff", blur: 0, offsetX: 0, offsetY: 0, width: 1, position: "inside" },
      { kind: "drop-shadow", enabled: true, opacity: 0.22, color: "rgba(10,12,20,0.9)", blur: 40, offsetX: 0, offsetY: 18 },
    ],
    fillOpacity: 0,
  },
  {
    name: "Pressed Metal",
    effects: [
      { kind: "bevel-emboss", enabled: true, opacity: 0.9, color: "rgba(0,0,0,0.9)", blur: 3, offsetX: 0, offsetY: 0, depth: 5, angle: 120, altitude: 26, bevelStyle: "inner", highlightColor: "#ffffff", shadowColor: "#101018", glossContour: [{ x: 0, y: 0 }, { x: 0.35, y: 1 }, { x: 0.7, y: 0.2 }, { x: 1, y: 0.8 }] },
      { kind: "gradient-overlay", enabled: true, opacity: 0.35, color: "#ffffff", blur: 0, offsetX: 0, offsetY: 0, gradientStyle: "linear", gradientAngle: 90, stops: [{ offset: 0, color: "#ffffff" }, { offset: 0.5, color: "#8d94a8" }, { offset: 1, color: "#ffffff" }], dither: 0.4 },
      { kind: "inner-shadow", enabled: true, opacity: 0.45, color: "rgba(0,0,0,0.9)", blur: 8, offsetX: 0, offsetY: 2 },
    ],
  },
  {
    name: "Neon Sign",
    effects: [
      { kind: "outer-glow", enabled: true, opacity: 0.9, color: "#38e8ff", blur: 30, offsetX: 0, offsetY: 0, technique: "softer" },
      { kind: "outer-glow", enabled: true, opacity: 1, color: "#38e8ff", blur: 8, offsetX: 0, offsetY: 0, technique: "precise" },
      { kind: "inner-glow", enabled: true, opacity: 0.8, color: "#ffffff", blur: 6, offsetX: 0, offsetY: 0, glowSource: "edge" },
      { kind: "bloom", enabled: true, opacity: 0.7, color: "#ffffff", blur: 26, offsetX: 0, offsetY: 0, threshold: 0.55 },
    ],
  },
  {
    name: "Sitting On Glass",
    effects: [
      { kind: "contact-shadow", enabled: true, opacity: 0.75, color: "#3a3a44", blur: 5, offsetX: 0, offsetY: 0, strength: 9 },
      { kind: "reflection", enabled: true, opacity: 0.28, color: "#ffffff", blur: 8, offsetX: 0, offsetY: 4 },
      { kind: "drop-shadow", enabled: true, opacity: 0.3, color: "rgba(0,0,0,0.9)", blur: 26, offsetX: 0, offsetY: 20 },
    ],
  },
  {
    name: "Letterpress",
    effects: [
      { kind: "bevel-emboss", enabled: true, opacity: 0.85, color: "rgba(0,0,0,0.9)", blur: 1, offsetX: 0, offsetY: 0, depth: 2, angle: 120, altitude: 40, direction: "down", bevelStyle: "inner", highlightColor: "#ffffff", shadowColor: "#000000" },
      { kind: "inner-shadow", enabled: true, opacity: 0.35, color: "rgba(0,0,0,0.9)", blur: 3, offsetX: 0, offsetY: 1 },
    ],
  },
];

/** Attach a preset's effects to a layer, minting fresh ids. */
export function instantiateStyle(preset: LayerStylePreset) {
  return {
    effects: preset.effects.map((effect) => ({ ...effect, id: nextId("effect") } as LayerEffect)),
    fillOpacity: preset.fillOpacity,
    blendStack: preset.blendStack?.map((pass) => ({ ...pass, id: nextId("pass") })),
  };
}

/** Capture a layer's live style as a reusable preset. */
export function captureStyle(layer: Layer, name: string): LayerStylePreset {
  return {
    name,
    effects: (layer.effects ?? []).map(({ id, ...rest }) => {
      void id;
      return { ...rest };
    }),
    fillOpacity: layer.fillOpacity,
    blendStack: layer.blendStack?.map(({ id, ...rest }) => {
      void id;
      return { ...rest };
    }),
  };
}

export type RasterizedEffectLayer = {
  /** Where this layer belongs relative to the one it came from. */
  placement: "below" | "above";
  name: string;
  effect: LayerEffect;
};

/**
 * Photoshop's "Create Layers": the plan for splitting a style into real layers.
 *
 * Returned as a plan rather than performed here so the caller owns rendering
 * and history. Order matters and follows the paint order, so stacking the
 * results reproduces what the style drew.
 *
 * Effects that read the layers beneath cannot be split out this way: once
 * separated they would sample a different backdrop — themselves included —
 * and no longer match. They are reported so the caller can say so.
 */
export function planCreateLayers(layer: Layer): {
  layers: RasterizedEffectLayer[];
  unsplittable: LayerEffect[];
} {
  const effects = effectsInPaintOrder((layer.effects ?? []).filter((effect) => effect.enabled));
  const layers: RasterizedEffectLayer[] = [];
  const unsplittable: LayerEffect[] = [];

  for (const effect of effects) {
    if (BACKDROP_DEPENDENT.includes(effect.kind)) {
      unsplittable.push(effect);
      continue;
    }
    layers.push({
      placement: isEffectBelowContent(effect.kind) ? "below" : "above",
      name: `${layer.name} · ${EFFECT_LABELS[effect.kind]}`,
      effect,
    });
  }
  return { layers, unsplittable };
}

const BACKDROP_DEPENDENT: ReadonlyArray<LayerEffect["kind"]> = [
  "backdrop-blur", "refraction", "reflection", "contact-shadow",
];
