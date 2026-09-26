"use client";
import type { PathStyle } from "../../engine/document";
import { vectorPaints, type VectorPaint } from "../../engine/vector-path";

export function VectorAppearanceEditor({ path, disabled, onChange }: { path: PathStyle; disabled: boolean; onChange: (path: PathStyle) => void }) {
  const paints = vectorPaints(path);
  const update = (index: number, patch: Partial<VectorPaint>) => onChange({ ...path, appearance: paints.map((p, i) => i === index ? { ...p, ...patch } : p) });
  return <fieldset disabled={disabled} style={{ padding: 6, border: "1px solid var(--border)" }}>
    <legend>Appearance · bottom to top</legend>
    {paints.map((paint, i) => <div key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 6 }}>
      <input aria-label={`Enable ${paint.kind} ${i + 1}`} type="checkbox" checked={paint.enabled} onChange={e => update(i, { enabled: e.target.checked })} />
      <span>{paint.kind}</span>
      {["none", "transparent"].includes(paint.color) && <small>none</small>}
      <input aria-label={`Paint ${i + 1} color`} type="color" value={/^#[\da-f]{6}$/i.test(paint.color) ? paint.color : "#000000"} onChange={e => update(i, { color: e.target.value })} />
      <label>Opacity<input aria-label={`Paint ${i + 1} opacity`} key={`${i}:opacity:${paint.opacity}`} style={{ width: 50 }} type="number" min={0} max={100} defaultValue={Math.round(paint.opacity * 100)} onBlur={e => { const n = Number(e.target.value); if (e.target.value && Number.isFinite(n) && n >= 0 && n <= 100 && n / 100 !== paint.opacity) update(i, { opacity: n / 100 }); }} /></label>
      {paint.kind === "stroke" && <label>Width<input aria-label={`Paint ${i + 1} width`} key={`${i}:width:${paint.width}`} style={{ width: 50 }} type="number" min={0} max={10000} defaultValue={paint.width} onBlur={e => { const n = Number(e.target.value); if (e.target.value && Number.isFinite(n) && n >= 0 && n <= 10000 && n !== paint.width) update(i, { width: n }); }} /></label>}
      <button type="button" aria-label={`Move paint ${i + 1} toward top`} disabled={i === paints.length - 1} onClick={() => { const next = [...paints]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; onChange({ ...path, appearance: next }); }}>↑</button>
      <button type="button" aria-label={`Remove paint ${i + 1}`} onClick={() => onChange({ ...path, appearance: paints.filter((_, index) => i !== index) })}>×</button>
    </div>)}
    <div style={{ display: "flex", gap: 4 }}>{(["fill", "stroke"] as const).map(kind => <button type="button" key={kind} disabled={paints.length >= 16} onClick={() => onChange({ ...path, appearance: [...paints, { kind, color: "#808080", enabled: true, opacity: 1, width: kind === "stroke" ? 4 : 0 }] })}>+ {kind}</button>)}</div>
  </fieldset>;
}
