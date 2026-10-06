/**
 * "Export for Figma": plan a Luma document as a layered SVG.
 *
 * Every visible Luma layer becomes one `<g id="layer name">`, in stacking
 * order. What each group contains depends on what SVG (and Figma's SVG
 * import) can represent faithfully:
 *
 * - raster / smart-object layers → an embedded PNG with the layer transform
 * - shape layers → real `<rect>` / `<ellipse>`; path layers → real `<path>`s
 * - text layers → `<text>` recorded from Luma's own text drawing code, or
 *   outlined `<path>`s when "Outline text" is on and the font is bundled
 * - groups → nested `<g>` with opacity and blend
 *
 * Anything SVG cannot carry faithfully (layer effects, smart filters, masks,
 * clipping, Blend If, 3D projection, adjustment layers) is flattened to an
 * image of exactly that layer, rendered by Luma's compositor, and reported.
 * Nothing visible is silently dropped.
 */
import {
  affineForLayerTransform,
  drawLayerContent,
  newCanvas,
  resolvedBlendPasses,
  resolvedBlendIf,
  resolvedFillOpacity,
  type Document,
  type Layer,
  type PathStyle,
} from "./document";
import { hasLayerMask } from "./layer-mask";
import { isNeutralBlendIf } from "./blend";
import { render } from "./renderer";
import { drawLayerContentManaged } from "./precision-renderer";
import { pathContours, traceContours, vectorPaints } from "./vector-path";
import {
  cssBlendFor,
  num,
  serializeFigmaSvg,
  svgColor,
  SvgRecordingContext,
  type CssBlendMode,
  type FigmaLayerNode,
  type Matrix,
  type SvgElement,
} from "./figma-svg";

export type FigmaExportOptions = {
  title?: string;
  /** Text layer id → outlined glyph path (layer space), computed beforehand. */
  outlines?: ReadonlyMap<string, PathStyle>;
  /** Text layer id → why outlining was not possible, for the report. */
  outlineFailures?: ReadonlyMap<string, string>;
};

export type FigmaExportReport = {
  layers: number;
  /** Layers exported as editable SVG (images, shapes, paths, text, groups). */
  editable: number;
  textAsText: number;
  textOutlined: number;
  flattened: Array<{ name: string; reason: string }>;
  approximated: Array<{ name: string; reason: string }>;
  hiddenSkipped: number;
};

const CLEAN_RENDER = { checkerboard: false, selectionOverlay: false, proofing: false, outputColorSpace: "srgb" as const };

type Context = {
  doc: Document;
  children: Map<string | undefined, Layer[]>;
  byId: Map<string, Layer>;
  report: FigmaExportReport;
  options: FigmaExportOptions;
  measure: CanvasRenderingContext2D | null;
};

function childrenMap(doc: Document) {
  const groups = new Set(doc.layers.filter(l => l.kind === "group").map(l => l.id));
  const map = new Map<string | undefined, Layer[]>();
  for (const layer of doc.layers) {
    const parent = layer.parentId && groups.has(layer.parentId) ? layer.parentId : undefined;
    const list = map.get(parent);
    if (list) list.push(layer); else map.set(parent, [layer]);
  }
  return map;
}

function descendantIds(ctx: Context, layer: Layer, into = new Set<string>()) {
  into.add(layer.id);
  for (const child of ctx.children.get(layer.id) ?? []) descendantIds(ctx, child, into);
  return into;
}

function ancestorIds(ctx: Context, layer: Layer) {
  const ids: string[] = [];
  const seen = new Set<string>();
  let parent = layer.parentId ? ctx.byId.get(layer.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    ids.push(parent.id);
    parent = parent.parentId ? ctx.byId.get(parent.parentId) : undefined;
  }
  return ids;
}

/** Why a layer can't be written as plain SVG content, or null if it can. */
export function figmaFlattenReason(layer: Layer): string | null {
  if (layer.effects?.some(e => e.enabled)) return "layer effects";
  if (layer.filters?.some(f => f.enabled)) return "smart filters";
  if (hasLayerMask(layer)) return "layer mask";
  if (layer.vectorMask) return "vector mask";
  if (layer.clipping) return "clipping mask";
  if (layer.knockout && layer.knockout !== "none") return "knockout";
  if (layer.blendChannels && !(layer.blendChannels.r && layer.blendChannels.g && layer.blendChannels.b)) return "channel-restricted blending";
  if (layer.blendIf && !isNeutralBlendIf(resolvedBlendIf(layer))) return "Blend If";
  if ((layer.spatial ?? layer.text?.spatial)?.enabled) return "3D projection";
  if (resolvedBlendPasses(layer).filter(p => p.enabled).length > 1) return "multiple blend passes";
  return null;
}

/** Opacity and CSS blend for a layer drawn as its own SVG group. */
function compositing(ctx: Context, layer: Layer, includeFill: boolean): { opacity: number; blend: CssBlendMode } {
  const passes = resolvedBlendPasses(layer).filter(p => p.enabled);
  const pass = passes[0];
  const mode = pass?.mode ?? layer.blend;
  const { blend, exact } = cssBlendFor(mode);
  if (!exact) ctx.report.approximated.push({ name: layer.name, reason: `${mode} blend written as ${blend}` });
  else if (passes.length > 1) ctx.report.approximated.push({ name: layer.name, reason: "only the first blend pass is kept" });
  const opacity = layer.opacity * (pass?.opacity ?? 1) * (includeFill ? resolvedFillOpacity(layer) : 1);
  return { opacity: Math.max(0, Math.min(1, opacity)), blend };
}

/**
 * Render a subset of the document with Luma's compositor: only `include`
 * layers stay visible, and `neutral` layers (the target and its ancestor
 * groups) lose their own opacity/blend because the SVG group re-applies them.
 * Mutations are synchronous and always restored.
 */
function renderSubset(ctx: Context, include: Set<string>, neutral: Set<string>) {
  const saved = ctx.doc.layers.map(l => ({ l, visible: l.visible, opacity: l.opacity, blend: l.blend, blendStack: l.blendStack, fillOpacity: l.fillOpacity }));
  try {
    for (const layer of ctx.doc.layers) {
      if (!include.has(layer.id)) layer.visible = false;
      if (neutral.has(layer.id)) {
        layer.opacity = 1;
        layer.blend = "source-over";
        layer.blendStack = undefined;
        if (layer.kind === "group") layer.fillOpacity = undefined;
      }
    }
    const canvas = newCanvas(ctx.doc.width, ctx.doc.height);
    render(ctx.doc, canvas, CLEAN_RENDER);
    return canvas;
  } finally {
    for (const entry of saved) {
      entry.l.visible = entry.visible;
      entry.l.opacity = entry.opacity;
      entry.l.blend = entry.blend;
      entry.l.blendStack = entry.blendStack;
      entry.l.fillOpacity = entry.fillOpacity;
    }
  }
}

/** Crop a canvas to its non-transparent pixels and encode as a PNG data URL. */
function croppedImage(canvas: HTMLCanvasElement): { x: number; y: number; width: number; height: number; href: string } | null {
  const { width, height } = canvas;
  const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  let source = canvas;
  if (w !== width || h !== height) {
    source = newCanvas(w, h);
    source.getContext("2d")!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  }
  return { x: minX, y: minY, width: w, height: h, href: source.toDataURL("image/png") };
}

function flattenedNode(ctx: Context, layer: Layer, reason: string, ids: Set<string>, name = layer.name): FigmaLayerNode | null {
  const neutral = new Set([layer.id, ...ancestorIds(ctx, layer)]);
  const include = new Set([...ids, ...neutral]);
  const image = croppedImage(renderSubset(ctx, include, neutral));
  ctx.report.flattened.push({ name, reason });
  if (!image) return null;
  const { opacity, blend } = compositing(ctx, layer, false);
  return { name, kind: layer.kind, opacity, blend, flattened: reason, content: [{ tag: "image", ...image }] };
}

function rasterNode(ctx: Context, layer: Layer): FigmaLayerNode | null {
  const width = layer.bitmap?.width ?? layer.surface?.grid.width ?? 0;
  const height = layer.bitmap?.height ?? layer.surface?.grid.height ?? 0;
  if (!width || !height) return null;
  // Local (untransformed) pixels through the same drawing path the compositor
  // uses, so tile-backed high-depth layers export their real content.
  const local = newCanvas(width, height);
  drawLayerContentManaged(local.getContext("2d")!, { ...layer, transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0, skewX: 0 }, spatial: undefined });
  const image = croppedImage(local);
  if (!image) return null;
  const { opacity, blend } = compositing(ctx, layer, true);
  return { name: layer.name, kind: layer.kind, opacity, blend, content: [{ tag: "image", ...image, matrix: affineForLayerTransform(layer.transform) }] };
}

function contourData(contours: ReturnType<typeof pathContours>) {
  const out: string[] = [];
  traceContours({
    moveTo: (x, y) => { out.push(`M${num(x)} ${num(y)}`); },
    bezierCurveTo: (a, b, c, d, x, y) => { out.push(`C${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(x)} ${num(y)}`); },
    closePath: () => { out.push("Z"); },
  }, contours);
  return out.join(" ");
}

function pathElements(path: PathStyle, matrix: Matrix): SvgElement[] {
  const elements: SvgElement[] = [];
  const contours = pathContours(path);
  if (!contours.some(c => c.anchors.length >= 2)) return elements;
  for (const paint of vectorPaints(path)) {
    if (!paint.enabled || paint.opacity === 0 || !paint.color) continue;
    const color = svgColor(paint.color);
    if (!color) continue;
    if (paint.kind === "fill") {
      const d = contourData(contours.filter(c => c.closed));
      if (!d) continue;
      elements.push({ tag: "path", d, matrix, fill: color, ...(path.fillRule === "evenodd" ? { fillRule: "evenodd" as const } : {}), ...(paint.opacity < 1 ? { opacity: paint.opacity } : {}) });
    } else if (paint.width > 0) {
      elements.push({ tag: "path", d: contourData(contours), matrix, stroke: { ...color, width: paint.width, join: "round", cap: "round" }, ...(paint.opacity < 1 ? { opacity: paint.opacity } : {}) });
    }
  }
  return elements;
}

function shapeElements(layer: Layer, matrix: Matrix): SvgElement[] {
  const s = layer.shape!;
  const fill = s.fill && s.fill !== "none" ? svgColor(s.fill) ?? undefined : undefined;
  const strokeColor = s.stroke && s.strokeWidth > 0 ? svgColor(s.stroke) : null;
  // Canvas defaults the shape renderer relies on: miter joins, limit 10.
  const stroke = strokeColor ? { ...strokeColor, width: s.strokeWidth, join: "miter" as const, miterLimit: 10 } : undefined;
  if (!fill && !stroke) return [];
  if (s.kind === "rect") {
    const x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h), w = Math.abs(s.w), h = Math.abs(s.h);
    const rx = Math.max(0, Math.min(s.radius, Math.min(s.w, s.h) / 2));
    return [{ tag: "rect", x, y, width: w, height: h, ...(rx > 0 ? { rx } : {}), matrix, fill, stroke }];
  }
  return [{ tag: "ellipse", cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: Math.abs(s.w) / 2, ry: Math.abs(s.h) / 2, matrix, fill, stroke }];
}

function vectorNode(ctx: Context, layer: Layer): FigmaLayerNode | null {
  const matrix = affineForLayerTransform(layer.transform);
  let content: SvgElement[];
  try {
    content = layer.kind === "shape" ? shapeElements(layer, matrix) : pathElements(layer.path!, matrix);
  } catch (error) {
    return flattenedNode(ctx, layer, error instanceof Error ? error.message : "unsupported paint", descendantIds(ctx, layer));
  }
  if (!content.length) return null;
  const { opacity, blend } = compositing(ctx, layer, true);
  return { name: layer.name, kind: layer.kind, opacity, blend, content };
}

function textNode(ctx: Context, layer: Layer): FigmaLayerNode | null {
  const matrix = affineForLayerTransform(layer.transform);
  const outline = ctx.options.outlines?.get(layer.id);
  if (outline) {
    const content = pathElements(outline, matrix);
    if (content.length) {
      ctx.report.textOutlined += 1;
      const { opacity, blend } = compositing(ctx, layer, true);
      return { name: layer.name, kind: "text", opacity, blend, content };
    }
  }
  const failure = ctx.options.outlineFailures?.get(layer.id);
  if (failure) ctx.report.approximated.push({ name: layer.name, reason: `kept as live text: ${failure}` });
  const recorder = new SvgRecordingContext(ctx.measure);
  try {
    drawLayerContent(recorder.asContext(), layer);
  } catch (error) {
    recorder.unsupported ??= error instanceof Error ? error.message : "text drawing failed";
  }
  if (recorder.unsupported) return flattenedNode(ctx, layer, `text styling SVG can't hold (${recorder.unsupported})`, descendantIds(ctx, layer));
  if (!recorder.elements.length) return null;
  ctx.report.textAsText += 1;
  const { opacity, blend } = compositing(ctx, layer, true);
  return { name: layer.name, kind: "text", opacity, blend, content: recorder.elements };
}

function layerNode(ctx: Context, layer: Layer): FigmaLayerNode | null {
  const reason = figmaFlattenReason(layer);
  if (layer.kind === "group") {
    if (reason) return flattenedNode(ctx, layer, reason, descendantIds(ctx, layer));
    const children = levelNodes(ctx, layer.id);
    if (!children.length) return null;
    const { opacity, blend } = compositing(ctx, layer, true);
    const passThrough = opacity === 1 && blend === "normal";
    return { name: layer.name, kind: "group", opacity, blend, isolate: !passThrough, children };
  }
  if (reason) return flattenedNode(ctx, layer, reason, descendantIds(ctx, layer));
  if (layer.kind === "raster" || layer.kind === "smart-object") return rasterNode(ctx, layer);
  if (layer.kind === "shape" && layer.shape) return vectorNode(ctx, layer);
  if (layer.kind === "path" && layer.path) return vectorNode(ctx, layer);
  if (layer.kind === "text" && layer.text) return textNode(ctx, layer);
  return null;
}

/** Nodes for one sibling level, top-most first (Luma order). */
function levelNodes(ctx: Context, parentId: string | undefined): FigmaLayerNode[] {
  const siblings = ctx.children.get(parentId) ?? [];
  // Walk bottom-up so an adjustment can absorb what is already beneath it.
  const below: Array<{ node: FigmaLayerNode; ids: Set<string> }> = [];
  for (let i = siblings.length - 1; i >= 0; i--) {
    const layer = siblings[i];
    if (!layer.visible || layer.opacity <= 0) { ctx.report.hiddenSkipped += 1; continue; }
    ctx.report.layers += 1;
    if (layer.kind.startsWith("adjustment-")) {
      // SVG has no adjustment layers. Keep the look: merge the adjustment with
      // the layers it changes (everything below it at this level).
      const ids = new Set<string>([layer.id]);
      for (const entry of below) for (const id of entry.ids) ids.add(id);
      const name = `${layer.name} (merged with layers below)`;
      const neutral = new Set(ancestorIds(ctx, layer));
      const image = croppedImage(renderSubset(ctx, new Set([...ids, ...neutral]), neutral));
      ctx.report.flattened.push({ name: layer.name, reason: `adjustment layer merged with ${below.length} layer${below.length === 1 ? "" : "s"} below` });
      below.length = 0;
      if (image) below.push({ node: { name, kind: layer.kind, opacity: 1, blend: "normal", flattened: "adjustment layer", content: [{ tag: "image", ...image }] }, ids });
      continue;
    }
    const node = layerNode(ctx, layer);
    if (node) below.push({ node, ids: descendantIds(ctx, layer) });
  }
  return below.map(entry => entry.node).reverse();
}

function countEditable(nodes: FigmaLayerNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.flattened ? 0 : 1) + countEditable(node.children ?? []), 0);
}

/** Build the SVG. Synchronous: the document must not change while it runs. */
export function buildFigmaSvg(doc: Document, options: FigmaExportOptions = {}): { svg: string; report: FigmaExportReport } {
  const report: FigmaExportReport = { layers: 0, editable: 0, textAsText: 0, textOutlined: 0, flattened: [], approximated: [], hiddenSkipped: 0 };
  let measure: CanvasRenderingContext2D | null = null;
  try { measure = newCanvas(1, 1).getContext("2d"); } catch { measure = null; }
  const ctx: Context = { doc, children: childrenMap(doc), byId: new Map(doc.layers.map(l => [l.id, l])), report, options, measure };
  const nodes = levelNodes(ctx, undefined);
  report.editable = countEditable(nodes);
  return { svg: serializeFigmaSvg({ width: doc.width, height: doc.height, title: options.title }, nodes), report };
}
