"use client";

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
  onToggleGL,
}: ExportPopoverProps) {
  return (
    <div className="studio-popover-backdrop" onMouseDown={onClose}>
      <section className="studio-export-popover" role="dialog" aria-modal="true" aria-label="Export document" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><strong>Export document</strong><span>Choose a delivery format</span></div>
          <button autoFocus onClick={onClose} aria-label="Close export menu">×</button>
        </header>

        <div className="studio-export-options">
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
            <p>{compatibilityWarnings ? `${compatibilityWarnings} compatibility note${compatibilityWarnings === 1 ? "" : "s"} will be shown` : "Editable fidelity check passed"}</p>
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
