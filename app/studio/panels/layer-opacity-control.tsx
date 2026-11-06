"use client";

import { useRef, useState } from "react";

type LayerOpacityControlProps = Readonly<{
  layerId: string;
  value: number;
  disabled: boolean;
  onPreview: (layerId: string, value: number) => void;
  onCommit: (layerId: string, value: number) => void;
}>;

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100;
}

export default function LayerOpacityControl({ layerId, value, disabled, onPreview, onCommit }: LayerOpacityControlProps) {
  const percent = clampPercent(value * 100);
  const [draft, setDraft] = useState(String(percent));
  const [editing, setEditing] = useState(false);
  const initialPercent = useRef(percent);

  const commit = (next: number) => onCommit(layerId, (Number.isFinite(next) ? clampPercent(next) : percent) / 100);
  return <div className="layer-opacity-control" role="group" aria-label="Layer opacity">
    <div className="layer-opacity-heading">
      <span><strong>Opacity</strong><small>Selected layer</small></span>
      <label className="layer-opacity-number">
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          inputMode="numeric"
          aria-label="Layer opacity percentage"
          disabled={disabled}
          value={editing ? draft : String(percent)}
          onFocus={() => { initialPercent.current = percent; setDraft(String(percent)); setEditing(true); }}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (next !== "" && Number.isFinite(Number(next))) onPreview(layerId, clampPercent(Number(next)) / 100);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={() => {
            commit(draft === "" ? initialPercent.current : Number(draft));
            setEditing(false);
          }}
        />
        <span aria-hidden="true">%</span>
      </label>
    </div>
    <input
      type="range"
      min="0"
      max="100"
      step="1"
      aria-label="Layer opacity"
      disabled={disabled}
      value={percent}
      onChange={(event) => onPreview(layerId, Number(event.target.value) / 100)}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
      onKeyUp={(event) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(Number(event.currentTarget.value));
      }}
      onBlur={(event) => commit(Number(event.currentTarget.value))}
    />
    <div className="layer-opacity-scale" aria-hidden="true"><span>Transparent</span><span>Opaque</span></div>
    {disabled && <small className="layer-opacity-note">Unlock this layer to change its opacity.</small>}
  </div>;
}
