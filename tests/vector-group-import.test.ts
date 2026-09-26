import test from "node:test";
import assert from "node:assert/strict";
import { loadImage } from "@napi-rs/canvas";
import { testCanvas } from "./canvas-harness";
import { parseEditableSvg } from "../app/engine/vector-svg-import";
import { materializeImportedVectors } from "../app/engine/vector-import-install";
import { createDocument } from "../app/engine/document";
import { renderClean } from "../app/engine/renderer";
import { exportVectorSvg } from "../app/engine/vector-delivery";
import { Studio } from "../app/engine/studio";
import { decodeLumaProject } from "../app/engine/project";
const svg = (content: string, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" ${attrs}>${content}</svg>`;
const source = svg('<rect width="120" height="100" fill="#ffffff"/><g id="outer" opacity="0.6" transform="translate(8 4)"><rect id="red" width="80" height="70" fill="#ff0000"/><g id="inner" opacity="0.5" transform="translate(20 10)"><rect id="blue" width="70" height="60" fill="#0000ff"/><rect id="green" x="20" y="20" width="60" height="50" fill="#00ff00"/></g></g>');
function documentFromSvg(value: string) { const imported = parseEditableSvg(value), doc = createDocument(imported.width, imported.height); doc.layers = materializeImportedVectors(imported); return doc; }
const pixels = (canvas: HTMLCanvasElement) => canvas.getContext("2d")!.getImageData(0, 0, 120, 100).data;

test("editable nested SVG groups preserve hierarchy, sibling order and isolated opacity against an independent renderer", async () => {
  const doc = documentFromSvg(source);
  assert.deepEqual(doc.layers.map(l => l.name), ["outer", "inner", "green", "blue", "red", "rect"]);
  const [outer, inner, green, blue, red] = doc.layers;
  assert.equal(inner.parentId, outer.id); assert.equal(red.parentId, outer.id);
  assert.equal(green.parentId, inner.id); assert.equal(blue.parentId, inner.id);
  assert.equal(outer.opacity, .6); assert.equal(inner.opacity, .5); assert.equal(blue.opacity, 1);
  assert.equal(blue.transform.tx, 28); assert.equal(blue.transform.ty, 14);
  const actual = testCanvas(120, 100), expected = testCanvas(120, 100); renderClean(doc, actual);
  expected.getContext("2d")!.drawImage(await loadImage(Buffer.from(source)) as unknown as CanvasImageSource, 0, 0);
  const a = pixels(actual), b = pixels(expected);
  let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  assert.ok(worst <= 2, `maximum channel difference ${worst}`);
});

test("SVG root opacity is isolated and duplicate source IDs never alias imported groups", () => {
  const doc = documentFromSvg(svg('<g id="same"><rect width="80" height="80" fill="#ff0000"/></g><g id="same"><rect x="20" y="20" width="80" height="80" fill="#0000ff"/></g>', 'opacity=".5"'));
  assert.equal(doc.layers[0].kind, "group"); assert.equal(doc.layers[0].opacity, .5);
  assert.equal(new Set(doc.layers.map(l => l.id)).size, doc.layers.length);
  const output = testCanvas(120, 100); renderClean(doc, output);
  assert.deepEqual([...output.getContext("2d")!.getImageData(40, 40, 1, 1).data], [0, 0, 255, 128]);
});

test("group SVG export reimports, edits, undoes, saves and reopens without changing the previous master", async () => {
  const studio = new Studio(120, 100, testCanvas(120, 100));
  try {
    studio.addTextLayer("Previous master"); const master = studio.doc;
    const doc = await studio.importSvg(source, "Nested SVG", async s => parseEditableSvg(s));
    const group = doc.layers.find(l => l.name === "outer")!;
    studio.setLayerProp(group.id, "opacity", .4); studio.undo(); assert.equal(studio.findLayer(group.id)!.opacity, .6);
    studio.redo(); assert.equal(studio.findLayer(group.id)!.opacity, .4);
    const saved = await studio.prepareProjectSave(), reopened = await decodeLumaProject(saved.blob);
    assert.deepEqual(reopened.doc.layers.map(l => [l.id, l.parentId, l.opacity, l.path]), studio.doc.layers.map(l => [l.id, l.parentId, l.opacity, l.path]));
    const delivered = documentFromSvg(exportVectorSvg(reopened.doc));
    const a = testCanvas(120, 100), b = testCanvas(120, 100); renderClean(reopened.doc, a); renderClean(delivered, b);
    assert.deepEqual(pixels(a), pixels(b)); assert.equal(master.layers[0].text?.text, "Previous master");
  } finally { studio.dispose(); }
});

test("groups share the layer budget and unsupported nested content is never omitted", () => {
  assert.throws(() => parseEditableSvg(svg('<g/>'.repeat(512) + '<rect width="1" height="1"/>')), /512/);
  assert.throws(() => parseEditableSvg(svg('<g><rect width="10" height="10"/><image href="remote.png"/></g>')), /Unsupported/);
  assert.throws(() => parseEditableSvg(svg('<g/>')), /no supported/);
});

test("SVG object titles survive reimport instead of being replaced by generated IDs", () => {
  const doc = documentFromSvg(svg('<g id="machine-group"><title>Brand &amp; campaign</title><path id="machine-path" d="M0 0L20 0L20 20Z"><title>Logo</title></path></g>'));
  assert.deepEqual(doc.layers.map(layer => layer.name), ["Brand & campaign", "Logo"]);
  const reopened = documentFromSvg(exportVectorSvg(doc));
  assert.equal(reopened.layers[0].name, "Brand & campaign");
  assert.ok(reopened.layers.some(layer => layer.name === "Logo"));
});

test("malformed worker hierarchy rejects atomically before replacing the active document", async () => {
  const studio = new Studio(120, 100, testCanvas(120, 100));
  try {
    studio.addTextLayer("Keep me"); const doc = studio.doc, history = studio.historyState();
    for (const mutation of ["missing", "cycle", "duplicate", "opacity"]) {
      const imported = parseEditableSvg(source), group = imported.layers.find(l => l.kind === "group")!;
      if (mutation === "missing") group.parentId = "absent";
      if (mutation === "cycle") group.parentId = group.importId;
      if (mutation === "duplicate") imported.layers.push({ ...group });
      if (mutation === "opacity") group.opacity = NaN;
      await assert.rejects(studio.importSvg(source, "Bad", async () => imported), /imported/);
      assert.equal(studio.doc, doc); assert.deepEqual(studio.historyState(), history);
    }
  } finally { studio.dispose(); }
});
