import { Document, Layer, resolvedBlendIf } from "./document";
import { isNeutralBlendIf } from "./blend";
import { layerNeedsBackdrop } from "./gl-renderer";

/**
 * What the Rust compositor can and cannot flatten, and why.
 *
 * `flattenNative` used to refuse groups, clipping, smart filters, *any*
 * enabled effect, non-neutral Blend If, and any non-identity transform. That is
 * nearly every real document — the native path fired only on flat stacks of
 * untransformed raster layers, which made the pro edition's headline compositor
 * close to inert.
 *
 * Most of those refusals were never Rust's limitation. luma-core composites
 * pixels; transforms, filters, effects and clipping all happen *before* a layer
 * reaches a compositor, and the browser engine already does them. The fix is to
 * hand over the layer's finished pixels rather than its raw surface, exactly as
 * the GPU path does. What remains refused is what genuinely cannot be expressed
 * as "a stack of layers, each with a blend mode, an opacity and a mask".
 */

export type NativeRefusal =
  /** Portable viewport composition keeps source-backed layers tile-bounded. */
  | "source-backed"
  /** Adjustment layers transform the composite beneath them, they do not add to it. */
  | "adjustment-layer"
  /** A group is a nested composite, not an entry in a flat stack. */
  | "group"
  /** Knockout punches through the stack, which needs a second accumulator. */
  | "knockout"
  /** Blend If gates per pixel against the backdrop; luma-core has no such input. */
  | "blend-if"
  /** Per-channel write masking has no equivalent in the native layer options. */
  | "channel-mask"
  /** A backdrop-reading effect needs the running composite, which is on the GPU or in Rust, not here. */
  | "backdrop-effect"
  /** Clipped-as-group composites the base and its clipped members as one unit first. */
  | "clipped-group"
  /** Non-sRGB documents would need the working-space transform on the native side. */
  | "color-space"
  /** Nothing to composite. */
  | null;

/**
 * Why this document cannot go through the native compositor, or null if it can.
 *
 * Pure and exported so the decision is testable without a Rust binary present,
 * which is the only way it gets tested at all: `flattenNative` returns null both
 * when it refuses and when the native core is missing, so a test that only
 * checked for null could not tell a refusal from an absent binary.
 */
export function nativeFlattenRefusal(doc: Document): NativeRefusal {
  if (doc.colorSpace !== "srgb") return "color-space";

  const visible = doc.layers.filter((layer) => layer.visible && layer.opacity > 0);
  for (const layer of visible) {
    if (layer.surface?.store.sourceState()) return "source-backed";
    if (layer.kind === "group") return "group";
    if (layer.kind.startsWith("adjustment-")) return "adjustment-layer";
    if (layer.parentId) return "group";
    if ((layer.knockout ?? "none") !== "none") return "knockout";
    if (!isNeutralBlendIf(resolvedBlendIf(layer))) return "blend-if";
    const channels = layer.blendChannels;
    if (channels && !(channels.r && channels.g && channels.b)) return "channel-mask";
    if (layerNeedsBackdrop(layer)) return "backdrop-effect";
    // A clipping layer is fine on its own — its base is baked in when the layer
    // rasterizes. What is not fine is the base electing to blend the whole
    // clipped stack as one unit, which is a nested composite by another name.
    if (layer.clipping && clippedAsGroupBase(doc, layer)) return "clipped-group";
  }
  return null;
}

/** Whether the layer this one clips to composites its clipped stack as a unit. */
function clippedAsGroupBase(doc: Document, clipped: Layer): boolean {
  const index = doc.layers.indexOf(clipped);
  for (let below = index + 1; below < doc.layers.length; below += 1) {
    const candidate = doc.layers[below];
    if (candidate.clipping) continue;
    return candidate.blendClippedAsGroup ?? true;
  }
  return false;
}

/**
 * Whether a layer's surface pixels are already what the compositor should see.
 *
 * When nothing stands between the stored pixels and the composite, the native
 * path can take the precision surface straight across — full float, no canvas
 * round trip. Anything else has to be rendered through the shared pipeline
 * first, which costs the trip through 8-bit canvas but is the only way effects,
 * transforms and filters are honoured at all.
 *
 * This mirrors `canUploadPrecisionDirect` in the GL renderer, and for the same
 * reason: both paths want raw pixels when raw pixels are correct.
 */
export function nativeCanUseSurfaceDirectly(layer: Layer, doc: Document): boolean {
  const transform = layer.transform;
  return !!layer.surface
    && layer.surface.grid.width === doc.width
    && layer.surface.grid.height === doc.height
    && transform.tx === 0 && transform.ty === 0
    && transform.sx === 1 && transform.sy === 1 && transform.rotation === 0
    && !(transform.skewX ?? 0)
    && !layer.filters?.some((filter) => filter.enabled)
    && !layer.effects?.some((effect) => effect.enabled)
    && !layer.clipping
    && !layer.vectorMask
    && (layer.transparencyShapesLayer ?? true);
}

/**
 * One tile of a rasterized layer, as the working-space floats the wire wants.
 *
 * `tileToWorkingFloat32` is the equivalent for a precision surface. This is the
 * lossier sibling — the pixels have already been through an 8-bit canvas — but
 * it is what makes transforms, filters and effects reachable at all, and it is
 * the same trade the GPU path makes.
 */
export function tileFromContext(
  context: CanvasRenderingContext2D,
  address: { x: number; y: number; width: number; height: number },
): Float32Array {
  const bytes = context.getImageData(address.x, address.y, address.width, address.height).data;
  const values = new Float32Array(address.width * address.height * 4);
  for (let index = 0; index < values.length; index += 1) values[index] = bytes[index] / 255;
  return values;
}
