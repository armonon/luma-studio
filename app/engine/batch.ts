import JSZip from "jszip";
import { Studio } from "./studio";
import { isSafeAction, type Action } from "./actions";
import { preflightRasterFile } from "./input-limits";
import { exceedsBrowserCanvas } from "./large-documents";
import { BATCH_MAX_FILES, BATCH_MAX_OUTPUT_BYTES } from "./batch-limits";

export type BatchProgress = (i: number, total: number, name: string) => void;
export type BatchFailure = { name: string; message: string };
export type BatchResult = { archive: Blob; succeeded: number; failed: BatchFailure[]; cancelled: boolean; skipped: number; stoppedReason?: string };
export type BatchOptions = {
  signal?: AbortSignal;
  /** May lower the retained-output limit, never raise it. ZIP finalization needs additional copies. */
  maxOutputBytes?: number;
  onItem?: (index: number, status: "running" | "succeeded" | "failed" | "skipped", message?: string) => void;
};

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
  options: BatchOptions = {},
): Promise<BatchResult> {
  if (files.length > BATCH_MAX_FILES) throw new Error(`Batch accepts at most ${BATCH_MAX_FILES} files per run`);
  if (action && !isSafeAction(action)) throw new Error("The selected action is malformed or unsupported");
  const requestedBudget = options.maxOutputBytes ?? BATCH_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(requestedBudget) || requestedBudget < 1) throw new Error("Invalid batch output budget");
  const outputBudget = Math.min(BATCH_MAX_OUTPUT_BYTES, requestedBudget);
  const zip = new JSZip();
  const total = files.length;
  const failed: BatchFailure[] = [];
  const outputNames = new Set<string>();
  let succeeded = 0;
  let outputBytes = 0;
  let stoppedReason: string | undefined;
  for (let i = 0; i < total; i++) {
    // Yield between files so cancellation and progress can paint even with cached inputs.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (options.signal?.aborted || stoppedReason) {
      for (let rest = i; rest < total; rest++) options.onItem?.(rest, "skipped");
      break;
    }
    const file = files[i];
    onProgress?.(i, total, file.name);
    options.onItem?.(i, "running");
    let worker: Studio | null = null;
    try {
      const image = await runtime.loadImage(file);
      if (options.signal?.aborted) { options.onItem?.(i, "skipped"); continue; }
      worker = runtime.createStudio(image);
      const layer = worker.openImage(file.name.replace(/\.[^/.]+$/, ""), image);
      if (action) worker.replay(action, layer.id);
      const blob = await runtime.encodePng(worker);
      if (options.signal?.aborted) { options.onItem?.(i, "skipped"); continue; }
      if (blob.size > outputBudget - outputBytes) {
        stoppedReason = `Retained PNG output reached the ${Math.floor(outputBudget / 1024 / 1024)} MB safety limit; split the batch into smaller runs`;
        throw new Error(stoppedReason);
      }
      const safeName = Array.from(file.name, char => char.charCodeAt(0) < 32 ? "_" : char).join("");
      const stem = safeName.replace(/\.[^/.]+$/, "").replace(/[\\/]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "image";
      let outName = `${stem}.png`;
      let suffix = 2;
      while (outputNames.has(outName.toLowerCase())) outName = `${stem}-${suffix++}.png`;
      outputNames.add(outName.toLowerCase());
      zip.file(outName, new Uint8Array(await blob.arrayBuffer()));
      outputBytes += blob.size;
      succeeded += 1;
      options.onItem?.(i, "succeeded");
    } catch (error) {
      failed.push({ name: file.name, message: error instanceof Error ? error.message : "Unknown batch error" });
      options.onItem?.(i, "failed", failed.at(-1)!.message);
    } finally {
      worker?.dispose();
    }
  }
  const cancelled = options.signal?.aborted === true;
  const skipped = total - succeeded - failed.length;
  zip.file("luma-batch-report.json", JSON.stringify({ total, succeeded, failed, cancelled, skipped, stoppedReason, outputBytes }, null, 2));
  onProgress?.(total, total, "Zipping");
  // PNG is already compressed; STORE avoids an expensive redundant deflate pass.
  const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { archive, succeeded, failed, cancelled, skipped, stoppedReason };
}

async function loadImageFile(file: File): Promise<HTMLImageElement> {
  await preflightRasterFile(file, exceedsBrowserCanvas);
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not decode ${file.name}`)); };
    image.src = url;
  });
}
