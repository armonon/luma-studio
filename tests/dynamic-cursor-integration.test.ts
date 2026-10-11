import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("canvas pointer paths share one imperative dynamic cursor", () => {
  assert.match(page, /const dynamicCursorRef = useRef<HTMLDivElement>/);
  assert.match(page, /const updateDynamicCursorFromEvent =/);
  assert.match(page, /onPointerEnter=\{updateDynamicCursorFromEvent\}/);
  assert.match(page, /const onPointerDown[\s\S]*updateDynamicCursorFromEvent\(e\)/);
  assert.match(page, /const onPointerMove[\s\S]*updateDynamicCursorFromEvent\(e\)/);
  assert.match(page, /const onPointerUp[\s\S]*updateDynamicCursorFromEvent\(e\)/);
  assert.doesNotMatch(page, /setDynamicCursorPosition/);
});

test("cursor overlay exposes geometry, state, visibility, and fine-pointer fallback", () => {
  assert.match(css, /@media \(pointer: fine\)[\s\S]*\.dynamic-cursor-enabled > canvas[\s\S]*cursor: none !important/);
  assert.match(css, /\.dynamic-canvas-cursor\[data-kind="brush"\]/);
  assert.match(css, /\.dynamic-canvas-cursor\[data-status="attention"\]/);
  assert.match(css, /\.dynamic-canvas-cursor\[data-status="unavailable"\]/);
  assert.match(css, /\.dynamic-canvas-cursor\[data-pressed="true"\]/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Space temporarily promotes the same cursor surface to the pan hand", () => {
  assert.match(page, /canvasCursorOverrideRef = useRef<"hand" \| null>/);
  assert.ok((page.match(/setCanvasCursorOverride\("hand"/g) ?? []).length >= 3);
  assert.match(page, /setCanvasCursorOverride\(panDragRef\.current \? "hand" : null\)/);
});
