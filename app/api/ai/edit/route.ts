import { getChatGPTUser } from "@/app/chatgpt-auth";
import { readBoundedFormData, UploadLimitError } from "@/app/engine/bounded-upload";
import {
  buildAiEditPrompt,
  createAiEditProvenance,
  normalizeAiEditConfig,
} from "@/app/engine/ai-edit";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const AI_RATE_WINDOW_MS = 10 * 60 * 1000;
const AI_RATE_LIMIT = 12;
const AI_CONCURRENCY_LIMIT = 2;
const MAX_REQUEST_BYTES = 151 * 1024 * 1024;
const AI_PROCESS_CONCURRENCY_LIMIT = 2;
let processInFlight = 0;
// Keep the deployed default on the current GPT Image editing model while
// retaining an escape hatch for pinned or account-specific deployments.
const MODEL = process.env.AI_IMAGE_MODEL || "gpt-image-2";
const DESKTOP_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:3000",
]);

type AiRateWindow = { resetAt: number; used: number; inFlight: number };
const aiRateWindows = new Map<string, AiRateWindow>();

export function acquireAiEditPermit(identity: string, now = Date.now()):
  | { allowed: true; remaining: number; resetAt: number; release: () => void }
  | { allowed: false; reason: "rate" | "concurrency"; retryAfter: number; resetAt: number } {
  let bucket = aiRateWindows.get(identity);
  if (!bucket && aiRateWindows.size >= 10_000) {
    for (const [key, entry] of aiRateWindows) if (entry.inFlight === 0 && now >= entry.resetAt) aiRateWindows.delete(key);
    if (aiRateWindows.size >= 10_000) return { allowed: false, reason: "concurrency", retryAfter: 60, resetAt: now + 60_000 };
  }
  if (!bucket || (now >= bucket.resetAt && bucket.inFlight === 0)) {
    bucket = { resetAt: now + AI_RATE_WINDOW_MS, used: 0, inFlight: 0 };
    aiRateWindows.set(identity, bucket);
  }
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.used >= AI_RATE_LIMIT) return { allowed: false, reason: "rate", retryAfter, resetAt: bucket.resetAt };
  if (bucket.inFlight >= AI_CONCURRENCY_LIMIT || processInFlight >= AI_PROCESS_CONCURRENCY_LIMIT) return { allowed: false, reason: "concurrency", retryAfter: 2, resetAt: bucket.resetAt };
  bucket.used++;
  bucket.inFlight++;
  processInFlight++;
  let released = false;
  return {
    allowed: true,
    remaining: Math.max(0, AI_RATE_LIMIT - bucket.used),
    resetAt: bucket.resetAt,
    release: () => {
      if (released) return;
      released = true;
      bucket!.inFlight = Math.max(0, bucket!.inFlight - 1);
      processInFlight = Math.max(0, processInFlight - 1);
    },
  };
}

export function resetAiEditRateLimitsForTests() {
  aiRateWindows.clear();
  processInFlight = 0;
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function withDesktopCors(request: Request, response: Response) {
  const origin = request.headers.get("origin");
  if (!origin || !DESKTOP_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-expose-headers", "x-luma-model, x-luma-provenance, x-openai-request-id");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !DESKTOP_ORIGINS.has(origin)) return error("This application origin is not allowed.", 403);
  return withDesktopCors(request, new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "cache-control": "no-store",
    },
  }));
}

function parseJson(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Invalid JSON controls");
  }
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pngDimensions(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 26).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 26 || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error("The masked image and mask must be valid PNG files.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: bytes[25] };
}

export async function POST(request: Request) {
  const respond = (response: Response) => withDesktopCors(request, response);
  const fail = (message: string, status: number) => respond(error(message, status));
  const user = await getChatGPTUser();
  if (!user) return fail("Sign in with ChatGPT to use generative editing.", 401);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fail("Generative editing is not configured on this deployment.", 503);

  const permit = acquireAiEditPermit(user.email.toLowerCase());
  if (!permit.allowed) {
    return respond(Response.json(
      { error: permit.reason === "concurrency" ? "Image edit capacity is busy. Try again shortly." : "Image edit rate limit reached. Try again later." },
      { status: 429, headers: { "retry-after": String(permit.retryAfter), "cache-control": "no-store" } },
    ));
  }
  try {
  let incoming: FormData;
  try { incoming = await readBoundedFormData(request, MAX_REQUEST_BYTES); }
  catch (cause) { return fail(cause instanceof UploadLimitError ? cause.message : "Invalid or interrupted multipart upload.", cause instanceof UploadLimitError ? 413 : 400); }
  const image = incoming.get("image");
  const mask = incoming.get("mask");
  const reference = incoming.get("reference");
  const promptValue = incoming.get("prompt");
  const operationValue = incoming.get("operation");
  if (!(image instanceof File) || image.size === 0) return fail("An image is required.", 400);
  if (image.size > MAX_UPLOAD_BYTES) return fail("The image exceeds the 50 MB edit limit.", 413);
  if (mask !== null && !(mask instanceof File)) return fail("The mask must be an image file.", 400);
  if (mask instanceof File && mask.size > MAX_UPLOAD_BYTES) return fail("The mask exceeds the 50 MB edit limit.", 413);
  if (reference !== null && !(reference instanceof File)) return fail("The identity reference must be an image file.", 400);
  if (reference instanceof File && reference.size > MAX_UPLOAD_BYTES) return fail("The identity reference exceeds the 50 MB edit limit.", 413);
  if (reference instanceof File && reference.size > 0 && reference.type !== "image/png") return fail("The identity reference must be a PNG image.", 400);
  if (mask instanceof File && mask.size > 0 && mask.type !== "image/png") {
    return fail("The edit mask must be a PNG with an alpha channel.", 400);
  }
  if (mask instanceof File && mask.size > 0 && image.type !== "image/png") {
    return fail("The source and edit mask must both be PNG files of the same size.", 400);
  }

  let config;
  try {
    const hasMask = mask instanceof File && mask.size > 0;
    const [sourceDigest, maskDigest, sourceDimensions, maskDimensions] = await Promise.all([
      sha256(image),
      hasMask ? sha256(mask) : Promise.resolve(undefined),
      hasMask ? pngDimensions(image) : Promise.resolve(undefined),
      hasMask ? pngDimensions(mask) : Promise.resolve(undefined),
    ]);
    if (sourceDimensions && maskDimensions &&
        (sourceDimensions.width !== maskDimensions.width || sourceDimensions.height !== maskDimensions.height)) {
      return fail("The source image and edit mask must have identical dimensions.", 400);
    }
    if (maskDimensions && maskDimensions.colorType !== 4 && maskDimensions.colorType !== 6) {
      return fail("The edit mask PNG must contain an alpha channel.", 400);
    }
    config = normalizeAiEditConfig({
      prompt: promptValue,
      operation: operationValue,
      controls: parseJson(incoming.get("controls")),
      quality: incoming.get("quality"),
      size: incoming.get("size"),
      selection: parseJson(incoming.get("selection")) ?? { mode: hasMask ? "selection" : "none" },
      variationIndex: Number(incoming.get("variationIndex") ?? 0),
      sourceDigest,
      maskDigest,
      referenceDigest: incoming.get("referenceDigest"),
    });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "Invalid AI edit controls.", 400);
  }

  const body = new FormData();
  body.append("model", MODEL);
  body.append("image[]", image, "source.png");
  if (reference instanceof File && reference.size > 0) body.append("image[]", reference, "identity-reference.png");
  if (mask instanceof File && mask.size > 0) body.append("mask", mask, "mask.png");
  body.append("prompt", buildAiEditPrompt(config, mask instanceof File && mask.size > 0, reference instanceof File && reference.size > 0));
  body.append("quality", config.quality);
  body.append("size", config.size);
  body.append("output_format", "png");

    const upstream = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: request.signal,
    });
    const requestId = upstream.headers.get("x-request-id");
    const payload = await upstream.json() as {
      data?: Array<{ b64_json?: string }>;
      error?: {
        message?: string;
        code?: string;
        type?: string;
        moderation_details?: unknown;
      };
    };
    if (!upstream.ok) {
      return respond(Response.json(
        {
          error: payload.error?.message ?? "The image edit failed.",
          code: payload.error?.code,
          type: payload.error?.type,
          requestId,
        },
        { status: upstream.status, headers: { "cache-control": "no-store" } },
      ));
    }
    const base64 = payload.data?.[0]?.b64_json;
    if (!base64) return fail("The image service returned no image.", 502);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const provenance = createAiEditProvenance(config, MODEL, requestId ?? undefined);
    return respond(new Response(bytes, {
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-ratelimit-remaining": String(permit.remaining),
        "x-ratelimit-reset": String(Math.ceil(permit.resetAt / 1000)),
        "x-luma-model": MODEL,
        "x-luma-quality": config.quality,
        "x-luma-size": config.size,
        "x-luma-operation": config.operation,
        "x-luma-variation": String(config.variationIndex),
        "x-luma-provenance": provenance.id,
        "x-luma-mask-guidance": mask instanceof File && mask.size > 0 ? "present" : "none",
        ...(requestId ? { "x-openai-request-id": requestId } : {}),
      },
    }));
  } finally {
    permit.release();
  }
}
