export type AiEditOperation = "fill" | "remove" | "relight" | "harmonize" | "upscale" | "expand";
export type AiEditQuality = "auto" | "low" | "medium" | "high";
export type AiSelectionMode = "none" | "selection" | "inverse-selection";

export type AiOperationControls =
  | { operation: "fill"; edgeBlend: "seamless" | "defined"; preserveStructure: number }
  | { operation: "remove"; removeShadows: boolean; backgroundContinuity: number }
  | { operation: "relight"; direction: "auto" | "front" | "left" | "right" | "back" | "top"; temperature: number; intensity: number; preserveIdentity: number }
  | { operation: "harmonize"; color: number; lighting: number; perspective: number; preserveComposition: number }
  | { operation: "upscale"; detail: number; denoise: number; sharpening: number; preserveGeometry: number }
  | { operation: "expand"; continuity: number; preserveComposition: number; edgeContext: "natural" | "repeat" | "invent" };

export type AiSelectionGuide = {
  mode: AiSelectionMode;
  coverage?: number;
  featherPixels?: number;
  bounds?: { x: number; y: number; width: number; height: number };
};

export type AiEditConfig = {
  operation: AiEditOperation;
  prompt: string;
  controls: AiOperationControls;
  quality: AiEditQuality;
  size: "auto" | `${number}x${number}`;
  selection: AiSelectionGuide;
  variationIndex: number;
  sourceDigest?: string;
  maskDigest?: string;
};

export type AiEditProvenance = {
  schema: "luma-ai-edit/v1";
  id: string;
  provider: "openai";
  endpoint: "images/edits";
  model: string;
  config: AiEditConfig;
  upstreamRequestId?: string;
};

type UnknownRecord = Record<string, unknown>;

const OPERATIONS: ReadonlySet<string> = new Set(["fill", "remove", "relight", "harmonize", "upscale", "expand"]);
const QUALITIES: ReadonlySet<string> = new Set(["auto", "low", "medium", "high"]);
const SELECTION_MODES: ReadonlySet<string> = new Set(["none", "selection", "inverse-selection"]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function numberControl(value: unknown, fallback: number, minimum = 0, maximum = 1) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function booleanControl(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function enumControl<T extends string>(value: unknown, values: ReadonlyArray<T>, fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

export function normalizeAiOperation(value: unknown): AiEditOperation {
  return typeof value === "string" && OPERATIONS.has(value) ? value as AiEditOperation : "fill";
}

export function normalizeAiControls(operation: AiEditOperation, input: unknown): AiOperationControls {
  const controls = record(input);
  switch (operation) {
    case "remove":
      return {
        operation,
        removeShadows: booleanControl(controls.removeShadows, true),
        backgroundContinuity: numberControl(controls.backgroundContinuity, 0.9),
      };
    case "relight":
      return {
        operation,
        direction: enumControl(controls.direction, ["auto", "front", "left", "right", "back", "top"], "auto"),
        temperature: numberControl(controls.temperature, 0, -1, 1),
        intensity: numberControl(controls.intensity, 0.6),
        preserveIdentity: numberControl(controls.preserveIdentity, 1),
      };
    case "harmonize":
      return {
        operation,
        color: numberControl(controls.color, 0.8),
        lighting: numberControl(controls.lighting, 0.8),
        perspective: numberControl(controls.perspective, 0.5),
        preserveComposition: numberControl(controls.preserveComposition, 1),
      };
    case "upscale":
      return {
        operation,
        detail: numberControl(controls.detail, 0.7),
        denoise: numberControl(controls.denoise, 0.2),
        sharpening: numberControl(controls.sharpening, 0.3),
        preserveGeometry: numberControl(controls.preserveGeometry, 1),
      };
    case "expand":
      return {
        operation,
        continuity: numberControl(controls.continuity, 0.9),
        preserveComposition: numberControl(controls.preserveComposition, 1),
        edgeContext: enumControl(controls.edgeContext, ["natural", "repeat", "invent"], "natural"),
      };
    default:
      return {
        operation: "fill",
        edgeBlend: enumControl(controls.edgeBlend, ["seamless", "defined"], "seamless"),
        preserveStructure: numberControl(controls.preserveStructure, 0.9),
      };
  }
}

export function normalizeAiSize(value: unknown): AiEditConfig["size"] {
  if (value === undefined || value === null || value === "auto") return "auto";
  if (typeof value !== "string") throw new Error("AI output size must be auto or WIDTHxHEIGHT");
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error("AI output size must be auto or WIDTHxHEIGHT");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width % 16 || height % 16 ||
      width > 3840 || height > 3840 || Math.max(width, height) / Math.min(width, height) > 3 ||
      pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("AI output size violates GPT Image 2 resolution constraints");
  }
  return `${width}x${height}`;
}

export function normalizeAiEditConfig(input: {
  operation?: unknown;
  prompt?: unknown;
  controls?: unknown;
  quality?: unknown;
  size?: unknown;
  selection?: unknown;
  variationIndex?: unknown;
  sourceDigest?: unknown;
  maskDigest?: unknown;
}): AiEditConfig {
  const operation = normalizeAiOperation(input.operation);
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 4000) throw new Error("Enter a prompt up to 4,000 characters");
  const quality = typeof input.quality === "string" && QUALITIES.has(input.quality) ? input.quality as AiEditQuality : "medium";
  const selectionInput = record(input.selection);
  const mode = typeof selectionInput.mode === "string" && SELECTION_MODES.has(selectionInput.mode) ?
    selectionInput.mode as AiSelectionMode : "none";
  const boundsInput = record(selectionInput.bounds);
  const bounds = [boundsInput.x, boundsInput.y, boundsInput.width, boundsInput.height].every((item) =>
    typeof item === "number" && Number.isFinite(item)) ? {
      x: boundsInput.x as number,
      y: boundsInput.y as number,
      width: Math.max(0, boundsInput.width as number),
      height: Math.max(0, boundsInput.height as number),
    } : undefined;
  const variationIndex = typeof input.variationIndex === "number" && Number.isInteger(input.variationIndex) ?
    Math.max(0, Math.min(3, input.variationIndex)) : 0;
  return {
    operation,
    prompt,
    controls: normalizeAiControls(operation, input.controls),
    quality,
    size: normalizeAiSize(input.size),
    selection: {
      mode,
      coverage: numberControl(selectionInput.coverage, 0),
      featherPixels: numberControl(selectionInput.featherPixels, 0, 0, 4096),
      ...(bounds ? { bounds } : {}),
    },
    variationIndex,
    ...(typeof input.sourceDigest === "string" ? { sourceDigest: input.sourceDigest.slice(0, 128) } : {}),
    ...(typeof input.maskDigest === "string" ? { maskDigest: input.maskDigest.slice(0, 128) } : {}),
  };
}

function controlLevel(value: number) {
  return value >= 0.8 ? "strongly" : value >= 0.45 ? "moderately" : "lightly";
}

export function buildAiEditPrompt(config: AiEditConfig, hasMask: boolean) {
  let instruction: string;
  const controls = config.controls;
  switch (controls.operation) {
    case "remove":
      instruction = `Remove the requested subject and reconstruct a coherent background. ${controls.removeShadows ?
        "Remove shadows and reflections belonging only to the removed subject." :
        "Retain existing shadows unless the prompt explicitly says otherwise."} Match background continuity ${controlLevel(controls.backgroundContinuity)}.`;
      break;
    case "relight":
      instruction = `Relight the scene with ${controlLevel(controls.intensity)} intensity${controls.direction === "auto" ? "" : ` from the ${controls.direction}`}. Use a ${controls.temperature < -0.2 ? "cooler" : controls.temperature > 0.2 ? "warmer" : "neutral"} color temperature. Preserve identity and geometry ${controlLevel(controls.preserveIdentity)}.`;
      break;
    case "harmonize":
      instruction = `Harmonize the composite: match color ${controlLevel(controls.color)}, lighting and shadows ${controlLevel(controls.lighting)}, and perspective ${controlLevel(controls.perspective)}. Preserve composition ${controlLevel(controls.preserveComposition)}.`;
      break;
    case "upscale":
      instruction = `Increase apparent detail ${controlLevel(controls.detail)}, reduce noise ${controlLevel(controls.denoise)}, and sharpen ${controlLevel(controls.sharpening)} without inventing text or changing geometry. Preserve geometry ${controlLevel(controls.preserveGeometry)}.`;
      break;
    case "expand":
      instruction = `Extend the scene with ${controls.edgeContext} edge context and ${controlLevel(controls.continuity)} visual continuity. Preserve the existing composition ${controlLevel(controls.preserveComposition)}.`;
      break;
    default:
      instruction = `Fill the guided area with ${controls.edgeBlend} edges. Preserve surrounding structure ${controlLevel(controls.preserveStructure)}.`;
  }
  const maskInstruction = hasMask ?
    "Treat the supplied alpha mask as editing guidance: change the transparent guided region and preserve the opaque region as closely as possible." :
    "Preserve all content the request does not explicitly ask to change.";
  return `${instruction}\n${maskInstruction}\n\nUser direction: ${config.prompt}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as UnknownRecord;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function provenanceHash(text: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

export function createAiEditProvenance(config: AiEditConfig, model: string, upstreamRequestId?: string): AiEditProvenance {
  const id = `aie_${provenanceHash(stableStringify({ config, endpoint: "images/edits", model }))}`;
  return {
    schema: "luma-ai-edit/v1",
    id,
    provider: "openai",
    endpoint: "images/edits",
    model,
    config,
    ...(upstreamRequestId ? { upstreamRequestId } : {}),
  };
}

export function selectionAlphaToEditMask(
  selectionAlpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  mode: Exclude<AiSelectionMode, "none"> = "selection",
) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      selectionAlpha.length !== width * height) {
    throw new Error("Selection alpha payload does not match its dimensions");
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  let selected = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < selectionAlpha.length; index += 1) {
    const input = selectionAlpha[index];
    const editAlpha = mode === "inverse-selection" ? 255 - input : input;
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    // GPT Image edits transparent mask pixels; preserve selection feathering.
    rgba[offset + 3] = 255 - editAlpha;
    if (editAlpha > 0) {
      selected += editAlpha / 255;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width,
    height,
    data: rgba,
    guide: {
      mode,
      coverage: selected / selectionAlpha.length,
      ...(maxX >= 0 ? { bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {}),
    } satisfies AiSelectionGuide,
  };
}

export class AiEditCancelledError extends Error {
  constructor() {
    super("AI edit cancelled");
    this.name = "AiEditCancelledError";
  }
}

export class AiEditHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "AiEditHttpError";
  }
}

export type AiEditVariation = {
  index: number;
  image: Blob;
  model?: string;
  provenanceId?: string;
  upstreamRequestId?: string;
};

async function digestBlob(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0x811c9dc5;
  for (const byte of new Uint8Array(bytes)) hash = Math.imul(hash ^ byte, 0x01000193);
  return `fnv32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function runAiEditVariations(options: {
  endpoint?: string;
  image: Blob;
  mask?: Blob;
  operation: AiEditOperation;
  prompt: string;
  controls?: unknown;
  quality?: AiEditQuality;
  size?: AiEditConfig["size"];
  selection?: AiSelectionGuide;
  variations?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  onVariation?: (variation: AiEditVariation) => void;
}) {
  const variations = options.variations ?? 1;
  if (!Number.isSafeInteger(variations) || variations < 1 || variations > 4) {
    throw new Error("AI edit variations must be an integer between 1 and 4");
  }
  if (options.signal?.aborted) throw new AiEditCancelledError();
  const [sourceDigest, maskDigest] = await Promise.all([
    digestBlob(options.image),
    options.mask ? digestBlob(options.mask) : Promise.resolve(undefined),
  ]);
  const fetcher = options.fetcher ?? fetch;
  const results: AiEditVariation[] = new Array(variations);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < variations) {
      const index = nextIndex++;
      if (options.signal?.aborted) throw new AiEditCancelledError();
      const config = normalizeAiEditConfig({
        operation: options.operation,
        prompt: options.prompt,
        controls: options.controls,
        quality: options.quality,
        size: options.size,
        selection: options.selection ?? { mode: options.mask ? "selection" : "none" },
        variationIndex: index,
        sourceDigest,
        maskDigest,
      });
      const body = new FormData();
      body.append("image", options.image, "source.png");
      if (options.mask) body.append("mask", options.mask, "mask.png");
      body.append("prompt", config.prompt);
      body.append("operation", config.operation);
      body.append("controls", JSON.stringify(config.controls));
      body.append("quality", config.quality);
      body.append("size", config.size);
      body.append("selection", JSON.stringify(config.selection));
      body.append("variationIndex", String(config.variationIndex));
      body.append("sourceDigest", sourceDigest);
      if (maskDigest) body.append("maskDigest", maskDigest);
      let response: Response;
      try {
        response = await fetcher(options.endpoint ?? "/api/ai/edit", {
          method: "POST",
          body,
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new AiEditCancelledError();
        }
        throw error;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as UnknownRecord;
        throw new AiEditHttpError(
          typeof payload.error === "string" ? payload.error : "The image edit failed",
          response.status,
          typeof payload.code === "string" ? payload.code : undefined,
          typeof payload.requestId === "string" ? payload.requestId : undefined,
        );
      }
      const variation = {
        index,
        image: await response.blob(),
        model: response.headers.get("x-luma-model") ?? undefined,
        provenanceId: response.headers.get("x-luma-provenance") ?? undefined,
        upstreamRequestId: response.headers.get("x-openai-request-id") ?? undefined,
      };
      results[index] = variation;
      options.onVariation?.(variation);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, variations) }, worker));
  return results;
}
