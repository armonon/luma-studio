"use client";

import { useEffect, useState } from "react";
import type { Studio } from "@/app/engine/studio";
import {
  BLEND_LABELS,
  BLEND_MODE_GROUPS,
  DEFAULT_GRADIENT_STOPS,
  EFFECT_LABELS,
  LAYER_EFFECT_KINDS,
  effectUses,
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
  resolvedEffectBlendMode,
  resolvedGlobalLight,
  type BlendIf,
  type BlendIfRange,
  type BlendMode,
  type CurvePoints,
  type GlobalLight,
  type GlowSource,
  type GradientStop,
  type GradientStyle,
  type Layer,
  type LayerEffect,
  type LayerEffectKind,
  type PatternKind,
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

/**
 * Contour presets: the falloff curve an effect's alpha is remapped through.
 *
 * Photoshop ships a curve editor plus a preset well. These are the presets
 * that account for nearly all real use; the underlying field takes any curve.
 */
const CONTOUR_PRESETS: Record<string, CurvePoints | undefined> = {
  Linear: undefined,
  "Cone": [{ x: 0, y: 1 }, { x: 1, y: 0 }],
  "Ring": [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }],
  "Double ring": [{ x: 0, y: 0 }, { x: 0.25, y: 1 }, { x: 0.5, y: 0 }, { x: 0.75, y: 1 }, { x: 1, y: 0 }],
  "Rolling": [{ x: 0, y: 0 }, { x: 0.35, y: 0.85 }, { x: 0.7, y: 0.4 }, { x: 1, y: 1 }],
  "Half round": [{ x: 0, y: 0 }, { x: 0.5, y: 0.92 }, { x: 1, y: 1 }],
};

function contourNameOf(contour: CurvePoints | undefined) {
  if (!contour?.length) return "Linear";
  const key = JSON.stringify(contour);
  return Object.keys(CONTOUR_PRESETS).find((name) =>
    JSON.stringify(CONTOUR_PRESETS[name]) === key) ?? "Linear";
}

/** Gradient stops, editable in place: colour and position, add and remove. */
function GradientStopsEditor({ stops, onChange }: {
  stops: GradientStop[];
  onChange: (stops: GradientStop[]) => void;
}) {
  const replace = (index: number, patch: Partial<GradientStop>) =>
    onChange(stops.map((stop, i) => i === index ? { ...stop, ...patch } : stop));
  const preview = `linear-gradient(90deg, ${stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ")})`;
  return (
    <div className="gradient-stops">
      <div className="gradient-stops-preview" style={{ background: preview }} />
      {stops.map((stop, index) => (
        <div className="gradient-stop" key={index}>
          <input
            type="color"
            value={parseCssColor(stop.color).hex}
            onChange={(event) => replace(index, { color: event.target.value })}
            aria-label={`Gradient stop ${index + 1} color`}
          />
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(stop.offset * 100)}
            onChange={(event) => replace(index, { offset: Number(event.target.value) / 100 })}
            aria-label={`Gradient stop ${index + 1} position`}
          />
          <output>{Math.round(stop.offset * 100)}%</output>
          <button
            type="button"
            disabled={stops.length <= 2}
            onClick={() => onChange(stops.filter((_, i) => i !== index))}
            aria-label={`Remove gradient stop ${index + 1}`}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        className="gradient-stop-add"
        onClick={() => onChange([...stops, { offset: 0.5, color: stops[stops.length - 1]?.color ?? "#ffffff" }])}
      >＋ Add stop</button>
    </div>
  );
}

/** Controls for one effect instance, showing only the fields its kind reads. */
function EffectControls({ effect, layerId, studio, layerHasMatte }: {
  effect: LayerEffect;
  layerId: string;
  studio: Studio;
  layerHasMatte: boolean;
}) {
  const patch = (next: Partial<Omit<LayerEffect, "id" | "kind">>) =>
    studio.updateLayerEffect(layerId, effect.id, next);
  return (
    <div className="layer-style-effect">
      <label className="layer-style-select">
        <span>Blend mode</span>
        <select
          value={resolvedEffectBlendMode(effect)}
          onChange={(event) => patch({ blendMode: event.target.value as BlendMode })}
          aria-label="Effect blend mode"
        >
          {BLEND_MODE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.modes.map((mode) => <option key={mode} value={mode}>{BLEND_LABELS[mode]}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <Slider label="Opacity" value={effect.opacity * 100} min={0} max={100} suffix="%" onChange={(v) => patch({ opacity: v / 100 })} />
      {effect.kind !== "bevel-emboss" && effect.kind !== "gradient-overlay" && (
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
      {effectUses(effect.kind, "spread") && (
        <Slider
          label={effect.kind === "inner-shadow" || effect.kind === "inner-glow" ? "Choke" : "Spread"}
          value={(effect.spread ?? 0) * 100}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => patch({ spread: v / 100 })}
        />
      )}
      {effectUses(effect.kind, "noise") && (
        <Slider label="Noise" value={(effect.noise ?? 0) * 100} min={0} max={100} suffix="%" onChange={(v) => patch({ noise: v / 100 })} />
      )}
      {effectUses(effect.kind, "altitude") && (
        <Slider label="Altitude" value={effect.altitude ?? 30} min={0} max={90} suffix="°" onChange={(altitude) => patch({ altitude })} />
      )}
      {effectUses(effect.kind, "contour") && (
        <label className="layer-style-select">
          <span>Contour</span>
          <select
            value={contourNameOf(effect.contour)}
            onChange={(event) => patch({ contour: CONTOUR_PRESETS[event.target.value] })}
            aria-label="Contour"
          >
            {Object.keys(CONTOUR_PRESETS).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
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
      {effectUses(effect.kind, "glowSource") && (
        <label className="layer-style-select">
          <span>Source</span>
          <select
            value={effect.glowSource ?? "edge"}
            onChange={(event) => patch({ glowSource: event.target.value as GlowSource })}
            aria-label="Glow source"
          >
            <option value="edge">Edge</option>
            <option value="center">Center</option>
          </select>
        </label>
      )}
      {effectUses(effect.kind, "invert") && (
        <label className="layer-style-check">
          <span>Invert</span>
          <input type="checkbox" checked={!!effect.invert} onChange={(event) => patch({ invert: event.target.checked })} />
        </label>
      )}
      {effectUses(effect.kind, "gradientStops") && (
        <>
          <Slider label="Angle" value={effect.gradientAngle ?? 90} min={0} max={360} suffix="°" onChange={(gradientAngle) => patch({ gradientAngle })} />
          <label className="layer-style-select">
            <span>Style</span>
            <select
              value={effect.gradientStyle ?? "linear"}
              onChange={(event) => patch({ gradientStyle: event.target.value as GradientStyle })}
              aria-label="Gradient style"
            >
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
          </label>
          <label className="layer-style-check">
            <span>Reverse</span>
            <input type="checkbox" checked={!!effect.reverse} onChange={(event) => patch({ reverse: event.target.checked })} />
          </label>
          <GradientStopsEditor
            stops={effect.stops?.length ? effect.stops : [...DEFAULT_GRADIENT_STOPS]}
            onChange={(stops) => patch({ stops })}
          />
        </>
      )}
      {effectUses(effect.kind, "pattern") && (
        <>
          <label className="layer-style-select">
            <span>Pattern</span>
            <select
              value={effect.pattern ?? "checker"}
              onChange={(event) => patch({ pattern: event.target.value as PatternKind })}
              aria-label="Pattern"
            >
              <option value="checker">Checker</option>
              <option value="stripes">Stripes</option>
              <option value="dots">Dots</option>
            </select>
          </label>
          <Slider label="Scale" value={effect.patternScale ?? 16} min={2} max={128} suffix="px" onChange={(patternScale) => patch({ patternScale })} />
        </>
      )}
      {effectUses(effect.kind, "strength") && (
        <Slider label="Strength" value={effect.strength ?? 12} min={0} max={80} suffix="px" onChange={(strength) => patch({ strength })} />
      )}
      {effectUses(effect.kind, "threshold") && (
        <Slider label="Threshold" value={(effect.threshold ?? 0.7) * 100} min={0} max={100} suffix="%" onChange={(v) => patch({ threshold: v / 100 })} />
      )}
      {effectUses(effect.kind, "steps") && (
        <Slider label="Steps" value={effect.steps ?? 32} min={2} max={128} onChange={(steps) => patch({ steps })} />
      )}
      {effectUses(effect.kind, "saturation") && (
        <Slider label="Saturation" value={(effect.saturation ?? 1.6) * 100} min={0} max={300} suffix="%" onChange={(v) => patch({ saturation: v / 100 })} />
      )}
      {effectUses(effect.kind, "tint") && (
        <Slider label="Tint" value={(effect.tint ?? 0) * 100} min={0} max={100} suffix="%" onChange={(v) => patch({ tint: v / 100 })} />
      )}
      {effect.kind === "backdrop-blur" && (
        <p className="layer-style-hint">
          Blurs the layers behind this one, live. Nothing underneath means nothing to blur.
        </p>
      )}
      {effect.kind === "refraction" && (
        <p className="layer-style-hint">
          Bends the layers behind this one along its own edges, like glass. Displacement is capped
          by Strength, which is what keeps it correct as the canvas is tiled.
        </p>
      )}
      {effect.kind === "bloom" && (
        <p className="layer-style-hint">
          Spills light from pixels brighter than the threshold — unlike a glow, which spreads the
          whole silhouette regardless of what is in it.
        </p>
      )}
      {effect.kind === "relief" && (
        <p className="layer-style-hint">
          Embosses the image content rather than its outline, so a photograph gains real surface.
        </p>
      )}
      {effectUses(effect.kind, "globalLight") && (
        <label className="layer-style-check">
          <span>Use global light</span>
          <input
            type="checkbox"
            checked={!!effect.useGlobalLight}
            onChange={(event) => patch({ useGlobalLight: event.target.checked })}
          />
        </label>
      )}
      <label className="layer-style-check">
        <span>Subject only</span>
        <input
          type="checkbox"
          checked={!!effect.restrictToSubject}
          onChange={(event) => {
            patch({ restrictToSubject: event.target.checked });
            if (event.target.checked && !layerHasMatte) void studio.computeSubjectMask(layerId);
          }}
        />
      </label>
      {effect.restrictToSubject && !layerHasMatte && (
        <p className="layer-style-hint">Computing the subject matte on device…</p>
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
function BlendingOptions({ layer, studio, light }: { layer: Layer; studio: Studio; light: GlobalLight }) {
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
      <div className="global-light">
        <div className="blend-if-heading">
          <span><strong>Global light</strong><small>Shared by every effect opted in</small></span>
        </div>
        <Slider label="Angle" value={light.angle} min={0} max={360} suffix="°" onChange={(angle) => studio.setGlobalLight({ angle })} />
        <Slider label="Altitude" value={light.altitude} min={0} max={90} suffix="°" onChange={(altitude) => studio.setGlobalLight({ altitude })} />
      </div>
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
      <div className="blend-if-heading">
        <span><strong>Advanced</strong><small>Knockout · channels · mask</small></span>
      </div>
      <label className="layer-style-select">
        <span>Knockout</span>
        <select
          value={layer.knockout ?? "none"}
          onChange={(event) => studio.setLayerBlendingOption(layer.id, "knockout", event.target.value as Layer["knockout"])}
          aria-label="Knockout"
        >
          <option value="none">None</option>
          <option value="shallow">Shallow</option>
          <option value="deep">Deep</option>
        </select>
      </label>
      <div className="layer-style-color">
        <span>Channels</span>
        {(["r", "g", "b"] as const).map((channelKey) => {
          const enabled = layer.blendChannels?.[channelKey] ?? true;
          return (
            <label key={channelKey} className="channel-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => studio.setLayerBlendingOption(layer.id, "blendChannels", {
                  r: layer.blendChannels?.r ?? true,
                  g: layer.blendChannels?.g ?? true,
                  b: layer.blendChannels?.b ?? true,
                  [channelKey]: event.target.checked,
                })}
                aria-label={`Blend ${channelKey.toUpperCase()} channel`}
              />
              <span>{channelKey.toUpperCase()}</span>
            </label>
          );
        })}
      </div>
      <label className="layer-style-check">
        <span>Mask hides effects</span>
        <input
          type="checkbox"
          checked={!!layer.maskHidesEffects}
          onChange={(event) => studio.setLayerBlendingOption(layer.id, "maskHidesEffects", event.target.checked)}
        />
      </label>
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
  const light = resolvedGlobalLight(studio.doc);
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
          <div className="layer-style-actions">
            <button type="button" onClick={() => studio.copyLayerStyle(layer.id)} title="Copy this layer's effects and blending options">Copy</button>
            <button type="button" onClick={() => studio.pasteLayerStyle(layer.id)} disabled={!studio.hasCopiedLayerStyle()} title="Paste the copied style onto this layer">Paste</button>
            <button type="button" onClick={() => studio.scaleLayerEffects(layer.id, 0.5)} disabled={!effects.length} title="Halve every effect size">−50%</button>
            <button type="button" onClick={() => studio.scaleLayerEffects(layer.id, 2)} disabled={!effects.length} title="Double every effect size">+100%</button>
            <button type="button" onClick={() => studio.clearLayerStyle(layer.id)} disabled={!effects.length} title="Remove every effect">Clear</button>
          </div>
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
              ? <BlendingOptions layer={layer} studio={studio} light={light} />
              : paneEffects.length
                ? paneEffects.map((effect) => (
                  <EffectControls key={effect.id} effect={effect} layerId={layer.id} studio={studio} layerHasMatte={!!layer.subjectMask} />
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
