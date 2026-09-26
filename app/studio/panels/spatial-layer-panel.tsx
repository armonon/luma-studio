"use client";

import type { Layer } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";
import { DEFAULT_TEXT_SPATIAL } from "@/app/engine/text-3d";
import { spatialOperationsForTool } from "../spatial-capability-registry";
import type { Tool } from "../tool-registry";

const PRESETS = [
  { label: "Flat", transform: { rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 24 }, depth: 0 },
  { label: "Tilt", transform: { rotationX: -18, rotationY: 28, rotationZ: -4, perspective: 32 }, depth: 16 },
  { label: "Iso", transform: { rotationX: -28, rotationY: 36, rotationZ: 8, perspective: 22 }, depth: 24 },
  { label: "Poster", transform: { rotationX: 4, rotationY: -20, rotationZ: -8, perspective: 44 }, depth: 36 },
] as const;

export default function SpatialLayerPanel({ layer, tool, studio, onSendToForm }: { layer: Layer | null | undefined; tool: Tool; studio: Studio | null; onSendToForm: () => void }) {
  const spatial = layer?.spatial ?? layer?.text?.spatial ?? DEFAULT_TEXT_SPATIAL;
  const supported = Boolean(layer && !layer.lettering3d && layer.kind !== "group" && !layer.kind.startsWith("adjustment-"));
  const operations = spatialOperationsForTool(tool);
  const live = (patch: Parameters<Studio["liveUpdateLayerSpatial"]>[1]) => layer && studio?.liveUpdateLayerSpatial(layer.id, patch);
  const commit = () => layer && studio?.updateLayerSpatial(layer.id, {});
  const set = (patch: Parameters<Studio["updateLayerSpatial"]>[1]) => layer && studio?.updateLayerSpatial(layer.id, patch);

  return (
    <section className="desktop-spatial-panel" aria-label="Spatial tools">
      <header><span><strong>3D workspace</strong><small>{operations[0]?.label ?? "Spatial"} for {tool.replaceAll("-", " ")}</small></span><button type="button" role="switch" aria-checked={spatial.enabled} className={spatial.enabled ? "active" : ""} disabled={!supported} onClick={() => set({ enabled: !spatial.enabled })}><i /></button></header>
      <div className="desktop-spatial-capabilities" aria-label="Available spatial operations">
        {operations.slice(0, 5).map((operation) => <span key={operation.id} title={operation.summary}>{operation.label}</span>)}
      </div>
      {supported && spatial.enabled && <>
        <div className="desktop-spatial-presets">{PRESETS.map((preset) => <button type="button" key={preset.label} onClick={() => set({ transform: preset.transform, extrusion: { depth: preset.depth } })}>{preset.label}</button>)}</div>
        <div className="desktop-spatial-fields">
          {(["rotationX", "rotationY", "rotationZ"] as const).map((axis) => <label key={axis}><span>{axis.at(-1)}</span><input type="number" min="-180" max="180" value={Math.round(spatial.transform[axis] * 10) / 10} onChange={(event) => live({ transform: { [axis]: Number(event.target.value) } })} onBlur={commit} /><em>°</em></label>)}
          <label><span>Depth</span><input type="number" min="0" max="1000" value={spatial.extrusion.depth} onChange={(event) => live({ extrusion: { depth: Number(event.target.value) } })} onBlur={commit} /><em>px</em></label>
          <label><span>Lens</span><input type="number" min="0" max="100" value={spatial.transform.perspective} onChange={(event) => live({ transform: { perspective: Number(event.target.value) } })} onBlur={commit} /><em>%</em></label>
          <label><span>Bevel</span><input type="number" min="0" max="100" value={spatial.extrusion.bevel} onChange={(event) => live({ extrusion: { bevel: Number(event.target.value) } })} onBlur={commit} /><em>px</em></label>
        </div>
      </>}
      {layer && !layer.lettering3d && <button type="button" className="desktop-spatial-send" onClick={onSendToForm}>Send layer to Form Studio</button>}
      {layer?.lettering3d && <p>Use Type &amp; shape → Edit 3D source for this object’s geometry, materials and camera. Export GLB there for Form Studio.</p>}
      {!supported && <p>Select a pixel, smart-object, vector, path or text layer to create spatial content. Adjustment and group tools produce passes rather than geometry.</p>}
    </section>
  );
}
