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

test("the AI card's model count matches the models actually shipped", () => {
  // app/engine/neural.ts loads exactly these two on-device models.
  const neural = readFileSync(new URL("../app/engine/neural.ts", import.meta.url), "utf8");
  const modelIds = [...neural.matchAll(/"(Xenova\/[^"]+)"/g)].map((m) => m[1]);
  const distinct = new Set(modelIds);
  assert.equal(
    metricFor("AI").metric,
    String(distinct.size),
    `page claims ${metricFor("AI").metric} on-device models, engine loads ${distinct.size}: ${[...distinct].join(", ")}`,
  );
});

test("the Design card's blend-mode count matches the engine", () => {
  const modes = Object.keys(BLEND_LABELS).length;
  assert.equal(metricFor("Design").metric, String(modes));
});

test("no fabricated timing benchmarks in showcase metrics", () => {
  // A bare "N.Ns" metric asserts a measured latency. We have no benchmark
  // harness, so any such claim is invented.
  for (const mode of ["Photo", "Retouch", "Design", "AI"]) {
    const { metric } = metricFor(mode);
    assert.doesNotMatch(
      metric,
      /^\d+(\.\d+)?\s*(ms|s)$/i,
      `"${mode}" claims a timing benchmark (${metric}) with nothing measuring it`,
    );
  }
});

test("the performance section only advertises implementation-backed metrics", () => {
  assert.match(page, new RegExp(`<strong>${Object.keys(BLEND_LABELS).length}</strong>[\\s\\S]*?verified blend modes`));
  assert.match(page, /<strong>32<\/strong><span>-bit<\/span>[\s\S]*?float tile masters/);
  assert.match(page, /<strong>2<\/strong>[\s\S]*?on-device semantic models/);
  assert.match(page, new RegExp(`<strong>${HISTORY_LIMIT}</strong>[\\s\\S]*?bounded recovery nodes`));
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
