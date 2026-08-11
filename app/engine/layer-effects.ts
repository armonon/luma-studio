/**
 * Layer style effects: the six kinds, drawn with the 2D canvas.
 *
 * This lives apart from `renderer.ts` so the GPU path can share it without an
 * import cycle. Keeping one implementation is the point: the GPU renderer used
 * to carry its own copy that handled drop shadows and silently skipped the
 * other five, so turning on GPU export changed the exported image.
 */

import { compositeBlendStack } from "./blend";
import {
  DEFAULT_GLOBAL_LIGHT,
  NEUTRAL_BLEND_IF,
  bevelLightStrength,
  bevelOffset,
  curveToLut,
  effectUses,
  effectsInPaintOrder,
  isEffectBelowContent,
  layerCorners,
  newCanvas,
  resolvedEffectBlendMode,
  resolvedEffectOffset,
  resolvedFillOpacity,
  resolvedGradientStops,
  type GlobalLight,
  type Layer,
  type LayerEffect,
} from "./document";

/**
 * The region being drawn: the document-space rect and the pixels it maps to.
 *
 * Structurally the renderer's RenderFrame. Gradients and patterns need the
 * document-space origin, so a bare output size is not enough.
 */
export type EffectFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
};

/** A layer's extent in document pixels. */
type PixelBounds = { x: number; y: number; right: number; bottom: number };

/** The layer's transformed extent, which is what a gradient overlay spans. */
function layerBounds(layer: Layer, frame: EffectFrame): PixelBounds {
  const corners = layerCorners(layer, frame.width || 1, frame.height || 1);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** Reset a scratch canvas regardless of the transform or compositing left on it. */
function clearContext(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.clearRect(0, 0, width, height);
  ctx.restore();
}

/**
 * How far outside its own silhouette an effect can paint, in document pixels.
 *
 * Deliberately independent of the light angle — global light can rotate a
 * shadow at any time, and an overscan that shrank with the angle would clip
 * effects at tile boundaries until the next full redraw.
 */
export function layerEffectReach(effect: LayerEffect) {
  switch (effect.kind) {
    case "drop-shadow":
      return effect.blur * 2 + Math.hypot(effect.offsetX, effect.offsetY);
    case "outer-glow":
      return effect.blur * 2;
    case "stroke":
      // An inside stroke stays within the shape, but the outward band does not.
      return (effect.position ?? "outside") === "inside" ? 0 : (effect.width ?? 3) + effect.blur;
    case "bevel-emboss":
      return (effect.depth ?? 3) + effect.blur * 2;
    // Clipped to the layer, so they never reach outside it.
    case "color-overlay":
    case "gradient-overlay":
    case "pattern-overlay":
    case "inner-shadow":
    case "inner-glow":
    case "satin":
      return 0;
  }
}

/**
 * Map a document-space point into the tile's output pixels.
 *
 * Gradients and patterns have to be positioned in document space or they
 * restart at every tile boundary and slide around as the view is panned.
 */
function project(frame: EffectFrame, x: number, y: number) {
  return {
    x: (x - frame.x) * (frame.outputWidth / frame.width),
    y: (y - frame.y) * (frame.outputHeight / frame.height),
  };
}

/**
 * A gradient spanning the layer's bounds along `gradientAngle`.
 *
 * Photoshop scales the gradient to the layer, not the canvas, which is what
 * makes a small layer's overlay look the same wherever it sits.
 */
function gradientFill(
  ctx: CanvasRenderingContext2D,
  effect: LayerEffect,
  frame: EffectFrame,
  bounds: PixelBounds,
) {
  const radians = ((effect.gradientAngle ?? 90) * Math.PI) / 180;
  const centreX = (bounds.x + bounds.right) / 2;
  const centreY = (bounds.y + bounds.bottom) / 2;
  const half = Math.hypot(bounds.right - bounds.x, bounds.bottom - bounds.y) / 2;
  const from = project(frame, centreX - Math.cos(radians) * half, centreY + Math.sin(radians) * half);
  const to = project(frame, centreX + Math.cos(radians) * half, centreY - Math.sin(radians) * half);
  const centre = project(frame, centreX, centreY);
  const radius = Math.hypot(to.x - centre.x, to.y - centre.y);

  const gradient = (effect.gradientStyle ?? "linear") === "radial"
    ? ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, Math.max(1e-3, radius))
    : ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  for (const stop of resolvedGradientStops(effect)) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

/**
 * Fill with a repeating procedural pattern, anchored to the document origin.
 *
 * Photoshop patterns are library assets; we have no asset library, so these
 * are the three procedural fills the paint tools already offer rather than a
 * pretend-compatible pattern slot.
 */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  effect: LayerEffect,
  frame: EffectFrame,
  uniformScale: number,
) {
  const cell = Math.max(2, Math.round((effect.patternScale ?? 16) * uniformScale));
  const kind = effect.pattern ?? "checker";
  const tile = newCanvas(cell * 2, cell * 2);
  const tctx = tile.getContext("2d")!;
  if (effect.patternBackground) {
    tctx.fillStyle = effect.patternBackground;
    tctx.fillRect(0, 0, cell * 2, cell * 2);
  }
  tctx.fillStyle = effect.color;
  if (kind === "checker") {
    tctx.fillRect(0, 0, cell, cell);
    tctx.fillRect(cell, cell, cell, cell);
  } else if (kind === "stripes") {
    tctx.fillRect(0, 0, cell, cell * 2);
  } else {
    tctx.beginPath();
    tctx.arc(cell / 2, cell / 2, cell * 0.28, 0, Math.PI * 2);
    tctx.arc(cell * 1.5, cell * 1.5, cell * 0.28, 0, Math.PI * 2);
    tctx.fill();
  }

  const fill = ctx.createPattern(tile, "repeat");
  if (!fill) return;
  // Anchor the tiling to the document origin so panning does not shift it.
  const origin = project(frame, 0, 0);
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.fillStyle = fill;
  ctx.fillRect(-origin.x, -origin.y, frame.outputWidth, frame.outputHeight);
  ctx.restore();
}

/**
 * Deterministic value noise.
 *
 * Math.random would resample every frame and make the effect crawl while the
 * user pans, and would differ between the preview and the export. Hashing the
 * document-space position with the effect id keeps it nailed to the artwork.
 */
function hashNoise(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function seedFrom(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/**
 * Shape an effect's falloff after it has been drawn: contour, then noise.
 *
 * Both act on alpha alone, so they are one pass over the buffer and only run
 * when the effect actually asks for them.
 */
function shapeFalloff(
  ctx: CanvasRenderingContext2D,
  effect: LayerEffect,
  frame: EffectFrame,
) {
  // EFFECT_FIELDS is the source of truth, not just a description of it: a
  // bevel has no Noise control in Photoshop, so it must not respond to one.
  const noise = effectUses(effect.kind, "noise") ? Math.max(0, Math.min(1, effect.noise ?? 0)) : 0;
  const hasContour = effectUses(effect.kind, "contour") && !!effect.contour?.length;
  if (!hasContour && noise <= 0) return;

  const { width, height } = { width: frame.outputWidth, height: frame.outputHeight };
  if (width <= 0 || height <= 0) return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const lut = hasContour ? curveToLut(effect.contour!) : null;
  const seed = seedFrom(effect.id);
  // Sample the noise in document space so it does not crawl when panning.
  const stepX = frame.width / Math.max(1, width);
  const stepY = frame.height / Math.max(1, height);

  for (let y = 0; y < height; y += 1) {
    const docY = Math.round(frame.y + y * stepY);
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4 + 3;
      let alpha = data[index];
      if (alpha === 0) continue;
      if (lut) alpha = lut[alpha];
      if (noise > 0) {
        const docX = Math.round(frame.x + x * stepX);
        alpha *= 1 - noise * hashNoise(docX, docY, seed);
      }
      data[index] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Draw ONLY the shadow of `src`, never `src` itself.
 *
 * `drawImage` with a shadow set paints the image *and* its shadow. Every
 * inside-the-shape effect needs the silhouette alone, so the source is drawn
 * far off-canvas and the shadow offset compensates, leaving just the shadow in
 * frame. The caller's compositing operation is preserved.
 */
function stampSilhouette(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  color: string,
  blur: number,
  offsetX: number,
  offsetY: number,
) {
  const hide = src.width + Math.abs(offsetX) + blur + 100;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = offsetX + hide;
  ctx.shadowOffsetY = offsetY;
  ctx.drawImage(src, -hide, 0);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Split `blur` into a hard expansion and a soft remainder.
 *
 * Photoshop's Spread (outward) and Choke (inward) do not add size — they trade
 * softness for hardness at a fixed size, which is how you get a crisp shadow
 * without also making it bigger. At spread 1 the edge is hard; at 0 it is all
 * falloff. Returns the silhouette source to stamp and the blur left to apply.
 */
function applySpread(
  effect: LayerEffect,
  contentBuf: HTMLCanvasElement,
  scratchBuf: HTMLCanvasElement,
  blur: number,
  size: { width: number; height: number },
) {
  const spread = effectUses(effect.kind, "spread") ? Math.max(0, Math.min(1, effect.spread ?? 0)) : 0;
  if (spread <= 0 || blur <= 0) return { source: contentBuf, blur };
  const sctx = scratchBuf.getContext("2d")!;
  clearContext(sctx, size.width, size.height);
  stampDilated(sctx, contentBuf, "#000000", blur * spread);
  return { source: scratchBuf, blur: blur * (1 - spread) };
}

/** Grow the silhouette of `src` by `reach`, painted in `color`. */
function stampDilated(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  color: string,
  reach: number,
) {
  if (reach <= 0) {
    stampSilhouette(ctx, src, color, 0, 0, 0);
    return;
  }
  const steps = 16;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    stampSilhouette(ctx, src, color, 0, Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
}

/**
 * Paint one layer style effect into `effectBuf`, using `contentBuf` as the
 * layer's own pixels and `scratchBuf` for intermediate silhouettes.
 *
 * Compositing vocabulary used throughout:
 *   destination-in  — keep only where the incoming alpha also covers
 *   destination-out — punch the incoming alpha away
 * Offsets scale with the viewport so effects hold position while zooming.
 */
function drawLayerEffect(
  effectBuf: HTMLCanvasElement,
  contentBuf: HTMLCanvasElement,
  scratchBuf: HTMLCanvasElement,
  effect: LayerEffect,
  frame: EffectFrame,
  scale: { x: number; y: number },
  uniformScale: number,
  light: GlobalLight,
  bounds: PixelBounds,
) {
  const size = { width: frame.outputWidth, height: frame.outputHeight };
  const ctx = effectBuf.getContext("2d")!;
  clearContext(ctx, size.width, size.height);
  ctx.save();
  ctx.globalAlpha = effect.opacity;
  const blur = effect.blur * uniformScale;
  const offset = resolvedEffectOffset(effect, light);

  switch (effect.kind) {
    case "drop-shadow":
    case "outer-glow": {
      // A glow is a shadow with no offset, so they share one path.
      const offsetX = effect.kind === "outer-glow" ? 0 : offset.x * scale.x;
      const offsetY = effect.kind === "outer-glow" ? 0 : offset.y * scale.y;
      const spread = applySpread(effect, contentBuf, scratchBuf, blur, size);
      stampSilhouette(ctx, spread.source, effect.color, spread.blur, offsetX, offsetY);
      // Keep only the halo; the layer draws its own pixels separately.
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "color-overlay": {
      ctx.fillStyle = effect.color;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "inner-shadow": {
      // Colour everywhere the offset silhouette does NOT reach, then clip to
      // the layer: what remains is a rim hugging the inside of the edge.
      ctx.fillStyle = effect.color;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      const choke = applySpread(effect, contentBuf, scratchBuf, blur, size);
      stampSilhouette(ctx, choke.source, "#000000", choke.blur, offset.x * scale.x, offset.y * scale.y);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "stroke": {
      // One formula covers all three positions:
      //   band = dilate(outward) minus erode(inward)
      const width = Math.max(0.5, (effect.width ?? 3) * uniformScale);
      const position = effect.position ?? "outside";
      const outward = position === "inside" ? 0 : position === "center" ? width / 2 : width;
      const inward = position === "outside" ? 0 : position === "center" ? width / 2 : width;

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      stampDilated(ctx, contentBuf, effect.color, outward);

      if (inward > 0) {
        // Erode into the scratch buffer by intersecting shifted copies.
        const sctx = scratchBuf.getContext("2d")!;
        clearContext(sctx, size.width, size.height);
        sctx.drawImage(contentBuf, 0, 0);
        sctx.globalCompositeOperation = "destination-in";
        const steps = 16;
        for (let i = 0; i < steps; i += 1) {
          const angle = (i / steps) * Math.PI * 2;
          sctx.drawImage(contentBuf, Math.cos(angle) * inward, Math.sin(angle) * inward);
        }
        sctx.globalCompositeOperation = "source-over";
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(scratchBuf, 0, 0);
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(contentBuf, 0, 0);
      }
      ctx.globalAlpha = effect.opacity;
      break;
    }

    case "inner-glow": {
      const glow = applySpread(effect, contentBuf, scratchBuf, blur, size);
      if ((effect.glowSource ?? "edge") === "center") {
        // A centre glow is the blurred silhouette kept inside itself: solid
        // through the middle, falling away as it approaches the edge.
        stampSilhouette(ctx, glow.source, effect.color, glow.blur, 0, 0);
      } else {
        // An edge glow is the complement: colour everywhere the blurred
        // silhouette does not reach, leaving a rim inside the outline.
        ctx.fillStyle = effect.color;
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 1;
        stampSilhouette(ctx, glow.source, "#000000", glow.blur, 0, 0);
      }
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "satin": {
      // Photoshop's satin: lay the silhouette against itself displaced both
      // ways and keep where exactly one copy covers. The interference between
      // the two is what produces the folded sheen.
      const dx = offset.x * scale.x;
      const dy = offset.y * scale.y;
      stampSilhouette(ctx, contentBuf, effect.color, blur, dx, dy);
      ctx.globalCompositeOperation = "xor";
      stampSilhouette(ctx, contentBuf, effect.color, blur, -dx, -dy);
      if (effect.invert) {
        // Swap sheen and gap: fill solid, then punch the sheen out of it.
        const sctx = scratchBuf.getContext("2d")!;
        clearContext(sctx, size.width, size.height);
        sctx.drawImage(effectBuf, 0, 0);
        clearContext(ctx, size.width, size.height);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = effect.opacity;
        ctx.fillStyle = effect.color;
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 1;
        ctx.drawImage(scratchBuf, 0, 0);
      }
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "gradient-overlay": {
      ctx.fillStyle = gradientFill(ctx, effect, frame, bounds);
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "pattern-overlay": {
      drawPattern(ctx, effect, frame, uniformScale);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "bevel-emboss": {
      // Light one edge and shade the opposite one, both confined to the layer.
      const { dx, dy } = bevelOffset(effect, light);
      // A light overhead rakes across nothing, so the relief flattens out.
      ctx.globalAlpha = effect.opacity * bevelLightStrength(effect, light);
      stampSilhouette(ctx, contentBuf, effect.highlightColor ?? "#ffffff", blur, dx * scale.x, dy * scale.y);
      stampSilhouette(ctx, contentBuf, effect.shadowColor ?? "#000000", blur, -dx * scale.x, -dy * scale.y);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }
  }

  ctx.restore();
  shapeFalloff(ctx, effect, frame);
}

/**
 * Composite one finished effect buffer with the effect's own blend mode.
 *
 * A blend mode needs something to blend *with*. Effects accumulate into the
 * layer's own buffer, and a drop shadow, an outer glow or an outside stroke
 * all land where that buffer is still empty — so blending them there is a
 * no-op and the control would silently do nothing on three of the ten effects.
 *
 * What is actually beneath an effect is the backdrop plus whatever the layer
 * has drawn so far. We assemble exactly that, blend the effect onto it, then
 * keep only where the effect has coverage and hand that back as an ordinary
 * source-over stamp — so the layer's mask, clipping and opacity still apply to
 * the result, which they would not if effects wrote to the backdrop directly.
 *
 * Routed through the layer blend stack so all 27 modes work, including the
 * eleven with no native canvas operator.
 */
function stampEffect(
  out: CanvasRenderingContext2D,
  effectBuf: HTMLCanvasElement,
  blendBuf: HTMLCanvasElement,
  backdrop: HTMLCanvasElement | null,
  effect: LayerEffect,
  size: { width: number; height: number },
) {
  const mode = resolvedEffectBlendMode(effect);
  if (mode === "source-over") {
    out.drawImage(effectBuf, 0, 0);
    return;
  }

  const bctx = blendBuf.getContext("2d")!;
  clearContext(bctx, size.width, size.height);
  if (backdrop) bctx.drawImage(backdrop, 0, 0);
  bctx.drawImage(out.canvas, 0, 0);

  compositeBlendStack(
    bctx,
    effectBuf,
    [{ id: effect.id, mode, opacity: 1, enabled: true }],
    1,
    NEUTRAL_BLEND_IF,
  );
  // Keep only where the effect covers; the rest is backdrop we must not claim.
  bctx.globalCompositeOperation = "destination-in";
  bctx.drawImage(effectBuf, 0, 0);
  bctx.globalCompositeOperation = "source-over";

  out.drawImage(blendBuf, 0, 0);
}

/**
 * Draw a layer's own pixels plus its layer style into `out`.
 *
 * `content` must already hold the layer's rasterized, filtered pixels.
 * `effectBuf` and `scratchBuf` are scratch canvases of the same size; both are
 * cleared before use. `scale` is the viewport scale, so effects hold their
 * apparent size while zooming — pass 1 to rasterize at document resolution.
 */
export function composeLayerWithEffects(
  out: CanvasRenderingContext2D,
  content: HTMLCanvasElement,
  effectBuf: HTMLCanvasElement,
  scratchBuf: HTMLCanvasElement,
  layer: Layer,
  frame: EffectFrame,
  scale: { x: number; y: number },
  light: GlobalLight = DEFAULT_GLOBAL_LIGHT,
  /** Everything already composited beneath this layer, for blended effects. */
  backdrop: HTMLCanvasElement | null = null,
  /** Working buffer for blended effects; required once a mode is not normal. */
  blendBuf: HTMLCanvasElement | null = null,
) {
  const effects = effectsInPaintOrder(
    (layer.effects ?? []).filter((effect) => effect.enabled && effect.opacity > 0),
  );
  if (!effects.length) {
    out.globalAlpha = resolvedFillOpacity(layer);
    out.drawImage(content, 0, 0);
    out.globalAlpha = 1;
    return;
  }
  const uniformScale = Math.sqrt(scale.x * scale.y);
  const bounds = layerBounds(layer, frame);
  const size = { width: frame.outputWidth, height: frame.outputHeight };
  const blend = blendBuf ?? newCanvas(size.width, size.height);

  // Shadows and glows sit under the layer's own pixels.
  for (const effect of effects) {
    if (!isEffectBelowContent(effect.kind)) continue;
    drawLayerEffect(effectBuf, content, scratchBuf, effect, frame, scale, uniformScale, light, bounds);
    stampEffect(out, effectBuf, blend, backdrop, effect, size);
  }

  out.globalAlpha = resolvedFillOpacity(layer);
  out.drawImage(content, 0, 0);
  out.globalAlpha = 1;

  // Overlays, strokes and bevels sit on top. Stroke is the exception: an
  // outside stroke must not be clipped away by the content it surrounds, so
  // drawLayerEffect leaves it unclipped and it still composites above.
  for (const effect of effects) {
    if (isEffectBelowContent(effect.kind)) continue;
    drawLayerEffect(effectBuf, content, scratchBuf, effect, frame, scale, uniformScale, light, bounds);
    stampEffect(out, effectBuf, blend, backdrop, effect, size);
  }
}
