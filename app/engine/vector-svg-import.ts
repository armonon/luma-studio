import { DOMParser, type Element } from "@xmldom/xmldom";
import paper from "paper";
import type { PathStyle, Transform } from "./document";
import { validateVectorPath } from "./vector-path";

export const SVG_IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, nodes: 4096, depth: 32, layers: 512, anchors: 20000 } as const;
export type ImportedVector = { kind?: "path"; name: string; path: PathStyle; transform: Transform; opacity: number; importId?: string; parentId?: string };
export type ImportedGroup = { kind: "group"; name: string; path?: never; transform: Transform; opacity: number; importId: string; parentId?: string };
export type ImportedSvg = { width: number; height: number; layers: (ImportedVector | ImportedGroup)[] };
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const numberPattern = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
function numbers(value: string): number[] {
  if (value.replace(numberPattern, "").replace(/[\s,]/g, "")) throw new Error("Invalid SVG numeric list");
  const result = (value.match(numberPattern) ?? []).map(Number);
  if (result.some(n => !Number.isFinite(n) || Math.abs(n) > 1_000_000)) throw new Error("SVG numeric value exceeds the supported range");
  return result;
}
function scalar(value: string, fallback = 0) {
  if (!value) return fallback;
  const list = numbers(value.replace(/px$/, ""));
  if (list.length !== 1) throw new Error("SVG lengths must be finite pixel values");
  return list[0];
}
function multiply(l: Matrix, r: Matrix): Matrix {
  return [l[0] * r[0] + l[2] * r[1], l[1] * r[0] + l[3] * r[1], l[0] * r[2] + l[2] * r[3], l[1] * r[2] + l[3] * r[3], l[0] * r[4] + l[2] * r[5] + l[4], l[1] * r[4] + l[3] * r[5] + l[5]];
}
function parseTransform(value: string): Matrix {
  let m = identity, end = 0;
  for (const match of value.matchAll(/([A-Za-z]+)\s*\(([^()]*)\)/g)) {
    if (value.slice(end, match.index).trim().replace(/,/g, "")) throw new Error("Malformed SVG transform");
    end = match.index! + match[0].length;
    const n = numbers(match[2]); let next: Matrix;
    if (match[1] === "matrix" && n.length === 6) next = n as Matrix;
    else if (match[1] === "translate" && [1, 2].includes(n.length)) next = [1, 0, 0, 1, n[0], n[1] ?? 0];
    else if (match[1] === "scale" && [1, 2].includes(n.length)) next = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (match[1] === "rotate" && [1, 3].includes(n.length)) {
      const a = n[0] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = n[1] ?? 0, y = n[2] ?? 0;
      next = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    } else if (["skewX", "skewY"].includes(match[1]) && n.length === 1) {
      const t = Math.tan(n[0] * Math.PI / 180); next = match[1] === "skewX" ? [1, 0, t, 1, 0, 0] : [1, t, 0, 1, 0, 0];
    } else throw new Error(`Unsupported SVG transform: ${match[1]}`);
    m = multiply(m, next);
  }
  if (value.slice(end).trim()) throw new Error("Malformed SVG transform");
  return m;
}
export function layerTransform(m: Matrix): Transform {
  const [a, b, c, d, tx, ty] = m, sx = Math.hypot(a, b), sy = (a * d - b * c) / sx;
  const transform = { tx, ty, sx, sy, rotation: Math.atan2(b, a), skewX: (a * c + b * d) / (sx * sy) };
  if (Math.abs(sx) < 1e-8 || Math.abs(sy) < 1e-8 || Object.values(transform).some(n => !Number.isFinite(n) || Math.abs(n) > 1_000_000)) throw new Error("Singular or oversized SVG transform");
  return transform;
}
const presentation = new Set(["fill", "stroke", "stroke-width", "fill-rule", "fill-opacity", "stroke-opacity", "stroke-linecap", "stroke-linejoin"]);
function solid(value: string) {
  const named: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000", transparent: "none" };
  const color = named[value.toLowerCase()] ?? value;
  if (!/^(none|#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(color)) throw new Error(`Unsupported SVG paint: ${value.slice(0, 60)}. Use solid hex colors.`);
  return color;
}
function opacity(value: string) { const n = scalar(value, 1); if (n < 0 || n > 1) throw new Error("Invalid SVG opacity"); return n; }

/** Parse only an explicit editable subset. Never executes SVG or fetches resources. */
export function parseEditableSvg(source: string): ImportedSvg {
  if (source.length > SVG_IMPORT_LIMITS.bytes || new TextEncoder().encode(source).length > SVG_IMPORT_LIMITS.bytes) throw new Error("Editable SVG import is limited to 2 MiB");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("SVG document types and entities are not allowed");
  const xml = new DOMParser({ onError: (_level, message) => { throw new Error(`Malformed SVG: ${message}`); } }).parseFromString(source, "image/svg+xml");
  const root = xml.documentElement;
  if (!root || root.tagName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("Expected an SVG document with the SVG namespace");
  const view = root.getAttribute("viewBox") ? numbers(root.getAttribute("viewBox")!) : null;
  if (view && (view.length !== 4 || view[2] <= 0 || view[3] <= 0)) throw new Error("Invalid SVG viewBox");
  const width = scalar(root.getAttribute("width") ?? "", view?.[2] ?? 0), height = scalar(root.getAttribute("height") ?? "", view?.[3] ?? 0);
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 50000)) throw new Error("SVG dimensions must be whole pixels between 1 and 50,000");
  let viewport = identity;
  if (view) {
    const fit = root.getAttribute("preserveAspectRatio") || "xMidYMid meet";
    if (!["none", "xMidYMid meet", "xMidYMid"].includes(fit)) throw new Error("Unsupported SVG preserveAspectRatio");
    const sx = width / view[2], sy = height / view[3], scale = Math.min(sx, sy);
    viewport = fit === "none" ? [sx, 0, 0, sy, -view[0] * sx, -view[1] * sy] : [scale, 0, 0, scale, (width - view[2] * scale) / 2 - view[0] * scale, (height - view[3] * scale) / 2 - view[1] * scale];
  }
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(1, 1));
  let nodeCount = 0, anchorCount = 0, layerCount = 0, pathCount = 0;
  const layers: ImportedSvg["layers"] = [];
  try {
    const visit = (element: Element, inherited: Record<string, string>, parent: Matrix, depth: number, parentId?: string) => {
      if (++nodeCount > SVG_IMPORT_LIMITS.nodes || depth > SVG_IMPORT_LIMITS.depth) throw new Error("SVG structure budget exceeded");
      const tag = element.tagName;
      if (element.namespaceURI !== root.namespaceURI || !["svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "title", "desc", "metadata"].includes(tag)) throw new Error(`Unsupported SVG element: ${tag}`);
      if (tag === "svg" && depth !== 0) throw new Error("Nested SVG viewports are not supported");
      if (["title", "desc", "metadata"].includes(tag)) {
        if (element.childNodes.length > 1 || element.firstChild && element.firstChild.nodeType !== 3) throw new Error("SVG metadata must contain plain text only");
        return;
      }
      const props = { ...inherited };
      const geometry: Record<string, string[]> = { svg: ["xmlns", "width", "height", "viewBox", "preserveAspectRatio", "version"], g: [], path: ["d"], rect: ["x", "y", "width", "height", "rx", "ry"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"], polygon: ["points"], polyline: ["points"], line: ["x1", "x2", "y1", "y2"] };
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes.item(i)!;
        if (presentation.has(attr.name)) props[attr.name] = attr.value;
        else if (attr.name === "style") {
          for (const part of attr.value.split(";").filter(p => p.trim())) {
            const match = part.match(/^\s*([a-z-]+)\s*:\s*([^:]+?)\s*$/);
            if (!match || !presentation.has(match[1])) throw new Error("Unsupported SVG style; only solid paint properties are editable");
            props[match[1]] = match[2];
          }
        } else if (!["id", "transform", "opacity", ...geometry[tag]].includes(attr.name)) throw new Error(`Unsupported SVG attribute: ${attr.name}`);
      }
      const matrix = multiply(parent, parseTransform(element.getAttribute("transform") ?? ""));
      const alpha = opacity(element.getAttribute("opacity") ?? "");
      const name = () => {
        for (let child = element.firstChild; child; child = child.nextSibling) {
          if (child.nodeType === 1 && (child as Element).tagName === "title" && child.textContent?.trim()) return child.textContent.trim().slice(0, 256);
        }
        return (element.getAttribute("id") || (tag === "g" ? "SVG group" : tag)).slice(0, 256);
      };
      if (["svg", "g"].includes(tag)) {
        // Group transforms are folded into child geometry, while opacity must
        // be applied once to the complete group, never multiplied into children.
        const grouped = tag === "g" || alpha !== 1;
        const importId = grouped ? `svg-group-${nodeCount}` : undefined;
        if (grouped && ++layerCount > SVG_IMPORT_LIMITS.layers) throw new Error("SVG exceeds 512 editable layers including groups");
        for (let child = element.firstChild; child; child = child.nextSibling) {
          if (child.nodeType === 1) visit(child as Element, props, matrix, depth + 1, importId ?? parentId);
          else if (child.nodeType !== 8 && child.textContent?.trim()) throw new Error("Unexpected SVG content");
        }
        if (importId) layers.push({ kind: "group", name: name(), importId, parentId, opacity: alpha, transform: layerTransform(identity) });
        return;
      }
      if (++layerCount > SVG_IMPORT_LIMITS.layers) throw new Error("SVG exceeds 512 editable layers including groups");
      pathCount++;
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) {
          if (!["title", "desc"].includes((child as Element).tagName)) throw new Error("Geometry cannot contain nested SVG geometry");
          visit(child as Element, props, matrix, depth + 1);
        }
        else if (child.nodeType !== 8 && child.textContent?.trim()) throw new Error("Unexpected SVG path content");
      }
      const get = (key: string, fallback = 0) => scalar(element.getAttribute(key) ?? "", fallback);
      let item: paper.PathItem;
      if (tag === "path") {
        const data = element.getAttribute("d") ?? "";
        // Full lexical/arity validation before Paper parses: no ignored suffixes.
        if (data.length > 256000 || data.replace(numberPattern, "").replace(/[MmLlHhVvCcSsQqTtAaZz\s,]/g, "")) throw new Error("Invalid SVG path data");
        const commands = [...data.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)];
        if (commands.length && (commands[0][1].toLowerCase() !== "m" || data.slice(0, commands[0].index).trim()) || data.trim() && !commands.length) throw new Error("SVG paths must start with Move");
        const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
        let coordinateCount = 0;
        for (const command of commands) {
          const values = numbers(command[2]), count = arity[command[1].toLowerCase()]; coordinateCount += values.length;
          if (count ? !values.length || values.length % count : values.length) throw new Error("Incomplete SVG path command");
          if (command[1].toLowerCase() === "a") for (let i = 0; i < values.length; i += 7) if (values[i] < 0 || values[i + 1] < 0 || ![0, 1].includes(values[i + 3]) || ![0, 1].includes(values[i + 4])) throw new Error("Invalid SVG arc");
        }
        if (coordinateCount > 24576) throw new Error("SVG path complexity exceeds budget");
        item = new scope.CompoundPath({ pathData: data, insert: false });
      } else if (tag === "rect") {
        const w = get("width"), h = get("height"); if (w < 0 || h < 0 || get("rx") || get("ry")) throw new Error("SVG rounded/negative rectangles are not supported yet");
        item = new scope.Path.Rectangle({ point: [get("x"), get("y")], size: [w, h], insert: false });
      } else if (["circle", "ellipse"].includes(tag)) {
        const rx = tag === "circle" ? get("r") : get("rx"), ry = tag === "circle" ? rx : get("ry");
        if (rx < 0 || ry < 0) throw new Error("Invalid SVG ellipse radius");
        item = new scope.Path.Ellipse({ center: [get("cx"), get("cy")], radius: [rx, ry], insert: false });
      } else {
        const coords = tag === "line" ? [get("x1"), get("y1"), get("x2"), get("y2")] : numbers(element.getAttribute("points") ?? "");
        if (coords.length % 2 || coords.length > 8192) throw new Error("Invalid or oversized SVG point list");
        item = new scope.Path({ segments: Array.from({ length: coords.length / 2 }, (_, i) => [coords[2 * i], coords[2 * i + 1]]), closed: tag === "polygon", insert: false });
      }
      const paths = item instanceof scope.CompoundPath ? item.children as paper.Path[] : [item as paper.Path];
      const fill = solid(props.fill ?? "#000000"), stroke = solid(props.stroke ?? "none"), strokeWidth = scalar(props["stroke-width"] ?? "", 1);
      if (stroke !== "none" && (props["stroke-linejoin"] !== "round" || props["stroke-linecap"] !== "round")) throw new Error("Editable SVG strokes currently require round caps and joins");
      if (props["fill-rule"] && !["evenodd", "nonzero"].includes(props["fill-rule"])) throw new Error("Invalid SVG fill rule");
      const contours = paths.map(p => ({ closed: p.closed, anchors: p.segments.map(s => ({ x: s.point.x, y: s.point.y, hIn: { dx: s.handleIn.x, dy: s.handleIn.y }, hOut: { dx: s.handleOut.x, dy: s.handleOut.y } })) }));
      // SVG implicitly closes open subpaths for filling; refuse unsupported closure semantics.
      if (fill !== "none" && contours.some(c => !c.closed && c.anchors.length > 2)) throw new Error("Close SVG filled contours before importing; open filled paths are not yet supported");
      const path: PathStyle = { ...(contours[0] ?? { anchors: [], closed: false }), contours: contours.slice(1), fill, stroke, strokeWidth, fillRule: props["fill-rule"] as "evenodd" | "nonzero" || "nonzero", appearance: [{ kind: "fill", color: fill, enabled: true, opacity: opacity(props["fill-opacity"] ?? ""), width: 0 }, { kind: "stroke", color: stroke, enabled: true, opacity: opacity(props["stroke-opacity"] ?? ""), width: strokeWidth }] };
      validateVectorPath(path);
      anchorCount += contours.reduce((n, c) => n + c.anchors.length, 0);
      if (anchorCount > SVG_IMPORT_LIMITS.anchors) throw new Error("SVG exceeds the 20,000-anchor budget");
      layers.push({ name: name(), path, transform: layerTransform(matrix), opacity: alpha, parentId });
      item.remove();
    };
    visit(root, {}, viewport, 0);
    if (!pathCount) throw new Error("SVG has no supported editable geometry");
    return { width, height, layers: layers.reverse() };
  } finally { (scope as unknown as { remove(): void }).remove(); }
}
