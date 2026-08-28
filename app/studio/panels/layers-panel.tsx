"use client";

import { Suspense, lazy } from "react";
import { EFFECT_LABELS, type Layer } from "@/app/engine/document";
import {
  PRO_ADJUSTMENT_KINDS,
  PRO_ADJUSTMENT_LABELS,
  type ProAdjustmentKind,
} from "@/app/engine/pro-adjustments";
import type { Studio } from "@/app/engine/studio";

const VirtualLayerStack = lazy(() => import("../virtual-layer-stack"));
const BlendStackEditor = lazy(() => import("../blend-stack-editor"));
const SmartFilterEditor = lazy(() => import("../layer-editors").then((module) => ({ default: module.SmartFilterEditor })));

export type LayersPanelProps = Readonly<{
  studio: Studio | null;
  layers: Layer[];
  activeLayerId: string | null;
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
}>;

export default function LayersPanel({
  studio,
  layers,
  activeLayerId,
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
  onRemoveActive,
}: LayersPanelProps) {
  return (
    <section className="glass-card layers-card">
      <header>
        <strong>Layers</strong>
        <div className="layer-add-menu">
          <button onClick={onAddBlank} title="Add paint layer" aria-label="Add paint layer">＋</button>
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
      <Suspense fallback={<div className="layer-stack" aria-label="Loading layers" />}>
        <VirtualLayerStack
          layers={layers}
          activeLayerId={activeLayerId}
          draggedLayerId={draggedLayerId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDrop={(sourceId, targetIndex) => {
            if (!studio) return;
            const sourceIndex = layers.findIndex((candidate) => candidate.id === sourceId);
            studio.reorderLayer(sourceId, targetIndex - sourceIndex);
            onDragEnd();
          }}
          onSelect={onSelectLayer}
          onOpenStyle={(layer) => {
            onSetActiveLayerId(layer.id);
            onOpenLayerStyle(layer.id);
          }}
          onRename={(layer) => {
            const name = window.prompt("Layer name", layer.name)?.trim();
            if (name) studio?.setLayerProp(layer.id, "name", name, "Layer renamed");
          }}
          onToggleVisible={(layer) => onSetLayerVisible(layer.id, !layer.visible)}
          onDelete={(layer) => {
            if (!studio) return;
            studio.removeLayer(layer.id);
            if (activeLayerId === layer.id) onSetActiveLayerId(studio.doc.layers[0]?.id ?? null);
          }}
        />
      </Suspense>
      <div className="layer-stack-footer" aria-label="Layer actions">
        <button onClick={() => {
          if (!studio || !activeLayerId) return;
          if (activeLayer?.kind === "group") studio.ungroupLayer(activeLayer.id);
          else {
            const group = studio.groupLayer(activeLayerId);
            if (group) onSetActiveLayerId(group.id);
          }
        }} title={activeLayer?.kind === "group" ? "Ungroup" : "Group active layer"} aria-label={activeLayer?.kind === "group" ? "Ungroup active layer" : "Group active layer"}>⌘</button>
        <button onClick={() => { if (studio && activeLayerId) studio.reorderLayer(activeLayerId, -1); }} title="Move up" aria-label="Move active layer up">↑</button>
        <button onClick={() => { if (studio && activeLayerId) studio.reorderLayer(activeLayerId, 1); }} title="Move down" aria-label="Move active layer down">↓</button>
        <button onClick={() => activeLayer && onOpenLayerStyle(activeLayer.id)} title="Layer styles and advanced blending" aria-label="Open layer styles">fx</button>
        <button className="danger" onClick={onRemoveActive} title="Delete active" aria-label="Delete active layer">⌫</button>
      </div>
      {activeLayer && (
        <div className="layer-controls">
          <label>
            <span>Master</span>
            <input type="range" min="0" max="100" value={Math.round(activeLayer.opacity * 100)} onChange={(event) => onPreviewOpacity(activeLayer.id, Number(event.target.value) / 100)} onPointerUp={(event) => onCommitOpacity(activeLayer.id, Number(event.currentTarget.value) / 100)} onBlur={(event) => onCommitOpacity(activeLayer.id, Number(event.currentTarget.value) / 100)} />
            <output>{Math.round(activeLayer.opacity * 100)}%</output>
          </label>
          {activeLayer.kind === "group"
            ? <div className="blend-group-note">Group opacity · children pass through</div>
            : studio && (
              <Suspense fallback={<div className="blend-stack-editor" aria-label="Loading blending controls" />}>
                <BlendStackEditor key={activeLayer.id} layer={activeLayer} studio={studio} />
              </Suspense>
            )}
          <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
            <button onClick={() => studio?.setLayerProp(activeLayer.id, "locked", !activeLayer.locked, activeLayer.locked ? "Layer unlocked" : "Layer locked")} style={{ flex: 1 }}>
              {activeLayer.locked ? "Locked" : "Lock layer"}
            </button>
            {activeLayer.kind !== "group" && (
              <button onClick={() => studio?.setLayerProp(activeLayer.id, "clipping", !activeLayer.clipping, "Clipping mask")} style={{ flex: 1 }}>
                {activeLayer.clipping ? "✓ Clipped" : "Clip below"}
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
            {activeLayer.kind === "raster" && (
              <button onClick={() => studio?.convertToSmartObject(activeLayer.id)} style={{ flex: 1 }}>◇ Smart object</button>
            )}
            <button onClick={() => onOpenLayerStyle(activeLayer.id)} style={{ flex: 1 }} title="Blending options, Blend If and layer effects">fx Layer style…</button>
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
        </div>
      )}
    </section>
  );
}
