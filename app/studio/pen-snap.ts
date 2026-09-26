export type PenPoint = { x: number; y: number };
export type PenSnapSettings = { snap: boolean; grid: boolean; gridSize: number; angleStep: number; measurements: boolean };
export const DEFAULT_PEN_SNAP: PenSnapSettings = { snap: true, grid: false, gridSize: 10, angleStep: 45, measurements: true };
export const PEN_SNAP_KEY = "luma.pen-snap.v1";
export type PenSnapResult = {
  point: PenPoint; origin?: PenPoint; distance: number; angle: number; dx: number; dy: number;
  guides: { axis: "x" | "y"; position: number; label: string }[];
  label: string; closes: boolean; handle: boolean;
  zoom: number;
};
export function normalizePenSnap(value: Partial<PenSnapSettings> | null | undefined): PenSnapSettings {
  return {
    snap: typeof value?.snap === "boolean" ? value.snap : true,
    grid: value?.grid === true,
    gridSize: Number.isFinite(value?.gridSize) ? Math.max(1, Math.min(10000, value!.gridSize!)) : 10,
    angleStep: [15, 30, 45, 90].includes(value?.angleStep ?? 0) ? value!.angleStep! : 45,
    measurements: typeof value?.measurements === "boolean" ? value.measurements : true,
  };
}

/** O(draft anchors + document guides), no canvas-sized buffers or layer scans. */
export function resolvePenSnap(input: {
  point: PenPoint; anchors: readonly PenPoint[]; width: number; height: number; zoom: number;
  guides: readonly { orientation: "vertical" | "horizontal"; position: number }[];
  settings: PenSnapSettings; shiftKey?: boolean; altKey?: boolean; handleOrigin?: PenPoint;
}): PenSnapResult {
  const { anchors, handleOrigin } = input;
  const settings = normalizePenSnap(input.settings);
  const raw = input.point;
  if (![raw.x, raw.y, input.width, input.height, input.zoom].every(Number.isFinite) || input.zoom <= 0 || input.width <= 0 || input.height <= 0 || !Number.isFinite(8 / input.zoom)) throw new Error("Invalid pen coordinates or zoom");
  const origin = handleOrigin ?? anchors.at(-1);
  if (origin && ![origin.x, origin.y].every(Number.isFinite)) throw new Error("Invalid pen anchor");
  const tolerance = 8 / input.zoom;
  let point = { ...raw }, label = "", closes = false;
  const guides: PenSnapResult["guides"] = [];
  if (input.shiftKey && origin) {
    const length = Math.hypot(raw.x - origin.x, raw.y - origin.y);
    const step = settings.angleStep * Math.PI / 180;
    const angle = Math.round(Math.atan2(raw.y - origin.y, raw.x - origin.x) / step) * step;
    point = { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
    label = `${settings.angleStep}° constraint`;
    // An automatic alignment must never pull the result off the constrained ray.
  } else if (settings.snap && !input.altKey) {
    if (!handleOrigin && anchors.length >= 2 && Math.hypot(raw.x - anchors[0].x, raw.y - anchors[0].y) <= tolerance) {
      point = { ...anchors[0] }; label = "Close path"; closes = true;
    } else {
      const xTargets = [{ position: 0, label: "Canvas edge" }, { position: input.width / 2, label: "Canvas center" }, { position: input.width, label: "Canvas edge" }];
      const yTargets = [{ position: 0, label: "Canvas edge" }, { position: input.height / 2, label: "Canvas center" }, { position: input.height, label: "Canvas edge" }];
      for (const g of input.guides) if (Number.isFinite(g.position)) (g.orientation === "vertical" ? xTargets : yTargets).push({ position: g.position, label: "Guide" });
      for (const a of anchors) {
        if (Number.isFinite(a.x)) xTargets.push({ position: a.x, label: "Anchor alignment" });
        if (Number.isFinite(a.y)) yTargets.push({ position: a.y, label: "Anchor alignment" });
      }
      if (settings.grid) {
        xTargets.push({ position: Math.round(raw.x / settings.gridSize) * settings.gridSize, label: "Grid" });
        yTargets.push({ position: Math.round(raw.y / settings.gridSize) * settings.gridSize, label: "Grid" });
      }
      for (const [axis, targets] of [["x", xTargets], ["y", yTargets]] as const) {
        let best = tolerance + Number.EPSILON;
        let hit: typeof targets[number] | undefined;
        for (const target of targets) {
          const delta = Math.abs(raw[axis] - target.position);
          if (delta <= tolerance && delta < best) { best = delta; hit = target; }
        }
        if (hit) { point[axis] = hit.position; guides.push({ axis, position: hit.position, label: hit.label }); }
      }
      label = [...new Set(guides.map(g => g.label))].join(" + ");
    }
  }
  const dx = origin ? point.x - origin.x : 0, dy = origin ? point.y - origin.y : 0;
  const distance = Math.hypot(dx, dy);
  return { point, origin, distance, angle: distance < 1e-9 ? 0 : (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, dx, dy, guides, label, closes, handle: !!handleOrigin, zoom: input.zoom };
}

export function penMeasurementLabel(result: PenSnapResult): string {
  if (!result.origin) return `X ${result.point.x.toFixed(1)} · Y ${result.point.y.toFixed(1)} px`;
  return `${result.handle ? "Handle" : "Chord"} ${result.distance.toFixed(1)} px · ${result.angle.toFixed(1)}° · Δ ${result.dx.toFixed(1)}, ${result.dy.toFixed(1)}`;
}

export function createPenPath(anchors: readonly PathAnchor[], closed: boolean, color: string): PathStyle {
  if (anchors.length < 2 || anchors.length > 4096) throw new Error("Pen paths require 2–4096 anchors");
  return { anchors: anchors.map(a => ({ ...a, hIn: { ...a.hIn }, hOut: { ...a.hOut } })), closed, fill: closed ? color : "none", stroke: color, strokeWidth: closed ? 0 : 2 };
}
import type { PathAnchor, PathStyle } from "../engine/document";
