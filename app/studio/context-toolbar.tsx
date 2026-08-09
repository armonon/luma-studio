"use client";

import { ToolIcon } from "./studio-icons";

export type SelectionCombineMode = "replace" | "add" | "subtract" | "intersect";

type ContextValues = {
  color: string;
  size: number;
  hardness: number;
  flow: number;
  opacity: number;
  smoothing: number;
  symmetry: string;
  feather: number;
  smooth: number;
  contrast: number;
  shiftEdge: number;
  tolerance: number;
  textSize: number;
};

export default function ContextToolbar({
  tool,
  label,
  description,
  layerName,
  layerKind,
  mode,
  selectionMode,
  values,
  showGuides,
  assetsOpen,
  onValue,
  onSelectionMode,
  onFit,
  onToggleGuides,
  onToggleAssets,
}: {
  tool: string;
  label: string;
  description: string;
  layerName: string;
  layerKind: string;
  mode: "paint" | "selection" | "type" | "crop" | "general";
  selectionMode: SelectionCombineMode;
  values: ContextValues;
  showGuides: boolean;
  assetsOpen: boolean;
  onValue: (key: keyof ContextValues, value: number | string) => void;
  onSelectionMode: (mode: SelectionCombineMode) => void;
  onFit: () => void;
  onToggleGuides: () => void;
  onToggleAssets: () => void;
}) {
  const range = (label: string, key: keyof ContextValues, min: number, max: number, suffix = "", step = 1) => (
    <label className="context-range">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={Number(values[key])} onChange={(event) => onValue(key, Number(event.target.value))} />
      <output>{values[key]}{suffix}</output>
    </label>
  );

  return (
    <div className="studio-contextbar" aria-label={`${tool} options`}>
      <div className="studio-context-identity">
        <span><ToolIcon id={tool} size={17} /></span>
        <div><strong>{label}</strong><small>{description}</small></div>
      </div>

      {mode === "paint" && (
        <div className="studio-context-controls">
          <label className="context-color" title="Foreground color"><input type="color" value={values.color} onChange={(event) => onValue("color", event.target.value)} aria-label="Foreground color" /></label>
          {range("Size", "size", 1, tool === "capture-brush" ? 1200 : 400, "px")}
          {range("Hard", "hardness", 0, 100, "%")}
          {range("Flow", "flow", 1, 100, "%")}
          {range("Opacity", "opacity", 0, 100, "%")}
          {range("Smooth", "smoothing", 0, 95, "%")}
          <label className="context-select"><span>Symmetry</span><select value={values.symmetry} onChange={(event) => onValue("symmetry", event.target.value)}><option value="none">Off</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="radial">Radial · 6</option></select></label>
        </div>
      )}

      {mode === "selection" && (
        <div className="studio-context-controls selection-context-controls">
          <div className="context-segmented" aria-label="Selection operation">
            {(["replace", "add", "subtract", "intersect"] as const).map((operation) => <button key={operation} className={selectionMode === operation ? "active" : ""} onClick={() => onSelectionMode(operation)}>{operation === "replace" ? "New" : operation[0].toUpperCase() + operation.slice(1)}</button>)}
          </div>
          {range("Feather", "feather", 0, 64, "px")}
          {range("Smooth", "smooth", 0, 24)}
          {range("Contrast", "contrast", 0, 100, "%")}
          {range("Shift", "shiftEdge", -100, 100, "%")}
          {tool === "sel-wand" && range("Tolerance", "tolerance", 0, 128)}
        </div>
      )}

      {mode === "type" && (
        <div className="studio-context-controls">
          <label className="context-color" title="Type color"><input type="color" value={values.color} onChange={(event) => onValue("color", event.target.value)} aria-label="Type color" /></label>
          {range("Size", "textSize", 8, 400, "px")}
          <span className="context-tool-note">Click the canvas to add type · active text updates live</span>
        </div>
      )}

      {mode === "crop" && <div className="studio-context-summary"><span>{tool === "crop" ? "Drag the crop bounds" : "Place four perspective corners"}</span><small>Release to apply · Esc cancels draft points</small></div>}

      {mode === "general" && <div className="studio-context-summary"><span>{layerName}</span><small>{layerKind}</small></div>}

      <div className="studio-context-actions">
        <button onClick={onFit}>Fit</button>
        <button className={showGuides ? "active" : ""} onClick={onToggleGuides} aria-pressed={showGuides}>Guides</button>
        <button className={assetsOpen ? "active" : ""} onClick={onToggleAssets} aria-pressed={assetsOpen}>Tray</button>
      </div>
    </div>
  );
}
