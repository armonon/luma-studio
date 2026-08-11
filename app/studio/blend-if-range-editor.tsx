"use client";

import type { CSSProperties } from "react";
import { orderBlendIfHandles, type BlendIfRange } from "@/app/engine/document";

/**
 * The four Blend If handles for one range, as sliders rather than a split
 * triangle widget: black hide / black fade / white fade / white hide, in 0-255
 * so the numbers read the same as Photoshop's.
 */
export default function BlendIfRangeEditor({ label, range, onChange }: {
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
  const update = (key: keyof BlendIfRange, value: number) =>
    onChange(orderBlendIfHandles({ ...range, [key]: value / 255 }, key));
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
