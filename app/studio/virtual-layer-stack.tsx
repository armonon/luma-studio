"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Layer } from "@/app/engine/document";
import {
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
} from "@/app/engine/document";
import { isNeutralBlendIf } from "@/app/engine/blend";
import { virtualRange } from "./large-project-ui";

const ROW_HEIGHT = 46;

function layerGlyph(layer: Layer) {
  if (layer.kind === "group") return "▾";
  if (layer.kind === "smart-object") return "◇";
  if (layer.kind === "adjustment-tone") return "◐";
  if (layer.kind === "adjustment-curves") return "∿";
  if (layer.kind === "adjustment-levels") return "▦";
  if (layer.kind === "adjustment-hsl") return "◉";
  if (layer.kind === "adjustment-pro") return "✦";
  if (layer.kind === "text") return "T";
  if (layer.kind === "shape") return "▭";
  if (layer.kind === "path") return "✎";
  return "▨";
}

function layerDetails(layer: Layer) {
  const parts: string[] = [layer.kind];
  if (layer.mask) parts.push("mask");
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
  layers,
  activeLayerId,
  draggedLayerId,
  onDragStart,
  onDragEnd,
  onDrop,
  onSelect,
  onOpenStyle,
  onRename,
  onToggleVisible,
}: {
  layers: Layer[];
  activeLayerId: string | null;
  draggedLayerId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (sourceId: string, targetIndex: number) => void;
  onSelect: (layer: Layer) => void;
  onOpenStyle: (layer: Layer) => void;
  onRename: (layer: Layer) => void;
  onToggleVisible: (layer: Layer) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(360);
  const [scrollTop, setScrollTop] = useState(0);
  const range = useMemo(() => virtualRange({
    itemCount: layers.length,
    itemHeight: ROW_HEIGHT,
    viewportHeight,
    scrollTop,
  }), [layers.length, viewportHeight, scrollTop]);

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
    const index = layers.findIndex((layer) => layer.id === activeLayerId);
    if (!host || index < 0) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < host.scrollTop) host.scrollTop = top;
    else if (bottom > host.scrollTop + host.clientHeight) host.scrollTop = bottom - host.clientHeight;
  }, [activeLayerId, layers]);

  return (
    <div
      ref={hostRef}
      className="layer-stack virtual-layer-stack"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      data-layer-count={layers.length}
    >
      <div className="virtual-layer-spacer" style={{ height: range.totalHeight }}>
        <div className="virtual-layer-window" style={{ transform: `translateY(${range.offset}px)` }}>
          {layers.slice(range.start, range.end).map((layer, localIndex) => {
            const targetIndex = range.start + localIndex;
            return (
              <button
                key={layer.id}
                className={`spatial-layer ${activeLayerId === layer.id ? "active" : ""}`}
                style={{ height: ROW_HEIGHT, top: localIndex * ROW_HEIGHT, "--layer-indent": layer.parentId ? "12px" : "0px" } as CSSProperties}
                title={layer.ai
                  ? `${layer.ai.operation} · ${layer.ai.model}${layer.ai.requestId ? ` · request ${layer.ai.requestId}` : ""}`
                  : layer.name}
                draggable
                onDragStart={() => onDragStart(layer.id)}
                onDragEnd={onDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedLayerId && draggedLayerId !== layer.id) onDrop(draggedLayerId, targetIndex);
                }}
                onClick={() => onSelect(layer)}
                onDoubleClick={() => onOpenStyle(layer)}
              >
                <span className={`spatial-layer-thumb kind-${layer.kind}`}>{layerGlyph(layer)}</span>
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
                <i onClick={(event) => { event.stopPropagation(); onToggleVisible(layer); }}>
                  {layer.visible ? "◉" : "○"}
                </i>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
