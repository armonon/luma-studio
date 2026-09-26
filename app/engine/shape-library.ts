import type { Layer, PathAnchor, PathStyle, ShapeStyle } from "./document";
import { documentContours, layerVectorPath } from "./vector-delivery";
import { pathContours, validateVectorPath, type PathContour } from "./vector-path";

export const SHAPE_PRESETS = [
  { id: "rect", label: "Rectangle" }, { id: "ellipse", label: "Ellipse" },
  { id: "triangle", label: "Triangle" }, { id: "polygon", label: "Polygon" },
  { id: "star", label: "Star" }, { id: "heart", label: "Heart" },
  { id: "diamond", label: "Diamond" }, { id: "arrow", label: "Arrow" },
  { id: "chevron", label: "Chevron" }, { id: "cross", label: "Cross" },
  { id: "speech", label: "Speech bubble" }, { id: "line", label: "Line" },
] as const;
export type ShapePresetId = typeof SHAPE_PRESETS[number]["id"];
export type ShapeSettings = { preset: string; sides: number; innerRatio: number; radius: number; filled: boolean; stroke: string; strokeWidth: number };
export const DEFAULT_SHAPE_SETTINGS: ShapeSettings = { preset: "star", sides: 5, innerRatio: 0.42, radius: 0, filled: true, stroke: "#ffffff", strokeWidth: 2 };
export type CustomShape = { id: string; name: string; path: PathStyle };
export type ShapeBounds = { x: number; y: number; width: number; height: number };
export type ShapeGeometry = { kind: "shape"; style: ShapeStyle } | { kind: "path"; path: PathStyle };
export const SHAPE_LIBRARY_KEY = "luma.custom-shapes.v1";
export const SHAPE_LIBRARY_LIMIT = 32;
const MAX_LIBRARY_BYTES = 1_000_000;
const anchor = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0): PathAnchor => ({ x, y, hIn: { dx: ix, dy: iy }, hOut: { dx: ox, dy: oy } });
const polygon = (points: number[][]): PathContour => ({ anchors: points.map(([x, y]) => anchor(x, y)), closed: true });

function mapContours(contours: PathContour[], bounds: ShapeBounds): PathContour[] {
  return contours.map(c => ({ closed: c.closed, anchors: c.anchors.map(a => ({
    x: bounds.x + a.x * bounds.width, y: bounds.y + a.y * bounds.height,
    hIn: { dx: a.hIn.dx * bounds.width, dy: a.hIn.dy * bounds.height },
    hOut: { dx: a.hOut.dx * bounds.width, dy: a.hOut.dy * bounds.height },
  })) }));
}

/** Shared by canvas preview and commit: no pixels or document-sized buffers. */
export function buildShapeGeometry(settings: ShapeSettings, bounds: ShapeBounds, fill: string, custom?: CustomShape, line?: { from: { x: number; y: number }; to: { x: number; y: number } }): ShapeGeometry {
  if (![...Object.values(bounds), settings.sides, settings.innerRatio, settings.radius, settings.strokeWidth].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0 || settings.strokeWidth < 0 || settings.strokeWidth > 1000) throw new Error("Invalid shape dimensions or stroke");
  const paint = { fill: settings.filled ? fill : "none", stroke: settings.stroke, strokeWidth: settings.strokeWidth };
  if (settings.preset === "rect" || settings.preset === "ellipse") {
    return { kind: "shape", style: { kind: settings.preset, x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height, radius: Math.max(0, Math.min(settings.radius, bounds.width / 2, bounds.height / 2)), ...paint } };
  }
  let contours: PathContour[];
  let fillRule: PathStyle["fillRule"] = "nonzero";
  if (settings.preset.startsWith("custom-")) {
    if (!custom || custom.id !== settings.preset) throw new Error("Choose an available custom shape");
    validateVectorPath(custom.path);
    contours = pathContours(custom.path); fillRule = custom.path.fillRule ?? "nonzero";
  } else if (["triangle", "polygon", "star"].includes(settings.preset)) {
    const star = settings.preset === "star";
    const sides = settings.preset === "triangle" ? 3 : Math.max(3, Math.min(64, Math.round(settings.sides)));
    const count = sides * (star ? 2 : 1);
    contours = [polygon(Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
      const radius = star && i % 2 ? Math.max(0.05, Math.min(0.95, settings.innerRatio)) : 1;
      return [0.5 + Math.cos(angle) * 0.5 * radius, 0.5 + Math.sin(angle) * 0.5 * radius];
    }))];
  } else if (settings.preset === "heart") {
    contours = [{ closed: true, anchors: [anchor(.5, .2, -.25, -.35, .25, -.35), anchor(1, .3, 0, -.3, 0, .25), anchor(.5, 1, .2, -.25, -.2, -.25), anchor(0, .3, 0, .25, 0, -.3)] }];
  } else if (settings.preset === "diamond") contours = [polygon([[.5, 0], [1, .5], [.5, 1], [0, .5]])];
  else if (settings.preset === "arrow") contours = [polygon([[0, .3], [.6, .3], [.6, 0], [1, .5], [.6, 1], [.6, .7], [0, .7]])];
  else if (settings.preset === "chevron") contours = [polygon([[0, 0], [.45, 0], [1, .5], [.45, 1], [0, 1], [.55, .5]])];
  else if (settings.preset === "cross") contours = [polygon([[.33, 0], [.67, 0], [.67, .33], [1, .33], [1, .67], [.67, .67], [.67, 1], [.33, 1], [.33, .67], [0, .67], [0, .33], [.33, .33]])];
  else if (settings.preset === "speech") contours = [polygon([[0, 0], [1, 0], [1, .75], [.45, .75], [.2, 1], [.2, .75], [0, .75]])];
  else if (settings.preset === "line") {
    const from = line?.from ?? { x: bounds.x, y: bounds.y }, to = line?.to ?? { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
    const path: PathStyle = { anchors: [anchor(from.x, from.y), anchor(to.x, to.y)], closed: false, fill: "none", stroke: settings.stroke, strokeWidth: Math.max(1, settings.strokeWidth) };
    validateVectorPath(path); return { kind: "path", path };
  } else throw new Error("Unknown shape preset");
  const mapped = mapContours(contours, bounds);
  const path: PathStyle = { ...mapped[0], contours: mapped.slice(1), fillRule, ...paint };
  validateVectorPath(path); return { kind: "path", path };
}

/** Geometry-only reusable outline; independent from effects, paint stacks and live recipes. */
export function captureCustomShape(layer: Layer, id: string): CustomShape {
  if (!/^custom-[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid shape identity");
  if (layer.parentId) throw new Error("Ungroup the vector before saving its shape");
  const source = layerVectorPath(layer), contours = documentContours(layer);
  if (contours.some(c => !c.closed || c.anchors.length < 3)) throw new Error("Custom shapes require closed vector contours; close the path first");
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const c of contours) for (const a of c.anchors) for (const [x, y] of [[a.x, a.y], [a.x + a.hIn.dx, a.y + a.hIn.dy], [a.x + a.hOut.dx, a.y + a.hOut.dy]]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (![left, top, right, bottom].every(Number.isFinite) || right - left < 1e-6 || bottom - top < 1e-6) throw new Error("Shape needs nonzero width and height");
  const normalized = mapContours(contours, { x: -left / (right - left), y: -top / (bottom - top), width: 1 / (right - left), height: 1 / (bottom - top) });
  const path: PathStyle = { ...normalized[0], contours: normalized.slice(1), fillRule: source.fillRule ?? "nonzero", fill: "#ffffff", stroke: "none", strokeWidth: 0 };
  validateVectorPath(path);
  return { id, name: (layer.name.trim() || "Custom shape").slice(0, 64), path };
}

export function encodeShapeLibrary(shapes: CustomShape[]): string {
  if (shapes.length > SHAPE_LIBRARY_LIMIT) throw new Error(`Shape library holds ${SHAPE_LIBRARY_LIMIT} presets`);
  const json = JSON.stringify({ version: 1, shapes });
  if (json.length > MAX_LIBRARY_BYTES) throw new Error("Custom shape library exceeds its storage budget");
  decodeShapeLibrary(json);
  return json;
}

export function decodeShapeLibrary(json: string | null): CustomShape[] {
  if (!json) return [];
  if (json.length > MAX_LIBRARY_BYTES) throw new Error("Custom shape library exceeds its storage budget");
  const value = JSON.parse(json);
  if (value?.version !== 1 || !Array.isArray(value.shapes) || value.shapes.length > SHAPE_LIBRARY_LIMIT) throw new Error("Invalid custom shape library");
  const ids = new Set<string>();
  return value.shapes.map((s: CustomShape) => {
    if (!s || typeof s.id !== "string" || !/^custom-[a-zA-Z0-9_-]{1,100}$/.test(s.id) || ids.has(s.id) || typeof s.name !== "string" || !s.name.trim() || s.name.length > 64 || !s.path) throw new Error("Invalid custom shape preset");
    ids.add(s.id); validateVectorPath(s.path);
    const contours = pathContours(s.path);
    if (contours.some(c => !c.closed || c.anchors.length < 3 || c.anchors.some(a => [a.x, a.y, a.hIn.dx, a.hIn.dy, a.hOut.dx, a.hOut.dy].some(n => Math.abs(n) > 2)))) throw new Error("Custom shape geometry must be normalized closed contours");
    // Keep only geometry: never restore unrelated recipes or appearance payloads.
    return { id: s.id, name: s.name, path: { ...structuredClone(contours[0]), contours: structuredClone(contours.slice(1)), fillRule: s.path.fillRule ?? "nonzero", fill: "#ffffff", stroke: "none", strokeWidth: 0 } };
  });
}
