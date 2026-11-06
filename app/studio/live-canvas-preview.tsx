"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Images } from "lucide-react";

/** Copies the editor's rendered pixels; it never changes the document. */
export default function LiveCanvasPreview({ onReturnToCanvas, documentAspect }: { onReturnToCanvas: () => void; documentAspect?: number }) {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const openingRef = useRef<HTMLCanvasElement | null>(null);
  const [showOpening, setShowOpening] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const draw = () => {
      if (document.hidden) return;
      const source = document.querySelector<HTMLCanvasElement>(".spatial-canvas > canvas");
      const target = previewRef.current;
      if (!source || !target || !source.width || !source.height) { setReady(false); return; }
      if (!openingRef.current) {
        const opening = document.createElement("canvas");
        opening.width = source.width;
        opening.height = source.height;
        opening.getContext("2d")?.drawImage(source, 0, 0);
        openingRef.current = opening;
      }
      const width = Math.max(1, Math.round(target.clientWidth * Math.min(window.devicePixelRatio || 1, 2)));
      const height = Math.max(1, Math.round(target.clientHeight * Math.min(window.devicePixelRatio || 1, 2)));
      if (target.width !== width || target.height !== height) { target.width = width; target.height = height; }
      const context = target.getContext("2d");
      if (!context) return;
      const image = showOpening ? openingRef.current : source;
      if (!image) return;
      // A portrait editor viewport can letterbox a landscape document heavily.
      // Trim only those surrounding workspace pixels so the document remains legible.
      const cropHeight = documentAspect && documentAspect > 0 && image.width / image.height < documentAspect
        ? Math.min(image.height, image.width / documentAspect)
        : image.height;
      const cropTop = (image.height - cropHeight) / 2;
      const scale = Math.min(width / image.width, height / cropHeight);
      const drawWidth = image.width * scale;
      const drawHeight = cropHeight * scale;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, cropTop, image.width, cropHeight, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      setReady(true);
    };
    draw();
    const interval = window.setInterval(draw, 250);
    return () => window.clearInterval(interval);
  }, [showOpening, documentAspect]);

  return <aside className="panel-workspace-preview" aria-label="Canvas preview">
    <div className="panel-workspace-preview-heading"><Images size={16} aria-hidden="true" /><strong>Canvas preview</strong><span>{showOpening ? "At opening" : "Live"}</span></div>
    <div className="panel-workspace-preview-frame"><canvas ref={previewRef} aria-label={showOpening ? "Canvas when this workspace opened" : "Current document pixels"} />{!ready && <p>Open a document to preview its canvas.</p>}</div>
    <div className="panel-workspace-preview-actions">
      <button type="button" aria-pressed={showOpening} disabled={!ready} onClick={() => setShowOpening((current) => !current)}>{showOpening ? "Show live" : "Compare opening state"}</button>
      <button type="button" onClick={onReturnToCanvas}>Edit on canvas <ArrowUpRight size={14} aria-hidden="true" /></button>
    </div>
    <p className="panel-workspace-preview-note">Comparison uses the canvas as it appeared when you opened this workspace.</p>
  </aside>;
}
