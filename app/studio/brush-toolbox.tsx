"use client";
import { memo, useEffect, useId, useRef, useState } from "react";
import { BRUSH_PRESETS, MIRROR_MODES, brushPreview, matchesBrushRecipe, type BrushRecipe, type MirrorSettings } from "./brush-library";
import "./brush-toolbox.css";

const previews = new WeakMap<BrushRecipe, ReturnType<typeof brushPreview>>();
const previewJobs = new Set<() => void>();
let previewTimer: ReturnType<typeof setTimeout> | null = null;
function queuePreview(job: () => void) {
  previewJobs.add(job);
  const tick = () => {
    previewTimer = null;
    const next = previewJobs.values().next().value;
    if (next) { previewJobs.delete(next); next(); }
    if (previewJobs.size) previewTimer = setTimeout(tick, 16);
  };
  if (previewTimer === null) previewTimer = setTimeout(tick, 0);
  return () => { previewJobs.delete(job); };
}

const StrokePreview = memo(function StrokePreview({ settings }: { settings: BrushRecipe }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancel: (() => void) | undefined;
    // Wait for visible swatches; hidden categories and off-screen cards cost no paint.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      cancel = queuePreview(() => {
        const preview = previews.get(settings) ?? brushPreview(settings);
        previews.set(settings, preview);
        canvas.getContext("2d")?.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0);
      });
    });
    observer.observe(canvas);
    return () => { observer.disconnect(); cancel?.(); };
  }, [settings]);
  return <canvas ref={ref} width={160} height={44} aria-hidden="true" />;
});

export type PaintSection = "library" | "mirror" | "settings";
const sections = [["library", "Brushes"], ["mirror", "Mirror"], ["settings", "Settings"]] as const;

export default function BrushToolbox({ settings, onPreset, mirror, onMirror, onCapture, onDone, activeBrush, mirrorAvailable, section, onSection }: {
  settings: BrushRecipe; onPreset: (settings: BrushRecipe) => void;
  mirror: MirrorSettings; onMirror: (settings: MirrorSettings) => void;
  onCapture: () => void; onDone?: () => void; activeBrush: boolean; mirrorAvailable: boolean;
  section?: PaintSection; onSection?: (section: PaintSection) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const chosen = activeBrush ? BRUSH_PRESETS.find(p => matchesBrushRecipe(p.settings, settings)) : undefined;
  const results = BRUSH_PRESETS.filter(p => (category === "All" || category === p.category) && `${p.name} ${p.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="brush-toolbox">
    <div className="brush-toolbox-navigation">
    <div className="brush-toolbox-heading"><div><strong>Brush library</strong><span>{chosen?.name ?? (activeBrush ? "Custom settings" : "Choose a painting brush")} · {BRUSH_PRESETS.length} brushes</span></div>{onDone && <button onClick={onDone}>Done</button>}</div>
    {section && onSection && <div className="brush-section-tabs" role="group" aria-label="Paint toolbox sections">
      {sections.map(([key, label]) => <button key={key} aria-pressed={section === key} aria-controls={`${id}-${key}`} onClick={() => onSection(key)}>{label}{key === "mirror" && mirror.mode !== "none" && <i aria-label="enabled" />}</button>)}
    </div>}
    </div>
    <div id={`${id}-library`} hidden={section !== undefined && section !== "library"} className="brush-library-content">
    <input type="search" aria-label="Search brushes" placeholder="Find your brush…" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="brush-categories" aria-label="Brush categories">{["All", ...new Set(BRUSH_PRESETS.map(p => p.category))].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
    <div className="brush-preset-grid" aria-label="Brush presets">{results.map(p => <button key={p.id} aria-pressed={chosen?.id === p.id} onClick={() => onPreset(p.settings)} title={p.description}>
      <StrokePreview settings={p.settings} /><strong>{p.name}</strong><small>{p.category}</small>
    </button>)}{results.length === 0 && <p role="status">No matching brushes. Try another name or category.</p>}</div>
    <small className="brush-preview-note">Previews show pen pressure. Fingers paint at full pressure.</small>
    <button className="brush-capture-link" onClick={onCapture}>＋ Make a brush from an image</button>
    </div>
    <div id={`${id}-mirror`} hidden={section !== undefined && section !== "mirror"}>
    <fieldset disabled={!mirrorAvailable} className="brush-mirror-controls" aria-label="Paint symmetry">
      {!mirrorAvailable && <small>Choose a painting brush to use symmetry.</small>}
      <div className="brush-toolbox-heading"><strong>Mirror & repeat</strong><span>{mirror.mode === "none" ? "Off" : "Live strokes"}</span></div>
      <div className="brush-mirror-modes">{MIRROR_MODES.map(mode => <button key={mode.id} aria-pressed={mirror.mode === mode.id} onClick={() => onMirror({ ...mirror, mode: mode.id })}>{mode.label}</button>)}</div>
      {(mirror.mode === "radial" || mirror.mode === "kaleidoscope") && <label className="brush-mirror-range"><span>Repeats</span><input aria-label="Symmetry repeats" type="range" min={2} max={12} step={1} value={mirror.segments} onChange={e => onMirror({ ...mirror, segments: Number(e.target.value) })} /><output>{mirror.segments}</output></label>}
      {mirror.mode !== "none" && <details><summary>Move symmetry center</summary>
        {(["x", "y"] as const).map(axis => <label key={axis} className="brush-mirror-range"><span>{axis.toUpperCase()}</span><input aria-label={`Symmetry center ${axis.toUpperCase()}`} type="range" min={0} max={100} value={Math.round(mirror[axis] * 100)} onChange={e => onMirror({ ...mirror, [axis]: Number(e.target.value) / 100 })} /><output>{Math.round(mirror[axis] * 100)}%</output></label>)}
        <button onClick={() => onMirror({ ...mirror, x: 0.5, y: 0.5 })}>Center on canvas</button>
      </details>}
    </fieldset>
    </div>
    <p id={`${id}-settings`} hidden={section !== "settings"} className="brush-preview-note">Customize the active tool below. Changes apply to your next stroke.</p>
  </div>;
}
