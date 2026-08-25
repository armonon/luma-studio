import type { Studio } from "@/app/engine/studio";
import type { PathStyle } from "@/app/engine/document";
import type { Point } from "@/app/engine/advanced-tools";
import { preflightRasterFile } from "@/app/engine/input-limits";
import { exceedsBrowserCanvas } from "@/app/engine/large-documents";

export function mimeForFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "bmp") return "image/bmp";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "psd" || extension === "psb") return "image/vnd.adobe.photoshop";
  if (extension === "luma") return "application/x-luma-project";
  return "application/octet-stream";
}

export function geometricPath(kind: "triangle" | "polygon" | "line" | "custom-shape", x: number, y: number, width: number, height: number, color: string): PathStyle {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  let points: Point[];
  if (kind === "line") points = [{ x, y }, { x: x + width, y: y + height }];
  else {
    const sides = kind === "triangle" ? 3 : kind === "polygon" ? 6 : 10;
    points = Array.from({ length: sides }, (_, index) => {
      const angle = -Math.PI / 2 + index / sides * Math.PI * 2;
      const starScale = kind === "custom-shape" && index % 2 ? 0.42 : 1;
      return { x: centerX + Math.cos(angle) * width / 2 * starScale, y: centerY + Math.sin(angle) * height / 2 * starScale };
    });
  }
  return {
    anchors: points.map((point) => ({ ...point, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })),
    closed: kind !== "line",
    fill: kind === "line" ? "transparent" : color,
    stroke: kind === "line" ? color : "#000000",
    strokeWidth: kind === "line" ? Math.max(2, Math.min(width, height) * 0.04) : 0,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export async function addImageFileAsLayer(studio: Studio, file: File) {
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name)) {
    throw new Error(`${file.name} is not a supported image layer`);
  }
  await preflightRasterFile(file, exceedsBrowserCanvas);
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (!Number.isInteger(image.naturalWidth) || !Number.isInteger(image.naturalHeight) || image.naturalWidth < 1 || image.naturalHeight < 1) {
      throw new Error(`${file.name} has invalid image dimensions`);
    }
    if (exceedsBrowserCanvas(image.naturalWidth, image.naturalHeight)) {
      throw new Error(`${file.name} is too large to decode as one image; import a tiled Luma/PSB document instead`);
    }
    const name = file.name.replace(/\.[^/.]+$/, "") || "Imported Layer";
    const layer = studio.addRasterFromImage(name, image, {
      originalName: file.name,
      format: file.type || "image",
      mode: "decoded",
      originalBytes: file.size,
    });
    return { layer, name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function clipboardImageFile() {
  if (!navigator.clipboard?.read) throw new Error("Clipboard images are unavailable here");
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (!imageType) continue;
    const blob = await item.getType(imageType);
    return new File([blob], `Pasted Layer.${imageType.split("/")[1] || "png"}`, { type: imageType });
  }
  return null;
}
