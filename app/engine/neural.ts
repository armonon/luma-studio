// On-device subject matting via MODNet running through transformers.js.
// The model (~26MB) downloads on first use and is cached by the browser.
// We keep the import lazy so the initial JS bundle stays lean.

export type ProgressFn = (msg: string, pct: number) => void;

export type LocalSemanticCapability = {
  id: "subject-matting" | "point-segmentation";
  model: string;
  promptTypes: ReadonlyArray<"none" | "positive-point" | "negative-point">;
  output: "soft-alpha" | "binary-mask";
  runsOnDevice: true;
  cachedAfterDownload: true;
  limitations: ReadonlyArray<string>;
};

export type SemanticPoint = { x: number; y: number; label?: "include" | "exclude" };

export class NeuralCancelledError extends Error {
  constructor() {
    super("Local semantic operation cancelled");
    this.name = "NeuralCancelledError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new NeuralCancelledError();
}

type NeuralHandles = {
  model: unknown;
  processor: unknown;
  RawImage: {
    read: (source: Blob | string) => Promise<unknown>;
  };
};

let handlesPromise: Promise<NeuralHandles> | null = null;
let modelName = "Xenova/modnet";

export function setNeuralModel(name: string) {
  if (name !== modelName) {
    modelName = name;
    handlesPromise = null; // force reload
  }
}

export function getLocalSemanticCapabilities(): LocalSemanticCapability[] {
  return [
    {
      id: "subject-matting",
      model: modelName,
      promptTypes: ["none"],
      output: "soft-alpha",
      runsOnDevice: true,
      cachedAfterDownload: true,
      limitations: [
        "Optimized for foreground subject matting, not arbitrary semantic classes.",
        "First use downloads the model and inference cannot be interrupted inside a single ONNX call.",
      ],
    },
    {
      id: "point-segmentation",
      model: SAM_MODEL,
      promptTypes: ["positive-point", "negative-point"],
      output: "binary-mask",
      runsOnDevice: true,
      cachedAfterDownload: true,
      limitations: [
        "Point prompts guide geometry but do not attach a semantic class name.",
        "The lightweight model can miss thin structures and inference cannot be interrupted inside a single ONNX call.",
      ],
    },
  ];
}

async function loadHandles(onProgress?: ProgressFn): Promise<NeuralHandles> {
  if (handlesPromise) return handlesPromise;
  handlesPromise = (async () => {
    onProgress?.("Loading runtime", 0);
    const mod = await import("@huggingface/transformers");
    const anyMod = mod as unknown as {
      AutoModel: { from_pretrained: (name: string, opts?: unknown) => Promise<unknown> };
      AutoProcessor: { from_pretrained: (name: string, opts?: unknown) => Promise<unknown> };
      RawImage: { read: (source: Blob | string) => Promise<unknown> };
      env: {
        allowLocalModels?: boolean;
        useBrowserCache?: boolean;
      };
    };
    anyMod.env.allowLocalModels = false;
    anyMod.env.useBrowserCache = true;

    const progress_callback = (info: {
      status?: string;
      file?: string;
      progress?: number;
    }) => {
      if (!info) return;
      if (info.status === "progress" && typeof info.progress === "number") {
        onProgress?.(`Downloading ${info.file ?? "model"}`, info.progress);
      } else if (info.status === "ready") {
        onProgress?.(`Ready`, 100);
      } else if (info.status === "download") {
        onProgress?.(`Fetching ${info.file ?? "file"}`, 0);
      } else if (info.status === "done") {
        onProgress?.(`Loaded ${info.file ?? "file"}`, 100);
      }
    };

    onProgress?.("Downloading model", 0);
    const [model, processor] = await Promise.all([
      anyMod.AutoModel.from_pretrained(modelName, { progress_callback }),
      anyMod.AutoProcessor.from_pretrained(modelName, { progress_callback }),
    ]);
    onProgress?.("Model ready", 100);
    return { model, processor, RawImage: anyMod.RawImage };
  })();
  try {
    return await handlesPromise;
  } catch (err) {
    handlesPromise = null;
    throw err;
  }
}

// Warm up the model without running inference — safe to call in the background
// when the studio is idle to hide download latency.
export async function warmNeural(onProgress?: ProgressFn, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  try {
    await loadHandles(onProgress);
    throwIfAborted(signal);
  } catch (error) {
    if (error instanceof NeuralCancelledError) throw error;
    // swallow — caller can fall back
  }
}

type Tensor = { data: Float32Array; dims: number[] };
type ProcessorFn = (image: unknown) => Promise<Record<string, Tensor>>;
type ModelFn = (inputs: Record<string, Tensor>) => Promise<Record<string, Tensor>>;

export async function neuralMatte(
  source: HTMLCanvasElement,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  throwIfAborted(signal);
  const { model, processor, RawImage } = await loadHandles(onProgress);
  throwIfAborted(signal);

  onProgress?.("Preparing image", 0);
  const blob: Blob = await new Promise((resolve, reject) => {
    source.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to snapshot layer"))),
      "image/png",
    );
  });
  const img = await RawImage.read(blob);
  throwIfAborted(signal);

  onProgress?.("Running inference", 0);
  const inputs = await (processor as ProcessorFn)(img);
  throwIfAborted(signal);
  const outputs = await (model as ModelFn)(inputs);
  throwIfAborted(signal);

  // MODNet's ONNX export names its output "output" (a [1,1,H,W] alpha matte).
  const key = Object.keys(outputs)[0];
  const tensor = outputs[key];
  if (!tensor || !tensor.data) throw new Error("Model produced no output");
  const data = tensor.data;
  const dims = tensor.dims;
  const H = dims[dims.length - 2];
  const W = dims[dims.length - 1];

  const matte = document.createElement("canvas");
  matte.width = W;
  matte.height = H;
  const mctx = matte.getContext("2d")!;
  const outImg = mctx.createImageData(W, H);
  const od = outImg.data;
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
    od[i * 4] = 255;
    od[i * 4 + 1] = 255;
    od[i * 4 + 2] = 255;
    od[i * 4 + 3] = v;
  }
  mctx.putImageData(outImg, 0, 0);

  // Resize matte back to source resolution.
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(matte, 0, 0, source.width, source.height);

  onProgress?.("Done", 100);
  throwIfAborted(signal);
  return out;
}

// ---------- Segment Anything (point-prompted) ----------

type SamHandles = {
  model: unknown;
  processor: unknown;
  RawImage: { read: (source: Blob | string) => Promise<unknown> };
};

let samPromise: Promise<SamHandles> | null = null;
const SAM_MODEL = "Xenova/slimsam-77-uniform";

async function loadSam(onProgress?: ProgressFn): Promise<SamHandles> {
  if (samPromise) return samPromise;
  samPromise = (async () => {
    onProgress?.("Loading SAM runtime", 0);
    const mod = await import("@huggingface/transformers");
    const anyMod = mod as unknown as {
      SamModel: { from_pretrained: (name: string, opts?: unknown) => Promise<unknown> };
      AutoProcessor: { from_pretrained: (name: string, opts?: unknown) => Promise<unknown> };
      RawImage: { read: (source: Blob | string) => Promise<unknown> };
      env: { allowLocalModels?: boolean; useBrowserCache?: boolean };
    };
    anyMod.env.allowLocalModels = false;
    anyMod.env.useBrowserCache = true;

    const progress_callback = (info: { status?: string; file?: string; progress?: number }) => {
      if (!info) return;
      if (info.status === "progress" && typeof info.progress === "number") {
        onProgress?.(`Downloading ${info.file ?? "SAM"}`, info.progress);
      } else if (info.status === "done") {
        onProgress?.(`Loaded ${info.file ?? "file"}`, 100);
      }
    };
    onProgress?.("Downloading SAM", 0);
    const [model, processor] = await Promise.all([
      anyMod.SamModel.from_pretrained(SAM_MODEL, { progress_callback }),
      anyMod.AutoProcessor.from_pretrained(SAM_MODEL, { progress_callback }),
    ]);
    onProgress?.("SAM ready", 100);
    return { model, processor, RawImage: anyMod.RawImage };
  })();
  try {
    return await samPromise;
  } catch (err) {
    samPromise = null;
    throw err;
  }
}

// One-point SAM prompt. Returns a mask at source resolution with alpha =
// segmentation confidence.
export async function samPromptMask(
  source: HTMLCanvasElement,
  points: ReadonlyArray<SemanticPoint>,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  if (!points.length || points.length > 64) throw new Error("SAM requires between 1 and 64 point prompts");
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("SAM point coordinates must be finite");
  }
  throwIfAborted(signal);
  const { model, processor, RawImage } = await loadSam(onProgress);
  throwIfAborted(signal);

  onProgress?.("Preparing image", 0);
  const blob: Blob = await new Promise((resolve, reject) => {
    source.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to snapshot layer"))),
      "image/png",
    );
  });
  const img = await RawImage.read(blob);
  throwIfAborted(signal);

  onProgress?.("Running SAM", 0);
  type Runtime = {
    (image: unknown, opts?: { input_points?: number[][][]; input_labels?: number[][] }): Promise<Record<string, { data: Float32Array | Uint8Array; dims: number[] }>>;
  };
  const inputs = await (processor as Runtime)(img, {
    input_points: [points.map((point) => [point.x, point.y])],
    input_labels: [points.map((point) => point.label === "exclude" ? 0 : 1)],
  });
  throwIfAborted(signal);
  const outputs = await (model as (i: unknown) => Promise<Record<string, { data: Float32Array; dims: number[] }>>)(inputs);
  throwIfAborted(signal);
  const key = Object.keys(outputs).find((k) => k.toLowerCase().includes("mask")) ?? Object.keys(outputs)[0];
  const masksTensor = outputs[key];
  const dims = masksTensor.dims; // typically [1, N, H, W] where N = number of proposals
  const H = dims[dims.length - 2];
  const W = dims[dims.length - 1];
  const perMask = H * W;
  // SlimSAM produces multiple candidate masks; pick the largest one by area.
  const nProposals = dims[dims.length - 3] ?? 1;
  const data = masksTensor.data as Float32Array;
  let best = 0;
  let bestArea = -1;
  for (let n = 0; n < nProposals; n++) {
    let a = 0;
    for (let i = 0; i < perMask; i++) if (data[n * perMask + i] > 0) a++;
    if (a > bestArea) { bestArea = a; best = n; }
  }
  const off = best * perMask;

  onProgress?.("Building mask", 100);
  const matte = document.createElement("canvas");
  matte.width = W;
  matte.height = H;
  const mctx = matte.getContext("2d")!;
  const outImg = mctx.createImageData(W, H);
  const od = outImg.data;
  for (let i = 0; i < perMask; i++) {
    const v = data[off + i] > 0 ? 255 : 0;
    od[i * 4] = 255;
    od[i * 4 + 1] = 255;
    od[i * 4 + 2] = 255;
    od[i * 4 + 3] = v;
  }
  mctx.putImageData(outImg, 0, 0);

  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(matte, 0, 0, source.width, source.height);
  throwIfAborted(signal);
  return out;
}

export function samClickMask(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
) {
  return samPromptMask(source, [{ x, y, label: "include" }], onProgress, signal);
}
