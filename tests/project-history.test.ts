import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { encodeFixturePng, decodeFixturePng } from "./lossless-png-fixture.ts";
import "./canvas-harness.ts";
import { createDocument, createRasterLayer, newCanvas } from "../app/engine/document.ts";
import { OperationHistory } from "../app/engine/operation-history.ts";
import { decodeLumaProject, encodeLumaProject, LUMA_PROJECT_VERSION } from "../app/engine/project.ts";
import { PrecisionTileSurface } from "../app/engine/tile-store.ts";
import { Studio } from "../app/engine/studio.ts";
import type { HistoryEntry } from "../app/engine/studio.ts";

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? Math.floor(dataOrWidth.length / widthOrHeight / 4);
    }
  }
}

class TestCanvasContext {
  constructor(private readonly canvas: TestCanvas) {}

  drawImage(source: TestCanvas | { pixels?: number[] }) {
    const pixels = source instanceof TestCanvas ? source.pixels : source.pixels;
    if (pixels) this.canvas.pixels.set(pixels.slice(0, this.canvas.pixels.length));
  }

  putImageData(image: TestImageData, x: number, y: number) {
    for (let row = 0; row < image.height; row += 1) {
      for (let column = 0; column < image.width; column += 1) {
        const source = (row * image.width + column) * 4;
        const target = ((row + y) * this.canvas.width + column + x) * 4;
        this.canvas.pixels.set(image.data.subarray(source, source + 4), target);
      }
    }
  }

  getImageData(x: number, y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const source = ((row + y) * this.canvas.width + column + x) * 4;
        const target = (row * width + column) * 4;
        data.set(this.canvas.pixels.subarray(source, source + 4), target);
      }
    }
    return new TestImageData(data, width, height);
  }
}

function encodeTestPng(width: number, height: number, pixels: Uint8ClampedArray) {
  return encodeFixturePng(width, height, pixels);
}

class TestCanvas {
  private context = new TestCanvasContext(this);
  pixels = new Uint8ClampedArray();
  private storedWidth = 0;
  private storedHeight = 0;

  get width() { return this.storedWidth; }
  set width(value: number) { this.storedWidth = value; this.resize(); }
  get height() { return this.storedHeight; }
  set height(value: number) { this.storedHeight = value; this.resize(); }

  getContext(kind: string) { return kind === "2d" ? this.context : null; }

  toBlob(callback: (blob: Blob) => void) {
    const bytes = encodeTestPng(this.width, this.height, this.pixels);
    callback(bytes as unknown as Blob);
  }

  private resize() {
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
  }
}

const originalDocument = globalThis.document;
const originalImageData = globalThis.ImageData;
const originalCreateImageBitmap = globalThis.createImageBitmap;

globalThis.document = {
  createElement: (name: string) => {
    if (name !== "canvas") throw new Error(`Unexpected element: ${name}`);
    return new TestCanvas();
  },
} as unknown as Document;
globalThis.ImageData = TestImageData as unknown as typeof ImageData;
globalThis.createImageBitmap = (async (blob: Blob) => {
  const decoded = await decodeFixturePng(blob);
  return {
    ...decoded,
    close() {},
  };
}) as unknown as typeof createImageBitmap;

test.after(() => {
  globalThis.document = originalDocument;
  globalThis.ImageData = originalImageData;
  globalThis.createImageBitmap = originalCreateImageBitmap;
});

test("v4 projects round-trip stable ids, precision tiles, editable RAW sources, pixels, and nonlinear history", async () => {
  const doc = createDocument(4, 4);
  doc.bitDepth = 16;
  doc.proofing = { profile: "cmyk-generic", intent: "perceptual", blackPointCompensation: true, gamutWarning: true };
  const bitmap = newCanvas(4, 4);
  const pixels = new TestImageData(4, 4);
  pixels.data.set([18, 52, 86, 255], 0);
  bitmap.getContext("2d")!.putImageData(pixels as unknown as ImageData, 0, 0);
  const layer = createRasterLayer("Source", bitmap);
  layer.surface = new PrecisionTileSurface(4, 4, "rgba16f", "srgb", 16);
  layer.surface.writePixel(0, 0, [1.5, 0.25, -0.125, 1]);
  layer.blend = "multiply";
  layer.blendStack = [
    { id: "blend-primary", mode: "multiply", opacity: 0.72, enabled: true },
    { id: "blend-highlight", mode: "linear-dodge", opacity: 0.18, enabled: true },
  ];
  layer.fillOpacity = 0.64;
  layer.blendIf = {
    activeChannel: "blue",
    channels: {
      gray: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      red: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      green: { source: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 }, underlying: { black: 0, blackFeather: 0, whiteFeather: 1, white: 1 } },
      blue: {
        source: { black: 0.08, blackFeather: 0.22, whiteFeather: 0.86, white: 0.96 },
        underlying: { black: 0.12, blackFeather: 0.28, whiteFeather: 0.78, white: 0.92 },
      },
    },
  };
  layer.ai = {
    id: "ai-proof",
    operation: "harmonize",
    provider: "openai",
    model: "gpt-image-2",
    prompt: "Match the dusk lighting",
    createdAt: "2026-08-05T00:00:00.000Z",
    sourceLayerIds: [layer.id],
    usedSelection: true,
    requestId: "req_fixture",
    inputSha256: "a".repeat(64),
    maskSha256: "b".repeat(64),
    parameters: { quality: "medium", size: "auto" },
  };
  layer.source = { originalName: "sensor.dng", format: "DNG", mode: "dng-cfa-developed", originalBytes: 8 };
  layer.raw = {
    original: Uint8Array.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]),
    settings: { whiteBalance: "as-shot", customWhiteBalance: [1, 1, 1], exposureEV: 0.5, highlightRecovery: 0.35, workingSpace: "srgb" },
    decoder: "luma-dng-tiff-v1",
    boundary: "classic-tiff-uncompressed-bayer",
    matrixSource: "color-matrix-1",
    sensor: { bitsPerSample: 14, dngVersion: "1.6.0.0", warnings: ["fixture warning"] },
  };
  doc.layers.push(layer);
  doc.guides.push({ id: "guide-z", orientation: "vertical", position: 2 });
  const capturedBrushBitmap = newCanvas(2, 2);
  const capturedBrushPixels = new TestImageData(2, 2);
  capturedBrushPixels.data.set([230, 40, 90, 255], 0);
  capturedBrushBitmap.getContext("2d")!.putImageData(capturedBrushPixels as unknown as ImageData, 0, 0);
  doc.capturedBrushes = [{
    id: "captured-brush-proof",
    name: "Project brush",
    bitmap: capturedBrushBitmap,
    sourceDiameter: 96,
    createdAt: "2026-08-09T00:00:00.000Z",
    liveSource: { mode: "layer", layerId: layer.id, centerX: 2, centerY: 3, radius: 48, live: true },
  }];
  doc.layerComps = [{
    id: "layer-comp-proof",
    name: "Hero",
    createdAt: "2026-08-09T01:00:00.000Z",
    layers: [{ layerId: layer.id, visible: true, opacity: 0.8, transform: { ...layer.transform } }],
  }];
  doc.artboards = [{ id: "artboard-proof", name: "Square", x: 1, y: 1, width: 2, height: 2 }];
  const selectionMask = newCanvas(4, 4);

  const graph = new OperationHistory<HistoryEntry>({ maxNodes: 80 });
  const warm = graph.commit("Warm", {
    label: "Warm",
    before: [{ layerId: layer.id, opacity: 1, fillOpacity: null, blendStack: null, blendIf: null, surface: layer.surface.clone() }],
    after: [{
      layerId: layer.id,
      opacity: 0.6,
      fillOpacity: layer.fillOpacity,
      blendStack: layer.blendStack.map((pass) => ({ ...pass })),
      blendIf: structuredClone(layer.blendIf),
      surface: layer.surface.clone(),
    }],
    selectionBefore: null,
    selectionAfter: { mask: selectionMask, bounds: { x: 1, y: 1, w: 2, h: 2 } },
  });
  graph.undo();
  const beforePatch = new TestImageData(2, 2);
  const afterPatch = new TestImageData(2, 2);
  beforePatch.data[0] = 3;
  afterPatch.data[0] = 211;
  graph.commit("Cool", {
    label: "Cool",
    before: [{ layerId: layer.id, opacity: 1 }],
    after: [{ layerId: layer.id, opacity: 0.8 }],
    pixelPatches: [{
      layerId: layer.id,
      target: "bitmap",
      x: 0,
      y: 0,
      before: beforePatch as unknown as ImageData,
      after: afterPatch as unknown as ImageData,
    }],
    selectionTranslation: {
      sourceX: 1,
      sourceY: 1,
      source: beforePatch as unknown as ImageData,
      deltaX: 1,
      deltaY: -1,
      beforeBounds: { x: 1, y: 1, w: 2, h: 2 },
      afterBounds: { x: 2, y: 0, w: 2, h: 2 },
    },
    surfacePatches: [{
      layerId: layer.id,
      key: "0:0",
      before: Uint8Array.from([1, 2, 3]),
      after: Uint8Array.from([4, 5, 6]),
      updateBitmap: false,
    }],
    layerOrderBefore: [layer.id, "future-layer"],
    layerOrderAfter: ["future-layer", layer.id],
  });
  layer.opacity = 0.8;

  const blob = await encodeLumaProject(doc, [], "History fixture", graph.snapshot());
  const encodedZip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.equal(Object.keys(encodedZip.files).filter((path) => path.startsWith("assets/precision/") && !path.endsWith("/")).length, 3);
  assert.equal(Object.keys(encodedZip.files).filter((path) => path.startsWith("assets/raw/") && !path.endsWith("/")).length, 1);
  const recoveredState = await decodeLumaProject(await blob.arrayBuffer(), { restoreHistory: false });
  assert.equal(recoveredState.history, undefined);
  assert.equal(recoveredState.doc.layers[0].id, layer.id);
  assert.equal(recoveredState.doc.layers[0].surface!.readPixel(0, 0)[0], 1.5);
  const decoded = await decodeLumaProject(await blob.arrayBuffer());

  assert.equal(LUMA_PROJECT_VERSION, 15);
  assert.equal(decoded.name, "History fixture");
  assert.equal(decoded.doc.layers[0].id, layer.id);
  assert.equal(decoded.doc.layers[0].opacity, 0.8);
  assert.deepEqual(decoded.doc.proofing, doc.proofing);
  assert.equal(decoded.doc.layers[0].blend, "multiply");
  assert.deepEqual(decoded.doc.layers[0].blendStack, layer.blendStack);
  assert.equal(decoded.doc.layers[0].fillOpacity, 0.64);
  assert.deepEqual(decoded.doc.layers[0].blendIf, layer.blendIf);
  assert.equal(decoded.doc.layers[0].ai?.requestId, "req_fixture");
  assert.equal(decoded.doc.layers[0].ai?.inputSha256, "a".repeat(64));
  assert.deepEqual(Array.from(decoded.doc.layers[0].raw!.original), Array.from(layer.raw.original));
  assert.deepEqual(decoded.doc.layers[0].raw!.settings, layer.raw.settings);
  assert.equal(decoded.doc.layers[0].raw!.sensor.bitsPerSample, 14);
  assert.equal(decoded.doc.guides[0].id, "guide-z");
  assert.equal(decoded.doc.capturedBrushes?.[0].id, "captured-brush-proof");
  assert.equal(decoded.doc.capturedBrushes?.[0].name, "Project brush");
  assert.equal(decoded.doc.capturedBrushes?.[0].sourceDiameter, 96);
  assert.deepEqual(decoded.doc.capturedBrushes?.[0].liveSource, doc.capturedBrushes?.[0].liveSource);
  assert.equal(decoded.doc.capturedBrushes?.[0].bitmap.getContext("2d")!.getImageData(0, 0, 1, 1).data[0], 230);
  assert.equal(decoded.doc.layerComps?.[0].name, "Hero");
  assert.equal(decoded.doc.layerComps?.[0].layers[0].layerId, layer.id);
  assert.deepEqual(decoded.doc.artboards?.[0], doc.artboards[0]);
  assert.equal(decoded.doc.layers[0].bitmap!.getContext("2d")!.getImageData(0, 0, 1, 1).data[0], 18);
  const hdrPixel = decoded.doc.layers[0].surface!.readPixel(0, 0);
  assert.ok(Math.abs(hdrPixel[0] - 1.5) < 0.002);
  assert.ok(Math.abs(hdrPixel[1] - 0.25) < 0.002);
  assert.ok(Math.abs(hdrPixel[2] + 0.125) < 0.002);
  assert.equal(decoded.history?.summary().branchPoints, 1);
  assert.equal(decoded.history?.summary().operations, 2);

  const restoredWarm = decoded.history!.checkout(warm.id);
  assert.deepEqual(restoredWarm.undo.map((node) => node.label), ["Cool"]);
  assert.deepEqual(restoredWarm.redo.map((node) => node.label), ["Warm"]);
  assert.deepEqual(restoredWarm.redo[0].value?.selectionAfter?.bounds, { x: 1, y: 1, w: 2, h: 2 });
  assert.deepEqual(restoredWarm.redo[0].value?.after[0].blendStack, layer.blendStack);
  assert.equal(restoredWarm.redo[0].value?.after[0].fillOpacity, 0.64);
  assert.deepEqual(restoredWarm.redo[0].value?.after[0].blendIf, layer.blendIf);
  assert.ok(Math.abs(restoredWarm.redo[0].value!.after[0].surface!.readPixel(0, 0)[0] - 1.5) < 0.002);
  const restoredCool = decoded.history!.tree().find((node) => node.label === "Cool")!;
  decoded.history!.checkout(restoredCool.id);
  const coolPayload = decoded.history!.lineage().at(-1)!.value!;
  assert.equal(coolPayload.pixelPatches?.[0].before.data[0], 3);
  assert.equal(coolPayload.pixelPatches?.[0].after.data[0], 211);
  assert.equal(coolPayload.selectionTranslation?.source?.data[0], 3);
  assert.deepEqual(coolPayload.selectionTranslation?.beforeBounds, { x: 1, y: 1, w: 2, h: 2 });
  assert.deepEqual(coolPayload.selectionTranslation?.afterBounds, { x: 2, y: 0, w: 2, h: 2 });
  assert.deepEqual(Array.from(coolPayload.surfacePatches?.[0].before ?? []), [1, 2, 3]);
  assert.deepEqual(Array.from(coolPayload.surfacePatches?.[0].after ?? []), [4, 5, 6]);
  assert.equal(coolPayload.surfacePatches?.[0].updateBitmap, false);
  assert.deepEqual(coolPayload.layerOrderBefore, [layer.id, "future-layer"]);
  assert.deepEqual(coolPayload.layerOrderAfter, ["future-layer", layer.id]);
});

test("legacy v1 projects remain readable and receive safe generated ids", async () => {
  const zip = new JSZip();
  zip.file("assets/legacy.png", encodeTestPng(2, 2, new Uint8ClampedArray(16).fill(42)));
  zip.file("manifest.json", JSON.stringify({
    format: "luma-project",
    version: 1,
    name: "Legacy",
    savedAt: "2025-01-01T00:00:00.000Z",
    document: {
      width: 2,
      height: 2,
      colorSpace: "srgb",
      bitDepth: 8,
      resolution: { x: 72, y: 72, unit: "ppi" },
      layers: [{
        id: "raster-legacy",
        name: "Legacy layer",
        kind: "raster",
        visible: true,
        opacity: 1,
        blend: "source-over",
        transform: { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 },
        bitmapAsset: "assets/legacy.png",
      }],
    },
    actions: [],
  }));

  const archive = await zip.generateAsync({ type: "uint8array" });
  const decoded = await decodeLumaProject(archive);
  assert.equal(decoded.name, "Legacy");
  assert.equal(decoded.doc.layers[0].name, "Legacy layer");
  assert.notEqual(decoded.doc.layers[0].id, "raster-legacy");
  assert.equal(decoded.doc.guides.length, 0);
  assert.equal(decoded.history, undefined);
});

test("a subject matte is not written into the project and cannot poison a reopen", async () => {
  // The matte is a canvas. Left in the serializer's spread it went through
  // JSON.stringify as `{}` — truthy, with no getContext — so a reopened
  // document threw the moment a subject-restricted effect tried to draw it.
  // It is derived data, so it is dropped and recomputed on demand.
  const doc = createDocument(32, 32);
  const layer = createRasterLayer("Styled", newCanvas(32, 32));
  layer.subjectMask = newCanvas(32, 32);
  layer.effects = [{
    id: "e1", kind: "outer-glow", enabled: true, opacity: 1,
    color: "#00ff00", blur: 8, offsetX: 0, offsetY: 0, restrictToSubject: true,
  }];
  doc.layers = [layer];

  const blob = await encodeLumaProject(doc, [], "Matte fixture");
  const decoded = await decodeLumaProject(await blob.arrayBuffer());
  const restored = decoded.doc.layers[0];

  assert.equal(restored.subjectMask, undefined, "the matte must not survive as a plain object");
  assert.equal(restored.effects?.[0].restrictToSubject, true, "the request itself must survive");

  // The symptom the old bug produced was a truthy non-canvas, which threw the
  // moment anything drew it. Absent is the only safe value here; the render
  // path for a missing matte is covered in layer-style.test.ts.
  assert.ok(!("subjectMask" in restored) || restored.subjectMask === undefined);
});

test("an abandoned live edit never becomes another document's undo baseline", () => {
  // liveGlobalLightDocument stashes a whole-document clone on the first tick of
  // a Global Light drag. It used to be cleared in only two places, so an
  // abandoned drag survived into the next document and was committed there as
  // documentBefore — one Cmd+Z then replaced that document wholesale with the
  // previous one. Reachable by opening any file mid-drag, not just tab switching.
  const studio = new Studio(64, 48, newCanvas(8, 8));
  studio.addBlankRaster("LAYER_FROM_DOC_A");

  studio.liveUpdateGlobalLight({ angle: 42 });   // drag started, never released

  studio.resetDocument(80, 60);                  // goes through installDocument
  studio.addBlankRaster("LAYER_FROM_DOC_B");
  const before = studio.doc.layers.map((layer) => layer.name).join(",");

  studio.setGlobalLight({ angle: 99 });
  studio.undo();

  assert.equal(
    studio.doc.layers.map((layer) => layer.name).join(","),
    before,
    "undo must restore this document, not the one the abandoned drag came from",
  );
});
