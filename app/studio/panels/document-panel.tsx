"use client";

import { useRef } from "react";
import type { Document, ProofProfile, ProofSettings } from "@/app/engine/document";
import type { PhotoshopCompatibilityReport } from "@/app/engine/psd";
import type { Studio } from "@/app/engine/studio";

type EngineState = ReturnType<Studio["engineState"]>;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export default function DocumentPanel({
  studio,
  document,
  engineState,
  photoshopReport,
  showGuides,
  snapGuides,
  localCrashCount,
  onNotify,
  onExportDiagnostics,
  onToggleGuides,
  onToggleSnap,
}: Readonly<{
  studio: Studio | null;
  document: Document | null | undefined;
  engineState?: EngineState;
  photoshopReport: PhotoshopCompatibilityReport | null | undefined;
  showGuides: boolean;
  snapGuides: boolean;
  localCrashCount: number;
  onNotify: (message: string) => void;
  onExportDiagnostics: () => void;
  onToggleGuides: () => void;
  onToggleSnap: () => void;
}>) {
  const widthRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const resolutionRef = useRef<HTMLInputElement>(null);
  return <>
    <section className="glass-card mask-card" data-contextual-panel="document">
      <header><strong>Document</strong><small>{document?.width ?? 0} × {document?.height ?? 0}</small></header>
      <div className="document-size-row">
        <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
          <span>Width px</span>
          <input key={`width-${document?.width}`} ref={widthRef} type="number" min="1" max="32768" defaultValue={document?.width ?? 1600} style={{ width: "100%" }} />
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 10 }}>
          <span>Height px</span>
          <input key={`height-${document?.height}`} ref={heightRef} type="number" min="1" max="32768" defaultValue={document?.height ?? 1067} style={{ width: "100%" }} />
        </label>
        <button onClick={() => {
          const width = Number(widthRef.current?.value);
          const height = Number(heightRef.current?.value);
          if (studio?.resizeDocument(width, height)) onNotify(`Resized to ${Math.round(width)}×${Math.round(height)}`);
        }} aria-label="Apply document size" title="Resize document" style={{ alignSelf: "end" }}>✓</button>
      </div>
      <div style={{ display: "grid", gap: 7, padding: "0 10px 10px" }}>
        <label style={{ display: "grid", gridTemplateColumns: "74px 1fr auto", alignItems: "center", gap: 6, fontSize: 10 }}>
          <span>Resolution</span>
          <input key={`resolution-${document?.resolution.x}`} ref={resolutionRef} type="number" min="1" max="12000" step="1" defaultValue={document?.resolution.x ?? 72} aria-label="Document print resolution in pixels per inch" />
          <button onClick={() => {
            const ppi = Number(resolutionRef.current?.value);
            if (studio?.setDocumentResolution(ppi)) onNotify(`Resolution set to ${ppi} ppi without resampling`);
          }} aria-label="Apply print resolution">Set</button>
        </label>
        <label style={{ display: "grid", gridTemplateColumns: "74px 1fr", alignItems: "center", gap: 6, fontSize: 10 }}>
          <span>Color space</span>
          <select value={document?.colorSpace ?? "srgb"} onChange={(event) => {
            if (!studio || !document) return;
            const colorSpace = event.target.value as typeof document.colorSpace;
            if (studio.setDocumentPrecision(document.bitDepth, colorSpace)) onNotify(`Converted to ${colorSpace.toUpperCase()}`);
          }} aria-label="Document color space">
            <option value="srgb">sRGB</option><option value="display-p3">Display P3</option><option value="linear-srgb">Linear sRGB</option>
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "74px repeat(3, 1fr)", gap: 5, alignItems: "center", fontSize: 10 }}>
          <span>Bit depth</span>
          {([8, 16, 32] as const).map((depth) => (
            <button key={depth} type="button" className={document?.bitDepth === depth ? "active" : ""} onClick={() => {
              if (!studio || !document) return;
              if (studio.setDocumentPrecision(depth, document.colorSpace)) onNotify(`Converted to ${depth}-bit ${depth === 8 ? "integer" : "float"}`);
            }} aria-pressed={document?.bitDepth === depth}>{depth}</button>
          ))}
        </div>
        <details className="document-diagnostics">
          <summary><span>Engine details</span><small>{engineState?.precisionTiles ?? 0} precision tiles · ≥{formatBytes(engineState?.estimatedResidentBytes ?? 0)}</small></summary>
          <div className="document-diagnostics-body">
            <div><span>Memory floor</span><b>≥{formatBytes(engineState?.estimatedResidentBytes ?? 0)} resident</b></div>
            <div><span>Tile budget</span><b>{formatBytes(engineState?.residentMemoryBudget.residentBytes ?? 0)} / {formatBytes(engineState?.residentMemoryBudget.ceilingBytes ?? 0)}</b></div>
            <div><span>Precision</span><b>Linear · {document?.bitDepth ?? 8}-bit</b></div>
            <div><span>Color</span><b>{engineState?.colorManagement.profiles ?? 0} ICC profiles</b></div>
            <div><span>Canvas</span><b>{engineState?.virtualCanvas.levels ?? 1} mip · {engineState?.virtualCanvas.plannedTiles ?? 0} ready</b></div>
            <div><span>Renderer</span><b>{Math.round((engineState?.viewportPerformance.p95Ms ?? 0) * 10) / 10} ms p95 · {Math.round((engineState?.adaptivePreview.scale ?? 1) * 100)}%</b></div>
            <div><span>GPU cache</span><b>{formatBytes(engineState?.gpuTextureCache.residentBytes ?? 0)} / {formatBytes(engineState?.gpuTextureCache.budgetBytes ?? 0)}</b></div>
            <div><span>Photoshop</span><b>{engineState?.photoshop.container.toUpperCase() ?? "PSD"} · {engineState?.photoshop.warnings ?? 0} notes</b></div>
            <div><span>Stability</span><b>{localCrashCount} local crash record{localCrashCount === 1 ? "" : "s"}</b></div>
            <button onClick={onExportDiagnostics}>Export diagnostics</button>
          </div>
        </details>
        {photoshopReport && (
          <details className="advanced-blending">
            <summary><span>Photoshop preflight</span><small>{photoshopReport.canExport ? `${photoshopReport.container.toUpperCase()} ready` : "Action required"}</small></summary>
            <div className="advanced-blending-body" style={{ gap: 5 }}>
              {photoshopReport.issues.length === 0 ? <small>No compatibility issues detected.</small> : photoshopReport.issues.map((issue, index) => (
                <small key={`${issue.code}-${issue.layerId ?? "document"}-${index}`} style={{ lineHeight: 1.35 }}>{issue.severity === "error" ? "●" : issue.severity === "warning" ? "▲" : "ℹ"} {issue.message}</small>
              ))}
            </div>
          </details>
        )}
        <label style={{ display: "grid", gridTemplateColumns: "74px 1fr", alignItems: "center", gap: 6, fontSize: 10 }}>
          <span>Soft proof</span>
          <select value={document?.proofing.profile ?? "none"} onChange={(event) => studio?.setDocumentProofing({ profile: event.target.value as ProofProfile })} aria-label="Soft proof profile">
            <option value="none">Off</option><option value="srgb">sRGB output</option><option value="display-p3">Display P3 output</option><option value="cmyk-generic">CMYK · coated proof</option>
          </select>
        </label>
        {document?.proofing.profile !== "none" && <>
          <label style={{ display: "grid", gridTemplateColumns: "74px 1fr", alignItems: "center", gap: 6, fontSize: 10 }}>
            <span>Intent</span>
            <select value={document?.proofing.intent ?? "relative-colorimetric"} onChange={(event) => studio?.setDocumentProofing({ intent: event.target.value as ProofSettings["intent"] })} aria-label="Proof rendering intent">
              <option value="relative-colorimetric">Relative colorimetric</option><option value="perceptual">Perceptual</option><option value="absolute-colorimetric">Absolute colorimetric</option><option value="saturation">Saturation</option>
            </select>
          </label>
          <div className="mask-segmented">
            <button type="button" className={document?.proofing.blackPointCompensation ? "active" : ""} onClick={() => studio?.setDocumentProofing({ blackPointCompensation: !document?.proofing.blackPointCompensation })}>Black point</button>
            <button type="button" className={document?.proofing.gamutWarning ? "active" : ""} onClick={() => studio?.setDocumentProofing({ gamutWarning: !document?.proofing.gamutWarning })}>Gamut warning</button>
          </div>
        </>}
      </div>
    </section>
    <section className="glass-card mask-card" data-contextual-panel="document">
      <header><strong>Guides & snapping</strong><button onClick={onToggleGuides}>{showGuides ? "Hide" : "Show"}</button></header>
      <div className="mask-actions" style={{ paddingBottom: 6 }}>
        <button onClick={() => document && studio?.addGuide("vertical", document.width / 2)}>＋ Vertical</button>
        <button onClick={() => document && studio?.addGuide("horizontal", document.height / 2)}>＋ Horizontal</button>
        <button onClick={onToggleSnap}>{snapGuides ? "✓ Snap" : "Snap off"}</button>
        <button onClick={() => studio?.clearGuides()}>Clear</button>
      </div>
      {!!document?.guides.length && <div style={{ display: "grid", gap: 4, padding: "0 10px 8px" }}>
        {document.guides.map((guide) => <button key={guide.id} onClick={() => studio?.removeGuide(guide.id)} style={{ display: "flex", justifyContent: "space-between" }} title="Remove guide"><span>{guide.orientation === "vertical" ? "V" : "H"} · {Math.round(guide.position)} px</span><span>×</span></button>)}
      </div>}
    </section>
  </>;
}
