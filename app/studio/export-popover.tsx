"use client";
import { useEffect, useRef } from "react";

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
  onExportPrint: () => void;
  printAvailable: boolean;
  onToggleGL: () => void;
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
  onExportPrint,
  printAvailable,
  onToggleGL,
}: ExportPopoverProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="studio-popover-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} className="studio-export-popover" role="dialog" aria-modal="true" aria-label="Export document" onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key !== "Tab") return;
          const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? [])];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <header>
          <div><strong>Export document</strong><span>Choose a delivery format</span></div>
          <button onClick={onClose} aria-label="Close export menu">×</button>
        </header>

        <div className="studio-export-options">
          <article>
            <span className="export-format-mark">ICC</span>
            <div><strong>CMYK print PDF</strong><small>Desktop · printer ICC conversion · flattened</small></div>
            <button disabled={!printAvailable} onClick={onExportPrint}>Configure print output</button>
            <p>sRGB 8-bit input, up to 4 MP. Embedded output profile; not PDF/X certified.</p>
          </article>
          <article>
            <span className="export-format-mark">SVG</span>
            <div><strong>Editable vectors</strong><small>Paths, groups and vector masks · sRGB / 8-bit</small></div>
            <button onClick={() => onExportVector("svg")}>Export SVG</button>
            <button onClick={() => onExportVector("pdf")}>Export vector PDF</button>
            <p>Review affected objects and conversion limits before export. Unsupported content is never silently omitted.</p>
            <p>PDF: RGB paths with layer and paint opacity. Not PDF/X or color-certified print output.</p>
          </article>
          <article>
            <span className="export-format-mark">IMG</span>
            <div><strong>Raster image</strong><small>Flattened, color-managed output</small></div>
            <select value={rasterFormat} onChange={(event) => onRasterFormatChange(event.target.value as RasterFormat)} aria-label="Raster export format">
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
            <button onClick={onExportRaster}>Export {rasterFormat.toUpperCase()}</button>
          </article>

          <article>
            <span className="export-format-mark psd">PS</span>
            <div><strong>Photoshop document</strong><small>Layered PSD or large-document PSB</small></div>
            <select value={photoshopFormat} onChange={(event) => onPhotoshopFormatChange(event.target.value as PhotoshopFormat)} aria-label="Photoshop export container">
              <option value="auto">Automatic</option>
              <option value="source">Original source</option>
              <option value="psd">PSD</option>
              <option value="psb">PSB</option>
            </select>
            <button onClick={onExportPhotoshop}>Export {photoshopFormat === "psb" ? "PSB" : "PSD"}</button>
            <p>{compatibilityWarnings ? `${compatibilityWarnings} compatibility note${compatibilityWarnings === 1 ? "" : "s"} will be shown` : "Compatibility is checked during export"}</p>
          </article>
        </div>

        <footer>
          <div><strong>Export engine</strong><span>{useGL && glSupported ? "RGBA16F GPU compositing" : "CPU compositing"}</span></div>
          <button className={useGL ? "active" : ""} onClick={onToggleGL} disabled={!glSupported} aria-pressed={useGL}>
            {useGL ? "GPU on" : glSupported ? "Use GPU" : "GPU unavailable"}
          </button>
        </footer>
      </section>
    </div>
  );
}
