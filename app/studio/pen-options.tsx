"use client";
import type { PenSnapSettings } from "./pen-snap";
export type PenOptionsProps = {
  settings: PenSnapSettings; enabled: boolean; count: number;
  onChange: (patch: Partial<PenSnapSettings>) => void; onFinish: () => void; onClose: () => void;
};
export default function PenOptions({ settings, enabled, count, onChange, onFinish, onClose }: PenOptionsProps) {
  return <div className="studio-context-controls pen-tool-controls" aria-label="Pen precision options">
    <button disabled={!enabled} aria-pressed={settings.snap} onClick={() => onChange({ snap: !settings.snap })} title="Snap to draft anchors, document guides and canvas edges/center. Option bypasses snapping.">Snap</button>
    <button disabled={!enabled || !settings.snap} aria-pressed={settings.grid} onClick={() => onChange({ grid: !settings.grid })} title="Snap near document-space grid intersections">Grid</button>
    {settings.grid && <label className="pen-number">Grid px<input aria-label="Pen grid spacing" type="number" min={1} max={10000} disabled={!enabled || !settings.snap} value={settings.gridSize} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) onChange({ gridSize: e.target.valueAsNumber }); }} /></label>}
    <label className="pen-angle">Shift angle<select aria-label="Pen angle constraint" value={settings.angleStep} disabled={!enabled} onChange={e => onChange({ angleStep: Number(e.target.value) })}>{[15, 30, 45, 90].map(angle => <option value={angle} key={angle}>{angle}°</option>)}</select></label>
    <button disabled={!enabled} aria-pressed={settings.measurements} onClick={() => onChange({ measurements: !settings.measurements })} title="Show document-pixel distance, angle and coordinate deltas. Chord is straight-line distance, not curve length.">Measure</button>
    <button disabled={!enabled || count < 2} onClick={onFinish} title="Finish open path (Enter)">Finish</button>
    <button disabled={!enabled || count < 2} onClick={onClose} title="Join the final anchor to the first">Close path</button>
    <span className="pen-tool-hint">⇧ angle · ⌥ free · Esc cancel</span>
  </div>;
}
