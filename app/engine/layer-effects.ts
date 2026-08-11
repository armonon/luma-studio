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
  resolvedEffectAngle,
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
 * How far outside its own silhouette an effect reaches, in document pixels.
 *
 * This sets the tile margin, so it covers reading as well as writing. Backdrop
 * Blur paints nothing outside the layer but *samples* far outside it, and
 * returning 0 gave every tile only its own slice of the backdrop to blur —
 * which showed up as a grid of seams across the frosted panel.
 *
 * Deliberately independent of the light angle — global light can rotate a
 * shadow at any time, and an overscan that shrank with the angle would clip
 * effects at tile boundaries until the next full redraw.
 */
export function layerEffectReach(effect: LayerEffect) {
  switch (effect.kind) {
    case "drop-shadow":
      return effect.blur * 2 + Math.hypot(effect.offsetX, effect.offsetY);
    case "long-shadow":
      return Math.hypot(effect.offsetX, effect.offsetY);
    case "bloom":
      return effect.blur * 2;
    case "outer-glow":
      return effect.blur * 2;
    case "stroke":
      // An inside stroke stays within the shape, but the outward band does not.
      return (effect.position ?? "outside") === "inside" ? 0 : (effect.width ?? 3) + effect.blur;
    case "bevel-emboss":
      return (effect.depth ?? 3) + effect.blur * 2;
    case "backdrop-blur":
      // Sampling reach, not painting reach.
      return effect.blur * 2;
    case "refraction":
      // Bounded displacement, which is exactly why this one tiles correctly.
      return (effect.strength ?? 12) + effect.blur;
    // Clipped to the layer, so they never reach outside it.
    case "color-overlay":
    case "gradient-overlay":
    case "pattern-overlay":
    case "inner-shadow":
    case "inner-glow":
    case "satin":
    case "relief":
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
  backdrop: HTMLCanvasElement | null,
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

    case "backdrop-blur": {
      // Frosted glass: blur what is *behind* the layer and keep it inside the
      // layer's own silhouette. Photoshop has no live equivalent — there you
      // duplicate, merge, blur and clip by hand, and it goes stale the moment
      // anything underneath changes.
      if (!backdrop) break;
      const saturation = effect.saturation ?? 1.6;
      ctx.filter = `blur(${blur}px) saturate(${saturation})`;
      // Draw 1:1. The tile is already overscanned by layerEffectReach, so the
      // darkened border where the blur samples past the edge falls outside the
      // visible crop. Scaling the backdrop to fake a bleed instead distorts it
      // and makes neighbouring tiles disagree — which is a visible seam.
      ctx.drawImage(backdrop, 0, 0);
      ctx.filter = "none";
      const tint = Math.max(0, Math.min(1, effect.tint ?? 0));
      if (tint > 0) {
        ctx.globalAlpha = tint;
        ctx.fillStyle = effect.color;
        ctx.fillRect(0, 0, size.width, size.height);
      }
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "long-shadow": {
      // A flat-design trail: the silhouette stamped repeatedly along the light
      // direction, fading out. No Photoshop equivalent, and about ten lines
      // once there is a silhouette stamp to reuse.
      const steps = Math.max(1, Math.min(128, Math.round(effect.steps ?? 32)));
      const dx = offset.x * scale.x;
      const dy = offset.y * scale.y;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        ctx.globalAlpha = effect.opacity * (1 - t);
        stampSilhouette(ctx, contentBuf, effect.color, 0, dx * t, dy * t);
      }
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "bloom": {
      // Bloom reads pixel values, not the silhouette: only genuinely bright
      // parts of the image spill light, which is what a lens actually does and
      // what Outer Glow — driven by alpha alone — cannot tell apart.
      const threshold = Math.max(0, Math.min(1, effect.threshold ?? 0.7));
      const sctx = scratchBuf.getContext("2d")!;
      clearContext(sctx, size.width, size.height);
      sctx.drawImage(contentBuf, 0, 0);
      const bright = sctx.getImageData(0, 0, size.width, size.height);
      const data = bright.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        data[i + 3] = luminance <= threshold
          ? 0
          : data[i + 3] * ((luminance - threshold) / Math.max(1e-6, 1 - threshold));
      }
      sctx.putImageData(bright, 0, 0);
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(scratchBuf, 0, 0);
      ctx.filter = "none";
      break;
    }

    case "relief": {
      // Emboss driven by the image's own luminance rather than its outline, so
      // a photograph gains real relief instead of a lit rim around its edge.
      const depth = Math.max(1, Math.round((effect.depth ?? 3) * uniformScale));
      const radians = (resolvedEffectAngle(effect, light) * Math.PI) / 180;
      const stepX = Math.round(Math.cos(radians) * depth);
      const stepY = Math.round(-Math.sin(radians) * depth);

      const sctx = scratchBuf.getContext("2d")!;
      clearContext(sctx, size.width, size.height);
      sctx.drawImage(contentBuf, 0, 0);
      const source = sctx.getImageData(0, 0, size.width, size.height);
      const src = source.data;
      const luminance = new Float32Array(size.width * size.height);
      for (let i = 0, p = 0; i < src.length; i += 4, p += 1) {
        luminance[p] = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;
      }
      const out = ctx.createImageData(size.width, size.height);
      const dst = out.data;
      for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
          const p = y * size.width + x;
          const index = p * 4;
          if (src[index + 3] === 0) continue;
          const ax = Math.max(0, Math.min(size.width - 1, x - stepX));
          const ay = Math.max(0, Math.min(size.height - 1, y - stepY));
          const bx = Math.max(0, Math.min(size.width - 1, x + stepX));
          const by = Math.max(0, Math.min(size.height - 1, y + stepY));
          // Mid grey plus the slope along the light direction: the classic
          // emboss, which an overlay blend turns back into surface relief.
          const slope = luminance[ay * size.width + ax] - luminance[by * size.width + bx];
          const value = Math.max(0, Math.min(255, 128 + slope * 255));
          dst[index] = value;
          dst[index + 1] = value;
          dst[index + 2] = value;
          dst[index + 3] = src[index + 3];
        }
      }
      ctx.putImageData(out, 0, 0);
      // putImageData ignores globalAlpha, so the opacity is reapplied by mask.
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = effect.opacity;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }

    case "refraction": {
      // Glass: bend the backdrop by the slope of the layer's own alpha, so the
      // edges of the shape distort what is behind them and the middle stays
      // clear. Displacement is bounded by `strength`, which is what keeps this
      // correct across tiles — a reflection would need the whole backdrop.
      if (!backdrop) break;
      const strength = Math.max(0, (effect.strength ?? 12) * uniformScale);
      if (strength <= 0) break;

      const sctx = scratchBuf.getContext("2d")!;
      clearContext(sctx, size.width, size.height);
      if (blur > 0) sctx.filter = `blur(${blur}px)`;
      sctx.drawImage(contentBuf, 0, 0);
      sctx.filter = "none";
      const shape = sctx.getImageData(0, 0, size.width, size.height).data;
      const source = ctx.createImageData(size.width, size.height);
      const bctx = backdrop.getContext("2d")!;
      const behind = bctx.getImageData(0, 0, size.width, size.height).data;
      const dst = source.data;

      const alphaAt = (x: number, y: number) => {
        const cx = Math.max(0, Math.min(size.width - 1, x));
        const cy = Math.max(0, Math.min(size.height - 1, y));
        return shape[(cy * size.width + cx) * 4 + 3] / 255;
      };

      for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
          const index = (y * size.width + x) * 4;
          if (shape[index + 3] === 0) continue;
          // The alpha gradient is the surface normal of the glass. Take the
          // direction from it and the magnitude from `strength`, rather than
          // multiplying the raw gradient: a one-pixel difference across a
          // softened edge is ~0.1, so a raw product would displace by a pixel
          // or two however high the control was set.
          const gx = alphaAt(x - 1, y) - alphaAt(x + 1, y);
          const gy = alphaAt(x, y - 1) - alphaAt(x, y + 1);
          const magnitude = Math.hypot(gx, gy);
          if (magnitude < 1e-4) continue;
          // Steeper edges bend more, saturating at the full strength.
          const bend = strength * Math.min(1, magnitude * 8);
          const dx = (gx / magnitude) * bend;
          const dy = (gy / magnitude) * bend;
          const sx = Math.max(0, Math.min(size.width - 1, Math.round(x + dx)));
          const sy = Math.max(0, Math.min(size.height - 1, Math.round(y + dy)));
          const from = (sy * size.width + sx) * 4;
          dst[index] = behind[from];
          dst[index + 1] = behind[from + 1];
          dst[index + 2] = behind[from + 2];
          dst[index + 3] = behind[from + 3];
        }
      }
      ctx.putImageData(source, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = effect.opacity;
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
 * Composite one finished effect buffer with the effect's own blend mode,
 * against whatever the layer has already drawn beneath it.
 *
 * Routed through the layer blend stack so all 27 modes work, including the
 * eleven with no native canvas operator.
 *
 * Known limitation, deliberately chosen. An earlier version also pulled in the
 * backdrop so that a multiplied drop shadow would darken the layers below.
 * Masking that result back down to the effect's coverage requires
 * `destination-in`, which *multiplies* alpha — so wherever nothing was beneath,
 * the effect's own alpha got squared and its falloff collapsed. That is a
 * subtle wrongness across every blended effect in exchange for one case, so
 * effects blend against the layer's own pixels only: exactly Porter-Duff, no
 * alpha distortion. The consequence is that a mode is a no-op where the effect
 * lands on transparency, the same way a shadow over an empty canvas looks the
 * same whatever mode it is set to. Fixing it properly means compositing effects
 * into the backdrop and re-deriving the layer's mask and clipping afterwards.
 */
function stampEffect(
  out: CanvasRenderingContext2D,
  effectBuf: HTMLCanvasElement,
  effect: LayerEffect,
) {
  const mode = resolvedEffectBlendMode(effect);
  if (mode === "source-over") {
    out.drawImage(effectBuf, 0, 0);
    return;
  }
  compositeBlendStack(
    out,
    effectBuf,
    [{ id: effect.id, mode, opacity: 1, enabled: true }],
    1,
    NEUTRAL_BLEND_IF,
  );
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


  // Shadows and glows sit under the layer's own pixels.
  for (const effect of effects) {
    if (!isEffectBelowContent(effect.kind)) continue;
    drawLayerEffect(effectBuf, content, scratchBuf, effect, frame, scale, uniformScale, light, bounds, backdrop);
    stampEffect(out, effectBuf, effect);
  }

  out.globalAlpha = resolvedFillOpacity(layer);
  out.drawImage(content, 0, 0);
  out.globalAlpha = 1;

  // Overlays, strokes and bevels sit on top. Stroke is the exception: an
  // outside stroke must not be clipped away by the content it surrounds, so
  // drawLayerEffect leaves it unclipped and it still composites above.
  for (const effect of effects) {
    if (isEffectBelowContent(effect.kind)) continue;
    drawLayerEffect(effectBuf, content, scratchBuf, effect, frame, scale, uniformScale, light, bounds, backdrop);
    stampEffect(out, effectBuf, effect);
  }
}
