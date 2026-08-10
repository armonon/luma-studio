import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BLEND_LABELS } from "../app/engine/document.ts";
import { normalizeAiOperation } from "../app/engine/ai-edit.ts";
import { HISTORY_LIMIT } from "../app/engine/studio.ts";

// The marketing page makes concrete, checkable claims. When the engine changes
// underneath them they become false silently, which is exactly how "10 creative
// models" and a fabricated "0.8s" benchmark survived in the copy. These tests
// pin the claims to the code.

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

function metricFor(modeName: string): { metric: string; label: string } {
  const block = new RegExp(
    `name: "${modeName}"[\\s\\S]*?metric: "([^"]*)"[\\s\\S]*?metricLabel: "([^"]*)"`,
  ).exec(page);
  assert.ok(block, `could not find showcase mode "${modeName}"`);
  return { metric: block[1], label: block[2] };
}

test("the AI section does not turn implementation details into a product-count claim", () => {
  // app/engine/neural.ts loads exactly these two on-device models.
  const neural = readFileSync(new URL("../app/engine/neural.ts", import.meta.url), "utf8");
  const modelIds = [...neural.matchAll(/"(Xenova\/[^"]+)"/g)].map((m) => m[1]);
  const distinct = new Set(modelIds);
  assert.ok(distinct.size >= 2, `expected local semantic models, found: ${[...distinct].join(", ")}`);
  assert.doesNotMatch(page, /on-device semantic models|creative models/i);
});

test("blend-mode marketing counts match the engine", () => {
  const modes = Object.keys(BLEND_LABELS).length;
  assert.match(page, new RegExp(`${modes} MODES`));
  assert.match(page, new RegExp(`<strong>${modes}</strong>[\\s\\S]*?Photoshop-class blend modes`));
});

test("no fabricated timing benchmarks in showcase metrics", () => {
  // A bare "N.Ns" metric asserts a measured latency. We have no benchmark
  // harness, so any such claim is invented.
  for (const mode of ["Focus", "Blend", "Paint", "Develop"]) {
    const { metric } = metricFor(mode);
    assert.doesNotMatch(
      metric,
      /^\d+(\.\d+)?\s*(ms|s)$/i,
      `"${mode}" claims a timing benchmark (${metric}) with nothing measuring it`,
    );
  }
});

test("the performance section only advertises implementation-backed metrics", () => {
  assert.match(page, new RegExp(`<strong>${Object.keys(BLEND_LABELS).length}</strong>[\\s\\S]*?Photoshop-class blend modes`));
  assert.match(page, /<strong>8<\/strong><span>×<\/span>[\s\S]*?passes on a single layer/);
  assert.match(page, /<strong>32<\/strong><span>-bit<\/span>[\s\S]*?floating-point tile masters/);
  assert.match(page, new RegExp(`<strong>${HISTORY_LIMIT}</strong>[\\s\\S]*?recoverable history nodes`));
  assert.doesNotMatch(page, /Metal-first|120<\/strong><span>fps|16K<\/strong>|blocking autosave|∞<\/strong>/);
});

test("every advertised neural action is a real engine operation", () => {
  const block = /const neuralActions = \[([\s\S]*?)\] as const;/.exec(page);
  assert.ok(block, "could not find neuralActions");
  // Entries are ["<icon>", "<Label>"] tuples; take the second element.
  const labels = [...block[1].matchAll(/\[\s*"[^"]*"\s*,\s*"([^"]+)"\s*\]/g)]
    .map((m) => m[1].trim());
  assert.ok(labels.length > 0, "expected some advertised actions");

  for (const label of labels) {
    const op = label.toLowerCase().replace(/^generative /, "");
    assert.equal(
      normalizeAiOperation(op),
      op,
      `"${label}" is advertised but is not a recognised AiEditOperation`,
    );
  }
});

// ---------------------------------------------------------------------------
// Prose claims about the native compositor.
//
// The page previously said the native compositor "handles demanding layer
// stacks in the background". It runs only at export, only in sRGB, and
// `Studio.flattenNative` explicitly *refuses* demanding stacks — groups,
// clipping, filters, effects, non-neutral Blend If, or any non-identity
// transform all fall back to the portable renderer. Counting tests did not
// catch that, so the scope words are pinned here too.
// ---------------------------------------------------------------------------

const NATIVE_CLAIM_BANNED = [
  /native[^.]{0,60}\bin the background\b/i,
  /native[^.]{0,60}\breal[- ]time\b/i,
  /native[^.]{0,60}\blive (?:preview|canvas|viewport)\b/i,
  /native[^.]{0,60}\bdemanding layer stacks\b/i,
];

test("the page does not claim the native compositor runs outside export", () => {
  for (const pattern of NATIVE_CLAIM_BANNED) {
    const hit = pattern.exec(page);
    assert.equal(
      hit,
      null,
      `native compositor is export-only, but the page says: "${hit?.[0]}"`,
    );
  }
});

test("flattenNative really is gated to export and sRGB", () => {
  // Pins the claim to the implementation rather than to today's wording.
  const studioSrc = readFileSync(new URL("../app/engine/studio.ts", import.meta.url), "utf8");
  const fn = /async flattenNative\(\)[\s\S]*?\n  \}/.exec(studioSrc);
  assert.ok(fn, "flattenNative not found — the claim above may be stale");
  assert.match(fn[0], /colorSpace !== "srgb"/, "expected an sRGB-only guard");
  assert.match(fn[0], /isNativeCoreAvailable\(\)/, "expected a native-availability guard");
  // Only exportImage may call it; a viewport caller would invalidate the copy.
  const callers = [...studioSrc.matchAll(/flattenNative\(\)/g)].length;
  assert.ok(callers >= 2, "expected a definition plus at least one call site");
});
