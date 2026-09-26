"use client";

import type { Layer } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";
import { CONTEXTUAL_PANEL_CHOICES, type ContextualPanelId } from "../contextual-panel-registry";
import type { Tool, WorkspaceMode } from "../tool-registry";
import SpatialLayerPanel from "./spatial-layer-panel";
import LayerThumbnail from "../layer-thumbnail";
import { Box, Eye, EyeOff, Focus, LockKeyhole, UnlockKeyhole } from "lucide-react";

export type PropertiesPanelProps = Readonly<{
  showPanelPicker: boolean;
  toolLabel: string;
  hasSelection: boolean;
  workspace: WorkspaceMode;
  contextualOverride: ContextualPanelId | null;
  activeLayer: Layer | null | undefined;
  documentWidth: number;
  documentHeight: number;
  activeTool: Tool;
  paintingTool: boolean;
  warpRadius: number;
  showRadialOverlay: boolean;
  brushSize: number;
  hardness: number;
  brushOpacity: number;
  spaceToolLabel: string;
  studio: Studio | null;
  onContextPanelChange: (panel: ContextualPanelId | null) => void;
  onFocusLayer: (layerId: string) => void;
  onDisableRadialWarp: () => void;
  onWarpRadiusChange: (radius: number) => void;
  onToggleRadialOverlay: () => void;
  onBrushSizeChange: (size: number) => void;
  onHardnessChange: (hardness: number) => void;
  onBrushOpacityChange: (opacity: number) => void;
  onPreviewOpacity: (layerId: string, opacity: number) => void;
  onCommitOpacity: (layerId: string, opacity: number) => void;
  onSetLayerVisible: (layerId: string, visible: boolean) => void;
  onOpenSpaceDeck: () => void;
  onAddBlank: () => void;
  onSendToForm: () => void;
}>;

export default function PropertiesPanel({
  showPanelPicker,
  toolLabel,
  hasSelection,
  workspace,
  contextualOverride,
  activeLayer,
  documentWidth,
  documentHeight,
  activeTool,
  paintingTool,
  warpRadius,
  showRadialOverlay,
  brushSize,
  hardness,
  brushOpacity,
  spaceToolLabel,
  studio,
  onContextPanelChange,
  onFocusLayer,
  onDisableRadialWarp,
  onWarpRadiusChange,
  onToggleRadialOverlay,
  onBrushSizeChange,
  onHardnessChange,
  onBrushOpacityChange,
  onPreviewOpacity,
  onCommitOpacity,
  onSetLayerVisible,
  onOpenSpaceDeck,
  onAddBlank,
  onSendToForm,
}: PropertiesPanelProps) {
  return (
    <section className="glass-card desktop-properties-card">
      <header>
        <strong>{toolLabel}</strong>
        <small>{hasSelection ? "SELECTION" : workspace.toUpperCase()}</small>
      </header>
      <div className="desktop-properties-body">
        {showPanelPicker && (
          <label className="desktop-context-panel-picker">
            <span>Panel</span>
            <select
              aria-label="Contextual inspector panel"
              value={contextualOverride ?? ""}
              onChange={(event) => onContextPanelChange((event.target.value || null) as ContextualPanelId | null)}
            >
              <option value="">Auto</option>
              {CONTEXTUAL_PANEL_CHOICES.map((panel) => <option key={panel.id} value={panel.id}>{panel.label}</option>)}
            </select>
          </label>
        )}
        <div className="desktop-property-target">
          <LayerThumbnail layer={activeLayer} />
          <span>
            <strong>{activeLayer?.name ?? "Canvas"}</strong>
            <small>{activeLayer ? `${activeLayer.kind.replaceAll("-", " ")} · ${activeLayer.visible ? "visible" : "hidden"}${activeLayer.locked ? " · locked" : ""}` : `${documentWidth} × ${documentHeight}`}</small>
          </span>
          {activeLayer && <button type="button" onClick={() => onFocusLayer(activeLayer.id)} title="Focus this layer" aria-label="Focus this layer"><Focus size={16} /></button>}
        </div>
        <details className="desktop-quick-controls">
        <summary>Quick controls</summary>
        {activeTool === "radial-warp" ? <>
          <div className="desktop-property-switch">
            <span><strong>Radial warp</strong><small>Drag inside the ring to reshape locally</small></span>
            <button type="button" role="switch" aria-checked className="active" onClick={onDisableRadialWarp} aria-label="Disable radial warp"><i /></button>
          </div>
          <label className="desktop-property-range">
            <span>Influence</span>
            <input type="range" min="16" max="600" value={warpRadius} onChange={(event) => onWarpRadiusChange(Number(event.target.value))} />
            <output>{warpRadius}px</output>
          </label>
          <div className="desktop-property-row">
            <span>Overlay</span>
            <button type="button" className={showRadialOverlay ? "active" : ""} aria-pressed={showRadialOverlay} onClick={onToggleRadialOverlay}>{showRadialOverlay ? "Visible" : "Hidden"}</button>
          </div>
        </> : (paintingTool || workspace === "mask") ? <>
          <label className="desktop-property-range">
            <span>Size</span>
            <input type="range" min="1" max={activeTool === "capture-brush" ? 1200 : 400} value={brushSize} onChange={(event) => onBrushSizeChange(Number(event.target.value))} />
            <output>{brushSize}px</output>
          </label>
          <label className="desktop-property-range">
            <span>Hardness</span>
            <input type="range" min="0" max="100" value={Math.round(hardness * 100)} onChange={(event) => onHardnessChange(Number(event.target.value) / 100)} />
            <output>{Math.round(hardness * 100)}%</output>
          </label>
          <label className="desktop-property-range">
            <span>Opacity</span>
            <input type="range" min="1" max="100" value={Math.round(brushOpacity * 100)} onChange={(event) => onBrushOpacityChange(Number(event.target.value) / 100)} />
            <output>{Math.round(brushOpacity * 100)}%</output>
          </label>
        </> : activeLayer ? <>
          <label className="desktop-property-range">
            <span>Opacity</span>
            <input type="range" min="0" max="100" value={Math.round(activeLayer.opacity * 100)} onChange={(event) => onPreviewOpacity(activeLayer.id, Number(event.target.value) / 100)} onPointerUp={(event) => onCommitOpacity(activeLayer.id, Number(event.currentTarget.value) / 100)} onBlur={(event) => onCommitOpacity(activeLayer.id, Number(event.currentTarget.value) / 100)} />
            <output>{Math.round(activeLayer.opacity * 100)}%</output>
          </label>
          <div className="desktop-property-row">
            <span>Tool features</span>
            <button type="button" onClick={onOpenSpaceDeck}>{spaceToolLabel} · Open</button>
          </div>
          <div className="desktop-property-row desktop-property-buttons">
            <button type="button" className={activeLayer.visible ? "active" : ""} aria-pressed={activeLayer.visible} onClick={() => onSetLayerVisible(activeLayer.id, !activeLayer.visible)}>{activeLayer.visible ? <Eye size={14} /> : <EyeOff size={14} />} {activeLayer.visible ? "Visible" : "Hidden"}</button>
            <button type="button" className={activeLayer.locked ? "active" : ""} aria-pressed={Boolean(activeLayer.locked)} onClick={() => studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, "Layer lock")}>{activeLayer.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />} {activeLayer.locked ? "Locked" : "Unlocked"}</button>
          </div>
        </> : (
          <button className="desktop-empty-action" type="button" onClick={onAddBlank}>＋ Add your first layer</button>
        )}
        </details>
        <button type="button" className="desktop-space-hint" onClick={onOpenSpaceDeck} title="Open tool features (Space)"><kbd>Space</kbd><span><strong>Tool features</strong><small>Tap to pin · hold and drag to pan</small></span></button>
        <details className="desktop-spatial-disclosure">
          <summary><Box />Spatial & Form Studio</summary>
          <SpatialLayerPanel layer={activeLayer} tool={activeTool} studio={studio} onSendToForm={onSendToForm} />
        </details>
      </div>
    </section>
  );
}
