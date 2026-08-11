/**
 * Layer style effects: the six kinds, drawn with the 2D canvas.
 *
 * This lives apart from `renderer.ts` so the GPU path can share it without an
 * import cycle. Keeping one implementation is the point: the GPU renderer used
 * to carry its own copy that handled drop shadows and silently skipped the
 * other five, so turning on GPU export changed the exported image.
 */

import {
  bevelOffset,
  effectsInPaintOrder,
  isEffectBelowContent,
  resolvedFillOpacity,
  type Layer,
  type LayerEffect,
} from "./document";

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

/** How far outside its own silhouette an effect can paint, in document pixels. */
export function layerEffectReach(effect: LayerEffect) {
  switch (effect.kind) {
    case "drop-shadow":
      return effect.blur * 2 + Math.abs(effect.offsetX) + Math.abs(effect.offsetY);
    case "outer-glow":
      return effect.blur * 2;
    case "stroke":
      // An inside stroke stays within the shape, but the outward band does not.
      return (effect.position ?? "outside") === "inside" ? 0 : (effect.width ?? 3) + effect.blur;
    case "bevel-emboss": {
      const { dx, dy } = bevelOffset(effect);
      return Math.max(Math.abs(dx), Math.abs(dy)) + effect.blur * 2;
    }
    // Clipped to the layer, so they never reach outside it.
    case "color-overlay":
    case "inner-shadow":
      return 0;
  }
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
  size: { width: number; height: number },
  scale: { x: number; y: number },
  uniformScale: number,
) {
  const ctx = effectBuf.getContext("2d")!;
  clearContext(ctx, size.width, size.height);
  ctx.save();
  ctx.globalAlpha = effect.opacity;
  const blur = effect.blur * uniformScale;

  switch (effect.kind) {
    case "drop-shadow":
    case "outer-glow": {
      // A glow is a shadow with no offset, so they share one path.
      const offsetX = effect.kind === "outer-glow" ? 0 : effect.offsetX * scale.x;
      const offsetY = effect.kind === "outer-glow" ? 0 : effect.offsetY * scale.y;
      stampSilhouette(ctx, contentBuf, effect.color, blur, offsetX, offsetY);
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
      stampSilhouette(ctx, contentBuf, "#000000", blur, effect.offsetX * scale.x, effect.offsetY * scale.y);
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

    case "bevel-emboss": {
      // Light one edge and shade the opposite one, both confined to the layer.
      const { dx, dy } = bevelOffset(effect);
      stampSilhouette(ctx, contentBuf, effect.highlightColor ?? "#ffffff", blur, dx * scale.x, dy * scale.y);
      stampSilhouette(ctx, contentBuf, effect.shadowColor ?? "#000000", blur, -dx * scale.x, -dy * scale.y);
      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(contentBuf, 0, 0);
      break;
    }
  }

  ctx.restore();
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
  size: { width: number; height: number },
  scale: { x: number; y: number },
) {
  const effects = effectsInPaintOrder(
    (layer.effects ?? []).filter((effect) => effect.enabled && effect.opacity > 0),
  );
  const uniformScale = Math.sqrt(scale.x * scale.y);

  // Shadows and glows sit under the layer's own pixels.
  for (const effect of effects) {
    if (!isEffectBelowContent(effect.kind)) continue;
    drawLayerEffect(effectBuf, content, scratchBuf, effect, size, scale, uniformScale);
    out.drawImage(effectBuf, 0, 0);
  }

  out.globalAlpha = resolvedFillOpacity(layer);
  out.drawImage(content, 0, 0);
  out.globalAlpha = 1;

  // Overlays, strokes and bevels sit on top. Stroke is the exception: an
  // outside stroke must not be clipped away by the content it surrounds, so
  // drawLayerEffect leaves it unclipped and it still composites above.
  for (const effect of effects) {
    if (isEffectBelowContent(effect.kind)) continue;
    drawLayerEffect(effectBuf, content, scratchBuf, effect, size, scale, uniformScale);
    out.drawImage(effectBuf, 0, 0);
  }
}
