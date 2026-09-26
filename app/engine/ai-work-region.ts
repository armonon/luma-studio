import type { DisplayViewport } from "./viewport";

export type AiGeometryCopy = { mode: "upscale" | "expand"; factor: number };
export function planAiGeometryCopy(width: number, height: number, options: AiGeometryCopy) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0) ||
      !["upscale", "expand"].includes(options.mode) || !Number.isFinite(options.factor) || options.factor <= 1 || options.factor > 4) throw new Error("AI copy needs valid dimensions and a scale greater than 1, up to 4");
  const outputWidth = Math.round(width * options.factor), outputHeight = Math.round(height * options.factor);
  if (outputWidth > 3840 || outputHeight > 3840 || outputWidth * outputHeight > 8_294_400 || Math.max(outputWidth, outputHeight) / Math.min(outputWidth, outputHeight) > 3) throw new Error("AI enlarged copies support up to 3840 pixels per side, 8.29 megapixels, and a 3:1 aspect ratio. Reduce the scale or crop first.");
  const paddingX = options.mode === "expand" ? Math.floor((outputWidth - width) / 2) : 0;
  const paddingY = options.mode === "expand" ? Math.floor((outputHeight - height) / 2) : 0;
  const regionWidth = options.mode === "expand" ? outputWidth : width;
  const regionHeight = options.mode === "expand" ? outputHeight : height;
  const proxy = Math.min(1, 2048 / regionWidth, 2048 / regionHeight);
  const apiScale = Math.max(1, Math.sqrt(655_360 / (outputWidth * outputHeight)));
  let apiWidth = Math.min(3840, Math.ceil(outputWidth * apiScale / 16) * 16);
  let apiHeight = Math.min(3840, Math.ceil(outputHeight * apiScale / 16) * 16);
  if (apiWidth * apiHeight > 8_294_400) {
    const scale = Math.sqrt(8_294_400 / (apiWidth * apiHeight));
    apiWidth = Math.floor(apiWidth * scale / 16) * 16;
    apiHeight = Math.floor(apiHeight * scale / 16) * 16;
  }
  return { outputWidth, outputHeight, paddingX, paddingY, requestSize: `${apiWidth}x${apiHeight}` as `${number}x${number}`, work: {
    x: -paddingX, y: -paddingY, width: regionWidth, height: regionHeight,
    outputWidth: Math.max(1, Math.round(regionWidth * proxy)), outputHeight: Math.max(1, Math.round(regionHeight * proxy)),
  } };
}

export type AiWorkRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
};

/**
 * Plan the document crop sent to the image model. Small documents retain a
 * 1:1 path; selections get useful surrounding context; enormous documents use
 * the visible viewport (or a whole-document proxy) while never allocating
 * more than a 2048² input raster.
 */
export function planAiWorkRegion(
  documentWidth: number,
  documentHeight: number,
  selection?: { x: number; y: number; w: number; h: number } | null,
  viewport?: Pick<DisplayViewport, "x" | "y" | "width" | "height"> | null,
): AiWorkRegion {
  const docWidth = Math.max(1, Math.floor(documentWidth));
  const docHeight = Math.max(1, Math.floor(documentHeight));
  let x = 0;
  let y = 0;
  let width = docWidth;
  let height = docHeight;
  if (selection && selection.w > 0 && selection.h > 0) {
    const padding = Math.max(32, Math.min(512, Math.ceil(Math.max(selection.w, selection.h) * 0.15)));
    x = Math.max(0, Math.floor(selection.x) - padding);
    y = Math.max(0, Math.floor(selection.y) - padding);
    const right = Math.min(docWidth, Math.ceil(selection.x + selection.w) + padding);
    const bottom = Math.min(docHeight, Math.ceil(selection.y + selection.h) + padding);
    width = Math.max(1, right - x);
    height = Math.max(1, bottom - y);
  } else if (viewport && docWidth * docHeight > 2048 * 2048) {
    x = Math.max(0, Math.min(docWidth - 1, Math.floor(viewport.x)));
    y = Math.max(0, Math.min(docHeight - 1, Math.floor(viewport.y)));
    const right = Math.max(x + 1, Math.min(docWidth, Math.ceil(viewport.x + viewport.width)));
    const bottom = Math.max(y + 1, Math.min(docHeight, Math.ceil(viewport.y + viewport.height)));
    width = right - x;
    height = bottom - y;
  }
  const scale = Math.min(1, 2048 / width, 2048 / height, Math.sqrt((2048 * 2048) / (width * height)));
  return {
    x,
    y,
    width,
    height,
    outputWidth: Math.max(1, Math.round(width * scale)),
    outputHeight: Math.max(1, Math.round(height * scale)),
  };
}
