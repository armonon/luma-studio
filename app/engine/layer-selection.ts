import type { Layer } from "./document";

export type LayerSelection = { ids: string[]; primary: string | null; anchor: string | null };
export type LayerSelectionModifiers = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; orderedIds?: string[] };

export function selectLayerRange(order: readonly string[], current: LayerSelection, id: string, modifiers: LayerSelectionModifiers = {}): LayerSelection {
  if (!order.includes(id)) return current;
  const valid = current.ids.filter(key => order.includes(key));
  const toggle = modifiers.metaKey || modifiers.ctrlKey;
  if (modifiers.shiftKey && current.anchor && order.includes(current.anchor)) {
    const a = order.indexOf(current.anchor), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const ids = toggle ? order.filter(key => valid.includes(key) || range.includes(key)) : range;
    return { ids, primary: id, anchor: current.anchor };
  }
  if (toggle) {
    const ids = valid.includes(id) ? valid.filter(key => key !== id) : order.filter(key => valid.includes(key) || key === id);
    return { ids, primary: ids.includes(id) ? id : ids.at(-1) ?? null, anchor: id };
  }
  return { ids: [id], primary: id, anchor: id };
}

/** Normalize selected parents + children to disjoint subtree roots. */
export function selectedLayerTree(layers: readonly Layer[], ids: readonly string[]) {
  const selected = new Set(ids), byId = new Map(layers.map(layer => [layer.id, layer]));
  const roots = layers.filter(layer => {
    if (!selected.has(layer.id)) return false;
    let parent = layer.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (selected.has(parent)) return false;
      seen.add(parent); parent = byId.get(parent)?.parentId;
    }
    return true;
  });
  const included = new Set(roots.map(layer => layer.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const layer of layers) if (layer.parentId && included.has(layer.parentId) && !included.has(layer.id)) { included.add(layer.id); changed = true; }
  }
  return { roots, layers: layers.filter(layer => included.has(layer.id)), ids: included };
}
