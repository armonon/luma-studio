import assert from "node:assert/strict";
import test from "node:test";
import { readPsd } from "ag-psd";
import {
  createCurvesLayer,
  createDocument,
  createHslLayer,
  createLevelsLayer,
} from "../app/engine/document.ts";
import { exportPsd, importPsd } from "../app/engine/psd.ts";

test("PSD export and import preserve editable levels, curves, and HSL layers", async () => {
  const doc = createDocument(64, 48);
  const levels = createLevelsLayer("Levels proof", {
    inBlack: 0.1,
    inWhite: 0.9,
    gamma: 1.3,
    outBlack: 0.05,
    outWhite: 0.95,
  });
  const curves = createCurvesLayer("Curves proof", {
    rgb: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.62 }, { x: 1, y: 1 }],
    r: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }],
    g: [{ x: 0, y: 0.02 }, { x: 1, y: 1 }],
    b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  const hsl = createHslLayer("HSL proof", { hue: 18, saturation: 24, lightness: -7 });
  doc.layers = [levels, curves, hsl];

  const encoded = exportPsd(doc);
  const raw = readPsd(encoded, { skipLayerImageData: true, skipCompositeImageData: true });
  assert.deepEqual(raw.children?.map((layer) => layer.adjustment?.type).sort(), ["curves", "hue/saturation", "levels"]);

  const restored = await importPsd(encoded);
  const restoredLevels = restored.layers.find((layer) => layer.kind === "adjustment-levels")!;
  const restoredCurves = restored.layers.find((layer) => layer.kind === "adjustment-curves")!;
  const restoredHsl = restored.layers.find((layer) => layer.kind === "adjustment-hsl")!;
  assert.ok(Math.abs(restoredLevels.levels!.inBlack - 0.1) < 0.01);
  assert.equal(restoredLevels.levels!.gamma, 1.3);
  assert.ok(Math.abs(restoredCurves.curves!.rgb[1].y - 0.62) < 0.01);
  assert.deepEqual(restoredHsl.hsl, { hue: 18, saturation: 24, lightness: -7 });
});
