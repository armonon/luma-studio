"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Studio } from "@/app/engine/studio";
import {
  cloneCurves,
  curveToLut,
  type Curves,
  type HslParams,
  type Layer,
  type LevelsParams,
  type SmartFilter,
} from "@/app/engine/document";

function LiveRange({ value, minimum, maximum, step = 1, onLive, onCommit, label }: {
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  onLive: (value: number) => void;
  onCommit: (value: number) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : value;
  const update = (next: number) => {
    draftRef.current = next;
    setDraft(next);
    setEditing(true);
    onLive(next);
  };
  const commit = () => {
    if (!editing) return;
    onCommit(draftRef.current);
    setEditing(false);
  };
  return <input type="range" min={minimum} max={maximum} step={step} value={shown} onChange={(event) => update(Number(event.target.value))} onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} aria-label={label} />;
}

export function SmartFilterEditor({ layer, filter, index, count, studio }: {
  layer: Layer;
  filter: SmartFilter;
  index: number;
  count: number;
  studio: Studio;
}) {
  const parameter = (label: string, key: string, minimum: number, maximum: number, step: number, fallback: number, suffix = "") => {
    const value = filter.params[key] ?? fallback;
    const patch = (next: number) => ({ params: { [key]: next } });
    return (
      <label style={{ display: "grid", gridTemplateColumns: "62px 1fr 42px", gap: 5, alignItems: "center", fontSize: 10 }}>
        <span>{label}</span>
        <LiveRange value={value} minimum={minimum} maximum={maximum} step={step} onLive={(next) => studio.liveUpdateSmartFilter(layer.id, filter.id, patch(next))} onCommit={(next) => studio.updateSmartFilter(layer.id, filter.id, patch(next))} label={`${filter.kind} ${label}`} />
        <output>{Math.round(value * 10) / 10}{suffix}</output>
      </label>
    );
  };
  return (
    <div style={{ display: "grid", gap: 5, padding: 7, border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, opacity: filter.enabled ? 1 : 0.55 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button onClick={() => studio.updateSmartFilter(layer.id, filter.id, { enabled: !filter.enabled })} aria-label={`${filter.enabled ? "Disable" : "Enable"} ${filter.kind} filter`}>{filter.enabled ? "◉" : "○"}</button>
        <strong style={{ flex: 1, fontSize: 11 }}>fx · {filter.kind}</strong>
        <button onClick={() => studio.moveSmartFilter(layer.id, filter.id, -1)} disabled={index === 0} aria-label="Move filter earlier">↑</button>
        <button onClick={() => studio.moveSmartFilter(layer.id, filter.id, 1)} disabled={index === count - 1} aria-label="Move filter later">↓</button>
        <button onClick={() => studio.removeSmartFilter(layer.id, filter.id)} aria-label={`Remove ${filter.kind} filter`}>×</button>
      </div>
      <label style={{ display: "grid", gridTemplateColumns: "62px 1fr 42px", gap: 5, alignItems: "center", fontSize: 10 }}>
        <span>Opacity</span>
        <LiveRange value={Math.round(filter.opacity * 100)} minimum={0} maximum={100} onLive={(next) => studio.liveUpdateSmartFilter(layer.id, filter.id, { opacity: next / 100 })} onCommit={(next) => studio.updateSmartFilter(layer.id, filter.id, { opacity: next / 100 })} label={`${filter.kind} opacity`} />
        <output>{Math.round(filter.opacity * 100)}%</output>
      </label>
      {(["blur", "sharpen", "high-pass", "motion-blur", "surface-blur", "median", "dust-scratches", "maximum", "minimum", "lens-blur", "reduce-noise"] as string[]).includes(filter.kind) && parameter("Radius", "radius", 0.5, 64, 0.5, filter.kind === "lens-blur" ? 8 : filter.kind === "blur" ? 8 : 2, "px")}
      {filter.kind === "sharpen" && parameter("Amount", "amount", 0, 3, 0.05, 0.6)}
      {(filter.kind === "surface-blur" || filter.kind === "dust-scratches") && parameter("Threshold", "threshold", 0, 255, 1, filter.kind === "surface-blur" ? 24 : 18)}
      {filter.kind === "motion-blur" && parameter("Angle", "angle", -180, 180, 1, 0, "°")}
      {filter.kind === "lens-blur" && parameter("Blades", "blades", 3, 12, 1, 6)}
      {filter.kind === "lens-blur" && parameter("Rotation", "rotation", -180, 180, 1, 0, "°")}
      {filter.kind === "lens-blur" && parameter("Highlights", "highlights", 0, 1, 0.01, 0.15)}
      {filter.kind === "reduce-noise" && parameter("Strength", "strength", 0, 1, 0.01, 0.65)}
      {filter.kind === "reduce-noise" && parameter("Detail", "preserveDetail", 0, 1, 0.01, 0.55)}
      {filter.kind === "reduce-noise" && parameter("Color", "reduceColor", 0, 1, 0.01, 0.7)}
      {filter.kind === "displace" && parameter("Amount", "amount", -128, 128, 1, 12, "px")}
      {filter.kind === "displace" && parameter("Scale", "scale", 4, 512, 1, 48, "px")}
      {filter.kind === "displace" && parameter("Angle", "angle", -180, 180, 1, 0, "°")}
      {filter.kind === "desaturate" && parameter("Amount", "amount", 0, 1, 0.01, 1)}
      {filter.kind === "hue" && parameter("Degrees", "degrees", -180, 180, 1, 45, "°")}
    </div>
  );
}

type CurveChannel = "rgb" | "r" | "g" | "b";

export function CurvesEditor({ curves, onLive, onCommit, onReset }: {
  curves: Curves;
  onLive: (curves: Curves) => void;
  onCommit: (curves: Curves) => void;
  onReset: () => void;
}) {
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [draft, setDraft] = useState<Curves>(() => cloneCurves(curves));
  const draftRef = useRef<Curves>(draft);
  const current = drag == null ? curves : draft;
  const size = 220;
  const points = current[channel];
  const lut = useMemo(() => curveToLut(points), [points]);
  const toSvg = (point: { x: number; y: number }) => ({ x: point.x * size, y: (1 - point.y) * size });
  const fromSvg = (x: number, y: number) => ({ x: Math.max(0, Math.min(1, x / size)), y: Math.max(0, Math.min(1, 1 - y / size)) });
  const updateChannel = (nextPoints: typeof points, commit: boolean) => {
    const next = cloneCurves(drag == null ? curves : draftRef.current);
    next[channel] = nextPoints;
    draftRef.current = next;
    setDraft(next);
    if (commit) onCommit(next); else onLive(next);
  };
  const eventPoint = (event: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * size, y: ((event.clientY - rect.top) / rect.height) * size };
  };
  const onDown = (event: PointerEvent<SVGSVGElement>) => {
    const initial = cloneCurves(curves);
    draftRef.current = initial;
    setDraft(initial);
    const point = eventPoint(event);
    let hit = points.findIndex((candidate) => {
      const svg = toSvg(candidate);
      return Math.hypot(svg.x - point.x, svg.y - point.y) < 8;
    });
    if (hit === -1) {
      const nextPoint = fromSvg(point.x, point.y);
      const next = [...points, nextPoint].sort((a, b) => a.x - b.x);
      updateChannel(next, false);
      hit = next.findIndex((candidate) => candidate.x === nextPoint.x && candidate.y === nextPoint.y);
    }
    setDrag(hit);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (drag == null) return;
    const point = eventPoint(event);
    const next = points.map((candidate, index) => index === drag ? fromSvg(point.x, point.y) : candidate);
    if (drag === 0) next[0].x = 0;
    if (drag === next.length - 1) next[next.length - 1].x = 1;
    updateChannel(next, false);
  };
  const onUp = () => { if (drag != null) { onCommit(cloneCurves(draftRef.current)); setDrag(null); } };
  const removePoint = (index: number) => {
    if (points.length > 2 && index !== 0 && index !== points.length - 1) updateChannel(points.filter((_, candidate) => candidate !== index), true);
  };
  const lutPath = Array.from({ length: 256 }, (_, index) => `${index === 0 ? "M" : "L"}${index / 255 * size} ${(1 - lut[index] / 255) * size}`).join(" ");
  return (
    <section className="glass-card tone-card">
      <header><strong>Curves</strong><button onClick={onReset} aria-label="Reset curves">↺</button></header>
      <div style={{ display: "flex", gap: 4, padding: "4px 12px" }}>
        {(["rgb", "r", "g", "b"] as CurveChannel[]).map((candidate) => <button key={candidate} onClick={() => setChannel(candidate)} style={{ flex: 1, padding: "4px 6px", fontSize: 11, borderRadius: 6, background: channel === candidate ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.04)", color: candidate === "r" ? "#ff6b6b" : candidate === "g" ? "#7bff8f" : candidate === "b" ? "#6ba6ff" : "#fff", border: "1px solid rgba(255,255,255,0.14)", textTransform: "uppercase" }}>{candidate}</button>)}
      </div>
      <div style={{ padding: 8 }}>
        <svg ref={svgRef} viewBox={`0 0 ${size} ${size}`} width="100%" style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, aspectRatio: "1", touchAction: "none" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          {Array.from({ length: 5 }).map((_, index) => { const value = index / 4 * size; return <g key={index}><line x1={value} y1={0} x2={value} y2={size} stroke="rgba(255,255,255,.08)" /><line x1={0} y1={value} x2={size} y2={value} stroke="rgba(255,255,255,.08)" /></g>; })}
          <line x1={0} y1={size} x2={size} y2={0} stroke="rgba(255,255,255,.15)" strokeDasharray="4 4" />
          <path d={lutPath} stroke={channel === "r" ? "#ff6b6b" : channel === "g" ? "#7bff8f" : channel === "b" ? "#6ba6ff" : "#fff"} strokeWidth={1.5} fill="none" />
          {points.map((point, index) => { const svg = toSvg(point); return <circle key={index} cx={svg.x} cy={svg.y} r={5} fill="#fff" stroke="rgba(0,0,0,.4)" onDoubleClick={(event) => { event.stopPropagation(); removePoint(index); }} style={{ cursor: "pointer" }} />; })}
        </svg>
      </div>
      <p style={{ padding: "0 12px 8px", fontSize: 11, opacity: 0.65 }}>Click to add a point · drag to move · double-click a point to delete</p>
    </section>
  );
}

export function LevelsEditor({ levels, onLive, onCommit, onReset }: {
  levels: LevelsParams;
  onLive: (levels: LevelsParams) => void;
  onCommit: (levels: LevelsParams) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(levels);
  const draftRef = useRef(levels);
  const [editing, setEditing] = useState(false);
  const current = editing ? draft : levels;
  const set = (patch: Partial<LevelsParams>) => {
    const next = { ...(editing ? draftRef.current : levels), ...patch };
    draftRef.current = next;
    setDraft(next);
    setEditing(true);
    onLive(next);
  };
  const commit = () => {
    if (!editing) return;
    onCommit(draftRef.current);
    setEditing(false);
  };
  const rows: Array<[keyof LevelsParams, string, number, number, number]> = [["inBlack", "In black", 0, 1, 0.001], ["inWhite", "In white", 0, 1, 0.001], ["gamma", "Gamma", 0.1, 9.99, 0.01], ["outBlack", "Out black", 0, 1, 0.001], ["outWhite", "Out white", 0, 1, 0.001]];
  return <section className="glass-card tone-card"><header><strong>Levels</strong><button onClick={onReset} aria-label="Reset levels">↺</button></header><div className="tone-controls">{rows.map(([key, label, min, max, step]) => <label key={key}><span>{label}</span><input type="range" min={min} max={max} step={step} value={current[key]} onChange={(event) => set({ [key]: Number(event.target.value) })} onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} /><output>{key === "gamma" ? current[key].toFixed(2) : current[key].toFixed(3)}</output></label>)}</div></section>;
}

export function HslEditor({ hsl, onLive, onCommit, onReset }: {
  hsl: HslParams;
  onLive: (hsl: HslParams) => void;
  onCommit: (hsl: HslParams) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(hsl);
  const draftRef = useRef(hsl);
  const [editing, setEditing] = useState(false);
  const current = editing ? draft : hsl;
  const set = (patch: Partial<HslParams>) => {
    const next = { ...(editing ? draftRef.current : hsl), ...patch };
    draftRef.current = next;
    setDraft(next);
    setEditing(true);
    onLive(next);
  };
  const commit = () => {
    if (!editing) return;
    onCommit(draftRef.current);
    setEditing(false);
  };
  const rows: Array<[keyof HslParams, string, number, number]> = [["hue", "Hue", -180, 180], ["saturation", "Saturation", -100, 100], ["lightness", "Lightness", -100, 100]];
  return <section className="glass-card tone-card"><header><strong>Hue / Saturation</strong><button onClick={onReset} aria-label="Reset hue and saturation">↺</button></header><div className="tone-controls">{rows.map(([key, label, min, max]) => <label key={key}><span>{label}</span><input type="range" min={min} max={max} step={1} value={current[key]} onChange={(event) => set({ [key]: Number(event.target.value) })} onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} /><output>{Math.round(current[key])}</output></label>)}</div></section>;
}
