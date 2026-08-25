import assert from "node:assert/strict";
import test from "node:test";
import {
  AiEditAuthenticationError,
  AiEditCancelledError,
  AiEditConnectionError,
  buildAiEditPrompt,
  createAiEditProvenance,
  normalizeAiEditConfig,
  normalizeAiSize,
  resolveAiEditEndpoint,
  runAiEditVariations,
  selectionAlphaToEditMask,
} from "../app/engine/ai-edit.ts";
import { getLocalSemanticCapabilities, warmNeural } from "../app/engine/neural.ts";
import { planAiWorkRegion } from "../app/engine/ai-work-region.ts";

test("AI work regions stay bounded and preserve document coordinates", () => {
  assert.deepEqual(planAiWorkRegion(1200, 800), {
    x: 0, y: 0, width: 1200, height: 800, outputWidth: 1200, outputHeight: 800,
  });
  const selected = planAiWorkRegion(50_000, 40_000, { x: 12_000, y: 8_000, w: 200, h: 100 });
  assert.deepEqual(selected, {
    x: 11_968, y: 7_968, width: 264, height: 164, outputWidth: 264, outputHeight: 164,
  });
  const viewport = planAiWorkRegion(50_000, 40_000, null, { x: 9_000, y: 7_000, width: 8_000, height: 4_000 });
  assert.equal(viewport.x, 9_000);
  assert.equal(viewport.y, 7_000);
  assert.equal(viewport.width, 8_000);
  assert.equal(viewport.height, 4_000);
  assert.ok(viewport.outputWidth * viewport.outputHeight <= 2048 * 2048);
  assert.ok(viewport.outputWidth <= 2048 && viewport.outputHeight <= 2048);
});

test("operation controls are validated, clamped, and translated to stable instructions", () => {
  const config = normalizeAiEditConfig({
    operation: "relight",
    prompt: "Moonlight from the window",
    controls: { direction: "left", temperature: -3, intensity: 0.8, preserveIdentity: 4 },
    selection: { mode: "selection", coverage: 0.25 },
  });
  assert.deepEqual(config.controls, {
    operation: "relight",
    direction: "left",
    temperature: -1,
    intensity: 0.8,
    preserveIdentity: 1,
  });
  const prompt = buildAiEditPrompt(config, true);
  assert.match(prompt, /from the left/);
  assert.match(prompt, /transparent guided region/);
  assert.match(prompt, /Moonlight from the window/);
});

test("GPT Image 2 output dimensions enforce documented constraints", () => {
  assert.equal(normalizeAiSize("1024x1024"), "1024x1024");
  assert.equal(normalizeAiSize("3840x2160"), "3840x2160");
  assert.throws(() => normalizeAiSize("1000x1000"), /constraints/);
  assert.throws(() => normalizeAiSize("4096x4096"), /constraints/);
  assert.throws(() => normalizeAiSize("2048x512"), /constraints/);
});

test("provenance identifiers are stable and variation-specific", () => {
  const first = normalizeAiEditConfig({ operation: "fill", prompt: "Add flowers", variationIndex: 0 });
  const reordered = normalizeAiEditConfig({ prompt: "Add flowers", variationIndex: 0, operation: "fill" });
  const variation = normalizeAiEditConfig({ operation: "fill", prompt: "Add flowers", variationIndex: 1 });
  assert.equal(createAiEditProvenance(first, "gpt-image-2").id, createAiEditProvenance(reordered, "gpt-image-2").id);
  assert.notEqual(createAiEditProvenance(first, "gpt-image-2").id, createAiEditProvenance(variation, "gpt-image-2").id);
});

test("selection alpha becomes a feather-preserving transparent edit mask", () => {
  const mask = selectionAlphaToEditMask(new Uint8Array([0, 128, 255, 0]), 2, 2);
  assert.deepEqual([...mask.data.filter((_, index) => index % 4 === 3)], [255, 127, 0, 255]);
  assert.deepEqual(mask.guide.bounds, { x: 0, y: 0, width: 2, height: 2 });
  assert.ok(Math.abs(mask.guide.coverage! - (128 / 255 + 1) / 4) < 1e-9);

  const inverse = selectionAlphaToEditMask(new Uint8Array([0, 255]), 2, 1, "inverse-selection");
  assert.deepEqual([...inverse.data.filter((_, index) => index % 4 === 3)], [0, 255]);
});

test("variation orchestration is ordered, bounded to two requests, and carries provenance", async () => {
  let active = 0;
  let peak = 0;
  const seen: number[] = [];
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    active += 1;
    peak = Math.max(peak, active);
    const body = init?.body as FormData;
    const index = Number(body.get("variationIndex"));
    seen.push(index);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active -= 1;
    return new Response(new Uint8Array([index]), {
      headers: {
        "content-type": "image/png",
        "x-luma-provenance": `variation-${index}`,
        "x-luma-model": "gpt-image-2",
        "x-openai-request-id": `request-${index}`,
      },
    });
  };
  const results = await runAiEditVariations({
    image: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    operation: "fill",
    prompt: "Add a red flower",
    variations: 4,
    fetcher,
  });
  assert.deepEqual(seen.sort(), [0, 1, 2, 3]);
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.index), [0, 1, 2, 3]);
  assert.deepEqual(results.map((result) => result.provenanceId), [
    "variation-0", "variation-1", "variation-2", "variation-3",
  ]);
  assert.deepEqual(results.map((result) => result.model), Array(4).fill("gpt-image-2"));
});

test("Identity Lock sends a separately digested reference image and prompt guidance", async () => {
  const requests: FormData[] = [];
  await runAiEditVariations({
    image: new Blob(["source"], { type: "image/png" }),
    reference: new Blob(["identity"], { type: "image/png" }),
    operation: "relight",
    prompt: "Warm studio light",
    fetcher: async (_input, init) => {
      requests.push(init?.body as FormData);
      return new Response(new Blob(["result"]), { headers: { "content-type": "image/png" } });
    },
  });
  assert.ok(requests[0]?.get("reference") instanceof Blob);
  assert.match(String(requests[0]?.get("referenceDigest")), /^[a-f0-9]{64}$/);
  const config = normalizeAiEditConfig({ operation: "relight", prompt: "Warm studio light" });
  assert.match(buildAiEditPrompt(config, false, true), /second supplied image as an identity/);
});

test("AI and local semantic work can be cancelled before expensive work starts", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runAiEditVariations({
    image: new Blob(["image"]),
    operation: "fill",
    prompt: "Change it",
    signal: controller.signal,
  }), AiEditCancelledError);
  await assert.rejects(warmNeural(undefined, controller.signal), /cancelled/);
});

test("desktop AI uses the hosted endpoint while web remains same-origin", () => {
  assert.equal(resolveAiEditEndpoint(false), "/api/ai/edit");
  assert.equal(resolveAiEditEndpoint(true), "https://luma-studio-preview.armonon.chatgpt.site/api/ai/edit");
});

test("AI requests carry credentials and retry short transient failures", async () => {
  let attempts = 0;
  let credentials: RequestCredentials | undefined;
  let headers: HeadersInit | undefined;
  const results = await runAiEditVariations({
    image: new Blob(["image"]),
    operation: "fill",
    prompt: "Add light",
    retryBaseDelayMs: 0,
    fetcher: async (_input, init) => {
      attempts += 1;
      credentials = init?.credentials;
      headers = init?.headers;
      if (attempts === 1) return Response.json({ error: "busy" }, { status: 503, headers: { "retry-after": "0" } });
      return new Response(new Blob(["result"]), { headers: { "content-type": "image/png" } });
    },
  });
  assert.equal(attempts, 2);
  assert.equal(credentials, "include");
  assert.equal(headers, undefined, "desktop multipart requests must remain CORS-safelisted and avoid preflight");
  assert.equal(results.length, 1);
});

test("AI failures distinguish authentication and connection errors", async () => {
  const input = { image: new Blob(["image"]), operation: "fill" as const, prompt: "Change it", retryLimit: 0 };
  await assert.rejects(runAiEditVariations({
    ...input,
    fetcher: async () => Response.json({ error: "Please sign in" }, { status: 401 }),
  }), AiEditAuthenticationError);
  await assert.rejects(runAiEditVariations({
    ...input,
    fetcher: async () => { throw new TypeError("offline"); },
  }), AiEditConnectionError);
});

test("local semantic capability reporting is explicit about models and limits", () => {
  const capabilities = getLocalSemanticCapabilities();
  assert.deepEqual(capabilities.map((capability) => capability.id), ["subject-matting", "point-segmentation"]);
  assert.ok(capabilities.every((capability) => capability.runsOnDevice && capability.cachedAfterDownload));
  assert.ok(capabilities.find((capability) => capability.id === "point-segmentation")?.promptTypes.includes("negative-point"));
});
