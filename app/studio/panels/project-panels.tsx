"use client";

import type { Document } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";

export function StructurePanel({
  studio,
  document,
  layerCompName,
  artboardName,
  onLayerCompNameChange,
  onArtboardNameChange,
  onExportArtboard,
  onNotify,
}: Readonly<{
  studio: Studio | null;
  document: Document | null | undefined;
  layerCompName: string;
  artboardName: string;
  onLayerCompNameChange: (name: string) => void;
  onArtboardNameChange: (name: string) => void;
  onExportArtboard: (id: string, name: string) => void;
  onNotify: (message: string) => void;
}>) {
  return <>
    <section className="glass-card mask-card" data-contextual-panel="structure">
      <header><strong>Layer comps</strong><small>{document?.layerComps?.length ?? 0}</small></header>
      <div className="inspector-create-row">
        <input value={layerCompName} maxLength={80} onChange={(event) => onLayerCompNameChange(event.target.value)} aria-label="New layer comp name" />
        <button onClick={() => {
          const comp = studio?.captureLayerComp(layerCompName);
          if (comp) onNotify(`Captured ${comp.name}`);
        }} aria-label="Capture layer comp" title="Capture current layer state">＋</button>
      </div>
      {!!document?.layerComps?.length && (
        <div style={{ display: "grid", gap: 4, padding: "0 10px 9px" }}>
          {document.layerComps.map((comp) => (
            <div key={comp.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 4, alignItems: "center" }}>
              <button onClick={() => studio?.applyLayerComp(comp.id)} style={{ textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`Apply ${comp.name}`}>{comp.name}</button>
              <button onClick={() => { studio?.recaptureLayerComp(comp.id); onNotify(`Updated ${comp.name}`); }} title="Recapture from current layers">↻</button>
              <button onClick={() => studio?.applyLayerComp(comp.id)} title="Apply layer comp">▶</button>
              <button onClick={() => studio?.removeLayerComp(comp.id)} title="Remove layer comp">×</button>
            </div>
          ))}
        </div>
      )}
    </section>
    <section className="glass-card mask-card" data-contextual-panel="structure">
      <header><strong>Artboards</strong><small>{document?.artboards?.length ?? 0}</small></header>
      <div className="inspector-create-row">
        <input value={artboardName} maxLength={80} onChange={(event) => onArtboardNameChange(event.target.value)} aria-label="New artboard name" />
        <button onClick={() => {
          const bounds = document?.selection?.bounds;
          const artboard = studio?.createArtboard(artboardName, bounds ? { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h } : undefined);
          if (artboard) onNotify(`Created ${artboard.name}${bounds ? " from selection" : ""}`);
        }} aria-label={`Create artboard from ${document?.selection ? "selection" : "canvas"}`} title={`Create from ${document?.selection ? "selection" : "canvas"}`}>＋</button>
      </div>
      {!!document?.artboards?.length && (
        <div style={{ display: "grid", gap: 4, padding: "0 10px 9px" }}>
          {document.artboards.map((artboard) => (
            <div key={artboard.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 4, alignItems: "center" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }} title={artboard.name}>{artboard.name} · {artboard.width}×{artboard.height}</span>
              <button onClick={() => onExportArtboard(artboard.id, artboard.name)} title="Export artboard as PNG">↗</button>
              <button onClick={() => studio?.removeArtboard(artboard.id)} title="Remove artboard">×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  </>;
}

type PluginSummary = Readonly<{ id: string; name?: string; version?: string }>;

export function AssetsPanel({ plugins, capturedBrushCount, desktop, onInstall, onUninstall }: Readonly<{
  plugins: readonly PluginSummary[];
  capturedBrushCount: number;
  desktop: boolean;
  onInstall: () => void;
  onUninstall: (pluginId: string) => void;
}>) {
  return (
    <section className="glass-card mask-card" data-contextual-panel="assets">
      <header><strong>Assets</strong><small>{plugins.length + capturedBrushCount}</small>{desktop && <button onClick={onInstall} title="Install a safe declarative .luma-plugin package">＋ Plugin</button>}</header>
      <div style={{ display: "grid", gap: 4, padding: "8px 10px" }}>
        {plugins.length ? plugins.map((plugin) => (
          <div key={plugin.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis" }}>{plugin.name ?? plugin.id}{plugin.version ? ` · ${plugin.version}` : ""}</span>
            <button onClick={() => onUninstall(plugin.id)} title={`Unload ${plugin.name ?? plugin.id}`}>Unload</button>
          </div>
        )) : <small className="inspector-empty-state">No plug-ins or saved brushes</small>}
      </div>
    </section>
  );
}
