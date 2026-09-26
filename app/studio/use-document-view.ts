import { useCallback, useState } from "react";
import type { CanvasView } from "../engine/viewport";
import { FIT_VIEW, reconcileDocumentViews, updateDocumentView, type DocumentViews } from "./document-view-state";

export function useDocumentView(activeId: string | null, openIds: string[], initial: CanvasView) {
  const [state, setState] = useState<DocumentViews>({ activeId: null, views: {}, initial });
  // Derive synchronously on a tab change: no frame rendered with another tab's view.
  let current = state;
  if (state.activeId !== activeId || Object.keys(state.views).some(id => !openIds.includes(id))) {
    current = reconcileDocumentViews(state, activeId, openIds);
    setState(current);
  }
  const setView = useCallback((update: CanvasView | ((view: CanvasView) => CanvasView)) => {
    setState(previous => updateDocumentView(previous, activeId, update));
  }, [activeId]);
  return [activeId ? current.views[activeId] ?? FIT_VIEW : current.initial, setView] as const;
}
