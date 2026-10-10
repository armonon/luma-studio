// On-device Upscale via Swin2SR (lightweight x2), running through
// transformers.js exactly like neural.ts's MODNet matting: the model
// downloads on first use, is cached by the webview afterward, and all
// inference stays local. The desktop CSP permits only Hugging Face's model
// origins for this fetch. Kept lazy so the initial JS bundle stays lean.
//
// Licence: mv-lab/swin2sr is Apache-2.0
// (https://github.com/mv-lab/swin2sr/blob/main/LICENSE). Xenova/swin2SR-
// lightweight-x2-64 on Hugging Face is a straight ONNX re-export of the same
// weights for transformers.js and carries no additional restriction.

import { configureNeuralRuntime } from "./neural-runtime";
import { planUpscaleTiles, validateTileOutput } from "./upscale-tiling";

export type ProgressFn = (msg: string, pct: number) => void;

export class UpscaleCancelledError extends Error {
  constructor() {
    super("Upscale cancelled");
    this.name = "UpscaleCancelledError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new UpscaleCancelledError();
}

type Tensor = { data: Float32Array; dims: number[] };
type ProcessorFn = (image: unknown) => Promise<Record<string, unknown>>;
type ModelFn = (inputs: Record<string, unknown>) => Promise<Record<string, Tensor>>;

type Handles = {
  model: ModelFn;
  processor: ProcessorFn;
  RawImage: { read: (source: Blob | string) => Promise<unknown> };
  modelScale: number;
};

// One small model covers both menu options — 4x runs this 2x pass twice
// (tiling + stitching each pass) instead of shipping a second model.
const MODEL_NAME = "Xenova/swin2SR-lightweight-x2-64";
const MODEL_SCALE = 2;

let handlesPromise: Promise<Handles> | null = null;

async function loadHandles(onProgress?: ProgressFn): Promise<Handles> {
  if (handlesPromise) return handlesPromise;
  handlesPromise = (async () => {
    onProgress?.("Loading runtime", 0);
    const mod = await import("@huggingface/transformers");
    configureNeuralRuntime(mod.env, typeof location === "undefined" ? undefined : location.href);
    const anyMod = mod as unknown as {
      AutoModel: { from_pretrained: (name: string, opts?: unknown) => Promise<unknown> };
      AutoProcessor: { from_pretrained: (name: string, opts?: unknown) => Promise<unknown> };
      RawImage: { read: (source: Blob | string) => Promise<unknown> };
      env: { allowLocalModels?: boolean; useBrowserCache?: boolean };
    };
    anyMod.env.allowLocalModels = false;
    anyMod.env.useBrowserCache = typeof caches !== "undefined";

    const progress_callback = (info: { status?: string; file?: string; progress?: number }) => {
      if (!info) return;
      if (info.status === "progress" && typeof info.progress === "number") {
        onProgress?.(`Downloading ${info.file ?? "model"}`, info.progress);
      } else if (info.status === "ready") {
        onProgress?.("Model ready", 100);
      }
    };

    onProgress?.("Downloading model", 0);
    const [model, processor] = await Promise.all([
      anyMod.AutoModel.from_pretrained(MODEL_NAME, { progress_callback }),
      anyMod.AutoProcessor.from_pretrained(MODEL_NAME, { progress_callback }),
    ]);
    return {
      model: model as unknown as ModelFn,
      processor: processor as unknown as ProcessorFn,
      RawImage: anyMod.RawImage,
      modelScale: MODEL_SCALE,
    };
  })();
  try {
    return await handlesPromise;
  } catch (err) {
    handlesPromise = null;
    throw err;
  }
}

/** Warm the model in the background, mirroring warmNeural in neural.ts. */
export async function warmUpscale(onProgress?: ProgressFn, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  try {
    await loadHandles(onProgress);
  } catch {
    // swallow — caller falls back to running it lazily on demand
  }
}

function cropCanvas(source: HTMLCanvasElement, rect: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, rect.width);
  out.height = Math.max(1, rect.height);
  out.getContext("2d")!.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return out;
}

async function runModelOnCanvas(canvas: HTMLCanvasElement, handles: Handles): Promise<HTMLCanvasElement> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to snapshot tile"))), "image/png");
  });
  const img = await handles.RawImage.read(blob);
  const inputs = await handles.processor(img);
  const outputs = await handles.model(inputs);
  const key = "reconstruction" in outputs ? "reconstruction" : Object.keys(outputs)[0];
  const tensor = outputs[key];
  if (!tensor?.data) throw new Error("Upscale model produced no output");
  const dims = tensor.dims; // [1, 3, H, W] channel-first, values ~[0,1]
  const H = dims[dims.length - 2];
  const W = dims[dims.length - 1];
  const channelSize = H * W;
  const data = tensor.data;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;
  const imageData = ctx.createImageData(W, H);
  const od = imageData.data;
  for (let i = 0; i < channelSize; i++) {
    od[i * 4] = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
    od[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, data[channelSize + i])) * 255);
    od[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, data[channelSize * 2 + i])) * 255);
    od[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

/**
 * Upscale a canvas 2x or 4x on-device, tiling the source so a single model
 * call never holds a multi-megapixel tensor in memory. 4x makes two tiled
 * 2x passes. `onProgress` is called once per tile (and once per pass) so the
 * UI can show real progress instead of a spinner.
 */
export async function neuralUpscale(
  source: HTMLCanvasElement,
  scale: 2 | 4,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
  tileSize = 256,
  overlap = 16,
): Promise<HTMLCanvasElement> {
  throwIfAborted(signal);
  const handles = await loadHandles(onProgress);
  throwIfAborted(signal);
  const passes = scale === 4 ? 2 : 1;
  let current = source;
  for (let pass = 0; pass < passes; pass += 1) {
    const plans = planUpscaleTiles(current.width, current.height, handles.modelScale, tileSize, overlap);
    const outWidth = current.width * handles.modelScale;
    const outHeight = current.height * handles.modelScale;
    const stitched = document.createElement("canvas");
    stitched.width = outWidth;
    stitched.height = outHeight;
    const stitchedCtx = stitched.getContext("2d")!;
    for (const plan of plans) {
      throwIfAborted(signal);
      const donePct = Math.round(((pass * plans.length + plan.index) / (plans.length * passes)) * 100);
      onProgress?.(
        `Upscaling tile ${plan.index + 1} of ${plans.length}${passes > 1 ? ` (pass ${pass + 1}/${passes})` : ""}`,
        donePct,
      );
      const tileCanvas = cropCanvas(current, plan.source);
      const tileOutput = await runModelOnCanvas(tileCanvas, handles);
      throwIfAborted(signal);
      if (!validateTileOutput(plan, tileOutput.width, tileOutput.height)) {
        throw new Error("Upscale model returned a smaller tile than expected");
      }
      stitchedCtx.drawImage(
        tileOutput,
        plan.trim.x, plan.trim.y, plan.dest.width, plan.dest.height,
        plan.dest.x, plan.dest.y, plan.dest.width, plan.dest.height,
      );
    }
    current = stitched;
  }
  onProgress?.("Done", 100);
  return current;
}
