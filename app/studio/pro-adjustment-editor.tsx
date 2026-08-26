"use client";

import { useRef, useState } from "react";
import {
  PRO_ADJUSTMENT_LABELS,
  defaultProAdjustment,
  type ProAdjustmentParams,
  type RgbOffset,
} from "@/app/engine/pro-adjustments";

type Props = {
  adjustment: ProAdjustmentParams;
  onLive: (adjustment: ProAdjustmentParams) => void;
  onCommit: (adjustment: ProAdjustmentParams) => void;
  onReset: () => void;
};

function Range({ label, value, min, max, step, suffix = "", onLive, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onLive: (value: number) => void;
  onCommit: () => void;
}) {
  return <label>
    <span>{label}</span>
    <input type="range" value={value} min={min} max={max} step={step}
      onChange={(event) => onLive(Number(event.target.value))}
      onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    <output>{Math.abs(value) < 10 && step < 1 ? value.toFixed(2) : Math.round(value)}{suffix}</output>
  </label>;
}

export default function ProAdjustmentEditor({ adjustment, onLive, onCommit, onReset }: Props) {
  const [balanceBand, setBalanceBand] = useState<"shadows" | "midtones" | "highlights">("midtones");
  const [mixerOutput, setMixerOutput] = useState<0 | 1 | 2>(0);
  const [draft, setDraft] = useState(adjustment);
  const [editing, setEditing] = useState(false);
  const current = editing ? draft : adjustment;
  const lastValue = useRef(adjustment);
  const update = (patch: Record<string, unknown>) => {
    const next = { ...(editing ? lastValue.current : adjustment), ...patch } as ProAdjustmentParams;
    lastValue.current = next;
    setDraft(next);
    setEditing(true);
    return next;
  };
  const live = (patch: Record<string, unknown>) => {
    const next = update(patch);
    onLive(next);
    return next;
  };
  const commit = (next = lastValue.current) => {
    onCommit(next);
    setEditing(false);
  };

  return <section className="glass-card tone-card pro-adjustment-card">
    <header>
      <strong>{PRO_ADJUSTMENT_LABELS[current.kind]}</strong>
      <button type="button" onClick={onReset} aria-label="Reset adjustment">↺</button>
    </header>
    <div className="tone-controls">
      {current.kind === "black-white" && <>
        <Range label="Monochrome" value={current.amount * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ amount: value / 100 })} onCommit={commit} />
        <Range label="Tint" value={current.tintAmount * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ tintAmount: value / 100 })} onCommit={commit} />
        <label><span>Tint color</span><input type="color" value={current.tint}
          onChange={(event) => live({ tint: event.target.value })} onBlur={() => commit()} /><output>{current.tint}</output></label>
      </>}

      {current.kind === "color-balance" && <>
        <label><span>Tonal range</span><select value={balanceBand} onChange={(event) => setBalanceBand(event.target.value as typeof balanceBand)}>
          <option value="shadows">Shadows</option><option value="midtones">Midtones</option><option value="highlights">Highlights</option>
        </select><output>{balanceBand}</output></label>
        {(["Cyan / Red", "Magenta / Green", "Yellow / Blue"] as const).map((label, channel) => <Range key={label}
          label={label} value={current[balanceBand][channel] * 100} min={-100} max={100} step={1}
          onLive={(value) => {
            const band = [...current[balanceBand]] as RgbOffset;
            band[channel] = value / 100;
            live({ [balanceBand]: band });
          }} onCommit={commit} />)}
        <label><span>Preserve luminosity</span><input type="checkbox" checked={current.preserveLuminosity}
          onChange={(event) => { const next = update({ preserveLuminosity: event.target.checked }); onLive(next); commit(next); }} /><output>{current.preserveLuminosity ? "On" : "Off"}</output></label>
      </>}

      {current.kind === "photo-filter" && <>
        <label><span>Filter color</span><input type="color" value={current.color}
          onChange={(event) => live({ color: event.target.value })} onBlur={() => commit()} /><output>{current.color}</output></label>
        <Range label="Density" value={current.density * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ density: value / 100 })} onCommit={commit} />
        <label><span>Preserve luminosity</span><input type="checkbox" checked={current.preserveLuminosity}
          onChange={(event) => { const next = update({ preserveLuminosity: event.target.checked }); onLive(next); commit(next); }} /><output>{current.preserveLuminosity ? "On" : "Off"}</output></label>
      </>}

      {current.kind === "channel-mixer" && <>
        <label><span>Output channel</span><select value={mixerOutput} onChange={(event) => setMixerOutput(Number(event.target.value) as 0 | 1 | 2)}>
          <option value={0}>Red</option><option value={1}>Green</option><option value={2}>Blue</option>
        </select><output>{["R", "G", "B"][mixerOutput]}</output></label>
        {(["Red", "Green", "Blue", "Constant"] as const).map((label, component) => {
          const index = mixerOutput * 4 + component;
          return <Range key={label} label={label} value={current.matrix[index] * 100} min={-200} max={200} step={1} suffix="%"
            onLive={(value) => { const matrix = [...current.matrix] as typeof current.matrix; matrix[index] = value / 100; live({ matrix }); }} onCommit={commit} />;
        })}
      </>}

      {current.kind === "color-lookup" && <>
        <label><span>Look</span><select value={current.preset} onChange={(event) => {
          const next = update({ preset: event.target.value }); onLive(next); commit(next);
        }}><option value="cinematic">Cinematic</option><option value="teal-orange">Teal & Orange</option><option value="film">Film</option><option value="chrome">Chrome</option></select><output>LUT</output></label>
        <Range label="Intensity" value={current.intensity * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ intensity: value / 100 })} onCommit={commit} />
      </>}

      {current.kind === "gradient-map" && <>
        <label><span>Shadows</span><input type="color" value={current.shadow} onChange={(event) => live({ shadow: event.target.value })} onBlur={() => commit()} /><output>{current.shadow}</output></label>
        <label><span>Highlights</span><input type="color" value={current.highlight} onChange={(event) => live({ highlight: event.target.value })} onBlur={() => commit()} /><output>{current.highlight}</output></label>
        <Range label="Smooth" value={current.smoothness * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ smoothness: value / 100 })} onCommit={commit} />
        <label><span>Reverse</span><input type="checkbox" checked={current.reverse} onChange={(event) => {
          const next = update({ reverse: event.target.checked }); onLive(next); commit(next);
        }} /><output>{current.reverse ? "On" : "Off"}</output></label>
      </>}

      {current.kind === "relight-field" && <>
        <Range label="Horizontal" value={current.centerX * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ centerX: value / 100 })} onCommit={commit} />
        <Range label="Vertical" value={current.centerY * 100} min={0} max={100} step={1} suffix="%"
          onLive={(value) => live({ centerY: value / 100 })} onCommit={commit} />
        <Range label="Radius" value={current.radius * 100} min={1} max={150} step={1} suffix="%"
          onLive={(value) => live({ radius: value / 100 })} onCommit={commit} />
        <Range label="Intensity" value={current.intensity * 100} min={-100} max={100} step={1} suffix="%"
          onLive={(value) => live({ intensity: value / 100 })} onCommit={commit} />
        <Range label="Direction" value={current.angle} min={-180} max={180} step={1} suffix="°"
          onLive={(angle) => live({ angle })} onCommit={commit} />
        <Range label="Temperature" value={current.temperature * 100} min={-100} max={100} step={1}
          onLive={(value) => live({ temperature: value / 100 })} onCommit={commit} />
        <Range label="Falloff" value={current.falloff} min={0.2} max={5} step={0.1}
          onLive={(falloff) => live({ falloff })} onCommit={commit} />
      </>}

      {current.kind === "threshold" && <Range label="Threshold" value={current.level * 255} min={0} max={255} step={1}
        onLive={(value) => live({ level: value / 255 })} onCommit={commit} />}
      {current.kind === "posterize" && <Range label="Levels" value={current.levels} min={2} max={64} step={1}
        onLive={(levels) => live({ levels })} onCommit={commit} />}
      {current.kind === "invert" && <p style={{ padding: "4px 12px 10px", margin: 0, opacity: .65, fontSize: 11 }}>Colors are inverted nondestructively.</p>}
    </div>
    <footer style={{ padding: "4px 12px 10px" }}>
      <button type="button" onClick={() => { const next = defaultProAdjustment(current.kind); onLive(next); commit(next); }}>Reset</button>
    </footer>
  </section>;
}
