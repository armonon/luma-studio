import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { createDocument, createRasterLayer, createTextLayer } from "../app/engine/document.ts";
import { encodeLumaProject } from "../app/engine/project.ts";
import { preparePhotoshopSmartObjects } from "../app/engine/psd-smart-objects.ts";

test("stalled embedded fonts time out without leaking output or decoded-content reservations", async () => {
  const child = createDocument(32, 32);
  child.layers = [createTextLayer("Type", { text: "Keep editable", font: "12px Arvo", color: "#ffffff", x: 0, y: 12, align: "left", lineHeight: 1.2 })];
  const source = new Uint8Array(await (await encodeLumaProject(child, [], "Child")).arrayBuffer());
  const doc = createDocument(32, 32);
  const first = createRasterLayer("First", testCanvas(32, 32)); first.kind = "smart-object";
  const second = createRasterLayer("Second", testCanvas(32, 32)); second.kind = "smart-object"; second.smartSource = source;
  doc.layers = [first, second];
  const font = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
  const fonts = Object.getOwnPropertyDescriptor(document, "fonts");
  const timeout = globalThis.setTimeout;
  let settle!: (value: unknown) => void;
  let fontLoads = 0, reserved = 0, maximum = 0;
  Object.defineProperty(document, "fonts", { configurable: true, value: { add() {} } });
  Object.defineProperty(globalThis, "FontFace", { configurable: true, value: class {
    load() { fontLoads++; return new Promise(resolve => { settle = resolve; }); }
  } });
  // Exercise the actual production 15-second deadline without slowing the suite.
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => timeout(callback, ms === 15000 ? 1 : ms, ...args)) as typeof setTimeout;
  try {
    const reserve = (bytes: number) => { reserved += bytes; maximum = Math.max(maximum, reserved); return () => { reserved -= bytes; }; };
    await assert.rejects(preparePhotoshopSmartObjects(doc, reserve, () => {}), /Fonts did not finish/);
    assert.ok(maximum > 0); assert.equal(reserved, 0);
    assert.equal(fontLoads, 1); assert.equal(second.smartSource, source);
    assert.equal(first.bitmap!.width, 32); assert.equal(second.bitmap!.width, 32);
    settle({}); await new Promise(resolve => setImmediate(resolve));
    const prepared = await preparePhotoshopSmartObjects(doc, reserve, () => {});
    assert.equal(prepared.objects.size, 2); assert.ok(reserved > 0);
    prepared.release(); prepared.release(); assert.equal(reserved, 0);
    assert.equal(fontLoads, 1, "retry reuses the completed load");
  } finally {
    globalThis.setTimeout = timeout;
    if (font) Object.defineProperty(globalThis, "FontFace", font); else Reflect.deleteProperty(globalThis, "FontFace");
    if (fonts) Object.defineProperty(document, "fonts", fonts); else Reflect.deleteProperty(document, "fonts");
  }
});
