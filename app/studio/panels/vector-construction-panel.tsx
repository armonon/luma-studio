"use client";
import { useState } from "react";
import type { Layer } from "../../engine/document";
import type { Studio } from "../../engine/studio";
import { pathContours } from "../../engine/vector-path";
import { exportVectorSvg } from "../../engine/vector-delivery";
import { booleanDisabledReason, executeVectorBoolean, executeVectorOffset, VECTOR_COMMANDS } from "../vector-command-registry";
import { VectorAppearanceEditor } from "./vector-appearance-editor";

export default function VectorConstructionPanel({ studio, layer, onSelect, onNotify, onSave }: {
  studio: Studio; layer: Layer; onSelect: (id: string) => void; onNotify: (message: string) => void;
  onSave: (blob: Blob, name: string) => Promise<unknown>;
}) {
  const [operandId, setOperandId] = useState("");
  const [busy, setBusy] = useState(false);
  const [distance, setDistance] = useState(10);
  const [join, setJoin] = useState<"round" | "miter" | "square">("round");
  const reason = booleanDisabledReason(layer);
  const recipe = layer.path?.booleanSource;
  const editBlocked = !!layer.locked || !!layer.path?.symbolId && studio.doc.layers.some(l => l.path?.symbolId === layer.path!.symbolId && l.locked);
  return <section className="vector-construction-panel" aria-label="Vector construction" style={{ display: "grid", gap: 8, padding: "8px 0" }}>
    <style>{`.vector-construction-panel button { min-height:28px; padding:4px 8px; border:1px solid var(--border, #ffffff22); border-radius:4px; } .vector-construction-panel button:hover:not(:disabled) { background:#ffffff0c; } .vector-construction-panel button:focus-visible { outline:2px solid #558bff; outline-offset:2px; } .vector-construction-panel button:disabled { opacity:.45; cursor:not-allowed; } .vector-construction-panel button:active:not(:disabled) { background:#ffffff20; } .vector-construction-panel button[aria-pressed="true"] { background:#558bff30; }`}</style>
    <strong>Vector construction</strong>
    {layer.path && <small>{pathContours(layer.path).length} contours · {pathContours(layer.path).reduce((n, c) => n + c.anchors.length, 0)} anchors</small>}
    {!recipe && <label>Combine with<select aria-label="Second boolean operand" value={operandId} disabled={busy} onChange={e => setOperandId(e.target.value)}>
      <option value="">Choose a vector layer…</option>
      {studio.doc.layers.filter(l => l.id !== layer.id && (l.path || l.shape)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select></label>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
      {VECTOR_COMMANDS.map(command => <button key={command.id} type="button" aria-pressed={recipe?.operation === command.id} disabled={busy || !!reason || !recipe && !operandId} title={reason ?? command.description} onClick={async () => {
        setBusy(true);
        try { const result = await executeVectorBoolean(studio, layer.id, recipe ? null : operandId, command.id); onSelect(result.id); onNotify("Boolean shape updated; original operands preserved"); }
        catch (error) { onNotify(error instanceof Error ? error.message : "Boolean operation failed"); }
        finally { setBusy(false); }
      }}>{command.label}</button>)}
    </div>
    {busy && <span role="status">Calculating geometry…</span>}
    <fieldset disabled={busy || editBlocked || !!layer.path?.symbolId} style={{ display: "grid", gap: 6, padding: 8, border: "1px solid var(--border, #ffffff22)" }}>
      <legend>Offset path</legend>
      <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>Distance (local px)<input style={{ width: 70 }} type="number" aria-label="Offset distance" min={-1000} max={1000} value={Number.isNaN(distance) ? "" : distance} onChange={e => setDistance(e.target.valueAsNumber)} /></label>
      <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>Join<select aria-label="Offset join" value={join} onChange={e => setJoin(e.target.value as typeof join)}><option value="round">Round</option><option value="miter">Miter</option><option value="square">Square</option></select></label>
      <button type="button" disabled={!Number.isFinite(distance) || Math.abs(distance) > 1000} onClick={async () => {
        setBusy(true);
        try { const result = await executeVectorOffset(studio, layer.id, distance, join); onSelect(result.id); onNotify("Offset updated from retained source contours"); }
        catch (error) { onNotify(error instanceof Error ? error.message : "Offset failed"); }
        finally { setBusy(false); }
      }}>{layer.path?.offsetSource ? "Update offset" : "Create offset"}</button>
      {layer.path?.offsetSource && <><small>Current: {layer.path.offsetSource.distance} px · {layer.path.offsetSource.join}</small><button type="button" onClick={() => studio.updatePath(layer.id, { ...layer.path!, offsetSource: undefined })}>Expand offset</button></>}
      <small>Closed contours · 0.25 px curve approximation</small>
    </fieldset>
    {recipe && <button type="button" disabled={busy || editBlocked} title="Keep the current contours and discard the editable boolean recipe; undo restores it" onClick={() => studio.updatePath(layer.id, { ...layer.path!, booleanSource: undefined })}>Expand to editable contours</button>}
    {layer.path && <>
      <VectorAppearanceEditor path={layer.path} disabled={busy || editBlocked} onChange={path => { try { studio.updatePath(layer.id, path); } catch (error) { onNotify(error instanceof Error ? error.message : "Appearance edit failed"); } }} />
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" disabled={busy || editBlocked} onClick={() => { try { const instance = studio.createVectorInstance(layer.id); onSelect(instance.id); onNotify("Linked vector instance added; geometry and paints update together"); } catch (error) { onNotify(error instanceof Error ? error.message : "Instance creation failed"); } }}>Create linked instance</button>
        {layer.path.symbolId && <button type="button" disabled={busy || layer.locked} onClick={() => studio.detachVectorInstance(layer.id)}>Detach instance</button>}
      </div>
      {layer.path.symbolId && <small>{studio.doc.layers.filter(l => l.path?.symbolId === layer.path!.symbolId).length} linked vector instances · independent transforms</small>}
      <label>Fill rule<select aria-label="Vector fill rule" disabled={busy || editBlocked || !!recipe} value={layer.path.fillRule ?? "nonzero"} onChange={e => studio.updatePath(layer.id, { ...layer.path!, fillRule: e.target.value as "nonzero" | "evenodd" })}><option value="nonzero">Non-zero</option><option value="evenodd">Even-odd (holes)</option></select></label>
      {!layer.path.appearance && <fieldset disabled={busy || editBlocked} style={{ border: 0, padding: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <label>Fill<input aria-label="Path fill" type="color" disabled={busy || layer.locked} value={/^#[\da-f]{6}$/i.test(layer.path.fill) ? layer.path.fill : "#000000"} onChange={e => studio.updatePath(layer.id, { ...layer.path!, fill: e.target.value })} /></label>
        <button type="button" disabled={busy || layer.locked} onClick={() => studio.updatePath(layer.id, { ...layer.path!, fill: "none" })}>No fill</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <label>Stroke<input aria-label="Path stroke color" type="color" disabled={busy || layer.locked} value={/^#[\da-f]{6}$/i.test(layer.path.stroke) ? layer.path.stroke : "#000000"} onChange={e => studio.updatePath(layer.id, { ...layer.path!, stroke: e.target.value })} /></label>
        <button type="button" disabled={busy || layer.locked} onClick={() => studio.updatePath(layer.id, { ...layer.path!, stroke: "none", strokeWidth: 0 })}>No stroke</button>
      </div>
      <label>Stroke width<input key={`${layer.id}:${layer.path.strokeWidth}`} aria-label="Path stroke width" type="number" min={0} max={10000} defaultValue={layer.path.strokeWidth} disabled={busy || layer.locked} onBlur={e => {
        const width = Number(e.target.value);
        if (Number.isFinite(width) && width >= 0 && width <= 10000) studio.updatePath(layer.id, { ...layer.path!, strokeWidth: width });
      }} /></label>
      </fieldset>}
    </>}
    <button type="button" disabled={busy} onClick={async () => {
      try { const svg = exportVectorSvg(studio.doc, [layer]); await onSave(new Blob([svg], { type: "image/svg+xml" }), `${layer.name.replace(/[^a-z0-9_-]/gi, "-") || "vector"}.svg`); }
      catch (error) { onNotify(error instanceof Error ? error.message : "SVG export failed"); }
    }}>Export selected vector SVG</button>
    <small>Solid vectors only · sRGB · original layers retained</small>
  </section>;
}
