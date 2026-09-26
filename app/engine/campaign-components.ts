import { cloneCanvas, ensureMask, nextId, type Artboard, type Document, type Layer, type Transform } from "./document";
import { shallowCloneLayer } from "./history-payload";
import { selectedLayerTree } from "./layer-selection";
import { adaptTransform, type DesignLink } from "./campaign";
import { validateVectorPath } from "./vector-path";

export type MaskWorkBudget = { remaining: number };
export const CAMPAIGN_MASK_BYTES = 32 * 1024 * 1024;
export function componentTree(doc: Document, ids: string[]) {
  const tree = selectedLayerTree(doc.layers, ids);
  if (!ids.length || ids.some(id => !tree.ids.has(id)) || tree.layers.length > 128) throw new Error("Components require 1–128 existing layers, including descendants");
  if (tree.roots.some(l => l.parentId || l.clipping)) throw new Error("Select the complete parent group or unclipped component root");
  for (const layer of tree.layers) {
    if (layer.smartSource || layer.raw || layer.surface?.store.sourceState()) throw new Error("Detach embedded or source-backed content before linking campaign components");
    if (layer.kind !== "group" && !layer.bitmap && !layer.surface && !layer.text && !layer.shape && !layer.path) throw new Error("Components cannot contain document-wide adjustments");
    let parent = layer.parentId, depth = 0;
    while (parent) {
      const group = doc.layers.find(l => l.id === parent);
      if (!group || group.kind !== "group" || !tree.ids.has(parent) || ++depth > 32) throw new Error("Invalid or excessively nested component hierarchy");
      parent = group.parentId;
    }
  }
  return tree;
}

/** Group transforms do not compose in the engine: each child is in document
 * space. Use ONE root-derived mapping for every descendant and its masks. */
export function componentMapping(source: Layer, from: Artboard, to: Artboard, link: DesignLink) {
  const target = adaptTransform(source.transform, from, to, link);
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return { scale, dx: target.tx - source.transform.tx * scale, dy: target.ty - source.transform.ty * scale };
}
export type ComponentMapping = ReturnType<typeof componentMapping>;
export function mappedTransform(source: Transform, map: ComponentMapping): Transform {
  return { ...source, tx: source.tx * map.scale + map.dx, ty: source.ty * map.scale + map.dy, sx: source.sx * map.scale, sy: source.sy * map.scale };
}
export function mapComponentMasks(layer: Layer, sourceWidth: number, sourceHeight: number, width: number, height: number, map: ComponentMapping, budget: MaskWorkBudget) {
  if (layer.mask || layer.maskSurface) {
    // This wrapper is staged. Migrating a legacy mask must not mutate its owner.
    if (!layer.maskSurface && layer.mask && layer.mask.width * layer.mask.height > budget.remaining) throw new Error("Legacy component mask exceeds the migration budget");
    const mask = layer.maskSurface ?? ensureMask(layer, sourceWidth, sourceHeight);
    if (mask.width !== sourceWidth || mask.height !== sourceHeight) throw new Error("Component mask dimensions do not match its document");
    layer.maskSurface = mask.remapped(width, height, map.scale, map.dx, map.dy, budget.remaining);
    budget.remaining -= layer.maskSurface.stats().residentBytes;
    layer.mask = undefined;
  }
  if (layer.vectorMask) {
    const path = structuredClone(layer.vectorMask);
    const contours=[path,...(path.contours??[]),...(path.booleanSource?.operands.flat()??[]),...(path.offsetSource?.contours??[])];
    // Recipe operands must follow the visible contours, otherwise editing a
    // copied boolean/offset mask would jump back to the master's coordinates.
    const seen=new Set<object>();
    for (const contour of contours) for (const anchor of contour.anchors) {
      if(seen.has(anchor))continue;seen.add(anchor);
      anchor.x = anchor.x * map.scale + map.dx; anchor.y = anchor.y * map.scale + map.dy;
      anchor.hIn.dx *= map.scale; anchor.hIn.dy *= map.scale;
      anchor.hOut.dx *= map.scale; anchor.hOut.dy *= map.scale;
    }
    path.strokeWidth *= map.scale;
    if(path.offsetSource)path.offsetSource.distance*=map.scale;
    validateVectorPath(path);
    layer.vectorMask = path;
  }
}

export function cloneComponentLayer(source: Layer, target: Layer | undefined, allocated: HTMLCanvasElement[]) {
  const copy = shallowCloneLayer(source);
  copy.id = target?.id ?? nextId("layer"); copy.name = target?.name ?? source.name;
  if (target) copy.locked = target.locked;
  if (source.bitmap) { copy.bitmap = cloneCanvas(source.bitmap); allocated.push(copy.bitmap); }
  return copy;
}

export function linkedComponents(doc: Document) {
  const links = doc.campaign?.links ?? [];
  return links.filter(link => link.sourceId && (!link.componentId || link.componentId === link.layerId)).map(link => {
    const source = doc.layers.find(l => l.id === link.sourceId), target = doc.layers.find(l => l.id === link.layerId);
    if (!source || !target) throw new Error("A linked component root is missing; detach its link before updating");
    const tree = componentTree(doc, [source.id]), targets = selectedLayerTree(doc.layers, [target.id]);
    if (target.parentId || target.clipping) throw new Error("Move the linked component back to the document root before updating");
    const members = links.filter(l => l.componentId === target.id || l.layerId === target.id);
    if (members.some(l => doc.layers.some(layer=>layer.id===l.layerId)&&!targets.ids.has(l.layerId))) throw new Error("A linked component child was moved outside its group; undo or detach the component before updating");
    return { link, source, target, tree, targets, members };
  });
}
