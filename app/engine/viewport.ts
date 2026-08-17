import type { PixelRect } from "./tile-store";

export type CanvasView = {
  zoom: number;
  panX: number;
  panY: number;
};

export type DisplayViewport = PixelRect & {
  /** Backing-store pixels per full-resolution document pixel. */
  zoom: number;
  outputWidth: number;
  outputHeight: number;
  /** CSS pixels per full-resolution document pixel. */
  cssScale: number;
  devicePixelRatio: number;
};

export type ViewportLimits = {
  maxDimension?: number;
  maxPixels?: number;
};

const VIEWPORT_EPSILON = 1e-7;

/**
 * ResizeObserver and layout effects can report the same viewport more than
 * once. Ignore floating-point noise only; backing-store or device-scale
 * changes must always create a new plan.
 */
export function sameDisplayViewport(
  current: DisplayViewport | null,
  next: DisplayViewport,
) {
  if (!current) return false;
  if (
    current.outputWidth !== next.outputWidth
    || current.outputHeight !== next.outputHeight
  ) return false;
  return (
    Math.abs(current.x - next.x) <= VIEWPORT_EPSILON
    && Math.abs(current.y - next.y) <= VIEWPORT_EPSILON
    && Math.abs(current.width - next.width) <= VIEWPORT_EPSILON
    && Math.abs(current.height - next.height) <= VIEWPORT_EPSILON
    && Math.abs(current.zoom - next.zoom) <= VIEWPORT_EPSILON
    && Math.abs(current.cssScale - next.cssScale) <= VIEWPORT_EPSILON
    && Math.abs(current.devicePixelRatio - next.devicePixelRatio) <= VIEWPORT_EPSILON
  );
}

const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_MAX_PIXELS = 12_000_000;

function positiveFinite(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Maps the editor's fit-relative zoom and screen-space pan to a bounded render
 * target. The returned document rectangle may extend beyond the document; that
 * is intentional, so the renderer can preserve the pasteboard around it.
 */
export function calculateDisplayViewport(
  documentWidth: number,
  documentHeight: number,
  stageWidth: number,
  stageHeight: number,
  view: CanvasView,
  requestedDevicePixelRatio = 1,
  limits: ViewportLimits = {},
): DisplayViewport {
  const safeDocumentWidth = positiveFinite(documentWidth, 1);
  const safeDocumentHeight = positiveFinite(documentHeight, 1);
  const safeStageWidth = positiveFinite(stageWidth, 1);
  const safeStageHeight = positiveFinite(stageHeight, 1);
  const fitScale = Math.min(
    safeStageWidth / safeDocumentWidth,
    safeStageHeight / safeDocumentHeight,
  );
  const cssScale = Math.max(1e-8, fitScale * positiveFinite(view.zoom, 1));
  const maxDimension = positiveFinite(limits.maxDimension ?? DEFAULT_MAX_DIMENSION, DEFAULT_MAX_DIMENSION);
  const maxPixels = positiveFinite(limits.maxPixels ?? DEFAULT_MAX_PIXELS, DEFAULT_MAX_PIXELS);
  let devicePixelRatio = Math.min(positiveFinite(requestedDevicePixelRatio, 1), 3);
  devicePixelRatio = Math.min(
    devicePixelRatio,
    maxDimension / safeStageWidth,
    maxDimension / safeStageHeight,
    Math.sqrt(maxPixels / (safeStageWidth * safeStageHeight)),
  );
  devicePixelRatio = Math.max(0.25, devicePixelRatio);
  const outputWidth = Math.max(1, Math.round(safeStageWidth * devicePixelRatio));
  const outputHeight = Math.max(1, Math.round(safeStageHeight * devicePixelRatio));
  const width = safeStageWidth / cssScale;
  const height = safeStageHeight / cssScale;

  return {
    x: safeDocumentWidth / 2 - (safeStageWidth / 2 + view.panX) / cssScale,
    y: safeDocumentHeight / 2 - (safeStageHeight / 2 + view.panY) / cssScale,
    width,
    height,
    zoom: cssScale * devicePixelRatio,
    outputWidth,
    outputHeight,
    cssScale,
    devicePixelRatio,
  };
}

export function viewportPointToDocument(
  viewport: Pick<DisplayViewport, "x" | "y" | "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
  x: number,
  y: number,
) {
  return {
    x: viewport.x + x / Math.max(1, viewportWidth) * viewport.width,
    y: viewport.y + y / Math.max(1, viewportHeight) * viewport.height,
  };
}

export function documentPointToViewport(
  viewport: Pick<DisplayViewport, "x" | "y" | "width" | "height">,
  viewportWidth: number,
  viewportHeight: number,
  x: number,
  y: number,
) {
  return {
    x: (x - viewport.x) / viewport.width * viewportWidth,
    y: (y - viewport.y) / viewport.height * viewportHeight,
  };
}
