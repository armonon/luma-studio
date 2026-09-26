"use client";

import { lazy, Suspense, useState } from "react";
import type { SpatialLayerStyle, TextRunStyle, TextStyle } from "@/app/engine/document";
import {
  applyTextRunStyle,
  resolvedDefaultTextStyle,
  resolvedTextStyleAt,
  withDefaultTextStyle,
} from "@/app/engine/text-model";
import { DEFAULT_TEXT_SPATIAL, TEXT_SPATIAL_PRESETS, withTextSpatial } from "@/app/engine/text-3d";
import { FontPicker } from "./font-picker";
import { TextAppearanceEditor } from "./text-appearance-editor";
const TextMeshEditor = lazy(() => import("./text-mesh-editor"));
import {
  executeTypographyCommand,
  typographyCommandForKeyboard,
  type TypographyCommandId,
} from "../typography-command-registry";

export type TextSelection = { start: number; end: number };

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export default function TypePanel({
  text,
  draft,
  selection,
  defaultColor,
  onSelection,
  onDraftChange,
  onDraftCommit,
  onPatch,
  onLivePatch,
  onCommitLive,
  onExportForm,
  spatialStyle,
  onSpatialPatch,
  onSpatialLivePatch,
  onSpatialCommit,
  onMeshRender,
  onMeshAsset,
  onMeshExport,
  onCreateOutlines,
  outlineDisabledReason,
}: {
  text: TextStyle | null;
  draft: string;
  selection: TextSelection;
  defaultColor: string;
  onSelection: (selection: TextSelection) => void;
  onDraftChange: (value: string) => void;
  onDraftCommit: () => void;
  onPatch: (patch: Partial<TextStyle>) => void;
  onLivePatch: (patch: Partial<TextStyle>) => void;
  onCommitLive: () => void;
  onExportForm: (includeGlyphs: boolean) => Promise<unknown>;
  spatialStyle?: SpatialLayerStyle;
  onSpatialPatch: (patch: Parameters<typeof withTextSpatial>[1]) => void;
  onSpatialLivePatch: (patch: Parameters<typeof withTextSpatial>[1]) => void;
  onSpatialCommit: () => void;
  onMeshRender: (canvas: HTMLCanvasElement) => void;
  onMeshAsset: (canvas: HTMLCanvasElement, asset: import("@/app/engine/lettering-asset").LetteringAsset) => void;
  onMeshExport: (blob: Blob, extension: "glb" | "png") => Promise<unknown>;
  onCreateOutlines: () => Promise<unknown>;
  outlineDisabledReason: string | null;
}) {
  const [section, setSection] = useState<"character" | "paragraph" | "appearance" | "spatial">("character");
  const [meshOpen, setMeshOpen] = useState(false);
  const [outlining, setOutlining] = useState(false);
  const [outlineError, setOutlineError] = useState("");
  const [formExporting, setFormExporting] = useState(false);
  const [formError, setFormError] = useState("");
  const base = text ? resolvedDefaultTextStyle(text) : {
    fontFamily: '"Lato", sans-serif',
    fontSize: 96,
    fontWeight: 700,
    fontStyle: "normal" as const,
    fontStretch: 100,
    color: defaultColor,
    tracking: 0,
    baselineShift: 0,
    decoration: "none" as const,
    axes: { wght: 700, wdth: 100, opsz: 96 },
    features: { kern: true, liga: true },
  };
  const selectedStyle = text && selection.end > selection.start
    ? resolvedTextStyleAt(text, selection.start)
    : base;
  const rangeSelected = Boolean(text && selection.end > selection.start);

  const characterPatch = (patch: TextRunStyle): Partial<TextStyle> | null => {
    if (!text) return null;
    return rangeSelected
      ? { schemaVersion: 2, runs: applyTextRunStyle(text, selection.start, selection.end, patch) }
      : withDefaultTextStyle(text, patch);
  };
  const patchCharacter = (patch: TextRunStyle) => {
    const update = characterPatch(patch);
    if (update) onPatch(update);
  };
  const liveCharacter = (patch: TextRunStyle) => {
    const update = characterPatch(patch);
    if (update) onLivePatch(update);
  };
  const runCommand = (id: TypographyCommandId) => executeTypographyCommand(id, selectedStyle, patchCharacter);
  const axis = (tag: string, value: number) => liveCharacter({
    axes: { ...selectedStyle.axes, [tag]: value },
    ...(tag === "wght" ? { fontWeight: value } : {}),
  });
  const appearance = text?.appearance ?? {
    fills: [{ id: "fill-primary", kind: "solid" as const, color: base.color, opacity: 1, enabled: true }],
    strokes: [],
  };
  const spatial = spatialStyle ?? text?.spatial ?? DEFAULT_TEXT_SPATIAL;
  const patchSpatial = (patch: Parameters<typeof withTextSpatial>[1], live = false) => {
    if (live) onSpatialLivePatch(patch);
    else onSpatialPatch(patch);
  };

  return (
    <div className="type-studio" data-has-text={Boolean(text)}>
      <div className="type-studio-story">
        <textarea
          value={draft}
          dir={text?.direction === "rtl" ? "rtl" : "auto"}
          aria-label={text ? "Edit active text layer" : "Text to add"}
          placeholder="Type on the canvas…"
          onChange={(event) => onDraftChange(event.target.value)}
          onSelect={(event) => onSelection({
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          })}
          onKeyDown={(event) => {
            const command = typographyCommandForKeyboard(event.nativeEvent);
            if (!command) return;
            event.preventDefault();
            runCommand(command);
          }}
          onBlur={onDraftCommit}
        />
        <span className="type-studio-selection">
          {rangeSelected ? `${selection.end - selection.start} selected` : text ? "Layer style" : "New text"}
        </span>
      </div>

      <div className="type-studio-tabs" role="tablist" aria-label="Typography sections">
        {(["character", "paragraph", "appearance", "spatial"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={section === id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
            {id === "spatial" ? "3D & Form" : id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      {!text && <p className="type-studio-empty">Choose a Type tool and click the canvas to create an editable text layer.</p>}

      {text && <div className="type-button-row" style={{ padding: "4px 0" }}>
        <button disabled={outlining || Boolean(outlineDisabledReason)} title={outlineDisabledReason ?? "Create editable vector contours; keep the original text hidden"}
          onClick={async () => { setOutlining(true); setOutlineError(""); try { await onCreateOutlines(); } catch (error) { setOutlineError(error instanceof Error ? error.message : "Unable to create outlines"); } finally { setOutlining(false); } }}>
          {outlining ? "Shaping…" : "Create outlines"}
        </button>
        {outlineError && <span role="alert">{outlineError}</span>}
      </div>}

      {text && section === "character" && (
        <div className="type-studio-grid">
          <FontPicker value={selectedStyle.fontFamily} onChange={fontFamily => patchCharacter({ fontFamily })} />
          <label><span>Weight</span><select value={Math.round(selectedStyle.fontWeight / 100) * 100} onChange={(event) => patchCharacter({ fontWeight: Number(event.target.value), axes: { ...selectedStyle.axes, wght: Number(event.target.value) } })}>
            {WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
          </select></label>
          <label><span>Size</span><input type="number" min="1" max="2000" value={Math.round(selectedStyle.fontSize * 10) / 10} onChange={(event) => liveCharacter({ fontSize: Math.max(1, Number(event.target.value)), axes: { ...selectedStyle.axes, opsz: Math.max(1, Number(event.target.value)) } })} onBlur={onCommitLive} /></label>
          <label><span>Tracking</span><input type="number" min="-1000" max="5000" value={selectedStyle.tracking} onChange={(event) => liveCharacter({ tracking: Number(event.target.value) })} onBlur={onCommitLive} /></label>
          <label><span>Baseline</span><input type="number" min="-500" max="500" value={selectedStyle.baselineShift} onChange={(event) => liveCharacter({ baselineShift: Number(event.target.value) })} onBlur={onCommitLive} /></label>
          <label className="type-color"><span>Color</span><input type="color" value={selectedStyle.color} onChange={(event) => patchCharacter({ color: event.target.value })} /></label>
          <label><span>Slant</span><select value={selectedStyle.fontStyle} onChange={event => patchCharacter({ fontStyle: event.target.value as TextRunStyle["fontStyle"] })}><option value="normal">Upright</option><option value="italic">Italic</option><option value="oblique">Oblique</option></select></label>
          <label><span>Decoration</span><select value={selectedStyle.decoration} onChange={event => patchCharacter({ decoration: event.target.value as TextRunStyle["decoration"] })}><option value="none">None</option><option value="underline">Underline</option><option value="line-through">Strikethrough</option></select></label>

          <div className="type-button-row type-wide" aria-label="Character styles">
            <button className={selectedStyle.fontWeight >= 700 ? "active" : ""} onClick={() => runCommand("type.bold")} aria-pressed={selectedStyle.fontWeight >= 700} title="Bold · ⌘B"><b>B</b></button>
            <button className={selectedStyle.fontStyle === "italic" ? "active" : ""} onClick={() => runCommand("type.italic")} aria-pressed={selectedStyle.fontStyle === "italic"} title="Italic · ⌘I"><i>I</i></button>
            <button className={selectedStyle.decoration === "underline" ? "active" : ""} onClick={() => runCommand("type.underline")} aria-pressed={selectedStyle.decoration === "underline"} title="Underline · ⌘U"><u>U</u></button>
            <button className={selectedStyle.features.smcp ? "active" : ""} onClick={() => runCommand("type.smallCaps")} aria-pressed={Boolean(selectedStyle.features.smcp)}>SC</button>
            <button className={selectedStyle.features.onum ? "active" : ""} onClick={() => runCommand("type.oldStyleNumbers")} aria-pressed={Boolean(selectedStyle.features.onum)}>01</button>
            <button className={selectedStyle.features.liga !== false ? "active" : ""} onClick={() => runCommand("type.ligatures")} aria-pressed={selectedStyle.features.liga !== false}>fi</button>
          </div>

          <label className="type-axis type-wide"><span><b>Weight axis</b><output>{Math.round(selectedStyle.axes.wght ?? selectedStyle.fontWeight)}</output></span><input aria-label="Font weight axis" type="range" min="100" max="900" value={selectedStyle.axes.wght ?? selectedStyle.fontWeight} onChange={(event) => axis("wght", Number(event.target.value))} onPointerUp={onCommitLive} onKeyUp={onCommitLive} onBlur={onCommitLive} /></label>
          <label className="type-axis type-wide"><span><b>Character width</b><output>{Math.round(selectedStyle.fontStretch)}%</output></span><input aria-label="Character width" type="range" min="50" max="200" value={selectedStyle.fontStretch} onChange={(event) => liveCharacter({ fontStretch: Number(event.target.value) })} onPointerUp={onCommitLive} onKeyUp={onCommitLive} onBlur={onCommitLive} /></label>
          <p className="type-studio-note type-wide">Character width scales lettering without changing the font’s width axis. Custom OpenType axes and features remain preserved; not all are rendered by Canvas.</p>
        </div>
      )}

      {text && section === "paragraph" && (
        <div className="type-studio-grid">
          <div className="type-button-row type-wide" aria-label="Text alignment">
            {(["left", "center", "right"] as const).map((align) => <button key={align} className={text.align === align ? "active" : ""} onClick={() => onPatch({ align })} aria-pressed={text.align === align}>{align === "left" ? "≡◂" : align === "center" ? "≡" : "▸≡"}</button>)}
            <button className={Boolean(text.justify) ? "active" : ""} onClick={() => onPatch({ justify: !text.justify })} aria-pressed={Boolean(text.justify)}>☰</button>
          </div>
          <label><span>Layout</span><select value={text.layout ?? "point"} onChange={(event) => onPatch({ layout: event.target.value as TextStyle["layout"], ...(event.target.value === "paragraph" ? { boxWidth: text.boxWidth ?? 600, boxHeight: text.boxHeight ?? 300 } : {}) })}><option value="point">Point</option><option value="paragraph">Frame</option><option value="vertical">Vertical</option><option value="path">Path</option></select></label>
          <label><span>Direction</span><select value={text.direction ?? "auto"} onChange={(event) => onPatch({ direction: event.target.value as TextStyle["direction"] })}><option value="auto">Automatic</option><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>
          <label><span>Leading</span><input type="number" min="0.5" max="5" step="0.05" value={text.lineHeight} onChange={(event) => onLivePatch({ lineHeight: Number(event.target.value) })} onBlur={onCommitLive} /></label>
          <label><span>After ¶</span><input type="number" min="0" max="10" step="0.1" value={text.paragraphSpacing ?? 0} onChange={(event) => onLivePatch({ paragraphSpacing: Number(event.target.value) })} onBlur={onCommitLive} /></label>
          <label className="type-wide"><span>Language</span><input value={text.language ?? "und"} placeholder="en-US, ar, ja…" onChange={(event) => onLivePatch({ language: event.target.value })} onBlur={onCommitLive} /></label>
          {text.layout === "paragraph" && <>
            <label><span>Frame width</span><input type="number" min="1" value={Math.round(text.boxWidth ?? 600)} onChange={(event) => onLivePatch({ boxWidth: Math.max(1, Number(event.target.value)) })} onBlur={onCommitLive} /></label>
            <label><span>Frame height</span><input type="number" min="1" value={Math.round(text.boxHeight ?? 300)} onChange={(event) => onLivePatch({ boxHeight: Math.max(1, Number(event.target.value)) })} onBlur={onCommitLive} /></label>
          </>}
        </div>
      )}

      {text && section === "appearance" && (
        <TextAppearanceEditor appearance={appearance} color={base.color} onChange={(appearance, live) => live ? onLivePatch({ appearance }) : onPatch({ appearance })} onCommit={onCommitLive} />
      )}

      {text && section === "spatial" && (
        <div className="type-studio-grid type-spatial-grid">
          <button className="type-wide" onClick={() => setMeshOpen(value => !value)} aria-expanded={meshOpen}>{meshOpen ? "Close 3D lettering workspace" : "Open 3D lettering workspace"}</button>
          {meshOpen && <Suspense fallback={<p className="type-wide" role="status">Loading 3D engine…</p>}><TextMeshEditor text={text} spatial={spatial} onLiveRotate={(rotationX, rotationY) => patchSpatial({ transform: { rotationX, rotationY } }, true)} onCommit={onSpatialCommit} onRender={onMeshRender} onAsset={onMeshAsset} onExport={onMeshExport} /></Suspense>}
          <div className="type-button-row type-wide" aria-label="3D text presets">{TEXT_SPATIAL_PRESETS.map(preset => <button key={preset.id} onClick={() => patchSpatial(preset.style)}>{preset.label}</button>)}<button onClick={() => patchSpatial(DEFAULT_TEXT_SPATIAL)}>Reset 3D</button></div>
          <label className="type-wide type-spatial-toggle"><span><b>Spatial text</b><small>Editable lightweight extrusion preview</small></span><input type="checkbox" checked={spatial.enabled} onChange={(event) => patchSpatial({ enabled: event.target.checked })} /></label>
          <label><span>Rotate X</span><input type="number" min="-180" max="180" value={spatial.transform.rotationX} onChange={(event) => patchSpatial({ transform: { rotationX: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label><span>Rotate Y</span><input type="number" min="-180" max="180" value={spatial.transform.rotationY} onChange={(event) => patchSpatial({ transform: { rotationY: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label><span>Rotate Z</span><input type="number" min="-180" max="180" value={spatial.transform.rotationZ} onChange={(event) => patchSpatial({ transform: { rotationZ: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label><span>Perspective</span><input type="number" min="0" max="100" value={spatial.transform.perspective} onChange={(event) => patchSpatial({ transform: { perspective: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label><span>Extrusion</span><input type="number" min="0" max="1000" value={spatial.extrusion.depth} onChange={(event) => patchSpatial({ extrusion: { depth: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label><span>Bevel</span><input type="number" min="0" max="100" value={spatial.extrusion.bevel} onChange={(event) => patchSpatial({ extrusion: { bevel: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label className="type-color"><span>Front</span><input type="color" value={spatial.material.frontColor} onChange={(event) => patchSpatial({ material: { frontColor: event.target.value } })} /></label>
          <label className="type-color"><span>Sides</span><input type="color" value={spatial.material.sideColor} onChange={(event) => patchSpatial({ material: { sideColor: event.target.value } })} /></label>
          <label><span>Roughness</span><input type="number" min="0" max="1" step="0.05" value={spatial.material.roughness} onChange={(event) => patchSpatial({ material: { roughness: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <label><span>Metalness</span><input type="number" min="0" max="1" step="0.05" value={spatial.material.metalness} onChange={(event) => patchSpatial({ material: { metalness: Number(event.target.value) } }, true)} onBlur={onSpatialCommit} /></label>
          <div className="type-form-actions type-wide">
            <button disabled={formExporting} onClick={async () => {
              setFormExporting(true); setFormError("");
              try { await onExportForm(true); } catch (error) { setFormError(error instanceof Error ? error.message : "Form export failed"); }
              finally { setFormExporting(false); }
            }}>{formExporting ? "Preparing glyphs…" : "Export glyphs to Form Studio"}</button>
            <button disabled={formExporting} onClick={async () => {
              setFormExporting(true); setFormError("");
              try { await onExportForm(false); } catch (error) { setFormError(error instanceof Error ? error.message : "Form export failed"); }
              finally { setFormExporting(false); }
            }}>Export source only (proxy)</button>
            {formError && <p role="alert">{formError}</p>}
            <span>{spatial.link ? `Linked · ${spatial.link.projectId}` : "Portable editable .lumaformtext asset"}</span>
          </div>
          <p className="type-studio-note type-wide">The canvas uses a lightweight 2D depth preview. Open the 3D lettering workspace for real glyph meshes, perspective and lit materials. Editable-source export does not launch or live-sync Form Studio; GLB exports the actual mesh.</p>
        </div>
      )}
    </div>
  );
}
