"use client";

import { useEffect, useState, type PointerEvent } from "react";
import type { DisplayViewport } from "../engine/viewport";
import { RULERS_KEY, rulerGuidePosition, rulerTicks } from "./workspace-ruler-model";

export function useWorkspaceRulers() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setVisible(localStorage.getItem(RULERS_KEY) !== "false"); } catch { /* Session-only preference. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return [visible, () => setVisible(current => {
    try { localStorage.setItem(RULERS_KEY, String(!current)); } catch { /* Session-only preference. */ }
    return !current;
  })] as const;
}

export function WorkspaceRulers({ viewport, width, height, onGuide }: {
  viewport: DisplayViewport; width: number; height: number;
  onGuide: (orientation: "horizontal" | "vertical", position: number) => void;
}) {
  const [drag, setDrag] = useState<{ axis: "horizontal" | "vertical"; position: number } | null>(null);
  const resolve = (event: PointerEvent<SVGSVGElement>, axis: "horizontal" | "vertical") => {
    const rect = event.currentTarget.parentElement!.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 22 || y < 22 || x > rect.width || y > rect.height) return null;
    return axis === "horizontal"
      ? rulerGuidePosition(y, rect.height, viewport.y, viewport.height, height)
      : rulerGuidePosition(x, rect.width, viewport.x, viewport.width, width);
  };
  return <>
    <span className="workspace-ruler-origin" title="Document pixels · origin at canvas top-left">px</span>
    {(["horizontal", "vertical"] as const).map(axis => {
      const horizontal = axis === "horizontal";
      const ticks = rulerTicks(horizontal ? viewport.x : viewport.y, horizontal ? viewport.width : viewport.height, viewport.cssScale);
      return <svg key={axis} className={`workspace-ruler ${axis}`} aria-label={`${axis} pixel ruler`} role="img"
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const position = resolve(event, axis);
          setDrag(position === null ? null : { axis, position });
        }}
        onPointerUp={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const position = resolve(event, axis);
          event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null);
          if (position !== null) onGuide(axis, position);
        }}
        onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}>
        <title>Pixels · drag into canvas to add a {axis} guide · undo with ⌘Z</title>
        {ticks.map(tick => <g key={tick.value}>
          <line x1={horizontal ? `${tick.percent}%` : tick.major ? 13 : 17} y1={horizontal ? tick.major ? 13 : 17 : `${tick.percent}%`} x2={horizontal ? `${tick.percent}%` : 22} y2={horizontal ? 22 : `${tick.percent}%`} />
          {tick.major && (horizontal ? <text x={`${tick.percent}%`} y="10" dx="3">{tick.label}</text> : <text x="9" y={`${tick.percent}%`} dy="3" writingMode="vertical-rl">{tick.label}</text>)}
        </g>)}
      </svg>;
    })}
    {drag && <div className={`workspace-guide-preview ${drag.axis}`} style={drag.axis === "horizontal" ? { top: `${(drag.position - viewport.y) / viewport.height * 100}%` } : { left: `${(drag.position - viewport.x) / viewport.width * 100}%` }}><output>{drag.position} px</output></div>}
  </>;
}
