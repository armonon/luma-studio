import type { Document, Layer } from "./document";

/** Fonts needed by a flattened render, not by the editable document as a whole.
 * Match the compositor's reachable groups and preserve raw clipping-base
 * dependencies, even when that base itself is hidden or has zero opacity.
 * Do not cull by bounds, Fill, masks or effects: text outside its frame can
 * still contribute a shadow, clipping silhouette or transformed pixels.
 */
export function renderedTextLayers(doc: Pick<Document, "layers">): Layer[] {
  const groups = new Set(doc.layers.filter(layer => layer.kind === "group").map(layer => layer.id));
  const children = new Map<string | undefined, Layer[]>();
  const clipBases = new Map<Layer, Layer>();
  const nextBase = new Map<string | undefined, Layer>();
  for (let index = doc.layers.length - 1; index >= 0; index--) {
    const layer = doc.layers[index];
    const base = nextBase.get(layer.parentId);
    if (layer.clipping && base) clipBases.set(layer, base);
    if (layer.kind !== "group" && !layer.clipping) nextBase.set(layer.parentId, layer);
  }
  for (const layer of doc.layers) {
    const parent = layer.parentId && groups.has(layer.parentId) ? layer.parentId : undefined;
    const siblings = children.get(parent);
    if (siblings) siblings.push(layer); else children.set(parent, [layer]);
  }
  const needed = new Set<Layer>(), visited = new Set<Layer>();
  const pending = [...(children.get(undefined) ?? [])];
  while (pending.length) {
    const layer = pending.pop()!;
    if (visited.has(layer) || !layer.visible || layer.opacity <= 0) continue;
    visited.add(layer);
    if (layer.kind === "group") {
      for (const child of children.get(layer.id) ?? []) pending.push(child);
    } else {
      if (layer.text) needed.add(layer);
      const base = clipBases.get(layer);
      if (base?.text) needed.add(base);
    }
  }
  return doc.layers.filter(layer => needed.has(layer));
}
