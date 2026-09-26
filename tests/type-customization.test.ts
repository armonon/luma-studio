import test from "node:test";
import assert from "node:assert/strict";
import { FONT_CHOICES, fontFamilyValue, normalizeFontFamilies } from "../app/studio/font-catalog.ts";
import { TEXT_SPATIAL_PRESETS, resolvedTextSpatial } from "../app/engine/text-3d.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { renderClean } from "../app/engine/renderer.ts";
import { decodeLumaProject } from "../app/engine/project.ts";

test("font catalog is broad, bounded, deduplicated and safely quoted", () => {
  assert.ok(FONT_CHOICES.length >= 60);
  assert.equal(new Set(FONT_CHOICES.map(font => font.value)).size, FONT_CHOICES.length);
  assert.ok(new Set(FONT_CHOICES.map(font => font.category)).size >= 7);
  assert.equal(fontFamilyValue('My "Font"'), '"My \\"Font\\"", sans-serif'.replaceAll('\\\\', '\\'));
  assert.throws(() => fontFamilyValue("\n"));
  assert.throws(() => fontFamilyValue("x".repeat(257)));
  assert.deepEqual(normalizeFontFamilies([" Avenir ", "Avenir", null, 4, "Bad\nName"]).map(font => font.label), ["Avenir"]);
  assert.equal(normalizeFontFamilies(Array.from({ length: 5000 }, (_, i) => `Font ${i}`)).length, 4096);
});

test("font, multi-outline appearance and 3D presets remain editable through undo and project roundtrip", async () => {
  const studio = new Studio(256, 128, testCanvas(256, 128));
  try {
    const layer = studio.addTextLayer("Luma", { x: 20, y: 80, font: "700 48px serif", color: "#ffffff" });
    studio.updateText(layer.id, { defaultStyle: { fontFamily: fontFamilyValue("Baskerville"), fontWeight: 500, fontSize: 48 }, appearance: { fills: [{ id: "f", kind: "solid", color: "#ffaa00", opacity: 0.7, enabled: true }], strokes: [{ id: "s1", color: "#111111", width: 8, opacity: 1, enabled: true }, { id: "s2", color: "#ff0000", width: 3, opacity: 0.8, enabled: true }] } });
    for (const preset of TEXT_SPATIAL_PRESETS) {
      studio.updateLayerSpatial(layer.id, preset.style);
      assert.ok(resolvedTextSpatial(layer.spatial)?.enabled);
    }
    const last = structuredClone(layer.spatial);
    studio.undo();
    assert.notDeepEqual(layer.spatial, last);
    studio.redo();
    assert.deepEqual(layer.spatial, last);
    const ticket = await studio.prepareProjectSave();
    const reopened = await decodeLumaProject(ticket.blob);
    assert.equal(reopened.doc.layers[0].text?.defaultStyle?.fontFamily, fontFamilyValue("Baskerville"));
    assert.equal(reopened.doc.layers[0].text?.appearance?.strokes.length, 2);
    assert.deepEqual(reopened.doc.layers[0].spatial, JSON.parse(JSON.stringify(last)));
  } finally { studio.dispose(); }
});

test("disabling every text fill does not silently paint the default color", () => {
  const studio = new Studio(128, 80, testCanvas(128, 80));
  try {
    const layer = studio.addTextLayer("AB", { x: 10, y: 55, font: "700 42px serif", color: "#ffffff" });
    studio.updateText(layer.id, { appearance: { fills: [{ id: "f", kind: "solid", color: "#ff0000", opacity: 1, enabled: false }], strokes: [] } });
    const output = testCanvas(128, 80);
    renderClean(studio.doc, output);
    const alpha = output.getContext("2d")!.getImageData(0, 0, 128, 80).data;
    assert.ok(alpha.every((value, index) => index % 4 !== 3 || value === 0));
    studio.updateText(layer.id, { appearance: { fills: [], strokes: [] } });
    renderClean(studio.doc, output);
    assert.ok(output.getContext("2d")!.getImageData(0, 0, 128, 80).data.every((value, index) => index % 4 !== 3 || value === 0));
    studio.updateText(layer.id, { appearance: { fills: [], strokes: [{ id: "s", color: "#ff0000", width: 2, opacity: 1, enabled: true }] } });
    renderClean(studio.doc, output);
    assert.ok(output.getContext("2d")!.getImageData(0, 0, 128, 80).data.some((value, index) => index % 4 === 3 && value > 0));
  } finally { studio.dispose(); }
});

test("3D front material changes pixels without destroying editable text colors", () => {
  const studio = new Studio(128, 80, testCanvas(128, 80));
  try {
    const layer = studio.addTextLayer("AB", { x: 10, y: 55, font: "700 42px serif", color: "#ffffff" });
    studio.updateLayerSpatial(layer.id, { enabled: true, transform: { rotationX: 0, rotationY: 0, rotationZ: 0 }, extrusion: { depth: 0, bevel: 0 }, material: { frontColor: "#ff0000" } });
    const output = testCanvas(128, 80);
    renderClean(studio.doc, output);
    const pixels = output.getContext("2d")!.getImageData(0, 0, 128, 80).data;
    assert.ok(pixels.some((value, index) => index % 4 === 0 && value > 200 && pixels[index + 1] < 10 && pixels[index + 3] > 200));
    assert.equal(layer.text!.color, "#ffffff");
  } finally { studio.dispose(); }
});
