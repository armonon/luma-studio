"use client";
import type { TextAppearance } from "../../engine/document";

export function TextAppearanceEditor({ appearance, color, onChange, onCommit }: {
  appearance: TextAppearance; color: string;
  onChange: (appearance: TextAppearance, live?: boolean) => void; onCommit: () => void;
}) {
  const number = (value: string, max: number) => Math.max(0, Math.min(max, Number(value) || 0));
  return <div className="type-appearance-stack">
    <h4>Fills <small>bottom → top</small></h4>
    {appearance.fills.map((fill, index) => <div className="type-appearance-item" key={fill.id}>
      <label><input type="checkbox" checked={fill.enabled} onChange={event => onChange({ ...appearance, fills: appearance.fills.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item) })} />Fill {index + 1}</label>
      <input type="color" aria-label={`Fill ${index + 1} color`} value={fill.color} onChange={event => onChange({ ...appearance, fills: appearance.fills.map((item, i) => i === index ? { ...item, color: event.target.value } : item) })} />
      <label>Opacity %<input type="number" min={0} max={100} value={Math.round(fill.opacity * 100)} onChange={event => onChange({ ...appearance, fills: appearance.fills.map((item, i) => i === index ? { ...item, opacity: number(event.target.value, 100) / 100 } : item) }, true)} onBlur={onCommit} /></label>
      <button aria-label={`Remove fill ${index + 1}`} onClick={() => onChange({ ...appearance, fills: appearance.fills.filter((_, i) => i !== index) })}>×</button>
    </div>)}
    <button disabled={appearance.fills.length >= 8} onClick={() => onChange({ ...appearance, fills: [...appearance.fills, { id: `fill-${Date.now()}-${appearance.fills.length}`, kind: "solid", color, opacity: 1, enabled: true }] })}>Add fill</button>
    <h4>Outlines <small>wide → narrow</small></h4>
    {appearance.strokes.map((stroke, index) => <div className="type-appearance-item" key={stroke.id}>
      <label><input type="checkbox" checked={stroke.enabled} onChange={event => onChange({ ...appearance, strokes: appearance.strokes.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item) })} />Outline {index + 1}</label>
      <input type="color" aria-label={`Outline ${index + 1} color`} value={stroke.color} onChange={event => onChange({ ...appearance, strokes: appearance.strokes.map((item, i) => i === index ? { ...item, color: event.target.value } : item) })} />
      <label>Width px<input type="number" min={0} max={200} value={stroke.width} onChange={event => onChange({ ...appearance, strokes: appearance.strokes.map((item, i) => i === index ? { ...item, width: number(event.target.value, 200) } : item) }, true)} onBlur={onCommit} /></label>
      <label>Opacity %<input type="number" min={0} max={100} value={Math.round(stroke.opacity * 100)} onChange={event => onChange({ ...appearance, strokes: appearance.strokes.map((item, i) => i === index ? { ...item, opacity: number(event.target.value, 100) / 100 } : item) }, true)} onBlur={onCommit} /></label>
      <button aria-label={`Remove outline ${index + 1}`} onClick={() => onChange({ ...appearance, strokes: appearance.strokes.filter((_, i) => i !== index) })}>×</button>
    </div>)}
    <button disabled={appearance.strokes.length >= 8} onClick={() => onChange({ ...appearance, strokes: [...appearance.strokes, { id: `stroke-${Date.now()}-${appearance.strokes.length}`, color: "#111111", width: Math.max(1, 8 - appearance.strokes.length * 2), opacity: 1, enabled: true }] })}>Add outline</button>
    <p className="type-studio-note">Up to 8 fills and 8 outlines. Disable all fills for outline-only lettering. Text remains editable.</p>
  </div>;
}
