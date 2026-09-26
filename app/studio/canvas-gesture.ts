import type { Point } from "../engine/advanced-tools";
import type { ShapeGesture } from "./shape-tool";

export type SelectionCombineMode = "replace" | "add" | "subtract" | "intersect";

export type CanvasDragKind =
  | "sel-rect"
  | "sel-ellipse"
  | "sel-lasso"
  | "rect"
  | "ellipse"
  | "triangle"
  | "polygon"
  | "line"
  | "custom-shape"
  | "frame"
  | "paragraph-text"
  | "move-layer"
  | "gradient"
  | "crop"
  | "straighten"
  | "content-move"
  | "radial-warp"
  | "ruler";

export type CanvasDragDraft = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: CanvasDragKind;
  /** Interaction target frozen on pointer-down; selection changes mid-drag cannot redirect it. */
  layerId?: string;
  path?: Point[];
  moveStart?: { tx: number; ty: number };
  shapeGesture?: ShapeGesture;
  shiftKey?: boolean;
  altKey?: boolean;
};

export type CanvasGestureContext = {
  preferredSelectionMode: SelectionCombineMode;
  modifiers: { shiftKey: boolean; altKey: boolean };
  feather: number;
  activeRasterLayerId: string | null;
  brushColor: string;
  secondaryColor: string;
  gradientType: "linear" | "radial";
  text: string;
  textSize: number;
  warpRadius: number;
};

type Bounds = { x: number; y: number; width: number; height: number };

export type CanvasGestureIntent =
  | { kind: "select-rect" | "select-ellipse"; bounds: Bounds; mode: SelectionCombineMode; feather: number }
  | { kind: "select-lasso"; path: Point[]; mode: SelectionCombineMode; feather: number }
  | { kind: "shape"; shape: "rect" | "ellipse"; bounds: Bounds; fill: string }
  | { kind: "path-shape"; shape: "triangle" | "polygon" | "line" | "custom-shape"; bounds: Bounds; fill: string }
  | { kind: "frame"; bounds: Bounds; shifted: boolean }
  | { kind: "paragraph-text"; bounds: Bounds; text: string; color: string; font: string }
  | {
      kind: "gradient";
      layerId: string;
      from: Point;
      to: Point;
      startColor: string;
      endColor: string;
      gradientType: "linear" | "radial";
    }
  | { kind: "crop"; bounds: Bounds }
  | { kind: "straighten"; radians: number }
  | { kind: "content-move"; layerId: string; deltaX: number; deltaY: number }
  | { kind: "radial-warp"; layerId: string; from: Point; to: Point; radius: number }
  | { kind: "measurement"; start: Point; end: Point };

const MIN_DRAG_SIZE = 2;
const MIN_TEXT_BOX_SIZE = 8;

export function resolveSelectionMode(
  preferred: SelectionCombineMode,
  modifiers: { shiftKey: boolean; altKey: boolean },
): SelectionCombineMode {
  // Shift wins when both modifiers are held, matching Photoshop's additive
  // selection gesture and the editor's existing pointer behavior.
  if (modifiers.shiftKey) return "add";
  if (modifiers.altKey) return "subtract";
  return preferred;
}

function normalizedBounds(drag: CanvasDragDraft): Bounds {
  return {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
}

function clearsMinimum(bounds: Bounds, minimum = MIN_DRAG_SIZE): boolean {
  return bounds.width > minimum && bounds.height > minimum;
}

/**
 * Convert a completed pointer drag into one editor operation.
 *
 * This deliberately plans rather than executes. React owns transient input
 * state while Studio owns mutations and history; keeping the boundary pure
 * makes the thresholds and routing testable without manufacturing DOM events.
 */
export function planCanvasGesture(
  drag: CanvasDragDraft,
  context: CanvasGestureContext,
): CanvasGestureIntent | null {
  const bounds = normalizedBounds(drag);
  const mode = resolveSelectionMode(context.preferredSelectionMode, context.modifiers);

  if (drag.kind === "sel-rect" || drag.kind === "sel-ellipse") {
    if (!clearsMinimum(bounds)) return null;
    return {
      kind: drag.kind === "sel-rect" ? "select-rect" : "select-ellipse",
      bounds,
      mode,
      feather: context.feather,
    };
  }

  if (drag.kind === "sel-lasso") {
    if (!drag.path || drag.path.length <= 4) return null;
    return {
      kind: "select-lasso",
      path: drag.path.map((point) => ({ ...point })),
      mode,
      feather: context.feather,
    };
  }

  if (drag.kind === "rect" || drag.kind === "ellipse") {
    if (!clearsMinimum(bounds)) return null;
    return { kind: "shape", shape: drag.kind, bounds, fill: context.brushColor };
  }

  if (["triangle", "polygon", "line", "custom-shape"].includes(drag.kind)) {
    if (!clearsMinimum(bounds)) return null;
    return {
      kind: "path-shape",
      shape: drag.kind as "triangle" | "polygon" | "line" | "custom-shape",
      bounds,
      fill: context.brushColor,
    };
  }

  if (drag.kind === "frame") {
    if (!clearsMinimum(bounds)) return null;
    return { kind: "frame", bounds, shifted: context.modifiers.shiftKey };
  }

  if (drag.kind === "paragraph-text") {
    if (!clearsMinimum(bounds, MIN_TEXT_BOX_SIZE)) return null;
    return {
      kind: "paragraph-text",
      bounds,
      text: context.text,
      color: context.brushColor,
      font: `700 ${context.textSize}px 'Inter', system-ui, sans-serif`,
    };
  }

  if (drag.kind === "gradient") {
    if (!context.activeRasterLayerId) return null;
    return {
      kind: "gradient",
      layerId: context.activeRasterLayerId,
      from: { x: drag.x0, y: drag.y0 },
      to: { x: drag.x1, y: drag.y1 },
      startColor: context.brushColor,
      endColor: context.secondaryColor,
      gradientType: context.gradientType,
    };
  }

  if (drag.kind === "crop") {
    return clearsMinimum(bounds) ? { kind: "crop", bounds } : null;
  }

  if (drag.kind === "straighten") {
    return { kind: "straighten", radians: -Math.atan2(drag.y1 - drag.y0, drag.x1 - drag.x0) };
  }

  if (drag.kind === "content-move") {
    if (!context.activeRasterLayerId) return null;
    return {
      kind: "content-move",
      layerId: context.activeRasterLayerId,
      deltaX: drag.x1 - drag.x0,
      deltaY: drag.y1 - drag.y0,
    };
  }

  if (drag.kind === "radial-warp") {
    if (!context.activeRasterLayerId) return null;
    return {
      kind: "radial-warp",
      layerId: context.activeRasterLayerId,
      from: { x: drag.x0, y: drag.y0 },
      to: { x: drag.x1, y: drag.y1 },
      radius: context.warpRadius,
    };
  }

  if (drag.kind === "ruler") {
    return {
      kind: "measurement",
      start: { x: drag.x0, y: drag.y0 },
      end: { x: drag.x1, y: drag.y1 },
    };
  }

  return null;
}
