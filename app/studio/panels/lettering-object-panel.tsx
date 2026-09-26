"use client";
import { useState } from "react";
import type { Layer } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";
import { cloneLetteringAsset } from "@/app/engine/lettering-asset";
import { BUNDLED_FONTS, bundledFontForFamily } from "@/app/engine/bundled-fonts";
import { resolvedDefaultTextStyle } from "@/app/engine/text-model";
import { withTextSpatial } from "@/app/engine/text-3d";
import type { SmartContentTarget } from "@/app/engine/smart-object-content";
import TextMeshEditor from "./text-mesh-editor";

export default function LetteringObjectPanel({ studio, layer, onExport }: {
  studio: Studio; layer: Layer; onExport: (blob: Blob, name: string) => Promise<unknown>;
}) {
  const [session, setSession] = useState<{ target: SmartContentTarget; source: NonNullable<Layer["lettering3d"]> } | null>(null);
  const [draft, setDraft] = useState(() => cloneLetteringAsset(layer.lettering3d!));
  const [message, setMessage] = useState("");
  const changed = session && JSON.stringify(draft) !== JSON.stringify(session.source);
  const close = () => {
    if (changed && !window.confirm("Discard the unapplied 3D preview changes? The saved layer will stay unchanged.")) return;
    setSession(null);
  };
  const spatial = draft.spatial;
  const patchSpatial = (patch: Parameters<typeof withTextSpatial>[1]) => setDraft(current => ({ ...current, spatial: withTextSpatial(current.spatial, patch) }));
  const textStyle = resolvedDefaultTextStyle(draft.text);
  return <section aria-label="Editable 3D object" className="type-studio">
    <p>3D lettering · {layer.lettering3d!.width} × {layer.lettering3d!.height}</p>
    {!session ? <button disabled={layer.locked} onClick={() => {
      try { const target = studio.prepareLetteringEdit(layer.id); const source = cloneLetteringAsset(layer.lettering3d!); setDraft(cloneLetteringAsset(source)); setSession({ target, source }); setMessage(""); }
      catch (error) { setMessage(String(error)); }
    }}>Edit 3D source</button> : <>
      <p role="note">Preview edits are not applied to the document until you choose Apply 3D changes. Switching layers closes this preview.</p>
      <div className="type-studio-grid">
        <label className="type-wide"><span>Lettering</span><textarea aria-label="3D source text" maxLength={160} value={draft.text.text} onChange={event => setDraft(current => ({ ...current, text: { ...current.text, text: event.target.value } }))} /></label>
        <label><span>Font</span><select aria-label="3D font family" value={bundledFontForFamily(textStyle.fontFamily)?.family ?? "Lato"} onChange={event => setDraft(current => ({ ...current, text: { ...current.text, defaultStyle: { ...current.text.defaultStyle, fontFamily: event.target.value } } }))}>{BUNDLED_FONTS.map(font => <option key={font.family}>{font.family}</option>)}</select></label>
        <label><span>Weight</span><select aria-label="3D font weight" value={textStyle.fontWeight} onChange={event => setDraft(current => ({ ...current, text: { ...current.text, defaultStyle: { ...current.text.defaultStyle, fontWeight: Number(event.target.value) } } }))}>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map(weight => <option key={weight} value={weight}>{weight}</option>)}</select></label>
        {(["rotationX", "rotationY", "rotationZ", "perspective"] as const).map(key => <label key={key}><span>{key === "perspective" ? "Perspective" : `Rotate ${key.slice(-1)}`}</span><input aria-label={`3D ${key}`} type="number" min={key === "perspective" ? 0 : -180} max={key === "perspective" ? 100 : 180} value={spatial.transform[key]} onChange={event => patchSpatial({ transform: { [key]: Number(event.target.value) } })} /></label>)}
        {(["depth", "bevel"] as const).map(key => <label key={key}><span>{key === "depth" ? "Extrusion" : "Bevel"}</span><input aria-label={`3D ${key}`} type="number" min="0" max={key === "depth" ? 1000 : 100} value={spatial.extrusion[key]} onChange={event => patchSpatial({ extrusion: { [key]: Number(event.target.value) } })} /></label>)}
        {(["frontColor", "sideColor"] as const).map(key => <label key={key}><span>{key === "frontColor" ? "Front" : "Sides"}</span><input aria-label={`3D ${key}`} type="color" value={spatial.material[key]} onChange={event => patchSpatial({ material: { [key]: event.target.value } })} /></label>)}
        {(["roughness", "metalness"] as const).map(key => <label key={key}><span>{key}</span><input aria-label={`3D ${key}`} type="number" min="0" max="1" step="0.05" value={spatial.material[key]} onChange={event => patchSpatial({ material: { [key]: Number(event.target.value) } })} /></label>)}
      </div>
      <TextMeshEditor text={draft.text} spatial={draft.spatial} initialAsset={session.source}
        onLiveRotate={(rotationX, rotationY) => patchSpatial({ transform: { rotationX, rotationY } })} onCommit={() => {}}
        onRender={() => {}} showRasterAction={false} assetLabel="Apply 3D changes"
        onAsset={(canvas, asset) => { studio.updateLetteringObject(session.target, canvas, asset); setSession(null); setMessage("3D source and render updated. Undo restores both."); }}
        onExport={(blob, extension) => onExport(blob, `${layer.name.replace(/[^a-z0-9-]+/gi, "-")}.${extension}`)} />
      <button onClick={close}>Cancel preview</button>
    </>}
    {message && <p role="status">{message}</p>}
    <small>Text, positioned outlines, extrusion, materials and camera settings are stored in the .luma project. PNG and PSD contain the committed render, not editable 3D.</small>
  </section>;
}
