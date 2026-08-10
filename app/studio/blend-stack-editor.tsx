"use client";

import { useState, type CSSProperties } from "react";
import type { Studio } from "@/app/engine/studio";
import {
  BLEND_LABELS,
  BLEND_MODE_GROUPS,
  MAX_LAYER_BLEND_PASSES,
  resolvedBlendIf,
  resolvedBlendPasses,
  resolvedFillOpacity,
  type BlendIf,
  type BlendIfRange,
  type BlendMode,
  type Layer,
} from "@/app/engine/document";
import { isNeutralBlendIf } from "@/app/engine/blend";

function BlendIfRangeEditor({ label, range, onChange }: {
  label: string;
  range: BlendIfRange;
  onChange: (range: BlendIfRange) => void;
}) {
  const fields: ReadonlyArray<readonly [keyof BlendIfRange, string]> = [
    ["black", "Black hide"],
    ["blackFeather", "Black fade"],
    ["whiteFeather", "White fade"],
    ["white", "White hide"],
  ];
  const update = (key: keyof BlendIfRange, value: number) => onChange({ ...range, [key]: value / 255 });
  return (
    <div className="blend-if-range">
      <div className="blend-if-range-heading">
        <strong>{label}</strong>
        <span>{Math.round(range.black * 255)} · {Math.round(range.blackFeather * 255)} / {Math.round(range.whiteFeather * 255)} · {Math.round(range.white * 255)}</span>
      </div>
      <div
        className="blend-if-preview"
        style={{
          "--black": `${range.black * 100}%`,
          "--black-feather": `${range.blackFeather * 100}%`,
          "--white-feather": `${range.whiteFeather * 100}%`,
          "--white": `${range.white * 100}%`,
        } as CSSProperties}
      />
      {fields.map(([key, name]) => (
        <label key={key}>
          <span>{name}</span>
          <input type="range" min="0" max="255" value={Math.round(range[key] * 255)} onChange={(event) => update(key, Number(event.target.value))} aria-label={`${label} ${name}`} />
          <output>{Math.round(range[key] * 255)}</output>
        </label>
      ))}
    </div>
  );
}

export default function BlendStackEditor({ layer, studio }: { layer: Layer; studio: Studio }) {
  const passes = resolvedBlendPasses(layer);
  const blendIf = resolvedBlendIf(layer);
  const fillOpacity = resolvedFillOpacity(layer);
  const hasAdvancedSettings = !isNeutralBlendIf(blendIf) || fillOpacity < 1;
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvancedSettings);
  const [draggedPass, setDraggedPass] = useState<string | null>(null);
  const activeBlendIf = blendIf.channels[blendIf.activeChannel];
  const setRange = (key: "source" | "underlying", range: BlendIfRange) => {
    studio.setLayerBlendIf(layer.id, {
      ...blendIf,
      channels: {
        ...blendIf.channels,
        [blendIf.activeChannel]: { ...activeBlendIf, [key]: range },
      },
    });
  };
  return (
    <div className="blend-stack-editor">
      <div className="blend-stack-heading">
        <span><strong>Blending</strong><small>{passes.length} of {MAX_LAYER_BLEND_PASSES} modes</small></span>
        <button type="button" onClick={() => studio.addBlendPass(layer.id)} disabled={passes.length >= MAX_LAYER_BLEND_PASSES} title="Add another blend pass">＋ Add blend mode</button>
      </div>
      <p>Pass 1 is applied first. Every pass blends this layer again with its own mode and opacity.</p>
      <div className="blend-pass-list">
        {passes.map((pass, index) => (
          <div
            className={`blend-pass ${pass.enabled ? "" : "disabled"}`}
            key={pass.id}
            draggable
            onDragStart={() => setDraggedPass(pass.id)}
            onDragEnd={() => setDraggedPass(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!draggedPass || draggedPass === pass.id) return;
              const from = passes.findIndex((candidate) => candidate.id === draggedPass);
              studio.moveBlendPass(layer.id, draggedPass, index - from);
              setDraggedPass(null);
            }}
          >
            <div className="blend-pass-topline">
              <button type="button" className="blend-pass-toggle" onClick={() => studio.updateBlendPass(layer.id, pass.id, { enabled: !pass.enabled })} aria-label={`${pass.enabled ? "Disable" : "Enable"} blend pass ${index + 1}`} title={pass.enabled ? "Disable pass" : "Enable pass"}>{pass.enabled ? "◉" : "○"}</button>
              <span>Pass {index + 1}</span>
              <div className="blend-pass-order">
                <button type="button" onClick={() => studio.moveBlendPass(layer.id, pass.id, -1)} disabled={index === 0} aria-label="Move pass earlier">↑</button>
                <button type="button" onClick={() => studio.moveBlendPass(layer.id, pass.id, 1)} disabled={index === passes.length - 1} aria-label="Move pass later">↓</button>
                <button type="button" onClick={() => studio.removeBlendPass(layer.id, pass.id)} disabled={passes.length === 1} aria-label="Remove blend pass">×</button>
              </div>
            </div>
            <select value={pass.mode} onChange={(event) => studio.updateBlendPass(layer.id, pass.id, { mode: event.target.value as BlendMode })} aria-label={`Blend mode for pass ${index + 1}`}>
              {BLEND_MODE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.modes.map((mode) => <option key={mode} value={mode}>{BLEND_LABELS[mode]}</option>)}
                </optgroup>
              ))}
            </select>
            <label>
              <span>Pass opacity</span>
              <input type="range" min="0" max="100" value={Math.round(pass.opacity * 100)} onChange={(event) => studio.updateBlendPass(layer.id, pass.id, { opacity: Number(event.target.value) / 100 })} />
              <output>{Math.round(pass.opacity * 100)}%</output>
            </label>
          </div>
        ))}
      </div>
      <details className="advanced-blending" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
        <summary><span>Advanced blending</span><small>Fill · Blend If</small></summary>
        <div className="advanced-blending-body">
          <label className="fill-opacity-control">
            <span>Fill opacity</span>
            <input type="range" min="0" max="100" value={Math.round(fillOpacity * 100)} onChange={(event) => studio.setLayerFillOpacity(layer.id, Number(event.target.value) / 100)} />
            <output>{Math.round(fillOpacity * 100)}%</output>
          </label>
          <div className="blend-if-heading">
            <span><strong>Blend If</strong><small>Feathered tonal visibility</small></span>
            <select value={blendIf.activeChannel} onChange={(event) => studio.setLayerBlendIf(layer.id, { ...blendIf, activeChannel: event.target.value as BlendIf["activeChannel"] })} aria-label="Blend If channel">
              <option value="gray">Gray</option><option value="red">Red</option><option value="green">Green</option><option value="blue">Blue</option>
            </select>
          </div>
          <BlendIfRangeEditor label="This layer" range={activeBlendIf.source} onChange={(range) => setRange("source", range)} />
          <BlendIfRangeEditor label="Underlying" range={activeBlendIf.underlying} onChange={(range) => setRange("underlying", range)} />
          <button type="button" className="blend-if-reset" onClick={() => studio.resetLayerBlendIf(layer.id)} disabled={!layer.blendIf}>Reset Blend If</button>
        </div>
      </details>
    </div>
  );
}
