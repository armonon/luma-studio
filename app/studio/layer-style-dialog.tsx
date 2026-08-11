"use client";

import { useEffect, useState } from "react";
import type { Studio } from "@/app/engine/studio";
import {
  BLEND_LABELS,
  BLEND_MODE_GROUPS,
  EFFECT_LABELS,
  LAYER_EFFECT_KINDS,
  effectUses,
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
  type BlendIf,
  type BlendIfRange,
  type BlendMode,
  type Layer,
  type LayerEffect,
  type LayerEffectKind,
  type StrokePosition,
} from "@/app/engine/document";
import { formatCssColor, parseCssColor } from "@/app/engine/color";
import BlendIfRangeEditor from "./blend-if-range-editor";

/** "Blending Options" is a pane like the effects, but it edits the layer itself. */
type Pane = "blending" | LayerEffectKind;

/**
 * A colour swatch plus an alpha slider. `<input type="color">` cannot carry
 * alpha, so the two controls recombine into one CSS colour string.
 */
function ColorField({ label, value, onChange, withAlpha = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  withAlpha?: boolean;
}) {
  const { hex, alpha } = parseCssColor(value);
  return (
    <div className="layer-style-color">
      <span>{label}</span>
      <input
        type="color"
        value={hex}
        onChange={(event) => onChange(formatCssColor(event.target.value, alpha))}
        aria-label={label}
      />
      {withAlpha && (
        <>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(alpha * 100)}
            onChange={(event) => onChange(formatCssColor(hex, Number(event.target.value) / 100))}
            aria-label={`${label} alpha`}
          />
          <output>{Math.round(alpha * 100)}%</output>
        </>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="layer-style-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <output>{Math.round(value)}{suffix}</output>
    </label>
  );
}

/** Controls for one effect instance, showing only the fields its kind reads. */
function EffectControls({ effect, layerId, studio }: { effect: LayerEffect; layerId: string; studio: Studio }) {
  const patch = (next: Partial<Omit<LayerEffect, "id" | "kind">>) =>
    studio.updateLayerEffect(layerId, effect.id, next);
  return (
    <div className="layer-style-effect">
      <Slider label="Opacity" value={effect.opacity * 100} min={0} max={100} suffix="%" onChange={(v) => patch({ opacity: v / 100 })} />
      {effect.kind !== "bevel-emboss" && (
        <ColorField label="Color" value={effect.color} onChange={(color) => patch({ color })} />
      )}
      {effectUses(effect.kind, "blur") && (
        <Slider label={effect.kind === "bevel-emboss" ? "Soften" : "Blur"} value={effect.blur} min={0} max={120} onChange={(blur) => patch({ blur })} />
      )}
      {effectUses(effect.kind, "offset") && (
        <>
          <Slider label="Offset X" value={effect.offsetX} min={-200} max={200} onChange={(offsetX) => patch({ offsetX })} />
          <Slider label="Offset Y" value={effect.offsetY} min={-200} max={200} onChange={(offsetY) => patch({ offsetY })} />
        </>
      )}
      {effectUses(effect.kind, "width") && (
        <Slider label="Size" value={effect.width ?? 3} min={1} max={100} suffix="px" onChange={(width) => patch({ width })} />
      )}
      {effectUses(effect.kind, "position") && (
        <label className="layer-style-select">
          <span>Position</span>
          <select
            value={effect.position ?? "outside"}
            onChange={(event) => patch({ position: event.target.value as StrokePosition })}
            aria-label="Stroke position"
          >
            <option value="outside">Outside</option>
            <option value="center">Center</option>
            <option value="inside">Inside</option>
          </select>
        </label>
      )}
      {effectUses(effect.kind, "depth") && (
        <Slider label="Depth" value={effect.depth ?? 3} min={0} max={40} suffix="px" onChange={(depth) => patch({ depth })} />
      )}
      {effectUses(effect.kind, "angle") && (
        <Slider label="Light angle" value={effect.angle ?? 135} min={0} max={360} suffix="°" onChange={(angle) => patch({ angle })} />
      )}
      {effectUses(effect.kind, "bevelColors") && (
        <>
          <ColorField label="Highlight" value={effect.highlightColor ?? "#ffffff"} onChange={(highlightColor) => patch({ highlightColor })} />
          <ColorField label="Shadow" value={effect.shadowColor ?? "#000000"} onChange={(shadowColor) => patch({ shadowColor })} />
        </>
      )}
      <div className="layer-style-effect-actions">
        <button type="button" onClick={() => patch({ enabled: !effect.enabled })}>
          {effect.enabled ? "Disable" : "Enable"}
        </button>
        <button type="button" onClick={() => studio.removeLayerEffect(layerId, effect.id)}>Remove</button>
      </div>
    </div>
  );
}

/** Layer opacity, blend mode, fill opacity and Blend If — the tonal knockout sliders. */
function BlendingOptions({ layer, studio }: { layer: Layer; studio: Studio }) {
  const passes = resolvedBlendPasses(layer);
  const blendIf = resolvedBlendIf(layer);
  const fillOpacity = resolvedFillOpacity(layer);
  const channel = blendIf.channels[blendIf.activeChannel];
  const setRange = (key: "source" | "underlying", range: BlendIfRange) => {
    studio.setLayerBlendIf(layer.id, {
      ...blendIf,
      channels: { ...blendIf.channels, [blendIf.activeChannel]: { ...channel, [key]: range } },
    });
  };
  return (
    <div className="layer-style-blending">
      <label className="layer-style-select">
        <span>Blend mode</span>
        <select
          value={passes[0].mode}
          onChange={(event) => studio.updateBlendPass(layer.id, passes[0].id, { mode: event.target.value as BlendMode })}
          aria-label="Blend mode"
        >
          {BLEND_MODE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.modes.map((mode) => <option key={mode} value={mode}>{BLEND_LABELS[mode]}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <Slider label="Opacity" value={layer.opacity * 100} min={0} max={100} suffix="%" onChange={(v) => studio.setLayerProp(layer.id, "opacity", v / 100, "Layer opacity")} />
      <Slider label="Fill opacity" value={fillOpacity * 100} min={0} max={100} suffix="%" onChange={(v) => studio.setLayerFillOpacity(layer.id, v / 100)} />
      <p className="layer-style-hint">
        Blend If hides tones instead of erasing them. Drag the black handles to drop shadows out of
        this layer, the white handles to drop highlights — the fade handles soften the cut.
      </p>
      <div className="blend-if-heading">
        <span><strong>Blend If</strong><small>Feathered tonal visibility</small></span>
        <select
          value={blendIf.activeChannel}
          onChange={(event) => studio.setLayerBlendIf(layer.id, { ...blendIf, activeChannel: event.target.value as BlendIf["activeChannel"] })}
          aria-label="Blend If channel"
        >
          <option value="gray">Gray</option><option value="red">Red</option><option value="green">Green</option><option value="blue">Blue</option>
        </select>
      </div>
      <BlendIfRangeEditor label="This layer" range={channel.source} onChange={(range) => setRange("source", range)} />
      <BlendIfRangeEditor label="Underlying" range={channel.underlying} onChange={(range) => setRange("underlying", range)} />
      <button type="button" className="blend-if-reset" onClick={() => studio.resetLayerBlendIf(layer.id)} disabled={!layer.blendIf}>
        Reset Blend If
      </button>
    </div>
  );
}

export default function LayerStyleDialog({ layer, studio, onClose }: {
  layer: Layer;
  studio: Studio;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<Pane>("blending");
  const effects = layer.effects ?? [];
  const paneEffects = pane === "blending" ? [] : effects.filter((effect) => effect.kind === pane);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Clicking a kind selects it, adding a first instance the way Photoshop does. */
  const selectKind = (kind: LayerEffectKind) => {
    setPane(kind);
    if (!effects.some((effect) => effect.kind === kind)) studio.addLayerEffect(layer.id, kind);
  };

  /** The checkbox toggles every instance of that kind at once. */
  const toggleKind = (kind: LayerEffectKind) => {
    const existing = effects.filter((effect) => effect.kind === kind);
    if (!existing.length) {
      studio.addLayerEffect(layer.id, kind);
      setPane(kind);
      return;
    }
    const enable = !existing.some((effect) => effect.enabled);
    for (const effect of existing) studio.updateLayerEffect(layer.id, effect.id, { enabled: enable });
  };

  return (
    <div className="spatial-modal" onMouseDown={onClose}>
      <section
        className="layer-style-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Layer style for ${layer.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span aria-hidden="true">fx</span>
          <strong>Layer Style</strong>
          <small>{layer.name}</small>
          <button type="button" onClick={onClose} aria-label="Close layer style">×</button>
        </header>
        <div className="layer-style-body">
          <nav className="layer-style-rail" aria-label="Layer style sections">
            <button
              type="button"
              className={pane === "blending" ? "active" : ""}
              onClick={() => setPane("blending")}
              aria-pressed={pane === "blending"}
              aria-label="Blending Options"
            >
              <i aria-hidden="true">◐</i><span>Blending Options</span>
            </button>
            {LAYER_EFFECT_KINDS.map((kind) => {
              const instances = effects.filter((effect) => effect.kind === kind);
              const on = instances.some((effect) => effect.enabled);
              return (
                <button
                  key={kind}
                  type="button"
                  className={`${pane === kind ? "active" : ""} ${instances.length ? "present" : ""}`}
                  onClick={() => selectKind(kind)}
                  aria-pressed={pane === kind}
                  aria-label={EFFECT_LABELS[kind]}
                >
                  <i
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${EFFECT_LABELS[kind]} enabled`}
                    tabIndex={0}
                    onClick={(event) => { event.stopPropagation(); toggleKind(kind); }}
                    onKeyDown={(event) => {
                      if (event.key !== " " && event.key !== "Enter") return;
                      event.preventDefault();
                      event.stopPropagation();
                      toggleKind(kind);
                    }}
                  >{on ? "◉" : "○"}</i>
                  <span>{EFFECT_LABELS[kind]}</span>
                  {instances.length > 1 && <small>{instances.length}</small>}
                </button>
              );
            })}
          </nav>
          <div className="layer-style-pane">
            {pane === "blending"
              ? <BlendingOptions layer={layer} studio={studio} />
              : paneEffects.length
                ? paneEffects.map((effect) => (
                  <EffectControls key={effect.id} effect={effect} layerId={layer.id} studio={studio} />
                ))
                : (
                  <div className="layer-style-empty">
                    <p>{layer.locked ? "This layer is locked." : `No ${EFFECT_LABELS[pane].toLowerCase()} on this layer.`}</p>
                    <button type="button" disabled={layer.locked} onClick={() => studio.addLayerEffect(layer.id, pane)}>
                      Add {EFFECT_LABELS[pane]}
                    </button>
                  </div>
                )}
          </div>
        </div>
      </section>
    </div>
  );
}
