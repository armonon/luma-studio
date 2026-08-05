import JSZip from "jszip";
import { Studio } from "./studio";
import { Action } from "./actions";

export type BatchProgress = (i: number, total: number, name: string) => void;

// Runs `action` against each image file in `files` on the given Studio instance,
// producing a ZIP archive of PNGs. The Studio is mutated for each item (its doc
// is opened with the image, the action replays, then we snapshot the flatten);
// after the run finishes the Studio is left holding the last-processed doc.
export async function runBatch(
  studio: Studio,
  files: File[],
  action: Action | null,
  onProgress?: BatchProgress,
): Promise<Blob> {
  const zip = new JSZip();
  const total = files.length;
  for (let i = 0; i < total; i++) {
    const file = files[i];
    onProgress?.(i, total, file.name);
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageEl(url);
      const layer = studio.openImage(file.name.replace(/\.[^/.]+$/, ""), img);
      if (action) studio.replay(action, layer.id);
      const flat = studio.flatten();
      const blob: Blob = await new Promise((resolve, reject) => {
        flat.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });
      const outName = `${file.name.replace(/\.[^/.]+$/, "")}.png`;
      zip.file(outName, blob);
    } catch (err) {
      console.warn("Batch item failed", file.name, err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  onProgress?.(total, total, "Zipping");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
