import { LumaEdition, hasCapability } from "./edition";

/**
 * The browser's canvas ceiling, and who is allowed past it.
 *
 * A 2D canvas cannot exceed roughly 16384px on a side or 64 megapixels in area.
 * That is a limit of the rendering surface, not of the document model: layers
 * are already stored as sparse `PrecisionTileSurface` tiles, the viewport is
 * already tiled, and PNG export already streams band by band. What a document
 * past the ceiling cannot do is ever materialise as one canvas.
 *
 * The numbers used to be spelled out in five places across studio.ts and
 * psd.ts. One of them disagreeing with the others is a document that can be
 * created and then not exported, so they live here now.
 */
export const MAX_CANVAS_EDGE = 16384;
export const MAX_CANVAS_AREA = 64_000_000;

/** Whether these dimensions are past what a single canvas can hold. */
export function exceedsBrowserCanvas(width: number, height: number): boolean {
  return width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE || width * height > MAX_CANVAS_AREA;
}

/** The inverse, named the way call sites read best. */
export function fitsBrowserCanvas(width: number, height: number): boolean {
  return !exceedsBrowserCanvas(width, height);
}

/**
 * Whether this edition may open a document of this size.
 *
 * The `large-documents` capability was declared for pro and then consulted
 * nowhere, so the web edition happily created documents it could only
 * partially export. Permission is checked here instead of assumed.
 */
export function canOpenDocumentSize(width: number, height: number, edition: LumaEdition): boolean {
  return fitsBrowserCanvas(width, height) || hasCapability(edition, "large-documents");
}

/** Why a document of this size was refused, for a message a user can act on. */
export function documentSizeRefusal(
  width: number,
  height: number,
  edition: LumaEdition,
): string | null {
  if (canOpenDocumentSize(width, height, edition)) return null;
  return `${width}x${height} is past this edition's ${MAX_CANVAS_EDGE}px / `
    + `${MAX_CANVAS_AREA / 1_000_000} megapixel ceiling. The desktop edition opens documents this large.`;
}
