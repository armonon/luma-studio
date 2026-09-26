"use client";

import { useEffect, useRef } from "react";
import { Box, Folder, Image, PenTool, Shapes, SlidersHorizontal, Type } from "lucide-react";
import type { Layer } from "@/app/engine/document";

/** Bounded preview: never allocate a document-sized canvas for a layer row. */
export default function LayerThumbnail({ layer }: { layer: Layer | null | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmap = layer?.bitmap;
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !bitmap) return;
    ctx.clearRect(0, 0, 64, 64);
    if (!bitmap.width || !bitmap.height) return;
    const scale = Math.min(64 / bitmap.width, 64 / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (64 - width) / 2, (64 - height) / 2, width, height);
  }); // Bitmap canvases are edited in place; refresh only the mounted rows.
  const Icon = layer?.kind === "text" ? Type
    : layer?.kind === "group" ? Folder
      : layer?.kind === "shape" ? Shapes
        : layer?.kind === "path" ? PenTool
          : layer?.kind === "smart-object" ? Box
            : layer?.kind.startsWith("adjustment-") ? SlidersHorizontal : Image;
  return <span className={`spatial-layer-thumb kind-${layer?.kind ?? "canvas"}`} aria-hidden="true">
    {bitmap ? <canvas ref={canvasRef} width={64} height={64} /> : <Icon strokeWidth={1.6} />}
  </span>;
}
