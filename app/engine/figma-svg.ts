/**
 * Layered SVG for Figma ("Export for Figma").
 *
 * Two pure pieces, both runnable under `node --test` without a browser:
 *
 * - `serializeFigmaSvg` turns a tree of layer nodes into an SVG document with
 *   one `<g id="layer name">` per Luma layer, bottom-most first (SVG paints in
 *   document order; Luma stores index 0 as the top layer).
 * - `SvgRecordingContext` is a small CanvasRenderingContext2D stand-in. Text
 *   layers are drawn through Luma's own `drawLayerContent` into it, so line
 *   breaks, alignment, tracking and per-run styling come from the exact code
 *   that draws the PNG — there is no second text layout engine to drift.
 *   Anything it cannot express as plain SVG (clips, gradients, shadows,
 *   compositing) marks the recording unsupported and the caller flattens that
 *   layer to an image instead of guessing.
 */

export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
export const IDENTITY: Readonly<Matrix> = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** CSS mix-blend-mode values SVG renderers understand. */
export type CssBlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
  | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference"
  | "exclusion" | "hue" | "saturation" | "color" | "luminosity" | "plus-lighter";

export type SvgPaint = { color: string; opacity: number };

export type SvgElement =
  | { tag: "image"; x: number; y: number; width: number; height: number; href: string; matrix?: Matrix; opacity?: number; pixelated?: boolean }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx?: number; matrix?: Matrix; fill?: SvgPaint; stroke?: SvgStroke; opacity?: number }
  | { tag: "ellipse"; cx: number; cy: number; rx: number; ry: number; matrix?: Matrix; fill?: SvgPaint; stroke?: SvgStroke; opacity?: number }
  | { tag: "path"; d: string; matrix?: Matrix; fill?: SvgPaint; fillRule?: "nonzero" | "evenodd"; stroke?: SvgStroke; opacity?: number }
  | SvgTextElement;

export type SvgStroke = SvgPaint & { width: number; join?: "miter" | "round" | "bevel"; cap?: "butt" | "round" | "square"; miterLimit?: number; dash?: number[] };

export type SvgFont = { family: string; size: number; weight: number; style: "normal" | "italic" | "oblique"; smallCaps?: boolean };

export type SvgTextElement = {
  tag: "text";
  matrix?: Matrix;
  font: SvgFont;
  fill?: SvgPaint;
  stroke?: SvgStroke;
  letterSpacing?: number;
  anchor?: "start" | "middle" | "end";
  direction?: "ltr" | "rtl";
  baseline?: "auto" | "text-before-edge" | "central" | "text-after-edge" | "hanging" | "ideographic";
  kerning?: "none";
  opacity?: number;
  spans: Array<{ text: string; x: number; y: number }>;
};

export type FigmaLayerNode = {
  name: string;
  /** Luma layer kind, written as data-luma-kind for traceability. */
  kind: string;
  opacity: number;
  blend: CssBlendMode;
  /** Non-pass-through groups composite their children in isolation first. */
  isolate?: boolean;
  /** Set when the layer was flattened to pixels, with the reason. */
  flattened?: string;
  content?: SvgElement[];
  children?: FigmaLayerNode[];
};

export type FigmaSvgDocument = { width: number; height: number; title?: string };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export function xmlEscape(value: string) {
  // XML 1.0 forbids most C0 controls even as character references.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[&<>"']/g, c => ESCAPES[c]);
}

/** Short, stable, locale-independent numbers. Never exponent form, never -0. */
export function num(value: number, digits = 4): string {
  if (!Number.isFinite(value)) throw new Error("Non-finite coordinate in SVG export");
  const rounded = Number(value.toFixed(digits));
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  const text = rounded.toFixed(digits).replace(/\.?0+$/, "");
  return text;
}

export function isIdentity(m?: Matrix) {
  return !m || (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0);
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

function transformAttr(m?: Matrix) {
  if (isIdentity(m)) return "";
  const t = m!;
  if (t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1) return ` transform="translate(${num(t.e)} ${num(t.f)})"`;
  return ` transform="matrix(${num(t.a, 6)} ${num(t.b, 6)} ${num(t.c, 6)} ${num(t.d, 6)} ${num(t.e)} ${num(t.f)})"`;
}

/**
 * Parse a CSS color into an SVG-1.1-safe hex value plus a separate opacity.
 * rgba()/8-digit hex are not universally understood by SVG importers.
 */
export function svgColor(input: string): SvgPaint | null {
  const value = input.trim().toLowerCase();
  if (!value || value === "none" || value === "transparent") return null;
  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map(c => c + c).join("");
    if (digits.length !== 6 && digits.length !== 8) throw new Error(`Unsupported color: ${input}`);
    const alpha = digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1;
    return { color: `#${digits.slice(0, 6)}`, opacity: alpha };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/)
    ?? value.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/);
  if (rgb) {
    const channel = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v))));
    const alphaText = rgb[4];
    const alpha = alphaText === undefined ? 1 : alphaText.endsWith("%") ? Number(alphaText.slice(0, -1)) / 100 : Number(alphaText);
    const hexValue = [rgb[1], rgb[2], rgb[3]].map(v => channel(v).toString(16).padStart(2, "0")).join("");
    return { color: `#${hexValue}`, opacity: Math.max(0, Math.min(1, alpha)) };
  }
  if (/^[a-z]+$/.test(value)) return { color: value, opacity: 1 };
  throw new Error(`Unsupported color: ${input}`);
}

function paintAttrs(kind: "fill" | "stroke", paint?: SvgPaint) {
  if (!paint) return ` ${kind}="none"`;
  return ` ${kind}="${xmlEscape(paint.color)}"${paint.opacity < 1 ? ` ${kind}-opacity="${num(paint.opacity)}"` : ""}`;
}

function strokeAttrs(stroke?: SvgStroke, defaults: { join?: string; cap?: string } = {}) {
  if (!stroke) return "";
  let out = paintAttrs("stroke", stroke) + ` stroke-width="${num(stroke.width)}"`;
  if (stroke.join && stroke.join !== (defaults.join ?? "miter")) out += ` stroke-linejoin="${stroke.join}"`;
  if (stroke.cap && stroke.cap !== (defaults.cap ?? "butt")) out += ` stroke-linecap="${stroke.cap}"`;
  if (stroke.miterLimit !== undefined && stroke.miterLimit !== 4 && (stroke.join ?? "miter") === "miter") out += ` stroke-miterlimit="${num(stroke.miterLimit)}"`;
  if (stroke.dash?.length) out += ` stroke-dasharray="${stroke.dash.map(v => num(v)).join(" ")}"`;
  return out;
}

function opacityAttr(opacity?: number) {
  return opacity !== undefined && opacity < 1 ? ` opacity="${num(Math.max(0, opacity))}"` : "";
}

function fontFamilyAttr(family: string) {
  // Keep the whole CSS family list: Figma uses the first family it knows,
  // browsers fall back through the rest exactly like Luma's canvas does.
  return xmlEscape(family.trim());
}

function serializeElement(element: SvgElement): string {
  switch (element.tag) {
    case "image":
      return `<image x="${num(element.x)}" y="${num(element.y)}" width="${num(element.width)}" height="${num(element.height)}"${transformAttr(element.matrix)}${opacityAttr(element.opacity)} preserveAspectRatio="none"${element.pixelated ? ' style="image-rendering:pixelated"' : ""} xlink:href="${xmlEscape(element.href)}"/>`;
    case "rect":
      return `<rect x="${num(element.x)}" y="${num(element.y)}" width="${num(element.width)}" height="${num(element.height)}"${element.rx ? ` rx="${num(element.rx)}"` : ""}${transformAttr(element.matrix)}${opacityAttr(element.opacity)}${paintAttrs("fill", element.fill)}${strokeAttrs(element.stroke)}/>`;
    case "ellipse":
      return `<ellipse cx="${num(element.cx)}" cy="${num(element.cy)}" rx="${num(element.rx)}" ry="${num(element.ry)}"${transformAttr(element.matrix)}${opacityAttr(element.opacity)}${paintAttrs("fill", element.fill)}${strokeAttrs(element.stroke)}/>`;
    case "path":
      return `<path d="${xmlEscape(element.d)}"${transformAttr(element.matrix)}${opacityAttr(element.opacity)}${paintAttrs("fill", element.fill)}${element.fill && element.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""}${strokeAttrs(element.stroke)}/>`;
    case "text": {
      const f = element.font;
      const styles: string[] = [];
      if (element.kerning === "none") styles.push("font-kerning:none");
      if (f.smallCaps) styles.push("font-variant-caps:small-caps");
      const attrs = [
        `font-family="${fontFamilyAttr(f.family)}"`,
        `font-size="${num(f.size)}"`,
        f.weight !== 400 ? `font-weight="${Math.round(f.weight)}"` : "",
        f.style !== "normal" ? `font-style="${f.style}"` : "",
        element.letterSpacing ? `letter-spacing="${num(element.letterSpacing)}"` : "",
        element.anchor && element.anchor !== "start" ? `text-anchor="${element.anchor}"` : "",
        element.direction === "rtl" ? 'direction="rtl" unicode-bidi="embed"' : "",
        element.baseline && element.baseline !== "auto" ? `dominant-baseline="${element.baseline}"` : "",
      ].filter(Boolean).join(" ");
      const spans = element.spans.length === 1
        ? ""
        : element.spans.map(span => `<tspan x="${num(span.x)}" y="${num(span.y)}">${xmlEscape(span.text)}</tspan>`).join("");
      const first = element.spans[0];
      const position = element.spans.length === 1 ? ` x="${num(first.x)}" y="${num(first.y)}"` : "";
      return `<text xml:space="preserve"${position} ${attrs}${transformAttr(element.matrix)}${opacityAttr(element.opacity)}${paintAttrs("fill", element.fill)}${strokeAttrs(element.stroke)}${styles.length ? ` style="${styles.join(";")}"` : ""}>${element.spans.length === 1 ? xmlEscape(first.text) : spans}</text>`;
    }
  }
}

/** Figma names imported layers after `id`. Keep names readable and unique. */
export function uniqueLayerIds(nodes: FigmaLayerNode[]) {
  const used = new Map<string, number>();
  const ids = new Map<FigmaLayerNode, string>();
  const visit = (node: FigmaLayerNode) => {
    const base = node.name.replace(/[\u0000-\u001f]/g, " ").trim() || "Layer";
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    let id = count === 1 ? base : `${base} ${count}`;
    while (count > 1 && used.has(id)) id += "′";
    if (count > 1) used.set(id, 1);
    ids.set(node, id);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/**
 * Serialize layer nodes (top-most first, Luma order) into an SVG document.
 * Element order in the output is bottom-most first so the stacking matches.
 */
export function serializeFigmaSvg(doc: FigmaSvgDocument, layers: FigmaLayerNode[]): string {
  if (!(doc.width > 0 && doc.height > 0)) throw new Error("Invalid document size");
  const ids = uniqueLayerIds(layers);
  const usesImages = JSON.stringify(layers, (key, value) => key === "href" ? "" : value).includes('"tag":"image"');
  const node = (layer: FigmaLayerNode): string => {
    const style: string[] = [];
    if (layer.blend !== "normal") style.push(`mix-blend-mode:${layer.blend}`);
    if (layer.isolate) style.push("isolation:isolate");
    const attrs = `id="${xmlEscape(ids.get(layer)!)}" data-luma-kind="${xmlEscape(layer.kind)}"${layer.flattened ? ` data-luma-flattened="${xmlEscape(layer.flattened)}"` : ""}${opacityAttr(layer.opacity)}${style.length ? ` style="${style.join(";")}"` : ""}`;
    const inner = (layer.content ?? []).map(serializeElement).join("")
      + [...(layer.children ?? [])].reverse().map(node).join("");
    return `<g ${attrs}>${inner}</g>`;
  };
  const body = [...layers].reverse().map(node).join("\n");
  const title = doc.title ? `<title>${xmlEscape(doc.title)}</title>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg"${usesImages ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ""} version="1.1" width="${num(doc.width)}" height="${num(doc.height)}" viewBox="0 0 ${num(doc.width)} ${num(doc.height)}">`
    + `${title}<desc>Exported from Luma for Figma: one group per layer, bottom layer first.</desc>\n${body}\n</svg>\n`;
}

// ---------------------------------------------------------------------------
// Recording context

/** Thrown internally; the recording is then reported as unsupported. */
class Unsupported extends Error {}

type DrawState = {
  matrix: Matrix;
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  miterLimit: number;
  lineDash: number[];
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  direction: CanvasDirection;
  letterSpacing: string;
  wordSpacing: string;
  fontKerning: CanvasFontKerning;
  fontVariantCaps: CanvasFontVariantCaps;
  fontStretch: CanvasFontStretch;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  globalCompositeOperation: GlobalCompositeOperation;
  filter: string;
  imageSmoothingEnabled: boolean;
};

const BASE_STATE: DrawState = {
  matrix: { ...IDENTITY },
  globalAlpha: 1,
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineJoin: "miter",
  lineCap: "butt",
  miterLimit: 10,
  lineDash: [],
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  direction: "inherit",
  letterSpacing: "0px",
  wordSpacing: "0px",
  fontKerning: "auto",
  fontVariantCaps: "normal",
  fontStretch: "normal",
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  globalCompositeOperation: "source-over",
  filter: "none",
  imageSmoothingEnabled: true,
};

/** Parse a canvas font shorthand ("italic 700 96px Inter, sans-serif"). */
export function parseCanvasFont(font: string): SvgFont {
  const match = font.match(/^(.*?)(?:^|\s)(\d+(?:\.\d+)?)px(?:\s*\/\s*\S+)?\s+(.+)$/);
  if (!match) throw new Unsupported(`Unrecognised font: ${font}`);
  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  let weight = 400;
  let style: SvgFont["style"] = "normal";
  let smallCaps = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "italic" || lower === "oblique") style = lower;
    else if (lower === "small-caps") smallCaps = true;
    else if (lower === "bold" || lower === "bolder") weight = 700;
    else if (lower === "lighter") weight = 300;
    else if (/^\d{1,4}(?:\.\d+)?$/.test(lower)) weight = Number(lower);
  }
  return { family: match[3].trim(), size: Number(match[2]), weight, style, ...(smallCaps ? { smallCaps } : {}) };
}

type Point = { x: number; y: number };
type PathSegment = { type: "M"; p: Point } | { type: "L"; p: Point } | { type: "C"; c1: Point; c2: Point; p: Point } | { type: "Z" };

const apply = (m: Matrix, x: number, y: number): Point => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

/**
 * Records a subset of CanvasRenderingContext2D as SVG elements.
 *
 * `measure` supplies real text metrics (a browser or Node canvas context);
 * the recorder mirrors its text state onto it before measuring so line
 * wrapping decisions are made with the same font engine as the PNG export.
 */
export class SvgRecordingContext {
  readonly elements: SvgElement[] = [];
  unsupported: string | null = null;
  private state: DrawState = { ...BASE_STATE, matrix: { ...IDENTITY }, lineDash: [] };
  private stack: DrawState[] = [];
  private path: PathSegment[] = [];
  private measureContext: CanvasRenderingContext2D | null;
  readonly canvas: { width: number; height: number };

  constructor(measureContext: CanvasRenderingContext2D | null, size: { width: number; height: number } = { width: 1, height: 1 }) {
    this.measureContext = measureContext;
    this.canvas = size;
  }

  /** Note the first unsupported operation; drawing continues harmlessly. */
  private refuse(reason: string) {
    this.unsupported ??= reason;
  }

  // --- state -------------------------------------------------------------
  get globalAlpha() { return this.state.globalAlpha; }
  set globalAlpha(v: number) { if (Number.isFinite(v) && v >= 0 && v <= 1) this.state.globalAlpha = v; }
  get fillStyle() { return this.state.fillStyle as string; }
  set fillStyle(v: unknown) { this.state.fillStyle = v; }
  get strokeStyle() { return this.state.strokeStyle as string; }
  set strokeStyle(v: unknown) { this.state.strokeStyle = v; }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(v: number) { if (Number.isFinite(v) && v > 0) this.state.lineWidth = v; }
  get lineJoin() { return this.state.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.state.lineJoin = v; }
  get lineCap() { return this.state.lineCap; }
  set lineCap(v: CanvasLineCap) { this.state.lineCap = v; }
  get miterLimit() { return this.state.miterLimit; }
  set miterLimit(v: number) { if (Number.isFinite(v) && v > 0) this.state.miterLimit = v; }
  get font() { return this.state.font; }
  set font(v: string) { this.state.font = v; }
  get textAlign() { return this.state.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.state.textAlign = v; }
  get textBaseline() { return this.state.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.state.textBaseline = v; }
  get direction() { return this.state.direction; }
  set direction(v: CanvasDirection) { this.state.direction = v; }
  get letterSpacing() { return this.state.letterSpacing; }
  set letterSpacing(v: string) { this.state.letterSpacing = v; }
  get wordSpacing() { return this.state.wordSpacing; }
  set wordSpacing(v: string) { this.state.wordSpacing = v; }
  get fontKerning() { return this.state.fontKerning; }
  set fontKerning(v: CanvasFontKerning) { this.state.fontKerning = v; }
  get fontVariantCaps() { return this.state.fontVariantCaps; }
  set fontVariantCaps(v: CanvasFontVariantCaps) { this.state.fontVariantCaps = v; }
  get fontStretch() { return this.state.fontStretch; }
  set fontStretch(v: CanvasFontStretch) { this.state.fontStretch = v; }
  get shadowColor() { return this.state.shadowColor; }
  set shadowColor(v: string) { this.state.shadowColor = v; }
  get shadowBlur() { return this.state.shadowBlur; }
  set shadowBlur(v: number) { this.state.shadowBlur = v; }
  get shadowOffsetX() { return this.state.shadowOffsetX; }
  set shadowOffsetX(v: number) { this.state.shadowOffsetX = v; }
  get shadowOffsetY() { return this.state.shadowOffsetY; }
  set shadowOffsetY(v: number) { this.state.shadowOffsetY = v; }
  get globalCompositeOperation() { return this.state.globalCompositeOperation; }
  set globalCompositeOperation(v: GlobalCompositeOperation) { this.state.globalCompositeOperation = v; }
  get filter() { return this.state.filter; }
  set filter(v: string) { this.state.filter = v; }
  get imageSmoothingEnabled() { return this.state.imageSmoothingEnabled; }
  set imageSmoothingEnabled(v: boolean) { this.state.imageSmoothingEnabled = v; }

  save() { this.stack.push({ ...this.state, matrix: { ...this.state.matrix }, lineDash: [...this.state.lineDash] }); }
  restore() { const previous = this.stack.pop(); if (previous) this.state = previous; }
  reset() { this.state = { ...BASE_STATE, matrix: { ...IDENTITY }, lineDash: [] }; this.stack = []; this.path = []; }

  // --- transforms ----------------------------------------------------------
  getTransform() { return { ...this.state.matrix, is2D: true, isIdentity: isIdentity(this.state.matrix) } as unknown as DOMMatrix; }
  setTransform(a: number | DOMMatrix2DInit = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    if (typeof a === "object") {
      const m = a as DOMMatrix2DInit;
      this.state.matrix = { a: m.a ?? m.m11 ?? 1, b: m.b ?? m.m12 ?? 0, c: m.c ?? m.m21 ?? 0, d: m.d ?? m.m22 ?? 1, e: m.e ?? m.m41 ?? 0, f: m.f ?? m.m42 ?? 0 };
    } else this.state.matrix = { a, b, c, d, e, f };
  }
  resetTransform() { this.state.matrix = { ...IDENTITY }; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { this.state.matrix = multiply(this.state.matrix, { a, b, c, d, e, f }); }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(angle: number) { const cos = Math.cos(angle), sin = Math.sin(angle); this.transform(cos, sin, -sin, cos, 0, 0); }

  // --- paths (stored in device space, like a real canvas) -----------------
  beginPath() { this.path = []; }
  moveTo(x: number, y: number) { this.path.push({ type: "M", p: apply(this.state.matrix, x, y) }); }
  lineTo(x: number, y: number) {
    if (!this.path.length) { this.moveTo(x, y); return; }
    this.path.push({ type: "L", p: apply(this.state.matrix, x, y) });
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const m = this.state.matrix;
    if (!this.path.length) this.moveTo(c1x, c1y);
    this.path.push({ type: "C", c1: apply(m, c1x, c1y), c2: apply(m, c2x, c2y), p: apply(m, x, y) });
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const last = this.currentPoint();
    if (!last) { this.moveTo(cx, cy); }
    const inverse = invert(this.state.matrix);
    const start = last && inverse ? apply(inverse, last.x, last.y) : { x: cx, y: cy };
    this.bezierCurveTo(
      start.x + (2 / 3) * (cx - start.x), start.y + (2 / 3) * (cy - start.y),
      x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y,
    );
  }
  closePath() { if (this.path.length) this.path.push({ type: "Z" }); }
  rect(x: number, y: number, w: number, h: number) {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath();
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, end: number, counterclockwise = false) {
    // Cubic approximation in local space, then mapped through the current
    // matrix: an affine map of a Bézier is exact, so only the arc fit errs.
    let sweep = end - start;
    if (!counterclockwise && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
    if (counterclockwise && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(end - start) >= 2 * Math.PI) sweep = counterclockwise ? -2 * Math.PI : 2 * Math.PI;
    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / segments;
    const k = (4 / 3) * Math.tan(step / 4);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const point = (t: number, dx = 0, dy = 0) => {
      const x = rx * Math.cos(t) + dx, y = ry * Math.sin(t) + dy;
      return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
    };
    const first = point(start);
    if (this.path.length) this.lineTo(first.x, first.y); else this.moveTo(first.x, first.y);
    for (let i = 0; i < segments; i++) {
      const t0 = start + i * step, t1 = t0 + step;
      // Tangent-scaled handles: P0 + k·P'(t0) and P1 − k·P'(t1).
      const c1 = point(t0, -k * rx * Math.sin(t0), k * ry * Math.cos(t0));
      const c2 = point(t1, k * rx * Math.sin(t1), -k * ry * Math.cos(t1));
      const p1 = point(t1);
      this.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p1.x, p1.y);
    }
  }
  arc(x: number, y: number, r: number, start: number, end: number, counterclockwise = false) {
    this.ellipse(x, y, r, r, 0, start, end, counterclockwise);
  }
  arcTo() { this.refuse("arcTo"); }
  roundRect() { this.refuse("roundRect"); }
  setLineDash(segments: number[]) { this.state.lineDash = segments.filter(Number.isFinite); }
  getLineDash() { return [...this.state.lineDash]; }

  private currentPoint(): Point | null {
    for (let i = this.path.length - 1; i >= 0; i--) {
      const segment = this.path[i];
      if (segment.type !== "Z") return segment.p;
      // After Z the current point is the subpath start.
      for (let j = i - 1; j >= 0; j--) if (this.path[j].type === "M") return (this.path[j] as { p: Point }).p;
    }
    return null;
  }

  /** Device-space path → local path data under the current matrix. */
  private pathData(): { d: string; matrix: Matrix } | null {
    const matrix = { ...this.state.matrix };
    const inverse = invert(matrix);
    if (!inverse || !this.path.length) return null;
    const local = (p: Point) => apply(inverse, p.x, p.y);
    const parts: string[] = [];
    for (const segment of this.path) {
      if (segment.type === "Z") { parts.push("Z"); continue; }
      if (segment.type === "C") {
        const c1 = local(segment.c1), c2 = local(segment.c2), p = local(segment.p);
        parts.push(`C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(p.x)} ${num(p.y)}`);
        continue;
      }
      const p = local(segment.p);
      parts.push(`${segment.type}${num(p.x)} ${num(p.y)}`);
    }
    return { d: parts.join(" "), matrix };
  }

  private paint(style: unknown): SvgPaint | null | undefined {
    if (typeof style !== "string") { this.refuse("gradient or pattern paint"); return undefined; }
    try { return svgColor(style); } catch { this.refuse(`color ${style}`); return undefined; }
  }

  private checkDrawable() {
    const s = this.state;
    if (s.globalCompositeOperation !== "source-over") this.refuse(`composite ${s.globalCompositeOperation}`);
    if (s.filter && s.filter !== "none") this.refuse("canvas filter");
    let shadow: SvgPaint | null = null;
    try { shadow = svgColor(s.shadowColor); } catch { shadow = { color: "#000", opacity: 1 }; }
    if (shadow && shadow.opacity > 0 && (s.shadowBlur > 0 || s.shadowOffsetX !== 0 || s.shadowOffsetY !== 0)) this.refuse("shadow");
    return this.unsupported === null;
  }

  private strokeFor(paint: SvgPaint): SvgStroke {
    const s = this.state;
    return {
      ...paint,
      width: s.lineWidth,
      join: s.lineJoin,
      cap: s.lineCap,
      miterLimit: s.miterLimit,
      ...(s.lineDash.length ? { dash: s.lineDash.length % 2 ? [...s.lineDash, ...s.lineDash] : [...s.lineDash] } : {}),
    };
  }

  fill(rule?: CanvasFillRule | Path2D) {
    if (rule !== undefined && typeof rule !== "string") { this.refuse("Path2D fill"); return; }
    if (!this.checkDrawable()) return;
    const paint = this.paint(this.state.fillStyle);
    const data = this.pathData();
    if (!paint || !data) return;
    this.elements.push({ tag: "path", d: data.d, matrix: data.matrix, fill: paint, ...(rule === "evenodd" ? { fillRule: "evenodd" as const } : {}), ...(this.state.globalAlpha < 1 ? { opacity: this.state.globalAlpha } : {}) });
  }

  stroke(path?: Path2D) {
    if (path !== undefined) { this.refuse("Path2D stroke"); return; }
    if (!this.checkDrawable()) return;
    const paint = this.paint(this.state.strokeStyle);
    const data = this.pathData();
    if (!paint || !data) return;
    this.elements.push({ tag: "path", d: data.d, matrix: data.matrix, stroke: this.strokeFor(paint), ...(this.state.globalAlpha < 1 ? { opacity: this.state.globalAlpha } : {}) });
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const saved = this.path; this.path = []; this.rect(x, y, w, h); this.fill(); this.path = saved;
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    const saved = this.path; this.path = []; this.rect(x, y, w, h); this.stroke(); this.path = saved;
  }
  clearRect() { this.refuse("clearRect"); }
  clip() { this.refuse("clip"); }
  drawImage() { this.refuse("drawImage inside vector content"); }
  getImageData(): ImageData { this.refuse("getImageData"); throw new Unsupported("getImageData"); }
  putImageData() { this.refuse("putImageData"); }
  createLinearGradient() { this.refuse("gradient"); return { addColorStop() {} } as unknown as CanvasGradient; }
  createRadialGradient() { this.refuse("gradient"); return { addColorStop() {} } as unknown as CanvasGradient; }
  createConicGradient() { this.refuse("gradient"); return { addColorStop() {} } as unknown as CanvasGradient; }
  createPattern() { this.refuse("pattern"); return null; }
  isPointInPath() { return false; }
  getContextAttributes() { return { alpha: true, colorSpace: "srgb" } as CanvasRenderingContext2DSettings; }

  // --- text --------------------------------------------------------------
  private syncMeasure() {
    const m = this.measureContext;
    if (!m) return null;
    const s = this.state;
    m.font = s.font;
    m.textAlign = s.textAlign;
    m.textBaseline = s.textBaseline;
    if ("direction" in m) m.direction = s.direction;
    if ("letterSpacing" in m) m.letterSpacing = s.letterSpacing;
    if ("wordSpacing" in m) m.wordSpacing = s.wordSpacing;
    if ("fontKerning" in m) m.fontKerning = s.fontKerning;
    if ("fontVariantCaps" in m) m.fontVariantCaps = s.fontVariantCaps;
    if ("fontStretch" in m) m.fontStretch = s.fontStretch;
    return m;
  }

  measureText(text: string): TextMetrics {
    const m = this.syncMeasure();
    if (m) return m.measureText(text);
    // Without a measuring context there is no honest width; refuse instead of
    // inventing one so the caller flattens this layer.
    this.refuse("text measurement unavailable");
    const size = (() => { try { return parseCanvasFont(this.state.font).size; } catch { return 10; } })();
    return { width: text.length * size * 0.5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size * 0.5, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2, fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 } as TextMetrics;
  }

  private textAnchor(): "start" | "middle" | "end" {
    const { textAlign, direction } = this.state;
    const rtl = direction === "rtl";
    if (textAlign === "center") return "middle";
    if (textAlign === "start") return "start";
    if (textAlign === "end") return "end";
    if (textAlign === "left") return rtl ? "end" : "start";
    return rtl ? "start" : "end";
  }

  private baseline(): SvgTextElement["baseline"] {
    switch (this.state.textBaseline) {
      case "top": return "text-before-edge";
      case "middle": return "central";
      case "bottom": return "text-after-edge";
      case "hanging": return "hanging";
      case "ideographic": return "ideographic";
      default: return "auto";
    }
  }

  private text(kind: "fill" | "stroke", text: string, x: number, y: number, maxWidth?: number) {
    if (maxWidth !== undefined) { this.refuse("fillText maxWidth"); return; }
    if (!text || !this.checkDrawable()) return;
    if (this.state.fontStretch !== "normal") { this.refuse("font-stretch"); return; }
    if (this.state.wordSpacing && parseFloat(this.state.wordSpacing) !== 0) { this.refuse("word spacing"); return; }
    let font: SvgFont;
    try { font = parseCanvasFont(this.state.font); } catch { this.refuse(`font ${this.state.font}`); return; }
    if (this.state.fontVariantCaps === "small-caps") font.smallCaps = true;
    else if (this.state.fontVariantCaps !== "normal") { this.refuse(`font-variant-caps ${this.state.fontVariantCaps}`); return; }
    const paint = this.paint(kind === "fill" ? this.state.fillStyle : this.state.strokeStyle);
    if (!paint) return;
    const spacing = parseFloat(this.state.letterSpacing) || 0;
    if (/em$/.test(this.state.letterSpacing.trim())) { this.refuse("letter-spacing in em"); return; }
    const element: SvgTextElement = {
      tag: "text",
      matrix: { ...this.state.matrix },
      font,
      ...(kind === "fill" ? { fill: paint } : { stroke: this.strokeFor(paint) }),
      ...(spacing ? { letterSpacing: spacing } : {}),
      anchor: this.textAnchor(),
      ...(this.state.direction === "rtl" ? { direction: "rtl" as const } : {}),
      baseline: this.baseline(),
      ...(this.state.fontKerning === "none" ? { kerning: "none" as const } : {}),
      ...(this.state.globalAlpha < 1 ? { opacity: this.state.globalAlpha } : {}),
      spans: [{ text, x, y }],
    };
    // Lines of one paragraph share every attribute but their position: keep
    // them in one <text> so Figma imports one editable text box, not N.
    const previous = this.elements.at(-1);
    if (previous?.tag === "text" && sameTextStyle(previous, element)) previous.spans.push({ text, x, y });
    else this.elements.push(element);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number) { this.text("fill", text, x, y, maxWidth); }
  strokeText(text: string, x: number, y: number, maxWidth?: number) { this.text("stroke", text, x, y, maxWidth); }

  /** Typed view for code that expects a real 2D context. */
  asContext() { return this as unknown as CanvasRenderingContext2D; }
}

function sameTextStyle(a: SvgTextElement, b: SvgTextElement) {
  const { spans: _a, ...restA } = a;
  const { spans: _b, ...restB } = b;
  void _a; void _b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

// ---------------------------------------------------------------------------
// Blend modes

const DIRECT_BLENDS: Record<string, CssBlendMode> = {
  "source-over": "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "linear-dodge": "plus-lighter",
};

/** Nearest CSS blend for Luma's Photoshop-only modes; reported, never silent. */
const APPROXIMATE_BLENDS: Record<string, CssBlendMode> = {
  dissolve: "normal",
  "linear-burn": "color-burn",
  "darker-color": "darken",
  "lighter-color": "lighten",
  "vivid-light": "hard-light",
  "linear-light": "hard-light",
  "pin-light": "hard-light",
  "hard-mix": "hard-light",
  subtract: "difference",
  divide: "color-dodge",
};

export function cssBlendFor(mode: string): { blend: CssBlendMode; exact: boolean } {
  if (mode in DIRECT_BLENDS) return { blend: DIRECT_BLENDS[mode], exact: true };
  return { blend: APPROXIMATE_BLENDS[mode] ?? "normal", exact: false };
}
