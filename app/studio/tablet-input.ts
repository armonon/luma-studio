import { zoomViewToScale, type CanvasView } from "../engine/viewport";

export type TouchPoint = { x: number; y: number };
export const TABLET_DRAW_KEY = "luma.tablet.finger-drawing.v1";
// Bound display buffers independently of project dimensions (not a process RAM cap).
export const TABLET_VIEWPORT_LIMITS = { maxDimension: 3072, maxPixels: 4_000_000 } as const;

/** iPadOS uses a desktop UA; capability detection also works with a trackpad. */
export function tabletInterface(touchPoints: number, coarse: boolean, platform: string, override: string | null) {
  if (override === "tablet") return true;
  if (override === "desktop") return false;
  return touchPoints > 1 && (coarse || /Mac|iPad|iPhone/.test(platform));
}

function geometry(points: readonly TouchPoint[]) {
  const a = points[0], b = points[1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
}

/** Incremental pinch with a stage-centred anchor; adding/removing fingers rebases. */
export function navigateTouches(view: CanvasView, previous: readonly TouchPoint[], next: readonly TouchPoint[], fitScale: number): CanvasView {
  if (!previous.length || previous.length !== next.length) return view;
  if (![...previous, ...next].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return view;
  const a = geometry(previous), b = geometry(next);
  const ratio = previous.length > 1 && a.distance >= 4 && b.distance >= 4 ? b.distance / a.distance : 1;
  const zoomed = zoomViewToScale(view, fitScale, view.zoom * fitScale * ratio, a.x, a.y);
  return { ...zoomed, panX: zoomed.panX + b.x - a.x, panY: zoomed.panY + b.y - a.y };
}

/** Exclusive editing pointer. Palms/second touches must never enter tool handlers. */
export class TabletPointerSession {
  readonly touches = new Map<number, TouchPoint>();
  editor: number | null = null;
  private editorTouch = false;
  private editorPoint: TouchPoint | null = null;
  blocked = new Set<number>();
  down(id: number, type: string, drawWithTouch: boolean, point: TouchPoint, canCancelTouch = false): "edit" | "navigate" | "ignore" | "cancel-edit" {
    if (this.editor !== null && this.editorTouch && type === "touch" && canCancelTouch && this.editorPoint) {
      this.touches.set(this.editor, this.editorPoint);
      this.touches.set(id, point);
      this.editor = null;
      this.editorTouch = false;
      this.editorPoint = null;
      return "cancel-edit";
    }
    if (this.editor !== null) { this.blocked.add(id); return "ignore"; }
    if (type === "touch" && this.touches.size) { this.touches.set(id, point); return "navigate"; }
    if (type !== "touch" || drawWithTouch) {
      for (const touchId of this.touches.keys()) this.blocked.add(touchId);
      this.touches.clear(); this.editor = id; this.editorTouch = type === "touch"; this.editorPoint = point; return "edit";
    }
    this.touches.set(id, point); return "navigate";
  }
  updateEditor(id: number, point: TouchPoint) { if (this.editor === id) this.editorPoint = point; }
  up(id: number) {
    this.touches.delete(id); this.blocked.delete(id);
    if (this.editor === id) { this.editor = null; this.editorTouch = false; this.editorPoint = null; }
  }
}
