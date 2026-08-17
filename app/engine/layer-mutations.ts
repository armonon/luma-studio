// Adjustment-layer mutation helpers. All eight update/liveUpdate methods on
// Studio (tone/curves/levels/hsl × commit/live) differ only in field name,
// layer-kind gate, and label — perfect for a single generic helper.

import { Curves, HslParams, Layer, LayerKind, LevelsParams, ToneParams, cloneCurves } from "./document";
import { cloneProAdjustment, type ProAdjustmentParams } from "./pro-adjustments";
import type { LayerSnapshot } from "./studio";

export type AdjustmentKind = "tone" | "curves" | "levels" | "hsl" | "proAdjustment";

// Discriminated shape: for a given kind, params[kind] is the correct type.
export type AdjustmentParams = {
  tone: ToneParams;
  curves: Curves;
  levels: LevelsParams;
  hsl: HslParams;
  proAdjustment: ProAdjustmentParams;
};

const KIND_TO_LAYER_KIND: Record<AdjustmentKind, LayerKind> = {
  tone: "adjustment-tone",
  curves: "adjustment-curves",
  levels: "adjustment-levels",
  hsl: "adjustment-hsl",
  proAdjustment: "adjustment-pro",
};

const LABELS: Record<AdjustmentKind, string> = {
  tone: "Tone adjusted",
  curves: "Curves adjusted",
  levels: "Levels adjusted",
  hsl: "HSL adjusted",
  proAdjustment: "Professional adjustment updated",
};

export function adjustmentLayerKind(kind: AdjustmentKind): LayerKind {
  return KIND_TO_LAYER_KIND[kind];
}

export function adjustmentLabel(kind: AdjustmentKind): string {
  return LABELS[kind];
}

/** Deep-clone an adjustment param object of the given kind. */
export function cloneAdjustmentParams<K extends AdjustmentKind>(
  kind: K,
  params: AdjustmentParams[K],
): AdjustmentParams[K] {
  if (kind === "curves") return cloneCurves(params as Curves) as AdjustmentParams[K];
  if (kind === "proAdjustment") return cloneProAdjustment(params as ProAdjustmentParams) as AdjustmentParams[K];
  return { ...(params as object) } as AdjustmentParams[K];
}

/** Snapshot the layer's current value for `kind`, or an empty snapshot if it
 *  hasn't been set yet. */
export function snapshotForAdjustment<K extends AdjustmentKind>(
  layer: Layer,
  kind: K,
): LayerSnapshot {
  const snap: LayerSnapshot = { layerId: layer.id };
  const current = layer[kind] as AdjustmentParams[K] | undefined;
  if (current) (snap as Record<string, unknown>)[kind] = cloneAdjustmentParams(kind, current);
  return snap;
}

/** Overwrite the layer's `kind` field with a fresh clone of `params`. */
export function applyAdjustment<K extends AdjustmentKind>(
  layer: Layer,
  kind: K,
  params: AdjustmentParams[K],
): void {
  (layer as Record<string, unknown>)[kind] = cloneAdjustmentParams(kind, params);
}

/** Whether `layer` is the correct kind for this adjustment. */
export function isAdjustmentLayer(layer: Layer | undefined, kind: AdjustmentKind): layer is Layer {
  return !!layer && layer.kind === KIND_TO_LAYER_KIND[kind];
}
