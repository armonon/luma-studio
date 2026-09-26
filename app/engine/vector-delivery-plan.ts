import { affineForLayerTransform, findClippingBase, resolvedBlendPasses, type Document, type Layer, type PathStyle } from "./document";
import { pathContours, validateVectorPath, vectorPaints, VECTOR_LIMITS } from "./vector-path";
import { documentContours, layerVectorPath } from "./vector-delivery";
import { planAlphaDelivery, VECTOR_ALPHA_LIMITS, type AlphaDelivery } from "./vector-alpha-delivery";

export type VectorDeliveryFormat = "svg" | "pdf";
export type DeliveryIssue = {
  code: string; classification: "A" | "B" | "C"; layerId?: string;
  objectName: string; layerPath: string; reason: string; conversion: string; impact: string;
};
export type VectorDeliveryReport = {
  format: VectorDeliveryFormat; canExport: boolean; status: "Fully editable" | "Export blocked";
  issues: DeliveryIssue[]; objectCount: number; anchorCount: number;
};
export type VectorDeliveryNode = {
  layer: Layer; path?: PathStyle; children: VectorDeliveryNode[];
  /** Geometry is already in document coordinates; group transforms are baked into children. */
  mask?: PathStyle;
  /** Opaque vector clipping-base geometry in document coordinates. */
  clip?: PathStyle;
  /** Raw vector-base alpha, without its masks, effects or master opacity. */
  clipContent?: VectorDeliveryNode;
  alpha?: AlphaDelivery;
  compositeOpacity?: number;
  synthetic?: boolean;
};

/** Shared writer/preflight admission. No pixels, mutation, or document-sized allocation. */
export function planVectorDelivery(doc: Document, format: VectorDeliveryFormat, selected?: Layer[]) {
  const issues: DeliveryIssue[] = [], byId = new Map<string, Layer>();
  const report: VectorDeliveryReport = { format, canExport: false, status: "Export blocked", issues, objectCount: 0, anchorCount: 0 };
  const nodes: VectorDeliveryNode[] = [];
  let alphaRecords = 0, alphaBytes = 0;
  const issue = (code: string, reason: string, layer?: Layer, classification: DeliveryIssue["classification"] = "B", conversion = "Prepare a separate delivery copy or keep the editable .luma master.", impact = "Export is blocked; nothing is silently omitted or flattened.") => {
    const names = layer ? [layer.name] : ["Document"], seen = new Set<string>();
    let parent = layer?.parentId;
    while (parent && !seen.has(parent) && seen.size < 32) { seen.add(parent); const p = byId.get(parent); if (!p) break; names.unshift(p.name); parent = p.parentId; }
    issues.push({ code, classification, layerId: layer?.id, objectName: layer?.name ?? "Document", layerPath: names.join(" / "), reason, conversion, impact });
  };
  if (doc.layers.length > VECTOR_LIMITS.layers) {
    issue("LAYER_BUDGET", `Vector delivery is bounded to ${VECTOR_LIMITS.layers} document layers.`);
    return { nodes, report };
  }
  for (const layer of doc.layers) {
    if (!layer.id || byId.has(layer.id)) issue("INVALID_TREE", "Duplicate or empty layer identity.", layer);
    byId.set(layer.id, layer);
  }
  if (![doc.width, doc.height].every(n => Number.isSafeInteger(n) && n > 0)) issue("DIMENSIONS", "Document dimensions must be positive whole pixels.");
  if (doc.colorSpace !== "srgb" || doc.bitDepth !== 8) issue("COLOR_DEPTH", "Vector delivery currently supports sRGB / 8-bit documents only; no profile or depth conversion is implied.", undefined, "B", "Explicitly convert a duplicate document; retain the original high-depth/profile master.", "Conversion changes color interpretation or sample precision.");
  if (format === "pdf") {
    const width = doc.width * 72 / doc.resolution.x, height = doc.height * 72 / doc.resolution.y;
    if (![width, height].every(n => Number.isFinite(n) && n > 0) || Math.max(width, height) > 14400) issue("PDF_PAGE", "PDF page exceeds the supported 200-inch boundary. Increase document PPI or export SVG.");
  }
  const children = new Map<string | undefined, Layer[]>();
  for (const layer of doc.layers) {
    const parent = layer.parentId ? byId.get(layer.parentId) : undefined;
    if (layer.parentId !== undefined && (!layer.parentId || parent?.kind !== "group")) issue("INVALID_TREE", "Layer parent is empty, missing or is not a group.", layer);
    const seen = new Set([layer.id]); let ancestor = parent;
    while (ancestor) {
      if (seen.has(ancestor.id) || seen.size > 32) { issue("INVALID_TREE", "Layer hierarchy is cyclic or exceeds 32 levels.", layer); break; }
      seen.add(ancestor.id); ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    const siblings = children.get(layer.parentId) ?? []; siblings.push(layer); children.set(layer.parentId, siblings);
  }
  if (issues.some(i => i.code === "INVALID_TREE")) return { nodes, report };
  // A selection retains its ancestors (opacity/masks) and selected group descendants.
  const included = selected ? new Set<string>() : null;
  if (included) {
    const expanded = new Set<string>();
    const descendants = (layer: Layer) => { if (expanded.has(layer.id)) return; expanded.add(layer.id); included.add(layer.id); for (const child of children.get(layer.id) ?? []) descendants(child); };
    for (const selectedLayer of selected!) {
      const layer = byId.get(selectedLayer.id);
      if (layer !== selectedLayer) { issue("STALE_SELECTION", "Selected layer no longer belongs to this document.", selectedLayer); continue; }
      descendants(layer); let parent = layer.parentId;
      while (parent) { included.add(parent); parent = byId.get(parent)?.parentId; }
    }
  }
  const budget = format === "pdf" ? 10000 : 100000;
  const countPath = (path: PathStyle) => {
    validateVectorPath(path);
    report.anchorCount += pathContours(path).reduce((n, c) => n + c.anchors.length, 0);
    if (report.anchorCount > budget) throw new Error(`${format.toUpperCase()} delivery exceeds the ${budget.toLocaleString("en-US")}-anchor budget (including masks).`);
  };
  const visit = (parent?: string): VectorDeliveryNode[] => (children.get(parent) ?? []).filter(l => l.visible && (!included || included.has(l.id))).slice().reverse().map(layer => {
    report.objectCount++;
    const node: VectorDeliveryNode = { layer, children: [] };
    // Once admission fails, do not keep cloning geometry for the remainder of
    // a long stack. Continue counting/navigating objects without retaining it.
    if (report.anchorCount > budget) {
      if (layer.kind === "group") node.children = visit(layer.id);
      return node;
    }
    const passes = resolvedBlendPasses(layer).filter(p => p.enabled);
    if (passes.length !== 1 || passes[0].mode !== "source-over" || passes[0].opacity !== 1 || layer.blendIf || layer.knockout && layer.knockout !== "none" || layer.blendChannels && Object.values(layer.blendChannels).some(v => !v)) issue("BLENDING", "Advanced blending requires conversion; this vector writer does not yet preserve it.", layer);
    if (layer.effects?.some(e => e.enabled) || layer.filters?.some(f => f.enabled) || layer.spatial?.enabled) issue("EFFECTS", "Raster/spatial effects need localized appearance conversion, which is not yet implemented.", layer);
    if (layer.mask || layer.maskSurface) {
      try {
        const alpha = planAlphaDelivery(layer, doc.width, doc.height)!;
        alphaRecords += alpha.records; alphaBytes += alpha.bytes;
        if (alphaRecords > VECTOR_ALPHA_LIMITS.records || alphaBytes > VECTOR_ALPHA_LIMITS.bytes) throw new Error("Combined mask payload exceeds the document delivery budget (4,096 tiles / 16 MiB)");
        node.alpha = alpha;
      } catch (error) { issue("PIXEL_MASK_BUDGET", error instanceof Error ? error.message : "Mask cannot be exported safely", layer); }
    }
    if (layer.clipping) {
      const base = findClippingBase(doc, layer);
      try {
        if (layer.kind === "group" || !base || !base.visible || included && !included.has(base.id)) throw new Error("unsupported base");
        const basePath = layerVectorPath(base), paints = vectorPaints(basePath).filter(p => p.enabled && p.color !== "none" && p.color !== "transparent" && (p.kind === "fill" || p.width > 0));
        if (paints.length === 1 && paints[0].kind === "fill" && paints[0].opacity === 1 && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(paints[0].color)) {
          const contours = documentContours(base).filter(c => c.closed);
          const clip = { ...basePath, anchors: contours[0]?.anchors ?? [], closed: true, contours: contours.slice(1) };
          countPath(clip); node.clip = clip;
        } else {
          countPath(basePath);
          node.clipContent = { layer: { ...base, opacity: 1, fillOpacity: 1 }, path: basePath, children: [], compositeOpacity: 1 };
        }
      } catch {
        issue("CLIPPING", "Clipping requires a visible vector base included in this delivery. Group, raster and adjustment bases are not supported by this vector writer.", layer, "B", "Keep the .luma master; prepare an equivalent vector mask in a separate delivery copy, or use a raster output when editability is not required.");
      }
    }
    if (![layer.opacity, layer.fillOpacity ?? 1].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) issue("OPACITY", "Invalid vector opacity.", layer);
    try {
      if (layer.vectorMask) { countPath(layer.vectorMask); node.mask = structuredClone(layer.vectorMask); }
      if (layer.kind === "group") node.children = visit(layer.id);
      else if (layer.path || layer.shape) {
        const path = layerVectorPath(layer); countPath(path); node.path = path;
        if (!Object.values(affineForLayerTransform(layer.transform)).every(Number.isFinite)) throw new Error("Invalid vector transform");
        for (const paint of vectorPaints(node.path).filter(p => p.enabled)) {
          const valid = format === "pdf" ? /^(?:none|transparent|#(?:[\da-f]{3}|[\da-f]{6}))$/i : /^(?:none|transparent|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
          if (paint.color.length > 128 || !valid.test(paint.color)) throw new Error(format === "pdf" ? "Vector PDF currently requires opaque hex colors" : "SVG export supports solid CSS hex/rgb colors only");
        }
      } else issue("CONTENT", layer.text ? "Text must be explicitly outlined for this vector writer; font/layout-preserving text export is not yet qualified." : "Only path, shape and group layers are supported by this editable vector writer.", layer, "B", layer.text ? "Duplicate the text, ungroup the copy if needed, and use Create outlines. Other text styling restrictions are checked by that command; retain the original editable master." : undefined, layer.text ? "Outlining preserves glyph geometry but removes text editing; it is never done automatically." : undefined);
    } catch (error) { issue("GEOMETRY", error instanceof Error ? error.message : "Invalid vector geometry", layer); }
    return node;
  });
  // Match the compositor: a contiguous visible clipped stack takes its base's
  // master opacity once, after the base and all members have been assembled.
  const clippingGroups = (entries: VectorDeliveryNode[]): VectorDeliveryNode[] => {
    const result: VectorDeliveryNode[] = [];
    for (let i = 0; i < entries.length; i++) {
      const node = entries[i], base = node.layer;
      node.children = clippingGroups(node.children);
      const stack: VectorDeliveryNode[] = [node];
      if (node.path && !base.clipping && base.opacity > 0 && (base.blendClippedAsGroup ?? true)) {
        const siblings = children.get(base.parentId) ?? [];
        let above = siblings.indexOf(base) - 1;
        while (above >= 0) {
          const member = siblings[above--];
          if (!member.clipping || !member.visible || member.opacity <= 0 || included && !included.has(member.id)) break;
          const next = entries[i + stack.length];
          if (!next || next.layer !== member || !next.path) break;
          stack.push(next);
        }
      }
      if (stack.length > 1) {
        node.compositeOpacity = 1;
        result.push({ layer: base, children: stack, synthetic: true, compositeOpacity: base.opacity });
        i += stack.length - 1;
      } else result.push(node);
    }
    return result;
  };
  nodes.push(...clippingGroups(visit()));
  if (report.anchorCount > budget) issue("ANCHOR_BUDGET", `${format.toUpperCase()} delivery exceeds the ${budget.toLocaleString("en-US")}-anchor budget (including masks).`);
  if (!report.objectCount) issue("EMPTY", "No visible objects to export.");
  report.canExport = issues.length === 0; report.status = report.canExport ? "Fully editable" : "Export blocked";
  return { nodes, report };
}

export function requireVectorDelivery(doc: Document, format: VectorDeliveryFormat, selected?: Layer[]) {
  const plan = planVectorDelivery(doc, format, selected);
  if (!plan.report.canExport) throw new Error(plan.report.issues.map(i => `${i.layerPath}: ${i.reason}`).join("\n"));
  return plan;
}
