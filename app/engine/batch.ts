import JSZip from "jszip";
import { Studio } from "./studio";
import { Action } from "./actions";

export type BatchProgress = (i: number, total: number, name: string) => void;
export type BatchFailure = { name: string; message: string };
export type BatchResult = { archive: Blob; succeeded: number; failed: BatchFailure[] };

export type BatchRuntime = {
  loadImage(file: File): Promise<HTMLImageElement>;
  createStudio(image: HTMLImageElement): Studio;
  encodePng(studio: Studio): Promise<Blob>;
};

function defaultRuntime(): BatchRuntime {
  return {
    loadImage: loadImageFile,
    createStudio: (image) => new Studio(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      document.createElement("canvas"),
    ),
    encodePng: (studio) => studio.exportPNG(),
  };
}

/** Process each input in a disposable Studio so the user's workspace is untouched. */
export async function runBatch(
  files: File[],
  action: Action | null,
  onProgress?: BatchProgress,
  runtime: BatchRuntime = defaultRuntime(),
): Promise<BatchResult> {
  const zip = new JSZip();
  const total = files.length;
  const failed: BatchFailure[] = [];
  const outputNames = new Set<string>();
  let succeeded = 0;
  for (let i = 0; i < total; i++) {
    const file = files[i];
    onProgress?.(i, total, file.name);
    let worker: Studio | null = null;
    try {
      const image = await runtime.loadImage(file);
      worker = runtime.createStudio(image);
      const layer = worker.openImage(file.name.replace(/\.[^/.]+$/, ""), image);
      if (action) worker.replay(action, layer.id);
      const blob = await runtime.encodePng(worker);
      const stem = file.name.replace(/\.[^/.]+$/, "") || "image";
      let outName = `${stem}.png`;
      let suffix = 2;
      while (outputNames.has(outName.toLowerCase())) outName = `${stem}-${suffix++}.png`;
      outputNames.add(outName.toLowerCase());
      zip.file(outName, new Uint8Array(await blob.arrayBuffer()));
      succeeded += 1;
    } catch (error) {
      failed.push({ name: file.name, message: error instanceof Error ? error.message : "Unknown batch error" });
    } finally {
      worker?.dispose();
    }
  }
  if (failed.length) {
    zip.file("luma-batch-report.json", JSON.stringify({ total, succeeded, failed }, null, 2));
  }
  onProgress?.(total, total, "Zipping");
  const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { archive, succeeded, failed };
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not decode ${file.name}`)); };
    image.src = url;
  });
}
