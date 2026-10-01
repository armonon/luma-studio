"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Layer } from "@/app/engine/document";
import {
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
} from "@/app/engine/document";
import { isNeutralBlendIf } from "@/app/engine/blend";
import { virtualRange } from "./large-project-ui";
import { ChevronDown, ChevronRight, Eye, EyeOff, X } from "lucide-react";
import type { LayerSelectionModifiers } from "../engine/layer-selection";
import LayerThumbnail from "./layer-thumbnail";

const ROW_HEIGHT = 46;

function layerDetails(layer: Layer) {
  const parts: string[] = [layer.kind.replace("adjustment-", "").replaceAll("-", " ")];
  if (layer.maskSurface || layer.mask) parts.push("mask");
  const fx = (layer.filters?.length ?? 0) + (layer.effects?.length ?? 0);
  if (fx) parts.push(`fx ${fx}`);
  const passes = resolvedBlendPasses(layer).length;
  if (passes > 1) parts.push(`${passes} passes`);
  if (!isNeutralBlendIf(resolvedBlendIf(layer)) || resolvedFillOpacity(layer) < 1) parts.push("advanced");
  if (layer.clipping) parts.push("clipped");
  if (layer.ai) parts.push("AI");
  return parts.join(" · ");
}

export default function VirtualLayerStack({
  touch = false,
  selecting = false,
  layers: allLayers,
  activeLayerId,
  selectedLayerIds,
  draggedLayerId,
  onDragStart,
  onDragEnd,
  onDrop,
  onSelect,
  onOpenStyle,
  onRename,
  onToggleVisible,
  onDelete,
  canDelete,
  onContextMenu,
  onDeleteSelection,
}: {
  touch?: boolean;
  selecting?: boolean;
  layers: Layer[];
  activeLayerId: string | null;
  selectedLayerIds: string[];
  draggedLayerId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (sourceId: string, targetIndex: number) => void;
  onSelect: (layer: Layer, modifiers: LayerSelectionModifiers) => void;
  onContextMenu: (layer: Layer, point: { x: number; y: number }) => void;
  onDeleteSelection: () => void;
  onOpenStyle: (layer: Layer) => void;
  onRename: (layer: Layer) => void;
  onToggleVisible: (layer: Layer) => void;
  /**
   * Deletes this specific layer, independent of which layer is active.
   * A layer row is the natural place to ask for this — the panel header's
   * delete button targets "whichever layer happens to be selected", which is
   * both an extra step and, at real-world panel widths, gets flexbox-squeezed
   * to zero width behind the crowded add-layer icon row (verified: the header
   * toolbar's Delete/Group/Move buttons render at `width: 0` once a `<select>`
   * sibling claims its intrinsic width, since only buttons opt into the
   * hide-until-hover collapse — the select doesn't shrink at all). A visible,
   * always-reachable per-row action does not depend on that layout surviving.
   */
  onDelete: (layer: Layer) => void;
  canDelete: (layer: Layer) => boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hierarchy = new Map(allLayers.map(layer => [layer.id, layer]));
  const ancestors = (layer: Layer) => {
    const ids: string[] = [];
    let parent = layer.parentId;
    while (parent && !ids.includes(parent)) { ids.push(parent); parent = hierarchy.get(parent)?.parentId; }
    return ids;
  };
  const layers = allLayers.filter(layer => !ancestors(layer).some(id => collapsed.has(id)));
  const select = (layer: Layer, event: LayerSelectionModifiers) => onSelect(layer, { shiftKey: event.shiftKey, metaKey: (touch && selecting) || event.metaKey, ctrlKey: event.ctrlKey, orderedIds: layers.map(item => item.id) });
  const [viewportHeight, setViewportHeight] = useState(360);
  const [scrollTop, setScrollTop] = useState(0);
  const range = virtualRange({
    itemCount: layers.length,
    itemHeight: ROW_HEIGHT,
    viewportHeight,
    scrollTop,
  });
  const activeRowIndex = layers.findIndex(layer => layer.id === activeLayerId);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setViewportHeight(host.clientHeight || 360);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const index = activeRowIndex;
    if (!host || index < 0) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < host.scrollTop) host.scrollTop = top;
    else if (bottom > host.scrollTop + host.clientHeight) host.scrollTop = bottom - host.clientHeight;
    if (host.contains(document.activeElement) && document.activeElement?.getAttribute("role") === "option") {
      const frame = requestAnimationFrame(() => host.querySelector<HTMLElement>('[data-primary="true"]')?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
  }, [activeLayerId, activeRowIndex]);

  return (
    <div
      ref={hostRef}
      className="layer-stack virtual-layer-stack"
      style={touch ? { height: Math.min(6, Math.max(2, layers.length)) * ROW_HEIGHT } : undefined}
      role="listbox"
      aria-label="Document layers"
      aria-multiselectable="true"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      data-layer-count={layers.length}
    >
      <div className="virtual-layer-spacer" style={{ height: range.totalHeight }}>
        <div className="virtual-layer-window" style={{ transform: `translateY(${range.offset}px)` }}>
          {layers.slice(range.start, range.end).map((layer, localIndex) => {
            const targetIndex = range.start + localIndex;
            return (
              <div
                key={layer.id}
                className={`spatial-layer ${selectedLayerIds.includes(layer.id) ? "active" : ""}`}
                role="option"
                aria-selected={selectedLayerIds.includes(layer.id)}
                data-primary={activeLayerId === layer.id}
                tabIndex={activeLayerId === layer.id || (!activeLayerId && targetIndex === 0) ? 0 : -1}
                style={{ height: ROW_HEIGHT, top: localIndex * ROW_HEIGHT, paddingLeft: 7 + Math.min(ancestors(layer).length, 5) * 12, ...(layer.kind === "group" ? { gridTemplateColumns: `${touch ? 44 : 16}px 34px minmax(0, 1fr) auto` } : {}) } as CSSProperties}
                title={layer.ai
                  ? `${layer.ai.operation} · ${layer.ai.model}${layer.ai.requestId ? ` · request ${layer.ai.requestId}` : ""}`
                  : layer.name}
                draggable={!touch && selectedLayerIds.length <= 1}
                onDragStart={() => onDragStart(layer.id)}
                onDragEnd={onDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedLayerId && draggedLayerId !== layer.id) onDrop(draggedLayerId, allLayers.indexOf(layer));
                }}
                onClick={event => select(layer, event)}
                onContextMenu={event => { event.preventDefault(); event.currentTarget.focus(); onContextMenu(layer, { x: event.clientX, y: event.clientY }); }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); onDeleteSelection(); return; }
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu(layer, { x: rect.left + 30, y: rect.bottom }); return;
                  }
                  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    const index = event.key === "Home" ? 0 : event.key === "End" ? layers.length - 1
                      : Math.max(0, Math.min(layers.length - 1, targetIndex + (event.key === "ArrowDown" ? 1 : -1)));
                    if (layers[index]) select(layers[index], event);
                    return;
                  }
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  select(layer, event);
                }}
                onDoubleClick={() => onOpenStyle(layer)}
              >
                {layer.kind === "group" && <button type="button" className="layer-group-toggle" aria-label={`${collapsed.has(layer.id) ? "Expand" : "Collapse"} ${layer.name}`} aria-expanded={!collapsed.has(layer.id)} onClick={event => { event.stopPropagation(); setCollapsed(current => { const next = new Set(current); if (next.has(layer.id)) next.delete(layer.id); else next.add(layer.id); return next; }); }}>{collapsed.has(layer.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>}
                <LayerThumbnail layer={layer} />
                <span className="layer-name">
                  <strong
                    title="Double-click to rename"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onRename(layer);
                    }}
                  >{layer.name}</strong>
                  <small>{layerDetails(layer)}</small>
                </span>
                <span className="spatial-layer-actions">
                  <button
                    type="button"
                    className="spatial-layer-visibility"
                    aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                    aria-pressed={layer.visible}
                    title={layer.visible ? "Hide layer" : "Show layer"}
                    onClick={(event) => { event.stopPropagation(); onToggleVisible(layer); }}
                  >
                    {layer.visible ? <Eye /> : <EyeOff />}
                  </button>
                  {touch ? <button type="button" aria-label={`Actions for ${layer.name}`} onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onContextMenu(layer, { x: rect.left, y: rect.bottom }); }}>•••</button> : <button
                    type="button"
                    className="spatial-layer-delete"
                    disabled={!canDelete(layer)}
                    aria-label={`Delete ${layer.name}`}
                    title="Delete layer"
                    onClick={(event) => { event.stopPropagation(); onDelete(layer); }}
                  >
                    <X />
                  </button>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
