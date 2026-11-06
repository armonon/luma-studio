"use client";

import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ToolIcon } from "./studio-icons";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { TransformMode } from "./canvas-geometry";
import { FONT_CHOICES } from "./font-catalog";
import ShapeOptions, { type ShapeOptionsProps } from "./shape-options";
import PenOptions, { type PenOptionsProps } from "./pen-options";
import { MIRROR_MODES } from "./brush-library";

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
  phone = false,
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
  onOpenBrushes,
}: {
  phone?: boolean;
  tool: string;
  label: string;
  description: string;
  layerName: string;
  layerKind: string;
  mode: "paint" | "selection" | "type" | "crop" | "general" | "transform" | "shape" | "pen";
  shapeControls?: ShapeOptionsProps;
  penControls?: PenOptionsProps;
  onOpenBrushes?: () => void;
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
  const settingsId = useId();
  const viewId = useId();
  const [phoneSettingsOpen, setPhoneSettingsOpen] = useState(false);
  const phoneSettingsButton = useRef<HTMLButtonElement>(null);
  const handleToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!phoneSettingsOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setPhoneSettingsOpen(false);
      phoneSettingsButton.current?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const sheet = event.currentTarget.querySelector<HTMLElement>(".studio-context-controls");
    const controls = [phoneSettingsButton.current, ...Array.from(sheet?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])]
      .filter((element): element is HTMLElement => Boolean(element && element.getClientRects().length));
    if (!controls.length) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    if (current < 0 || (event.shiftKey && current === 0) || (!event.shiftKey && current === controls.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  };
  const range = (label: string, key: keyof ContextValues, min: number, max: number, suffix = "", step = 1) => (
    <label className="context-range" data-option={key}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={Number(values[key])} onChange={(event) => onValue(key, Number(event.target.value))} />
      <output>{values[key]}{suffix}</output>
    </label>
  );

  return (
    <div className="studio-contextbar" data-tool-mode={mode} data-phone-options-open={phoneSettingsOpen ? "true" : undefined} role={phoneSettingsOpen ? "dialog" : undefined} aria-modal={phoneSettingsOpen || undefined} aria-label={`${tool} options`} onKeyDown={handleToolbarKeyDown}>
      {phone && phoneSettingsOpen && <button className="phone-tool-settings-scrim" type="button" tabIndex={-1} aria-label="Close all tool settings" onClick={() => setPhoneSettingsOpen(false)} />}
      <div className="studio-context-identity">
        <span><ToolIcon id={tool} size={17} /></span>
        <div><strong>{label}</strong><small>{description}</small></div>
      </div>
      {phone && mode === "selection" && <select className="phone-primary-control" aria-label="Selection operation" value={selectionMode} onChange={event => onSelectionMode(event.target.value as SelectionCombineMode)}>{(["replace", "add", "subtract", "intersect"] as const).map(operation => <option key={operation} value={operation}>{operation === "replace" ? "New selection" : operation[0].toUpperCase() + operation.slice(1)}</option>)}</select>}
      {phone && mode === "type" && <label className="phone-primary-control phone-primary-number">Size <input type="number" min="8" max="400" value={values.textSize} onChange={event => onValue("textSize", Number(event.target.value))} aria-label="Text size in pixels" /></label>}
      {phone && mode === "transform" && transformControls && <select className="phone-primary-control" aria-label="Transform mode" value={transformControls.mode} onChange={event => transformControls.onMode(event.target.value as TransformMode)} disabled={!transformControls.enabled || transformControls.draft}><option value="scale">Transform</option><option value="skew">Skew</option><option value="distort" disabled={!!transformControls.distortionReason}>Distort</option></select>}
      {phone && ["paint", "selection", "type", "transform"].includes(mode) && <button ref={phoneSettingsButton} className="phone-all-settings" type="button" aria-expanded={phoneSettingsOpen} onClick={() => setPhoneSettingsOpen(open => !open)}>{phoneSettingsOpen ? "Done" : "All settings"}</button>}

      {mode === "paint" && (
        <div className="studio-context-controls">
          {onOpenBrushes && <button onClick={onOpenBrushes} aria-label="Open brush library">Brushes</button>}
          <label className="context-color" title="Foreground color"><input type="color" value={values.color} onChange={(event) => onValue("color", event.target.value)} aria-label="Foreground color" /></label>
          {range("Size", "size", 1, tool === "capture-brush" ? 1200 : 400, "px")}
          {range("Opacity", "opacity", 0, 100, "%")}
          {!phone && <button className="context-more-trigger" popoverTarget={settingsId}>Tool settings</button>}
          <div key={tool} id={settingsId} popover={phone ? undefined : "auto"} className={phone ? "phone-extra-settings" : "context-more-panel"} aria-label={`${label} settings`} onKeyDown={event => event.stopPropagation()}>
            <header><strong>{label} settings</strong>{!phone && <button popoverTarget={settingsId} popoverTargetAction="hide" aria-label="Close tool settings">×</button>}</header>
            {range("Hardness", "hardness", 0, 100, "%")}
            {range("Flow", "flow", 1, 100, "%")}
            {range("Smoothing", "smoothing", 0, 95, "%")}
            {["brush", "pencil", "capture-brush", "erase", "mask-add", "mask-remove"].includes(tool) && <label className="context-select"><span>Mirror</span><select value={values.symmetry} onChange={(event) => onValue("symmetry", event.target.value)}>{MIRROR_MODES.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>}
          </div>
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
          {range("Size", "textSize", 8, 400, "px")}
          {!phone && <button className="context-more-trigger" popoverTarget={settingsId}>Tool settings</button>}
          <div key={tool} id={settingsId} popover={phone ? undefined : "auto"} className={phone ? "phone-extra-settings" : "context-more-panel"} aria-label={`${label} settings`} onKeyDown={event => event.stopPropagation()}>
          <header><strong>{label} settings</strong>{!phone && <button popoverTarget={settingsId} popoverTargetAction="hide" aria-label="Close tool settings">×</button>}</header>
          <label className="context-select"><span>Weight</span><select value={values.fontWeight} onChange={(event) => onValue("fontWeight", Number(event.target.value))}>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</select></label>
          <div className="context-segmented" aria-label="Text alignment">
            {(["left", "center", "right"] as const).map((align) => <button key={align} className={values.textAlign === align ? "active" : ""} aria-pressed={values.textAlign === align} onClick={() => onValue("textAlign", align)} aria-label={`Align ${align}`}>{align === "left" ? <AlignLeft size={15} /> : align === "center" ? <AlignCenter size={15} /> : <AlignRight size={15} />}</button>)}
          </div>
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
        <button popoverTarget={viewId} aria-label="Canvas view options">View</button>
        <div id={viewId} popover="auto" className="context-more-panel context-view-panel" aria-label="Canvas view options" onKeyDown={event => event.stopPropagation()}>
          <header><strong>Canvas view</strong><button popoverTarget={viewId} popoverTargetAction="hide" aria-label="Close canvas view options">×</button></header>
          <button onClick={onFit}>Fit canvas</button>
          <button className={showGuides ? "active" : ""} onClick={onToggleGuides} aria-pressed={showGuides}>Guides</button>
          <button className={assetsOpen ? "active" : ""} onClick={onToggleAssets} aria-pressed={assetsOpen} title="Show the Layer Focus strip">Layer strip</button>
        </div>
      </div>
    </div>
  );
}
