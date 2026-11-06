"use client";

import { Suspense, lazy, useCallback, useContext, useState } from "react";
import type { StudioCommand } from "@/app/desktop/menu-model";
import type { LayerSelectionModifiers } from "@/app/engine/layer-selection";
import LayerContextMenu from "../layer-context-menu";
import LayerOpacityControl from "./layer-opacity-control";
import { ArrowDown, ArrowUp, Folder, Plus, Trash2 } from "lucide-react";
import { EFFECT_LABELS, type Layer } from "@/app/engine/document";
import {
  PRO_ADJUSTMENT_KINDS,
  PRO_ADJUSTMENT_LABELS,
  type ProAdjustmentKind,
} from "@/app/engine/pro-adjustments";
import type { Studio } from "@/app/engine/studio";
import { ExpandedWorkspaceContext } from "../panel-workspace-context";

const VirtualLayerStack = lazy(() => import("../virtual-layer-stack"));
const BlendStackEditor = lazy(() => import("../blend-stack-editor"));
const SmartFilterEditor = lazy(() => import("../layer-editors").then((module) => ({ default: module.SmartFilterEditor })));

export type LayersPanelProps = Readonly<{
  touch?: boolean;
  studio: Studio | null;
  layers: Layer[];
  activeLayerId: string | null;
  selectedLayerIds: string[];
  onSelectLayers: (layer: Layer, modifiers: LayerSelectionModifiers) => void;
  onCommand: (id: StudioCommand) => void;
  commandEnabled: (id: StudioCommand) => boolean;
  activeLayer: Layer | null | undefined;
  draggedLayerId: string | null;
  onDragStart: (layerId: string) => void;
  onDragEnd: () => void;
  onSelectLayer: (layer: Layer) => void;
  onSetActiveLayerId: (layerId: string | null) => void;
  onOpenLayerStyle: (layerId: string) => void;
  onSetLayerVisible: (layerId: string, visible: boolean) => void;
  onPreviewOpacity: (layerId: string, opacity: number) => void;
  onCommitOpacity: (layerId: string, opacity: number) => void;
  onAddBlank: () => void;
  onAddTone: () => void;
  onAddProfessionalAdjustment: (kind: ProAdjustmentKind) => void;
  onRemoveActive: () => void;
  onRenameLayer: (layer: Layer) => void;
}>;

export default function LayersPanel({
  touch = false,
  studio,
  layers,
  activeLayerId,
  selectedLayerIds,
  onSelectLayers,
  onCommand,
  commandEnabled,
  activeLayer,
  draggedLayerId,
  onDragStart,
  onDragEnd,
  onSelectLayer,
  onSetActiveLayerId,
  onOpenLayerStyle,
  onSetLayerVisible,
  onPreviewOpacity,
  onCommitOpacity,
  onAddBlank,
  onAddTone,
  onAddProfessionalAdjustment,
  onRenameLayer,
}: LayersPanelProps) {
  const expanded = useContext(ExpandedWorkspaceContext);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  return (
    <section className="glass-card layers-card">
      <header>
        <strong>Layers <small className="layer-count">{layers.length}{selectedLayerIds.length > 1 ? ` · ${selectedLayerIds.length} selected` : ""}</small></strong>
        <div className="layer-add-menu">
          <button onClick={onAddBlank} title="Add paint layer" aria-label="Add paint layer"><Plus size={16} />{expanded && <span>New layer</span>}</button>
          <select
            aria-label="Add adjustment layer"
            title="Add adjustment layer"
            value=""
            onChange={(event) => {
              const kind = event.target.value;
              if (kind === "tone") onAddTone();
              else if (kind === "curves" && studio) onSelectLayer(studio.addCurvesLayer());
              else if (kind === "levels" && studio) onSelectLayer(studio.addLevelsLayer());
              else if (kind === "hsl" && studio) onSelectLayer(studio.addHslLayer());
              else if (kind) onAddProfessionalAdjustment(kind as ProAdjustmentKind);
            }}
          >
            <option value="">＋ Adjustment</option>
            <optgroup label="Core">
              <option value="tone">Tone</option>
              <option value="curves">Curves</option>
              <option value="levels">Levels</option>
              <option value="hsl">Hue / Saturation</option>
            </optgroup>
            <optgroup label="Professional">
              {PRO_ADJUSTMENT_KINDS.map((kind) => <option key={kind} value={kind}>{PRO_ADJUSTMENT_LABELS[kind]}</option>)}
            </optgroup>
          </select>
        </div>
      </header>
      {touch && <div className="touch-layer-toolbar">
        <button aria-pressed={selecting} onClick={() => setSelecting(value => !value)}>{selecting ? "Done selecting" : "Select layers"}</button>
        <button disabled={!selectedLayerIds.length} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom }); }}>Actions · {selectedLayerIds.length}</button>
      </div>}
      <Suspense fallback={<div className="layer-stack" aria-label="Loading layers" />}>
        <VirtualLayerStack
          touch={touch}
          selecting={selecting}
          layers={layers}
          activeLayerId={activeLayerId}
          selectedLayerIds={selectedLayerIds}
          draggedLayerId={draggedLayerId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDrop={(sourceId, targetIndex) => {
            if (!studio) return;
            const sourceIndex = layers.findIndex((candidate) => candidate.id === sourceId);
            studio.reorderLayer(sourceId, targetIndex - sourceIndex);
            onDragEnd();
          }}
          onSelect={onSelectLayers}
          onDeleteSelection={() => onCommand("delete-layer")}
          onContextMenu={(layer, point) => {
            if (!selectedLayerIds.includes(layer.id)) onSelectLayers(layer, {});
            setContextMenu(point);
          }}
          onOpenStyle={(layer) => {
            onSelectLayers(layer, {});
            onOpenLayerStyle(layer.id);
          }}
          onRename={onRenameLayer}
          onToggleVisible={(layer) => onSetLayerVisible(layer.id, !layer.visible)}
          onDelete={(layer) => {
            if (!studio) return;
            studio.removeLayer(layer.id);
            if (activeLayerId === layer.id) onSetActiveLayerId(studio.doc.layers[0]?.id ?? null);
          }}
          canDelete={(layer) => Boolean(studio && !studio.layerBatchReason([layer.id], "delete"))}
        />
      </Suspense>
      <div className="layer-stack-footer" aria-label="Layer actions">
        <button disabled={!commandEnabled("group-layer")} onClick={() => onCommand("group-layer")} title="Group selected layers (⌘G)" aria-label="Group selected layers"><Folder size={15} /></button>
        <button disabled={!commandEnabled("bring-forward") || layers[0]?.id === activeLayerId} onClick={() => onCommand("bring-forward")} title="Move up" aria-label="Move active layer up"><ArrowUp size={15} /></button>
        <button disabled={!commandEnabled("send-backward") || layers.at(-1)?.id === activeLayerId} onClick={() => onCommand("send-backward")} title="Move down" aria-label="Move active layer down"><ArrowDown size={15} /></button>
        <button disabled={!commandEnabled("layer-style")} onClick={() => onCommand("layer-style")} title="Layer styles and advanced blending" aria-label="Open layer styles">fx</button>
        <button disabled={!commandEnabled("delete-layer")} className="danger" onClick={() => onCommand("delete-layer")} title="Delete selected layers" aria-label="Delete selected layers"><Trash2 size={15} /></button>
      </div>
      {selectedLayerIds.length > 1 && <div className="layer-selection-summary"><span>{touch ? "Tap layers in Select mode to toggle selection" : "Shift-click a range · ⌘/Ctrl-click to toggle"}</span><button disabled={!commandEnabled("merge-layers")} title={studio?.layerBatchReason(selectedLayerIds, "merge") ?? "Rasterize selected layers · ⌘E · undo restores originals"} onClick={() => onCommand("merge-layers")}>Merge selected</button></div>}
      {contextMenu && <LayerContextMenu {...contextMenu} touch={touch} count={selectedLayerIds.length} enabled={commandEnabled} execute={onCommand} close={closeContextMenu} mergeReason={studio?.layerBatchReason(selectedLayerIds, "merge")} />}
      {activeLayer && selectedLayerIds.length <= 1 && (
        <section className="layer-controls" aria-label="Selected layer appearance">
          <header className="layer-appearance-heading"><strong>Layer appearance</strong><span>{activeLayer.name}</span></header>
          <LayerOpacityControl layerId={activeLayer.id} value={activeLayer.opacity} disabled={Boolean(studio?.isLayerLocked(activeLayer.id))} onPreview={onPreviewOpacity} onCommit={onCommitOpacity} />
          {activeLayer.kind === "group"
            ? <div className="blend-group-note">Group opacity · children pass through</div>
            : studio && (
              <Suspense fallback={<div className="blend-stack-editor" aria-label="Loading blending controls" />}>
                <BlendStackEditor key={activeLayer.id} layer={activeLayer} studio={studio} />
              </Suspense>
            )}
          <div className="layer-appearance-actions">
            <button type="button" aria-pressed={Boolean(activeLayer.locked)} onClick={() => studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, activeLayer.locked ? "Layer unlocked" : "Layer locked")}>
              {activeLayer.locked ? "Locked" : "Lock layer"}
            </button>
            {activeLayer.kind !== "group" && (
              <button type="button" aria-pressed={Boolean(activeLayer.clipping)} onClick={() => studio?.setLayerProp(activeLayer.id, "clipping", !activeLayer.clipping, "Clipping mask")}>
                {activeLayer.clipping ? "✓ Clipped" : "Clip below"}
              </button>
            )}
          </div>
          <div className="layer-appearance-actions layer-appearance-secondary">
            {activeLayer.kind === "raster" && (
              <button type="button" onClick={() => studio?.convertToSmartObject(activeLayer.id)}>◇ Smart object</button>
            )}
            <button type="button" onClick={() => onOpenLayerStyle(activeLayer.id)} title="Blending options, Blend If and layer effects">fx Layer style…</button>
          </div>
          {!!activeLayer.filters?.length && (
            <div style={{ display: "grid", gap: 4, paddingTop: 6 }}>
              <Suspense fallback={<div aria-label="Loading smart filters" />}>
                {activeLayer.filters.map((filter, index) => studio && (
                  <SmartFilterEditor key={filter.id} layer={activeLayer} filter={filter} index={index} count={activeLayer.filters!.length} studio={studio} />
                ))}
              </Suspense>
            </div>
          )}
          {!!activeLayer.effects?.length && (
            <div style={{ display: "grid", gap: 4, paddingTop: 6 }}>
              {activeLayer.effects.map((effect) => (
                <div key={effect.id} className="layer-effect-row">
                  <button onClick={() => onOpenLayerStyle(activeLayer.id)} title="Edit in Layer Style">
                    <i aria-hidden="true">{effect.enabled ? "◉" : "○"}</i>
                    <span>fx · {EFFECT_LABELS[effect.kind]}</span>
                  </button>
                  <button onClick={() => studio?.removeLayerEffect(activeLayer.id, effect.id)} aria-label={`Remove ${EFFECT_LABELS[effect.kind]}`} title="Remove layer effect">×</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
