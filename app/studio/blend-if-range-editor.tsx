"use client";

import { useRef, useState, type CSSProperties } from "react";
import { orderBlendIfHandles, type BlendIfRange } from "@/app/engine/document";

/**
 * The four Blend If handles for one range, as sliders rather than a split
 * triangle widget: black hide / black fade / white fade / white hide, in 0-255
 * so the numbers read the same as Photoshop's.
 */
export default function BlendIfRangeEditor({ label, range, onLive, onCommit }: {
  label: string;
  range: BlendIfRange;
  onLive: (range: BlendIfRange) => void;
  onCommit: (range: BlendIfRange) => void;
}) {
  const [draft, setDraft] = useState(range);
  const draftRef = useRef(range);
  const [editing, setEditing] = useState(false);
  const current = editing ? draft : range;
  const fields: ReadonlyArray<readonly [keyof BlendIfRange, string]> = [
    ["black", "Black hide"],
    ["blackFeather", "Black fade"],
    ["whiteFeather", "White fade"],
    ["white", "White hide"],
  ];
  const update = (key: keyof BlendIfRange, value: number) => {
    const next = orderBlendIfHandles({ ...(editing ? draftRef.current : range), [key]: value / 255 }, key);
    draftRef.current = next;
    setDraft(next);
    setEditing(true);
    onLive(next);
  };
  const commit = () => {
    if (!editing) return;
    onCommit(draftRef.current);
    setEditing(false);
  };
  return (
    <div className="blend-if-range">
      <div className="blend-if-range-heading">
        <strong>{label}</strong>
        <span>{Math.round(current.black * 255)} · {Math.round(current.blackFeather * 255)} / {Math.round(current.whiteFeather * 255)} · {Math.round(current.white * 255)}</span>
      </div>
      <div
        className="blend-if-preview"
        style={{
          "--black": `${current.black * 100}%`,
          "--black-feather": `${current.blackFeather * 100}%`,
          "--white-feather": `${current.whiteFeather * 100}%`,
          "--white": `${current.white * 100}%`,
        } as CSSProperties}
      />
      {fields.map(([key, name]) => (
        <label key={key}>
          <span>{name}</span>
          <input type="range" min="0" max="255" value={Math.round(current[key] * 255)} onChange={(event) => update(key, Number(event.target.value))} onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} aria-label={`${label} ${name}`} />
          <output>{Math.round(current[key] * 255)}</output>
        </label>
      ))}
    </div>
  );
}
