"use client";

import { ToolIcon } from "./studio-icons";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { TransformMode } from "./canvas-geometry";
import { FONT_CHOICES } from "./font-catalog";
import ShapeOptions, { type ShapeOptionsProps } from "./shape-options";
import PenOptions, { type PenOptionsProps } from "./pen-options";

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
  fontFamily: string;
  fontWeight: number;
  textAlign: string;
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
  transformControls,
  shapeControls,
  penControls,
}: {
  tool: string;
  label: string;
  description: string;
  layerName: string;
  layerKind: string;
  mode: "paint" | "selection" | "type" | "crop" | "general" | "transform" | "shape" | "pen";
  shapeControls?: ShapeOptionsProps;
  penControls?: PenOptionsProps;
  transformControls?: {
    mode: TransformMode; enabled: boolean; autoSelect: boolean; handles: boolean; snap: boolean;
    draft: boolean; distortionReason: string | null;
    onMode: (mode: TransformMode) => void; onAutoSelect: () => void; onHandles: () => void; onSnap: () => void;
    onApply: () => void; onCancel: () => void;
  };
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
            {(["replace", "add", "subtract", "intersect"] as const).map((operation) => <button key={operation} className={selectionMode === operation ? "active" : ""} aria-pressed={selectionMode === operation} onClick={() => onSelectionMode(operation)}>{operation === "replace" ? "New" : operation[0].toUpperCase() + operation.slice(1)}</button>)}
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
          <label className="context-select context-font-family"><span>Font</span><select title={values.fontFamily} value={values.fontFamily} onChange={(event) => onValue("fontFamily", event.target.value)}>{!FONT_CHOICES.some(font => font.value === values.fontFamily) && <option value={values.fontFamily}>{values.fontFamily.split(",")[0]} · current</option>}{FONT_CHOICES.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
          <label className="context-select"><span>Weight</span><select value={values.fontWeight} onChange={(event) => onValue("fontWeight", Number(event.target.value))}>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</select></label>
          {range("Size", "textSize", 8, 400, "px")}
          <div className="context-segmented" aria-label="Text alignment">
            {(["left", "center", "right"] as const).map((align) => <button key={align} className={values.textAlign === align ? "active" : ""} aria-pressed={values.textAlign === align} onClick={() => onValue("textAlign", align)} aria-label={`Align ${align}`}>{align === "left" ? <AlignLeft size={15} /> : align === "center" ? <AlignCenter size={15} /> : <AlignRight size={15} />}</button>)}
          </div>
        </div>
      )}

      {mode === "crop" && <div className="studio-context-summary"><span>{tool === "crop" ? "Drag the crop bounds" : "Place four perspective corners"}</span><small>Release to apply · Esc cancels draft points</small></div>}

      {mode === "general" && <div className="studio-context-summary"><span>{layerName}</span><small>{layerKind}</small></div>}
      {mode === "shape" && shapeControls && <ShapeOptions {...shapeControls} />}
      {mode === "pen" && penControls && <PenOptions {...penControls} />}

      {mode === "transform" && transformControls && <div className="studio-context-controls transform-context-controls">
        <div className="context-segmented" aria-label="Transform mode">
          {(["scale", "skew", "distort"] as const).map(value => <button key={value}
            disabled={!transformControls.enabled || (value === "distort" && !!transformControls.distortionReason) || transformControls.draft}
            title={value === "distort" ? transformControls.distortionReason ?? "Four-corner distortion · rasterizes on Apply · undoable" : value === "skew" ? "Drag a corner to shear its edge" : "Drag corners to scale · Shift locks proportions"}
            aria-pressed={transformControls.mode === value} className={transformControls.mode === value ? "active" : ""}
            onClick={() => transformControls.onMode(value)}>{value === "scale" ? "Transform" : value === "skew" ? "Skew" : "Distort"}</button>)}
        </div>
        {transformControls.draft ? <><button onClick={transformControls.onApply} title="Apply distortion (Enter)">Apply</button><button onClick={transformControls.onCancel} title="Cancel distortion (Esc)">Cancel</button></> : <>
          <button aria-pressed={transformControls.autoSelect} className={transformControls.autoSelect ? "active" : ""} onClick={transformControls.onAutoSelect} title="Select the layer under the pointer">Auto-select</button>
          <button aria-pressed={transformControls.handles} className={transformControls.handles ? "active" : ""} onClick={transformControls.onHandles}>Handles</button>
          <button aria-pressed={transformControls.snap} className={transformControls.snap ? "active" : ""} onClick={transformControls.onSnap} title="Snap to guides · Hold Option/Alt to bypass">Snap</button>
        </>}
      </div>}

      <div className="studio-context-actions">
        <button onClick={onFit}>Fit</button>
        <button className={showGuides ? "active" : ""} onClick={onToggleGuides} aria-pressed={showGuides}>Guides</button>
        <button className={assetsOpen ? "active" : ""} onClick={onToggleAssets} aria-pressed={assetsOpen}>Focus</button>
      </div>
    </div>
  );
}
