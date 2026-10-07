"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateThumbVariants, THUMB_WIDTH, THUMB_HEIGHT, type ThumbVariant } from "../engine/thumb-variants";
import { FONT_CHOICES, userFontChoices, fontFamilyValue } from "./font-catalog";
import { loadBundledFont, bundledFontForFamily } from "../engine/bundled-fonts";

export type ThumbDialogProps = {
  /** The document's flattened artwork (or a Cutout layer's transparent PNG) to use as the subject. */
  getSubjectImage: () => Promise<Blob | null>;
  onSave: (blob: Blob, fileName: string) => void;
  onClose: () => void;
};

const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error("Could not read the source image")); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function drawVariant(canvas: HTMLCanvasElement, variant: ThumbVariant, title: string, fontLabel: string, subject: HTMLImageElement | null) {
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

  // Background: a dark-to-accent gradient so the bold title stays legible over any photo.
  const gradient = ctx.createLinearGradient(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  gradient.addColorStop(0, "#0b0b10");
  gradient.addColorStop(1, variant.accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

  // Subject placement.
  if (subject) {
    const maxW = THUMB_WIDTH * 0.62, maxH = THUMB_HEIGHT * 0.92;
    const scale = Math.min(maxW / subject.width, maxH / subject.height, 1.4);
    const w = subject.width * scale, h = subject.height * scale;
    const y = THUMB_HEIGHT - h;
    const x = variant.layout === "subject-left" ? -w * 0.08
      : variant.layout === "subject-right" ? THUMB_WIDTH - w + w * 0.08
      : (THUMB_WIDTH - w) / 2;
    ctx.drawImage(subject, x, y, w, h);
  }

  // Bold title with outline + shadow, in a Luma bundled font or a Glyph font from the Locker.
  const sizePx = Math.round(96 * variant.titleScale);
  ctx.font = `900 ${sizePx}px ${fontLabel}`;
  ctx.textBaseline = "top";
  ctx.textAlign = variant.titleAlign;
  const marginX = 48;
  const textX = variant.titleAlign === "left" ? marginX : variant.titleAlign === "right" ? THUMB_WIDTH - marginX : THUMB_WIDTH / 2;
  const words = title.trim() ? title.trim().split(/\s+/) : ["Your title here"];
  const maxLineWidth = variant.layout === "subject-center" ? THUMB_WIDTH - marginX * 2 : THUMB_WIDTH * 0.52;
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxLineWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  const lineHeight = sizePx * 1.08;
  const totalHeight = lineHeight * lines.length;
  let y = (THUMB_HEIGHT - totalHeight) / 2;
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  for (const text of lines) {
    ctx.lineWidth = Math.max(6, sizePx * 0.09);
    ctx.strokeStyle = "#000";
    ctx.strokeText(text, textX, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, textX, y);
    y += lineHeight;
  }
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Re-encode at decreasing JPEG quality until the blob fits the 2 MB export budget. */
async function exportUnderSizeLimit(canvas: HTMLCanvasElement, format: "png" | "jpeg"): Promise<Blob> {
  const toBlob = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (format === "png") {
    const blob = await toBlob("image/png");
    if (blob && blob.size <= MAX_EXPORT_BYTES) return blob;
    format = "jpeg"; // PNG too big for a flat/photographic thumbnail — fall back to JPEG.
  }
  for (const quality of [0.92, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const blob = await toBlob("image/jpeg", quality);
    if (blob && blob.size <= MAX_EXPORT_BYTES) return blob;
    if (quality === 0.35 && blob) return blob; // best effort at the floor quality
  }
  throw new Error("Could not export under 2 MB");
}

/**
 * Thumb: a 1280x720 YouTube thumbnail maker. Composites the document's
 * artwork (ideally a Cutout result with a transparent background) over a
 * bold gradient, with large outlined/shadowed title text in one of Luma's
 * bundled fonts or a Glyph font sent over from the Locker. Always produces 3
 * deterministic A/B layout variants side by side.
 */
export default function ThumbDialog({ getSubjectImage, onSave, onClose }: ThumbDialogProps) {
  const [title, setTitle] = useState("");
  const [fontValue, setFontValue] = useState(fontFamilyValue("Anton"));
  const [subject, setSubject] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const fontChoices = useMemo(() => [...FONT_CHOICES.filter(f => f.bundled), ...userFontChoices()], []);
  const variants = useMemo(() => generateThumbVariants(title, 3), [title]);

  useEffect(() => {
    let active = true;
    getSubjectImage().then(async (blob) => {
      if (!active) return;
      if (!blob) { setSubject(null); return; }
      try { setSubject(await loadImage(blob)); } catch { setSubject(null); }
    }).catch(() => setSubject(null));
    return () => { active = false; };
  }, [getSubjectImage]);

  useEffect(() => {
    const bundled = bundledFontForFamily(fontValue);
    const ready = bundled ? loadBundledFont(bundled.family, 900) : Promise.resolve();
    ready.then(() => {
      variants.forEach((variant, index) => {
        const canvas = canvasRefs.current[index];
        if (canvas) drawVariant(canvas, variant, title, fontValue, subject);
      });
    }).catch(() => setError("That font failed to load; try another."));
  }, [variants, title, fontValue, subject]);

  const save = async (index: number) => {
    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    try {
      const blob = await exportUnderSizeLimit(canvas, "png");
      onSave(blob, `thumb-${variants[index].id}.${blob.type === "image/png" ? "png" : "jpg"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div role="dialog" aria-label="Thumb" style={overlayStyle}>
      <div style={panelStyle}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Thumb <span style={badgeStyle}>alpha</span></h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 0 }}>
          1280×720 YouTube thumbnail, 3 layout variants. Run Cutout first for a clean subject with a transparent
          background — Thumb will use whichever layer is active.
        </p>
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Title</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your title here" style={inputStyle} maxLength={80} />
          </label>
          <label>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Type preset</div>
            <select value={fontValue} onChange={(e) => setFontValue(e.target.value)} style={inputStyle}>
              {fontChoices.map((font) => <option key={font.value} value={font.value}>{font.label} · {font.category}</option>)}
            </select>
          </label>
        </div>
        {error && <p role="alert" style={{ color: "#ff6b6b" }}>{error}</p>}
        <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
          {variants.map((variant, index) => (
            <div key={variant.id} style={{ flex: "0 0 auto" }}>
              <canvas
                ref={(el) => { canvasRefs.current[index] = el; }}
                width={THUMB_WIDTH}
                height={THUMB_HEIGHT}
                style={{ width: 280, height: 157.5, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, background: "#111" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, opacity: 0.8 }}>
                <span>{variant.layout.replace("subject-", "")}</span>
                <button onClick={() => save(index)}>Export</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50,
};
const panelStyle: React.CSSProperties = {
  background: "#17171c", color: "#fff", borderRadius: 14, padding: 20, width: 960, maxWidth: "94vw",
  maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,.6)",
};
const badgeStyle: React.CSSProperties = {
  fontSize: 10, opacity: 0.6, border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, padding: "1px 5px", marginLeft: 8,
};
const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", background: "#0e0e12", color: "#fff", border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 6, padding: "6px 8px", marginTop: 4,
};
