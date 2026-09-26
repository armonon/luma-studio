"use client";
import { useRef, useState } from "react";
import type { Layer } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";
import { validateFormMesh } from "@/app/engine/form-mesh-asset";

export default function FormMeshPanel({ studio, layer, onExport }: { studio: Studio; layer: Layer; onExport: (blob: Blob, name: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState(() => structuredClone(layer.mesh3d!));
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const running = useRef(false);
  const run = async (work: () => Promise<unknown>) => {
    if (running.current) return; running.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { running.current = false; setBusy(false); }
  };
  return <section className="type-studio" aria-label="Form mesh editor">
    <p>{layer.mesh3d!.parts.length} mesh parts · solid PBR · editable geometry retained</p>
    <fieldset disabled={busy || layer.locked} style={{ display: "grid", gap: 8 }}>
      <div className="type-studio-grid">
        {([0, 1, 2] as const).map(axis => <label key={axis}>Rotate {"XYZ"[axis]}<input aria-label={`Mesh rotation ${"XYZ"[axis]}`} type="number" min={-180} max={180} value={draft.rotation[axis]} onChange={event => setDraft(current => { const next = structuredClone(current); next.rotation[axis] = event.target.valueAsNumber; return next; })} /></label>)}
        <label>Camera field of view<input aria-label="Mesh field of view" type="number" min={20} max={70} value={draft.fov} onChange={event => setDraft(current => ({ ...current, fov: event.target.valueAsNumber }))} /></label>
      </div>
      <div className="type-button-row">
        <button onClick={() => void run(async () => { validateFormMesh(draft); await studio.updateFormMesh(layer.id, draft); setMessage("Source and render updated. Undo restores both."); })}>Apply mesh view</button>
        <button onClick={() => { setDraft(structuredClone(layer.mesh3d!)); setMessage(""); }}>Reset changes</button>
      </div>
    </fieldset>
    <div className="type-button-row"><button disabled={busy} onClick={() => void run(async () => {
      validateFormMesh(layer.mesh3d);
      await onExport(new Blob([JSON.stringify(layer.mesh3d)], { type: "application/vnd.luma-form.mesh+json" }), `${layer.name.replace(/[^a-z0-9_-]+/gi, "-") || "Form-mesh"}.lumaformmesh`);
    })}>Export committed mesh to Form</button></div>
    <small>Change geometry and materials in Form, then return .lumaformmesh. Returns open as new documents; existing work is never overwritten. PNG/PSD contain the render only.</small>
    {message && <p role="status">{message}</p>}
  </section>;
}
