"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { STUDIO_PANEL_REGISTRY, type PanelId } from "./panel-registry";

/** A touch presentation of the SAME registry/content, never a second inspector. */
export function TabletPanel({ panel, onSelect, onClose, children }: {
  panel: PanelId; onSelect: (panel: PanelId) => void; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeRef.current(); }
    };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <aside ref={ref} tabIndex={-1} className="tablet-panel" aria-label="Workspace panel">
    <header>
      <select aria-label="Workspace panel" value={panel} onChange={event => onSelect(event.target.value as PanelId)}>
        {STUDIO_PANEL_REGISTRY.list().map(definition => <option key={definition.id} value={definition.id}>{definition.title}</option>)}
      </select>
      <button onClick={onClose} aria-label="Close workspace panel">×</button>
    </header>
    <div className="dock-panel-body">{children}</div>
  </aside>;
}
