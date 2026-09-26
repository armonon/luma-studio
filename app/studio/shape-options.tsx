"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildShapeGeometry, SHAPE_PRESETS, type CustomShape, type ShapeSettings } from "../engine/shape-library";
import { vectorPathData } from "../engine/vector-path";

export type ShapeOptionsProps = {
  settings: ShapeSettings; fill: string; custom: CustomShape[]; enabled: boolean; canSave: boolean;
  onChange: (patch: Partial<ShapeSettings>) => void; onPreset: (id: string) => void;
  onFill: (color: string) => void; onSave: () => void; onRemove: (id: string) => void;
};

function ShapePreview({ id, custom }: { id: string; custom?: CustomShape }) {
  const geometry = buildShapeGeometry({ preset: id, sides: 5, innerRatio: .42, radius: 6, filled: true, stroke: "currentColor", strokeWidth: 1 }, { x: 3, y: 3, width: 26, height: 26 }, "currentColor", custom);
  return <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
    {geometry.kind === "shape" ? geometry.style.kind === "rect" ? <rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <ellipse cx="16" cy="16" rx="13" ry="13" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <path d={vectorPathData(geometry.path)} fill={id === "line" ? "none" : "currentColor"} fillRule={geometry.path.fillRule} stroke="currentColor" strokeWidth="1" />}
  </svg>;
}

export default function ShapeOptions(props: ShapeOptionsProps) {
  const { settings, onChange, enabled } = props;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { setPosition(null); trigger.current?.focus(); };
  useEffect(() => { if (position) dialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [position]);
  const presets = [...SHAPE_PRESETS.map(p => ({ id: p.id as string, label: p.label as string, custom: undefined as CustomShape | undefined })), ...props.custom.map(p => ({ id: p.id, label: `${p.name} · custom`, custom: p }))];
  const selected = presets.find(p => p.id === settings.preset);
  return <div className="studio-context-controls shape-tool-controls" aria-label="Shape creation options">
    <div className="shape-picker">
      <button ref={trigger} type="button" disabled={!enabled} aria-expanded={!!position} aria-haspopup="dialog" onClick={e => { const bounds = e.currentTarget.getBoundingClientRect(); setPosition(position ? null : { left: Math.max(8, Math.min(bounds.left, window.innerWidth - 348)), top: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 440)) }); }} title="Choose a shape to draw"><ShapePreview id={selected?.id ?? "star"} custom={selected?.custom} /><span>{selected?.label ?? "Choose shape"}</span><span aria-hidden="true">⌄</span></button>
      {position && createPortal(<div className="shape-picker-backdrop" onPointerDown={close}><div ref={dialog} className="shape-picker-dialog" style={position} role="dialog" aria-modal="true" aria-label="Shape library" onPointerDown={e => e.stopPropagation()} onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); close(); }
        if (e.key === "Tab") {
          const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
        <header><strong>Shapes</strong><button type="button" aria-label="Close shape library" onClick={close}>×</button></header>
        <div className="shape-preset-grid">{presets.map(p => <button type="button" key={p.id} title={p.label} aria-label={`Draw ${p.label}`} aria-pressed={settings.preset === p.id} onClick={() => { props.onPreset(p.id); close(); }}><ShapePreview id={p.id} custom={p.custom} /><span>{p.label}</span></button>)}</div>
        <footer><button type="button" disabled={!props.canSave} onClick={props.onSave} title="Save selected vector outline; excludes paint, masks and effects">Save selected outline</button>{selected?.custom && <button type="button" onClick={() => props.onRemove(selected.id)}>Remove preset</button>}<small>Draw with Pen or combine vectors, then save their outline here. Saved locally on this device.</small></footer>
      </div></div>, document.body)}
    </div>
    <button type="button" disabled={!enabled || settings.preset === "line"} aria-pressed={settings.filled} onClick={() => onChange({ filled: !settings.filled })} title="Fill new shapes">Fill</button>
    <label className="context-color" title="New shape fill"><input type="color" aria-label="New shape fill" disabled={!enabled || !settings.filled || settings.preset === "line"} value={props.fill} onChange={e => props.onFill(e.target.value)} /></label>
    <label className="context-color" title="New shape stroke"><input type="color" aria-label="New shape stroke" disabled={!enabled} value={settings.stroke} onChange={e => onChange({ stroke: e.target.value })} /></label>
    <label className="shape-number"><span>Stroke</span><input aria-label="New shape stroke width" type="number" min={settings.preset === "line" ? 1 : 0} max={1000} disabled={!enabled} value={settings.strokeWidth} onChange={e => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) onChange({ strokeWidth: Math.max(settings.preset === "line" ? 1 : 0, Math.min(1000, v)) }); }} /><span>px</span></label>
    {settings.preset === "rect" && <label className="shape-number"><span>Corners</span><input type="number" aria-label="New rectangle corner radius" min={0} max={10000} value={settings.radius} disabled={!enabled} onChange={e => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) onChange({ radius: Math.max(0, Math.min(10000, v)) }); }} /></label>}
    {["polygon", "star"].includes(settings.preset) && <label className="shape-number"><span>{settings.preset === "star" ? "Points" : "Sides"}</span><input type="number" aria-label="Shape sides or points" min={3} max={64} value={settings.sides} disabled={!enabled} onChange={e => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) onChange({ sides: Math.max(3, Math.min(64, Math.round(v))) }); }} /></label>}
    {settings.preset === "star" && <label className="shape-number"><span>Inner %</span><input type="number" aria-label="Star inner radius percent" min={5} max={95} value={Math.round(settings.innerRatio * 100)} disabled={!enabled} onChange={e => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) onChange({ innerRatio: Math.max(5, Math.min(95, v)) / 100 }); }} /></label>}
    <span className="shape-draw-hint" title="Drag to draw. Shift: equal proportions or 45° line. Option: draw from center. Escape: cancel.">⇧ constrain · ⌥ center</span>
  </div>;
}
