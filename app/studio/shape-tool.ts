import type { Studio } from "../engine/studio";
import { buildShapeGeometry, SHAPE_PRESETS, type CustomShape, type ShapeSettings } from "../engine/shape-library";
import type { CanvasDragDraft } from "./canvas-gesture";

export const SHAPE_TOOLS = new Set(["rect", "ellipse", "triangle", "polygon", "line", "custom-shape"]);
export type ShapeGesture = { documentId: string; settings: ShapeSettings; custom?: CustomShape; fill: string };
export function shapePresetForTool(tool: string, selected: string) { return tool === "custom-shape" ? selected : tool; }

export function shapeDragGeometry(drag: CanvasDragDraft, modifiers: { shiftKey?: boolean; altKey?: boolean } = drag) {
  const config = drag.shapeGesture;
  if (!config) throw new Error("Shape gesture was not initialized");
  let dx = drag.x1 - drag.x0, dy = drag.y1 - drag.y0;
  const isLine = config.settings.preset === "line";
  if (modifiers.shiftKey) {
    if (isLine) {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy);
      dx = Math.cos(angle) * length; dy = Math.sin(angle) * length;
    } else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * size; dy = (dy < 0 ? -1 : 1) * size;
    }
  }
  const from = { x: drag.x0 - (modifiers.altKey ? dx : 0), y: drag.y0 - (modifiers.altKey ? dy : 0) };
  const to = { x: drag.x0 + dx, y: drag.y0 + dy };
  const bounds = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
  if (isLine ? Math.hypot(dx, dy) <= 2 : bounds.width <= 2 || bounds.height <= 2) return null;
  return buildShapeGeometry(config.settings, bounds, config.fill, config.custom, { from, to });
}

export function commitShapeDrag(studio: Studio, drag: CanvasDragDraft) {
  if (!drag.shapeGesture || studio.activeDocumentState().id !== drag.shapeGesture.documentId) throw new Error("Document changed; shape drawing cancelled");
  const geometry = shapeDragGeometry(drag);
  if (!geometry) return null;
  const name = drag.shapeGesture.custom?.name ?? SHAPE_PRESETS.find(s => s.id === drag.shapeGesture!.settings.preset)?.label ?? "Shape";
  return geometry.kind === "shape" ? studio.addShapeLayer(geometry.style) : studio.addPathLayer(geometry.path, name);
}
