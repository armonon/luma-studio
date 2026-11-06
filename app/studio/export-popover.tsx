"use client";
import { useEffect, useRef, useState } from "react";
import "./export-popover.css";

type RasterFormat = "png" | "jpeg" | "webp";
type PhotoshopFormat = "auto" | "source" | "psd" | "psb";

type ExportPopoverProps = {
  rasterFormat: RasterFormat;
  photoshopFormat: PhotoshopFormat;
  compatibilityWarnings: number;
  glSupported: boolean;
  useGL: boolean;
  onRasterFormatChange: (format: RasterFormat) => void;
  onPhotoshopFormatChange: (format: PhotoshopFormat) => void;
  onClose: () => void;
  onExportRaster: () => void;
  onExportPhotoshop: () => void;
  onExportVector: (format: "svg" | "pdf") => void;
  onExportFigma?: (options: { outlineText: boolean }) => void;
  onExportPrint: () => void;
  printAvailable: boolean;
  onToggleGL: () => void;
  onSaveProject?: () => void;
};

export default function ExportPopover({
  rasterFormat,
  photoshopFormat,
  compatibilityWarnings,
  glSupported,
  useGL,
  onRasterFormatChange,
  onPhotoshopFormatChange,
  onClose,
  onExportRaster,
  onExportPhotoshop,
  onExportVector,
  onExportFigma,
  onExportPrint,
  printAvailable,
  onToggleGL,
  onSaveProject,
}: ExportPopoverProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [outlineText, setOutlineText] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="studio-popover-backdrop export-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="studio-export-popover luma-export-dialog" role="dialog" aria-modal="true" aria-label="Export document" onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key !== "Tab") return;
          const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary') ?? [])]
            .filter(control => control.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <header>
          <div><strong>Export document</strong><span>Choose how you want to use your work.</span></div>
          <button onClick={onClose} aria-label="Close export menu">×</button>
        </header>

        <div className="studio-export-options">
          <article className="export-choice export-choice-primary">
            <span className="export-format-mark" aria-hidden="true">IMG</span>
            <div className="export-choice-heading"><strong>Image</strong><small>For sharing, websites and everyday use</small></div>
            <div className="export-choice-controls">
            <select value={rasterFormat} onChange={(event) => onRasterFormatChange(event.target.value as RasterFormat)} aria-label="Raster export format">
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
            <button className="export-primary-action" onClick={onExportRaster}>Export {rasterFormat.toUpperCase()}</button>
            </div>
            <p className="export-note">A flattened image with your document&apos;s color conversion.</p>
          </article>

          {onSaveProject && <article className="export-choice">
            <span className="export-format-mark" aria-hidden="true">L</span>
            <div className="export-choice-heading"><strong>Luma project</strong><small>Keep your layers and editing controls</small></div>
            <div className="export-choice-controls">
            <button onClick={onSaveProject}>Save .luma project</button>
            </div>
          </article>}

          <article className="export-choice">
            <span className="export-format-mark psd" aria-hidden="true">PS</span>
            <div className="export-choice-heading"><strong>Photoshop</strong><small>Layered PSD or large-document PSB</small></div>
            <div className="export-choice-controls">
            <select value={photoshopFormat} onChange={(event) => onPhotoshopFormatChange(event.target.value as PhotoshopFormat)} aria-label="Photoshop export container">
              <option value="auto">Automatic</option>
              <option value="source">Original source</option>
              <option value="psd">PSD</option>
              <option value="psb">PSB</option>
            </select>
            <button onClick={onExportPhotoshop}>{photoshopFormat === "auto" || photoshopFormat === "source" ? "Export Photoshop" : `Export ${photoshopFormat.toUpperCase()}`}</button>
            </div>
            <p className="export-note" data-warning={compatibilityWarnings > 0}>{compatibilityWarnings ? `${compatibilityWarnings} compatibility note${compatibilityWarnings === 1 ? "" : "s"} to review before export.` : "Compatibility is checked before export."}</p>
          </article>
          <article className="export-choice">
            <span className="export-format-mark" aria-hidden="true">SVG</span>
            <div className="export-choice-heading"><strong>Vector artwork</strong><small>Paths, groups and vector masks</small></div>
            <div className="export-choice-controls">
            <button onClick={() => onExportVector("svg")}>Export SVG</button>
            <button onClick={() => onExportVector("pdf")}>Export PDF</button>
            </div>
            <details className="export-details"><summary>Compatibility & color</summary>
              <p>sRGB / 8-bit. Review affected objects and conversion limits before export. Unsupported content is never silently omitted.</p>
              <p>PDF includes RGB paths with layer and paint opacity. It is not PDF/X or color-certified print output.</p>
            </details>
          </article>
          {onExportFigma && <article className="export-choice studio-export-figma">
            <span className="export-format-mark figma" aria-hidden="true">FIG</span>
            <div className="export-choice-heading"><strong>Figma</strong><small>Layered SVG you can drag into Figma</small></div>
            <div className="export-choice-controls">
            <button onClick={() => onExportFigma({ outlineText })}>Export for Figma</button>
            </div>
            <label className="studio-export-check">
              <input type="checkbox" checked={outlineText} onChange={(event) => setOutlineText(event.target.checked)} />
              <span>Outline text using Luma&apos;s bundled fonts</span>
            </label>
            <p className="export-note">Effects, masks, filters and adjustments become images.</p>
            <details className="export-details"><summary>What stays editable?</summary>
              <p>Images, shapes, paths and groups stay separate, with one group per layer. Text stays editable unless outlined; Figma needs the same fonts installed.</p>
              <p>Blend modes are written as CSS mix-blend-mode and may import as Normal. SVG filters are not imported as effects. Output is checked against Luma&apos;s PNG in a browser, not inside Figma.</p>
            </details>
          </article>}
          <article className="export-choice">
            <span className="export-format-mark" aria-hidden="true">ICC</span>
            <div className="export-choice-heading"><strong>CMYK print PDF</strong><small>{printAvailable ? "Printer profile conversion · flattened" : "Available in the desktop app"}</small></div>
            {printAvailable && <div className="export-choice-controls"><button onClick={onExportPrint}>Configure print output</button></div>}
            <details className="export-details"><summary>Print requirements</summary>
              <p>sRGB 8-bit input, up to 4 MP. Includes the output profile. Not PDF/X certified.</p>
            </details>
          </article>
        </div>

        <footer>
          <details className="export-details export-rendering-options"><summary>Rendering options</summary>
          <div className="export-rendering-row"><span>{useGL && glSupported ? "GPU compositing · RGBA16F" : "CPU compositing"}</span>
          <button className={useGL && glSupported ? "active" : ""} onClick={onToggleGL} disabled={!glSupported} aria-pressed={useGL && glSupported}>
            {!glSupported ? "GPU unavailable" : useGL ? "GPU on" : "Use GPU"}
          </button>
          </div>
          </details>
        </footer>
      </section>
    </div>
  );
}
