"use client";

import { useRef, useState } from "react";
import { neuralUpscale, UpscaleCancelledError } from "../engine/upscale";

export type UpscaleDialogProps = {
  /** Snapshot of the active raster layer's pixels, or null if none is selected. */
  getLayerCanvas: () => HTMLCanvasElement | null;
  onApply: (canvas: HTMLCanvasElement, scale: 2 | 4) => void;
  onSave: (blob: Blob, fileName: string) => void;
  onClose: () => void;
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), type, quality);
  });
}

/**
 * Upscale: on-device 2x/4x via Swin2SR. The model downloads on first use —
 * not precached — and this dialog says so plainly. Large inputs are tiled
 * (app/engine/upscale-tiling.ts) so a big photo doesn't blow the tab's memory
 * budget; progress is reported per tile.
 */
export default function UpscaleDialog({ getLayerCanvas, onApply, onSave, onClose }: UpscaleDialogProps) {
  const [scale, setScale] = useState<2 | 4>(2);
  const [progress, setProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [result, setResult] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourceCanvas = getLayerCanvas();

  const run = async () => {
    if (!sourceCanvas) { setError("Select a raster layer first."); return; }
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ msg: "Starting", pct: 0 });
    try {
      const out = await neuralUpscale(sourceCanvas, scale, (msg, pct) => setProgress({ msg, pct }), controller.signal);
      setResult(out);
      setProgress(null);
    } catch (err) {
      setProgress(null);
      if (err instanceof UpscaleCancelledError) return;
      setError(err instanceof Error ? err.message : "Upscale failed. Check your connection on first use.");
    }
  };

  const cancel = () => { abortRef.current?.abort(); setProgress(null); };

  return (
    <div role="dialog" aria-label="Upscale" style={overlayStyle}>
      <div style={panelStyle}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Upscale <span style={badgeStyle}>alpha</span></h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 0 }}>
          Runs on this device with Swin2SR (Apache-2.0). The model downloads the first time you use it — it is not
          part of the offline install, so Upscale needs a connection the first time. After that, inference stays local.
        </p>
        {!sourceCanvas && <p role="alert">Select a raster layer to upscale.</p>}
        <fieldset style={{ border: "none", padding: 0, margin: "12px 0" }} disabled={!!progress}>
          <legend style={{ fontSize: 12, opacity: 0.75 }}>Scale</legend>
          <label style={{ marginRight: 16 }}>
            <input type="radio" name="upscale-factor" checked={scale === 2} onChange={() => setScale(2)} /> 2×
          </label>
          <label>
            <input type="radio" name="upscale-factor" checked={scale === 4} onChange={() => setScale(4)} /> 4× (two passes)
          </label>
        </fieldset>
        {progress && (
          <div style={{ margin: "12px 0" }}>
            <div style={progressTrackStyle}>
              <div style={{ ...progressFillStyle, width: `${Math.min(100, Math.max(2, progress.pct))}%` }} />
            </div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>{progress.msg}</div>
            <button onClick={cancel} style={{ marginTop: 8 }}>Cancel</button>
          </div>
        )}
        {error && <p role="alert" style={{ color: "#ff6b6b" }}>{error}</p>}
        {!progress && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={run} disabled={!sourceCanvas}>Upscale {scale}×</button>
            {result && (
              <>
                <button onClick={() => { onApply(result, scale); onClose(); }}>Apply as new layer</button>
                <button onClick={async () => onSave(await canvasToBlob(result, "image/png"), `upscale-${scale}x.png`)}>Save PNG</button>
              </>
            )}
          </div>
        )}
        {result && (
          <div style={{ marginTop: 12, maxHeight: 280, overflow: "auto", border: "1px solid rgba(255,255,255,0.12)" }}>
            <img alt={`${scale}x upscaled preview`} src={result.toDataURL("image/png")} style={{ width: "100%", display: "block" }} />
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50,
};
const panelStyle: React.CSSProperties = {
  background: "#17171c", color: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "90vw",
  maxHeight: "85vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,.6)",
};
const badgeStyle: React.CSSProperties = {
  fontSize: 10, opacity: 0.6, border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, padding: "1px 5px", marginLeft: 8,
};
const progressTrackStyle: React.CSSProperties = {
  height: 4, borderRadius: 2, background: "rgba(255,255,255,0.14)", overflow: "hidden",
};
const progressFillStyle: React.CSSProperties = {
  height: "100%", background: "linear-gradient(90deg,#7c5ce7,#2385f4)", transition: "width 200ms ease",
};
