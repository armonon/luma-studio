"use client";

import { lazy, Suspense, useContext } from "react";
import type { Layer } from "@/app/engine/document";
import type { Studio } from "@/app/engine/studio";
import { CONTEXTUAL_PANEL_CHOICES, type ContextualPanelId } from "../contextual-panel-registry";
import type { Tool, WorkspaceMode } from "../tool-registry";
import SpatialLayerPanel from "./spatial-layer-panel";
import LayerThumbnail from "../layer-thumbnail";
import LayerOpacityControl from "./layer-opacity-control";
import { ExpandedWorkspaceContext } from "../panel-workspace-context";
import { Box, Eye, EyeOff, Focus, LockKeyhole, UnlockKeyhole } from "lucide-react";

const BlendStackEditor = lazy(() => import("../blend-stack-editor"));

export type PropertiesPanelProps = Readonly<{
  compact?: boolean;
  contextualContent?: boolean;
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
  onOpenLayerStyle: (layerId: string) => void;
  onOpenSpaceDeck: () => void;
  onAddBlank: () => void;
  onSendToForm: () => void;
}>;

export default function PropertiesPanel({
  compact = false,
  contextualContent = false,
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
  onOpenLayerStyle,
  onOpenSpaceDeck,
  onAddBlank,
  onSendToForm,
}: PropertiesPanelProps) {
  const expanded = useContext(ExpandedWorkspaceContext);
  // The phone brush sheet puts presets first. Layers and Tool settings already
  // expose the duplicated controls; retain the target so painting stays clear.
  if (compact && paintingTool && !expanded) return <div className="desktop-property-target compact-paint-target">
    <LayerThumbnail layer={activeLayer} />
    <span><strong>{activeLayer?.name ?? "Canvas"}</strong><small>{activeLayer?.locked ? "Locked layer" : "Painting target"}</small></span>
    {activeLayer && <button type="button" onClick={() => onFocusLayer(activeLayer.id)} title="Focus this layer" aria-label="Focus this layer"><Focus size={16} /></button>}
  </div>;
  if (contextualContent) return <section className="inspector-focus" aria-label="Selected layer properties">
    <div className="inspector-focus-heading"><span>Editing</span><strong>{toolLabel}</strong></div>
    <div className="inspector-focus-target">
      <LayerThumbnail layer={activeLayer} />
      <span className="inspector-focus-name"><strong>{activeLayer?.name ?? "Canvas"}</strong><small>{activeLayer ? activeLayer.kind.replaceAll("-", " ") : `${documentWidth} × ${documentHeight}`}</small></span>
      {activeLayer && <div className="inspector-focus-actions">
        <button type="button" aria-label={activeLayer.visible ? "Hide selected layer" : "Show selected layer"} aria-pressed={activeLayer.visible} title={activeLayer.visible ? "Hide layer" : "Show layer"} onClick={() => onSetLayerVisible(activeLayer.id, !activeLayer.visible)}>{activeLayer.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
        <button type="button" aria-label={activeLayer.locked ? "Unlock selected layer" : "Lock selected layer"} aria-pressed={Boolean(activeLayer.locked)} title={activeLayer.locked ? "Unlock layer" : "Lock layer"} onClick={() => studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, "Layer lock")}>{activeLayer.locked ? <LockKeyhole size={16} /> : <UnlockKeyhole size={16} />}</button>
        <button type="button" aria-label="Focus selected layer" title="Focus layer" onClick={() => onFocusLayer(activeLayer.id)}><Focus size={16} /></button>
      </div>}
    </div>
    {(expanded || !compact) && <div className="inspector-focus-details">
      {expanded && <div><span>Document</span><strong>{documentWidth} × {documentHeight} px</strong></div>}
      {activeLayer && <LayerOpacityControl layerId={activeLayer.id} value={activeLayer.opacity} disabled={Boolean(studio?.isLayerLocked(activeLayer.id))} onPreview={onPreviewOpacity} onCommit={onCommitOpacity} />}
      {activeLayer && studio && activeLayer.kind !== "group" && <Suspense fallback={<div aria-label="Loading blending controls" />}><BlendStackEditor key={activeLayer.id} layer={activeLayer} studio={studio} /></Suspense>}
      {activeLayer && <button className="concept-layer-style-action" type="button" onClick={() => onOpenLayerStyle(activeLayer.id)}>fx · Layer style and effects</button>}
    </div>}
  </section>;
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
        {!(compact && paintingTool) && <details className="desktop-quick-controls">
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
        </details>}
        {!compact && <button type="button" className="desktop-space-hint" onClick={onOpenSpaceDeck} title="Open tool features (Space)"><kbd>Space</kbd><span><strong>Tool features</strong><small>Tap to pin · hold and drag to pan</small></span></button>}
        <details className="desktop-spatial-disclosure">
          <summary><Box />Spatial & Form Studio</summary>
          <SpatialLayerPanel layer={activeLayer} tool={activeTool} studio={studio} onSendToForm={onSendToForm} />
        </details>
      </div>
    </section>
  );
}
