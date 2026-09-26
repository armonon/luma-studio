import type { CanvasView } from "../engine/viewport";

export type DocumentViews = { activeId: string | null; views: Record<string, CanvasView>; initial: CanvasView };
export const FIT_VIEW: CanvasView = { zoom: 1, panX: 0, panY: 0 };

/** Session-only framing: never a document edit or an undo entry. */
export function reconcileDocumentViews(state: DocumentViews, activeId: string | null, openIds: string[]): DocumentViews {
  const views = Object.fromEntries(Object.entries(state.views).filter(([id]) => openIds.includes(id)));
  if (activeId && !views[activeId]) views[activeId] = { ...(state.activeId === null ? state.initial : FIT_VIEW) };
  return { ...state, activeId, views };
}

export function updateDocumentView(state: DocumentViews, documentId: string | null, update: CanvasView | ((view: CanvasView) => CanvasView)): DocumentViews {
  // Delayed wheel/animation/pan callbacks must not move the newly selected tab.
  if (!documentId || documentId !== state.activeId || !state.views[documentId]) return state;
  const previous = state.views[documentId];
  const next = typeof update === "function" ? update(previous) : update;
  if (!Number.isFinite(next.zoom) || next.zoom <= 0 || !Number.isFinite(next.panX) || !Number.isFinite(next.panY)) return state;
  if (next.zoom === previous.zoom && next.panX === previous.panX && next.panY === previous.panY) return state;
  return { ...state, views: { ...state.views, [documentId]: { ...next } } };
}
