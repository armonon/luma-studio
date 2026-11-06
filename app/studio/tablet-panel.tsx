"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { STUDIO_PANEL_REGISTRY, type PanelId } from "./panel-registry";

/** A touch presentation of the SAME registry/content, never a second inspector. */
export function TabletPanel({ panel, onSelect, onClose, onExpand, children }: {
  panel: PanelId; onSelect: (panel: PanelId) => void; onClose: () => void; onExpand?: () => void; children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"compact" | "half" | "full">("half");
  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [panel]);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <aside ref={ref} tabIndex={-1} className="tablet-panel" data-size={size} data-panel={panel} aria-label="Workspace panel" onKeyDown={event => {
    // Handle Escape before the window/canvas shortcuts. Don't close this panel
    // when Escape belongs to a tool library or dialog above it.
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
  }}>
    <header>
      <select aria-label="Workspace panel" value={panel} onChange={event => onSelect(event.target.value as PanelId)}>
        {["Essentials", "Adjustments", "Production"].map(group => <optgroup key={group} label={group}>
          {STUDIO_PANEL_REGISTRY.list().filter(definition => (definition.mobileGroup ?? "Production") === group).map(definition => <option key={definition.id} value={definition.id}>{definition.title}</option>)}
        </optgroup>)}
      </select>
      <div className="phone-panel-sizing" role="group" aria-label="Panel size">
        <select aria-label="Panel size" value={size} onChange={event => setSize(event.target.value as typeof size)}>
          <option value="compact">Compact</option>
          <option value="half">Half</option>
          <option value="full">Full</option>
        </select>
      </div>
      {onExpand && <button type="button" onClick={onExpand} aria-label={`Expand ${STUDIO_PANEL_REGISTRY.require(panel).title} workspace`} title="Open full workspace">↗</button>}
      <button onClick={onClose} aria-label="Close workspace panel">×</button>
    </header>
    <div ref={bodyRef} className="dock-panel-body">{children}</div>
  </aside>;
}
