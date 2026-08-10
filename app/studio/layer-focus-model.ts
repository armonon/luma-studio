import {
  documentPointToLayer,
  effectiveLayerVisible,
  type Document,
  type Layer,
} from "@/app/engine/document";
import type { CanvasView } from "@/app/engine/viewport";

export type FocusContextMode = "off" | "ghost" | "full";
export type FocusEditTarget = "pixels" | "mask";

export type LayerFocusScope = {
  layerId: string;
  /** Stable ancestry snapshot used to recover to the nearest valid parent. */
  path: string[];
  target: FocusEditTarget;
};

export type LayerFocusState = {
  documentId: string | null;
  scope: LayerFocusScope | null;
  projectView: CanvasView | null;
  context: FocusContextMode;
};

export type FocusItem = {
  layer: Layer;
  previewLayer?: Layer;
  pinned: boolean;
};

export type LayerBounds = { x: number; y: number; width: number; height: number };
export type LayerFocusPreferences = { version: 1; pinnedLayerIds: string[]; recentLayerIds: string[] };

export const EMPTY_LAYER_FOCUS_STATE: LayerFocusState = {
  documentId: null,
  scope: null,
  projectView: null,
  context: "ghost",
};

export function normalizeLayerFocusPreferences(value: unknown): LayerFocusPreferences {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const ids = (input: unknown, limit: number) => Array.isArray(input)
    ? [...new Set(input.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, limit)
    : [];
  return {
    version: 1,
    pinnedLayerIds: ids(candidate.pinnedLayerIds, 64),
    recentLayerIds: ids(candidate.recentLayerIds, 24),
  };
}

const ADJUSTMENT_KINDS = new Set<Layer["kind"]>([
  "adjustment-tone",
  "adjustment-curves",
  "adjustment-levels",
  "adjustment-hsl",
]);

export function layerFocusPath(doc: Document, layerId: string) {
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
  const target = byId.get(layerId);
  if (!target) return [];
  const reversed = [target.id];
  const seen = new Set(reversed);
  let parentId = target.parentId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    reversed.push(parent.id);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return reversed.reverse();
}

export function supportsIsolatedFocus(layer: Layer) {
  return !ADJUSTMENT_KINDS.has(layer.kind);
}

export function enterLayerFocus(
  current: LayerFocusState,
  doc: Document,
  documentId: string,
  layerId: string,
  projectView: CanvasView,
  target: FocusEditTarget = "pixels",
): LayerFocusState {
  const layer = doc.layers.find((candidate) => candidate.id === layerId);
  if (!layer || (layer.kind === "adjustment-tone" && !layer.tone)) return current;
  const nextTarget = target === "mask" && !layer.mask ? "pixels" : target;
  return {
    documentId,
    scope: { layerId, path: layerFocusPath(doc, layerId), target: nextTarget },
    projectView: current.scope && current.documentId === documentId
      ? current.projectView
      : { ...projectView },
    context: supportsIsolatedFocus(layer)
      ? current.context
      : "full",
  };
}

export function leaveLayerFocus(state: LayerFocusState): LayerFocusState {
  return { ...EMPTY_LAYER_FOCUS_STATE, context: state.context };
}

/**
 * Resolve structural edits without a second document-state system. A deleted
 * focus target falls back through its captured ancestor path; a missing mask
 * returns to the owning layer's pixels. Document switches always return to the
 * project context.
 */
export function reconcileLayerFocus(
  state: LayerFocusState,
  doc: Document | undefined,
  documentId: string | null,
): LayerFocusState {
  if (!state.scope || !doc || !documentId || state.documentId !== documentId) {
    return state.scope ? leaveLayerFocus(state) : state;
  }
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
  const target = byId.get(state.scope.layerId);
  if (target) {
    if (state.scope.target === "mask" && !target.mask) {
      return { ...state, scope: { ...state.scope, target: "pixels" } };
    }
    const path = layerFocusPath(doc, target.id);
    return path.join("/") === state.scope.path.join("/")
      ? state
      : { ...state, scope: { ...state.scope, path } };
  }
  for (let index = state.scope.path.length - 2; index >= 0; index -= 1) {
    const fallback = byId.get(state.scope.path[index]);
    if (!fallback) continue;
    return {
      ...state,
      scope: {
        layerId: fallback.id,
        path: layerFocusPath(doc, fallback.id),
        target: "pixels",
      },
      context: supportsIsolatedFocus(fallback) ? state.context : "full",
    };
  }
  return leaveLayerFocus(state);
}

export function focusBreadcrumbLayers(doc: Document, state: LayerFocusState) {
  if (!state.scope) return [];
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
  return state.scope.path.map((id) => byId.get(id)).filter((layer): layer is Layer => Boolean(layer));
}

function dedupeLayers(layers: Layer[]) {
  const seen = new Set<string>();
  return layers.filter((layer) => {
    if (seen.has(layer.id)) return false;
    seen.add(layer.id);
    return true;
  });
}

function windowAroundSelection(layers: Layer[], selectedLayerId: string | null, limit = 64) {
  if (layers.length <= limit) return layers;
  const selectedIndex = Math.max(0, layers.findIndex((layer) => layer.id === selectedLayerId));
  const start = Math.max(0, Math.min(layers.length - limit, selectedIndex - Math.floor(limit / 2)));
  return layers.slice(start, start + limit);
}

/**
 * Focus is intentionally contextual rather than a second full layer list.
 * Immediate scope items lead, followed by a small recent/pinned working set.
 */
export function focusItems(
  doc: Document,
  state: LayerFocusState,
  selectedLayerId: string | null,
  pinnedIds: readonly string[],
  recentIds: readonly string[],
): FocusItem[] {
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
  const scopeLayer = state.scope ? byId.get(state.scope.layerId) : null;
  const parentId = scopeLayer?.kind === "group" ? scopeLayer.id : scopeLayer?.parentId;
  const contextual = doc.layers.filter((layer) => (layer.parentId ?? null) === (parentId ?? null));
  const pinned = pinnedIds.map((id) => byId.get(id)).filter((layer): layer is Layer => Boolean(layer));
  const recent = recentIds.map((id) => byId.get(id)).filter((layer): layer is Layer => Boolean(layer));
  const selected = selectedLayerId ? byId.get(selectedLayerId) : undefined;
  const contextualWindow = windowAroundSelection(contextual, selectedLayerId);
  const combined = dedupeLayers([
    ...(selected ? [selected] : []),
    ...pinned,
    ...contextualWindow,
    ...recent.slice(0, 12),
  ]).slice(0, 80);
  const pinnedSet = new Set(pinnedIds);
  return combined.map((layer) => ({
    layer,
    previewLayer: layer.kind === "group"
      ? doc.layers.find((candidate) => Boolean(candidate.bitmap) && isDescendantOf(doc, candidate, layer.id))
      : undefined,
    pinned: pinnedSet.has(layer.id),
  }));
}

function transformedBounds(layer: Layer, local: LayerBounds): LayerBounds {
  const { sx, sy, rotation, tx, ty } = layer.transform;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const point = (x: number, y: number) => ({
    x: cosine * sx * x - sine * sy * y + tx,
    y: sine * sx * x + cosine * sy * y + ty,
  });
  const corners = [
    point(local.x, local.y),
    point(local.x + local.width, local.y),
    point(local.x + local.width, local.y + local.height),
    point(local.x, local.y + local.height),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}

function localLayerBounds(doc: Document, layer: Layer): LayerBounds {
  if (layer.shape) return { x: layer.shape.x, y: layer.shape.y, width: layer.shape.w, height: layer.shape.h };
  if (layer.path?.anchors.length) {
    const xs = layer.path.anchors.map((anchor) => anchor.x);
    const ys = layer.path.anchors.map((anchor) => anchor.y);
    const padding = Math.max(4, layer.path.strokeWidth / 2);
    const x = Math.min(...xs) - padding;
    const y = Math.min(...ys) - padding;
    return { x, y, width: Math.max(1, Math.max(...xs) - x + padding), height: Math.max(1, Math.max(...ys) - y + padding) };
  }
  if (layer.text) {
    const fontSize = Number(layer.text.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 32);
    const lines = layer.text.text.split("\n");
    const width = layer.text.boxWidth ?? Math.max(fontSize, Math.max(...lines.map((line) => line.length), 1) * fontSize * 0.58);
    const height = layer.text.boxHeight ?? Math.max(fontSize, lines.length * fontSize * layer.text.lineHeight);
    return { x: layer.text.x, y: layer.text.y - fontSize, width, height };
  }
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

export function layerVisualBounds(doc: Document, layerId: string): LayerBounds {
  const layer = doc.layers.find((candidate) => candidate.id === layerId);
  if (!layer) return { x: 0, y: 0, width: doc.width, height: doc.height };
  if (layer.kind === "group") {
    const children = doc.layers.filter((candidate) => candidate.parentId === layer.id);
    if (!children.length) return { x: 0, y: 0, width: doc.width, height: doc.height };
    const bounds = children.map((child) => layerVisualBounds(doc, child.id));
    const x = Math.min(...bounds.map((bound) => bound.x));
    const y = Math.min(...bounds.map((bound) => bound.y));
    return {
      x,
      y,
      width: Math.max(1, Math.max(...bounds.map((bound) => bound.x + bound.width)) - x),
      height: Math.max(1, Math.max(...bounds.map((bound) => bound.y + bound.height)) - y),
    };
  }
  return transformedBounds(layer, localLayerBounds(doc, layer));
}

export function fitViewToLayer(
  doc: Document,
  layerId: string,
  stageWidth: number,
  stageHeight: number,
): CanvasView {
  const bounds = layerVisualBounds(doc, layerId);
  const safeStageWidth = Math.max(1, stageWidth);
  const safeStageHeight = Math.max(1, stageHeight);
  const fitScale = Math.min(safeStageWidth / Math.max(1, doc.width), safeStageHeight / Math.max(1, doc.height));
  const focusedScale = Math.min(
    safeStageWidth * 0.82 / Math.max(1, bounds.width),
    safeStageHeight * 0.82 / Math.max(1, bounds.height),
  );
  const zoom = Math.max(0.05, Math.min(32, focusedScale / Math.max(1e-8, fitScale)));
  const cssScale = fitScale * zoom;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    zoom,
    panX: (doc.width / 2 - centerX) * cssScale,
    panY: (doc.height / 2 - centerY) * cssScale,
  };
}

function isDescendantOf(doc: Document, layer: Layer, ancestorId: string) {
  const byId = new Map(doc.layers.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  let parentId = layer.parentId;
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

export function hitTestEditableLayer(
  doc: Document,
  x: number,
  y: number,
  focusLayerId?: string | null,
) {
  const focusLayer = focusLayerId ? doc.layers.find((layer) => layer.id === focusLayerId) : null;
  const candidates = focusLayer?.kind === "group"
    ? doc.layers.filter((layer) => isDescendantOf(doc, layer, focusLayer.id))
    : focusLayer
      ? [focusLayer]
      : doc.layers;
  for (const layer of candidates) {
    if (layer.kind === "group" || ADJUSTMENT_KINDS.has(layer.kind) || !effectiveLayerVisible(doc, layer)) continue;
    const bounds = layerVisualBounds(doc, layer.id);
    if (x < bounds.x || y < bounds.y || x > bounds.x + bounds.width || y > bounds.y + bounds.height) continue;
    if (layer.bitmap) {
      const local = documentPointToLayer(layer.transform, x, y);
      if (!local || local.x < 0 || local.y < 0 || local.x >= layer.bitmap.width || local.y >= layer.bitmap.height) continue;
      try {
        if (layer.bitmap.getContext("2d")?.getImageData(Math.floor(local.x), Math.floor(local.y), 1, 1).data[3] === 0) continue;
      } catch {
        // Cross-origin or externally backed canvases still use their visual bounds.
      }
    }
    return layer;
  }
  return null;
}
