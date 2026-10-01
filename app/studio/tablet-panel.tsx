"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { STUDIO_PANEL_REGISTRY, type PanelId } from "./panel-registry";

/** A touch presentation of the SAME registry/content, never a second inspector. */
export function TabletPanel({ panel, onSelect, onClose, children }: {
  panel: PanelId; onSelect: (panel: PanelId) => void; onClose: () => void; children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"compact" | "half" | "full">("half");
  const dragY = useRef<number | null>(null);
  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [panel]);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <aside ref={ref} tabIndex={-1} className="tablet-panel" data-size={size} aria-label="Workspace panel" onKeyDown={event => {
    // Handle Escape before the window/canvas shortcuts. Don't close this panel
    // when Escape belongs to a tool library or dialog above it.
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
  }}>
    <div className="phone-panel-sizing" role="group" aria-label="Panel size">
      <span className="phone-sheet-grip" aria-hidden="true" onPointerDown={event => { dragY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => {
        if (dragY.current !== null && Math.abs(event.clientY - dragY.current) > 24) setSize(event.clientY < dragY.current ? "full" : "compact");
        dragY.current = null;
      }} onPointerCancel={() => { dragY.current = null; }} />
      {(["compact", "half", "full"] as const).map(value => <button key={value} aria-pressed={size === value} onClick={() => setSize(value)}>{value === "half" ? "Half" : value === "full" ? "Expand" : "Compact"}</button>)}
    </div>
    <header>
      <select aria-label="Workspace panel" value={panel} onChange={event => onSelect(event.target.value as PanelId)}>
        {["Essentials", "Adjustments", "Production"].map(group => <optgroup key={group} label={group}>
          {STUDIO_PANEL_REGISTRY.list().filter(definition => (definition.mobileGroup ?? "Production") === group).map(definition => <option key={definition.id} value={definition.id}>{definition.title}</option>)}
        </optgroup>)}
      </select>
      <button onClick={onClose} aria-label="Close workspace panel">×</button>
    </header>
    <div ref={bodyRef} className="dock-panel-body">{children}</div>
  </aside>;
}
