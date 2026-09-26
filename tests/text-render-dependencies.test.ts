import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness.ts";
import { createGroupLayer, createTextLayer, createRasterLayer } from "../app/engine/document.ts";
import { renderedTextLayers } from "../app/engine/text-render-dependencies.ts";
import { Studio } from "../app/engine/studio.ts";
import { setPhotoshopLayerMetadata } from "../app/engine/psd-metadata.ts";

function text(name: string) {
  return createTextLayer(name, { text: "A", font: `16px ${name}`, color: "#fff", align: "left", lineHeight: 1.2, x: 0, y: 16 });
}

test("flattened font dependencies respect hierarchy, not Fill, effects or offscreen bounds", () => {
  const visible = text("Visible"), hidden = text("Hidden"), zero = text("Zero"), fill = text("Fill");
  hidden.visible = false; zero.opacity = 0; fill.fillOpacity = 0; fill.transform.tx = -10000;
  const parent = createGroupLayer("Hidden group"), child = text("Hidden child");
  parent.visible = false; child.parentId = parent.id;
  const transparent = createGroupLayer("Transparent group"), child2 = text("Transparent child");
  transparent.opacity = 0; child2.parentId = transparent.id;
  const orphan = text("Orphan"); orphan.parentId = "missing";
  assert.deepEqual(renderedTextLayers({ layers: [visible, hidden, zero, fill, parent, child, transparent, child2, orphan] }), [visible, fill, orphan]);
});

test("raw clipping text stays a dependency even when hidden or zero-opacity", () => {
  const base = text("Hidden clip base"); base.visible = false; base.opacity = 0;
  const clip = createRasterLayer("Clipped pixels", testCanvas(4, 4)); clip.clipping = true;
  const second = text("Another clipped member"); second.clipping = true;
  const unrelated = text("Other parent"); unrelated.parentId = "missing"; unrelated.visible = false;
  assert.deepEqual(renderedTextLayers({ layers: [clip, second, unrelated, base] }), [second, base]);
  clip.visible = false; second.visible = false;
  assert.deepEqual(renderedTextLayers({ layers: [clip, second, base] }), []);
});

test("dependency traversal is iterative and bounded for deep or malformed groups", () => {
  const groups = Array.from({ length: 10000 }, (_, i) => createGroupLayer(`Group ${i}`));
  groups.forEach((group, i) => { if (i) group.parentId = groups[i - 1].id; });
  const child = text("Deep"); child.parentId = groups.at(-1)!.id;
  assert.deepEqual(renderedTextLayers({ layers: [...groups, child] }), [child]);
  groups[0].parentId = groups.at(-1)!.id;
  assert.deepEqual(renderedTextLayers({ layers: [...groups, child] }), []);
});

test("actual raster/artboard delivery skips hidden missing fonts but rejects visible and clip dependencies", async () => {
  const keys = ["FontFace", "__TAURI__"], descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const fonts = Object.getOwnPropertyDescriptor(document, "fonts");
  const studio = new Studio(16, 16, testCanvas(16, 16));
  const calls: string[] = [];
  try {
    // Install the fixture before FontFace exists so viewport work cannot race
    // the export-admission assertions.
    const hidden = text("MissingDeliveryFixture"); hidden.visible = false;
    setPhotoshopLayerMetadata(hidden, { source: { text: { text: "A", style: { font: { name: hidden.name } } } }, preservation: "editable" });
    studio.doc.layers = [hidden];
    const board = studio.createArtboard("Delivery");
    Object.defineProperty(document, "fonts", { configurable: true, value: { add() {} } });
    Object.defineProperties(globalThis, {
      FontFace: { configurable: true, value: class { async load() { return this; } } },
      __TAURI__: { configurable: true, value: { core: { invoke: async (command: string, args: { postscriptName: string }) => {
        assert.equal(command, "read_installed_font"); calls.push(args.postscriptName); throw new Error("fixture exact face unavailable");
      } } } },
    });
    const history = studio.historyState().currentId;
    for (const format of ["image/png", "image/jpeg", "image/webp"] as const) assert.ok((await studio.exportImage(format)).size > 0);
    assert.ok((await studio.exportArtboard(board.id)).size > 0);
    assert.deepEqual(calls, []);
    assert.ok((await studio.exportProject("Hidden original text")).size > 0);
    await assert.rejects(studio.exportPhotoshop({}, async () => true), /fixture exact face unavailable/);
    hidden.visible = true;
    await assert.rejects(studio.exportImage(), /fixture exact face unavailable/);
    hidden.visible = false;
    const clipped = createRasterLayer("Clip", testCanvas(16, 16)); clipped.clipping = true;
    studio.doc.layers.unshift(clipped);
    await assert.rejects(studio.exportImage(), /fixture exact face unavailable/);
    assert.equal(studio.historyState().currentId, history, "refusal never edits the document");
    assert.equal(hidden.text!.text, "A");
  } finally {
    studio.dispose();
    keys.forEach((key, i) => { if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!); else Reflect.deleteProperty(globalThis, key); });
    if (fonts) Object.defineProperty(document, "fonts", fonts); else Reflect.deleteProperty(document, "fonts");
  }
});
