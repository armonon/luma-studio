import type { DisplayViewport } from "./viewport";

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
