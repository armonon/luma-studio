import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { initializeCanvas, readPsd, writePsd, type Psd } from "ag-psd";
import {
  createCurvesLayer,
  createDocument,
  createHslLayer,
  createLevelsLayer,
  createPathLayer,
  createRasterLayer,
  createShapeLayer,
  newCanvas,
  type LayerEffect,
  type LayerEffectKind,
} from "../app/engine/document.ts";
import {
  exportPhotoshopDocument,
  exportPsd,
  importPsd,
  photoshopCompatibilityReport,
  precisionSurfaceFromPsdPixels,
} from "../app/engine/psd.ts";
import {
  PhotoshopFormatError,
  extractPhotoshopImageResources,
  getPhotoshopDocumentMetadata,
  getPhotoshopLayerMetadata,
  inspectPhotoshopHeader,
  mergePhotoshopImageResources,
} from "../app/engine/psd-metadata.ts";

class TestCanvasContext {
  fillStyle = "#000000";
  strokeStyle = "#000000";
  font = "16px sans-serif";
  textAlign: CanvasTextAlign = "left";
  textBaseline: CanvasTextBaseline = "alphabetic";
  lineWidth = 1;
  lineJoin: CanvasLineJoin = "miter";
  lineCap: CanvasLineCap = "butt";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";

  constructor(private readonly canvas: TestCanvas) {}

  save() {}
  restore() {}
  setTransform() {}
  beginPath() {}
  moveTo() {}
  bezierCurveTo() {}
  closePath() {}
  ellipse() {}
  arcTo() {}
  fill() {}
  stroke() {}
  fillText() {}
  fillRect() {}

  drawImage(source: TestCanvas | { pixels?: ArrayLike<number> }) {
    if (source?.pixels) this.canvas.pixels.set(Array.from(source.pixels).slice(0, this.canvas.pixels.length));
  }

  createImageData(width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height } as ImageData;
  }

  getImageData(_x: number, _y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    data.set(this.canvas.pixels.subarray(0, data.length));
    return { data, width, height } as ImageData;
  }

  putImageData(image: ImageData) {
    this.canvas.pixels.set(image.data.subarray(0, this.canvas.pixels.length));
  }
}

class TestCanvas {
  private storedWidth = 0;
  private storedHeight = 0;
  private readonly context = new TestCanvasContext(this);
  pixels = new Uint8ClampedArray();

  get width() { return this.storedWidth; }
  set width(value: number) { this.storedWidth = value; this.resize(); }
  get height() { return this.storedHeight; }
  set height(value: number) { this.storedHeight = value; this.resize(); }
  getContext(kind: string) { return kind === "2d" ? this.context : null; }
  toBlob(callback: (blob: Blob) => void, type = "image/png") {
    const bytes = new TextEncoder().encode(JSON.stringify({
      width: this.width,
      height: this.height,
      pixels: [...this.pixels],
      type,
    }));
    callback(bytes as unknown as Blob);
  }
  private resize() { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); }
}

const originalDocument = globalThis.document;
const originalCreateImageBitmap = globalThis.createImageBitmap;
globalThis.document = {
  createElement(name: string) {
    if (name !== "canvas") throw new Error(`Unexpected element ${name}`);
    return new TestCanvas();
  },
} as unknown as Document;
globalThis.createImageBitmap = (async (blob: Blob) => {
  const decoded = JSON.parse(await blob.text()) as { width: number; height: number; pixels: number[] };
  return { ...decoded, close() {} };
}) as unknown as typeof createImageBitmap;
initializeCanvas(
  (width, height) => {
    const canvas = new TestCanvas();
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as HTMLCanvasElement;
  },
  (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height } as ImageData),
);
test.after(() => {
  globalThis.document = originalDocument;
  globalThis.createImageBitmap = originalCreateImageBitmap;
});

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

function photoshopHeader(version: number, bitsPerChannel = 8, colorMode = 3) {
  const buffer = new ArrayBuffer(26);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53]); // 8BPS
  const view = new DataView(buffer);
  view.setUint16(4, version, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, 480, false);
  view.setUint32(18, 640, false);
  view.setUint16(22, bitsPerChannel, false);
  view.setUint16(24, colorMode, false);
  return buffer;
}

test("Photoshop preflight distinguishes PSD/PSB and rejects invalid headers deterministically", () => {
  assert.deepEqual(inspectPhotoshopHeader(photoshopHeader(1)), {
    container: "psd",
    version: 1,
    channels: 4,
    width: 640,
    height: 480,
    bitsPerChannel: 8,
    colorMode: 3,
  });
  assert.equal(inspectPhotoshopHeader(photoshopHeader(2, 16, 4)).container, "psb");
  assert.throws(() => inspectPhotoshopHeader(new ArrayBuffer(12)), (error) => (
    error instanceof PhotoshopFormatError && error.code === "TRUNCATED_HEADER"
  ));
  assert.throws(() => inspectPhotoshopHeader(photoshopHeader(7)), (error) => (
    error instanceof PhotoshopFormatError && error.code === "UNSUPPORTED_VERSION"
  ));
});

test("PSD rich text runs and paragraph metadata survive an unchanged round trip", async () => {
  const source: Psd = {
    width: 120,
    height: 80,
    children: [{
      name: "Rich type",
      text: {
        text: "Hello world",
        transform: [1, 0.15, 0.05, 1, 12, 28],
        antiAlias: "crisp",
        orientation: "horizontal",
        style: { font: { name: "ArialMT" }, fontSize: 20 },
        styleRuns: [
          { length: 5, style: { fillColor: { r: 255, g: 0, b: 0 }, fauxBold: true } },
          { length: 6, style: { fillColor: { r: 0, g: 0, b: 255 }, underline: true, tracking: 30 } },
        ],
        paragraphStyle: { justification: "justify-left", firstLineIndent: 8, spaceAfter: 4 },
        paragraphStyleRuns: [{ length: 11, style: { justification: "justify-left", firstLineIndent: 8 } }],
        shapeType: "box",
        boxBounds: [0, 0, 100, 60],
      },
    }],
  };
  const sourceBytes = writePsd(source, { noBackground: true });
  const canonicalSource = readPsd(sourceBytes, { skipLayerImageData: true, skipCompositeImageData: true });
  const imported = await importPsd(sourceBytes);
  const textLayer = imported.layers.find((layer) => layer.kind === "text")!;
  assert.equal(getPhotoshopLayerMetadata(textLayer)?.preservation, "editable");

  const roundTripped = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true });
  const text = roundTripped.children?.[0].text;
  assert.ok(text);
  assert.deepEqual(text.styleRuns?.map((run) => run.length), [5, 6]);
  assert.equal(text.styleRuns?.[1].style.underline, true);
  assert.equal(text.styleRuns?.[1].style.tracking, 30);
  assert.equal(text.paragraphStyle?.firstLineIndent, 8);
  assert.deepEqual(text.paragraphStyleRuns, canonicalSource.children?.[0].text?.paragraphStyleRuns);
  assert.equal(text.shapeType, "box");
  assert.deepEqual(text.transform, [1, 0.15, 0.05, 1, 12, 28]);
});

test("tracking, paragraph spacing and justification survive an edited text layer", async () => {
  // Editing invalidates the preserved rich-text blob, so this exercises the
  // simple single-style path where Luma has to emit the values itself.
  const sourceBytes = writePsd({
    width: 200,
    height: 120,
    children: [{
      name: "Type",
      text: {
        text: "Hello world",
        transform: [1, 0, 0, 1, 0, 0],
        style: { font: { name: "ArialMT" }, fontSize: 20, tracking: 120 },
        paragraphStyle: { justification: "justify-center", spaceAfter: 30 },
        shapeType: "point",
      },
    }],
  }, { noBackground: true });

  const imported = await importPsd(sourceBytes);
  const layer = imported.layers.find((entry) => entry.kind === "text")!;
  assert.equal(layer.text?.tracking, 120, "tracking is already in thousandths of an em on both sides");
  assert.equal(layer.text?.paragraphSpacing, 1.5, "30px after a 20px face is 1.5 ems");
  assert.equal(layer.text?.justify, true);
  assert.equal(layer.text?.align, "center", "justify-center is centred *and* justified");

  // Edit it, so the preserved original can no longer be reused.
  layer.text = { ...layer.text!, text: "Goodbye world" };
  const text = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true })
    .children?.[0].text;
  assert.ok(text);
  assert.equal(text.text, "Goodbye world");
  assert.equal(text.style?.tracking, 120);
  assert.equal(text.paragraphStyle?.spaceAfter, 30);
  assert.equal(text.paragraphStyle?.justification, "justify-center");
});

test("Photoshop source mode is byte-for-byte for untouched files and disengages after edits", async () => {
  const preview = newCanvas(12, 10);
  preview.getContext("2d")!.fillRect(0, 0, 12, 10);
  const sourceBytes = writePsd({
    width: 12,
    height: 10,
    bitsPerChannel: 8,
    colorMode: 3,
    children: [{ name: "Original pixels", canvas: preview, left: 0, top: 0, opacity: 211 / 255 }],
  }, { noBackground: true });
  const imported = await importPsd(sourceBytes);

  const untouched = exportPhotoshopDocument(imported, { format: "source" });
  assert.deepEqual(new Uint8Array(untouched.buffer), new Uint8Array(sourceBytes));
  assert.ok(untouched.report.issues.some((issue) => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"));

  imported.layers[0].opacity = 0.5;
  const edited = exportPhotoshopDocument(imported, { format: "source" });
  assert.equal(edited.report.issues.some((issue) => issue.code === "ORIGINAL_SOURCE_PASSTHROUGH"), false);
  assert.notDeepEqual(new Uint8Array(edited.buffer), new Uint8Array(sourceBytes));
});

test("editing imported rich text emits valid single-style text and an explicit warning", async () => {
  const source: Psd = {
    width: 80,
    height: 60,
    children: [{
      name: "Runs",
      text: {
        text: "ABCD",
        style: { font: { name: "ArialMT" }, fontSize: 18 },
        styleRuns: [
          { length: 2, style: { fauxBold: true } },
          { length: 2, style: { fauxItalic: true } },
        ],
      },
    }],
  };
  const imported = await importPsd(writePsd(source, { noBackground: true }));
  const layer = imported.layers.find((candidate) => candidate.kind === "text")!;
  layer.text!.text = "Changed";
  const report = photoshopCompatibilityReport(imported);
  assert.ok(report.issues.some((issue) => issue.code === "RICH_TEXT_RUNS_REPLACED" && issue.layerId === layer.id));
  const encoded = exportPsd(imported);
  const decoded = readPsd(encoded, { skipLayerImageData: true, skipCompositeImageData: true });
  assert.equal(decoded.children?.[0].text?.text, "Changed");
  assert.equal(decoded.children?.[0].text?.styleRuns, undefined);
});

test("Luma paths export as editable Photoshop vector masks with fill and stroke", async () => {
  const doc = createDocument(100, 100);
  const path = createPathLayer("Editable curve", {
    anchors: [
      { x: 10, y: 20, hIn: { dx: 0, dy: 0 }, hOut: { dx: 15, dy: -5 } },
      { x: 75, y: 25, hIn: { dx: -12, dy: -4 }, hOut: { dx: 5, dy: 20 } },
      { x: 60, y: 80, hIn: { dx: 10, dy: -15 }, hOut: { dx: 0, dy: 0 } },
    ],
    closed: true,
    fill: "#336699",
    stroke: "#ff8800",
    strokeWidth: 3,
  });
  path.transform = { tx: 4, ty: 6, sx: 1.2, sy: 0.8, rotation: 0.1 };
  doc.layers = [path];

  const raw = readPsd(exportPsd(doc), { skipLayerImageData: true, skipCompositeImageData: true });
  assert.equal(raw.children?.[0].vectorMask?.paths.length, 1);
  assert.equal(raw.children?.[0].vectorMask?.paths[0].knots.length, 3);
  assert.deepEqual(raw.children?.[0].vectorFill, { type: "color", color: { r: 51, g: 102, b: 153 } });
  assert.equal(raw.children?.[0].vectorStroke?.lineWidth?.value, 3);

  const imported = await importPsd(exportPsd(doc));
  const restored = imported.layers.find((layer) => layer.kind === "path")!;
  assert.equal(restored.path?.anchors.length, 3);
  assert.equal(restored.path?.closed, true);
  assert.equal(restored.path?.fill, "#336699");
});

test("ellipse and rounded-rectangle layers export as native vector geometry", () => {
  const doc = createDocument(120, 90);
  const ellipse = createShapeLayer("Ellipse", {
    kind: "ellipse",
    x: 10,
    y: 12,
    w: 44,
    h: 30,
    fill: "#00aa88",
    stroke: "none",
    strokeWidth: 0,
    radius: 0,
  });
  const rounded = createShapeLayer("Rounded rectangle", {
    kind: "rect",
    x: 60,
    y: 15,
    w: 45,
    h: 55,
    fill: "#8844cc",
    stroke: "#ffffff",
    strokeWidth: 2,
    radius: 9,
  });
  doc.layers = [ellipse, rounded];
  const raw = readPsd(exportPsd(doc), { skipLayerImageData: true, skipCompositeImageData: true });
  const byName = new Map(raw.children?.map((layer) => [layer.name, layer]));
  assert.equal(byName.get("Ellipse")?.vectorMask?.paths[0].knots.length, 4);
  assert.equal(byName.get("Rounded rectangle")?.vectorMask?.paths[0].knots.length, 8);
  assert.equal(byName.get("Rounded rectangle")?.vectorStroke?.strokeEnabled, true);
});

test("smart-object descriptors and embedded linked bytes survive PSD round trip", async () => {
  const preview = newCanvas(32, 24);
  const id = "20953ddb-9391-11ec-b4f1-c15674f50bc4";
  const source: Psd = {
    width: 32,
    height: 24,
    linkedFiles: [{ id, name: "embedded.psb", type: "8BPS", creator: "8BIM", data: new Uint8Array([1, 3, 3, 7]) }],
    children: [{
      name: "Embedded object",
      canvas: preview,
      left: 0,
      top: 0,
      placedLayer: {
        id,
        placed: id,
        type: "raster",
        transform: [0, 0, 32, 0, 32, 24, 0, 24],
        width: 32,
        height: 24,
        resolution: { units: "Density", value: 72 },
      },
    }],
  };
  const imported = await importPsd(writePsd(source, { noBackground: true }));
  const smart = imported.layers.find((layer) => layer.kind === "smart-object")!;
  assert.ok(smart);
  assert.equal(getPhotoshopLayerMetadata(smart)?.source.placedLayer?.id, id);

  const restored = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true });
  assert.equal(restored.children?.[0].placedLayer?.id, id);
  assert.deepEqual([...restored.linkedFiles?.[0].data ?? []], [1, 3, 3, 7]);
});

test("PSD preservation metadata survives a Luma project save and reopen", async () => {
  const { decodeLumaProject, encodeLumaProject } = await import("../app/engine/project.ts");
  const preview = newCanvas(20, 16);
  const id = "c6276bf8-8788-455b-9e1f-05ddf365e179";
  const source: Psd = {
    width: 20,
    height: 16,
    linkedFiles: [{
      id,
      name: "project-preserved.psb",
      type: "8BPS",
      creator: "8BIM",
      data: new Uint8Array([2, 4, 8, 16]),
    }],
    children: [{
      name: "Project smart object",
      canvas: preview,
      left: 0,
      top: 0,
      placedLayer: {
        id,
        placed: id,
        type: "raster",
        transform: [0, 0, 20, 0, 20, 16, 0, 16],
        width: 20,
        height: 16,
        resolution: { units: "Density", value: 144 },
      },
    }],
  };
  const sourceBytes = writePsd(source, { noBackground: true });
  const imported = await importPsd(sourceBytes);
  const projectBlob = await encodeLumaProject(imported, [], "Photoshop bridge fixture");
  const archive = await JSZip.loadAsync(await projectBlob.arrayBuffer());
  assert.equal(
    Object.keys(archive.files).filter((path) => path.startsWith("assets/photoshop/") && !path.endsWith("/")).length,
    1,
  );

  const reopened = await decodeLumaProject(await projectBlob.arrayBuffer());
  assert.deepEqual([...getPhotoshopDocumentMetadata(reopened.doc)?.originalSource ?? []], [...new Uint8Array(sourceBytes)]);
  const smart = reopened.doc.layers.find((layer) => layer.kind === "smart-object")!;
  assert.equal(getPhotoshopLayerMetadata(smart)?.source.placedLayer?.id, id);

  const roundTripped = readPsd(exportPsd(reopened.doc), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
  });
  assert.equal(roundTripped.children?.[0].placedLayer?.id, id);
  assert.deepEqual([...roundTripped.linkedFiles?.[0].data ?? []], [2, 4, 8, 16]);
});

test("mask controls, non-Luma effects, group pass-through, guides, and resolution are preserved", async () => {
  const bitmap = newCanvas(24, 24);
  const mask = newCanvas(12, 10);
  const source: Psd = {
    width: 24,
    height: 24,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: 300,
        horizontalResolutionUnit: "PPI",
        widthUnit: "Inches",
        verticalResolution: 240,
        verticalResolutionUnit: "PPI",
        heightUnit: "Inches",
      },
      gridAndGuidesInformation: { guides: [{ location: 9, direction: "vertical" }] },
    },
    children: [{
      name: "Pass through group",
      blendMode: "pass through",
      opened: false,
      children: [{
        name: "Masked",
        canvas: bitmap,
        left: 0,
        top: 0,
        mask: {
          canvas: mask,
          left: 3,
          top: 4,
          right: 15,
          bottom: 14,
          defaultColor: 0,
          userMaskDensity: 0.7,
          userMaskFeather: 2.5,
          positionRelativeToLayer: true,
        },
        effects: {
          dropShadow: [{
            enabled: true,
            size: { units: "Pixels", value: 4 },
            distance: { units: "Pixels", value: 3 },
            color: { r: 0, g: 0, b: 0 },
            opacity: 0.5,
            angle: 45,
            blendMode: "screen",
            useGlobalLight: true,
            choke: { units: "Pixels", value: 1.25 },
          }],
          innerShadow: [{
            enabled: true,
            size: { units: "Pixels", value: 2 },
            distance: { units: "Pixels", value: 1 },
            color: { r: 12, g: 24, b: 48 },
            opacity: 0.35,
            angle: 90,
          }],
        },
      }],
    }],
  };
  const imported = await importPsd(writePsd(source, { noBackground: true }));
  assert.deepEqual(imported.resolution, { x: 300, y: 240, unit: "ppi" });
  assert.deepEqual(imported.guides.map((guide) => [guide.orientation, guide.position]), [["vertical", 9]]);

  const restored = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true });
  const group = restored.children?.[0];
  assert.ok(group);
  const child = group.children?.[0];
  assert.ok(child);
  assert.equal(group.blendMode, "pass through");
  assert.ok(Math.abs((child.mask?.userMaskDensity ?? 0) - 0.7) < 1 / 255);
  assert.equal(child.mask?.userMaskFeather, 2.5);
  assert.equal(child.effects?.dropShadow?.[0].blendMode, "screen");
  assert.equal(child.effects?.dropShadow?.[0].useGlobalLight, true);
  assert.equal(child.effects?.dropShadow?.[0].choke?.value, 1.25);
  assert.equal(child.effects?.innerShadow?.[0].color && "r" in child.effects.innerShadow[0].color ? child.effects.innerShadow[0].color.r : undefined, 12);
  assert.equal(restored.imageResources?.resolutionInfo?.horizontalResolution, 300);
  assert.deepEqual(restored.imageResources?.gridAndGuidesInformation?.guides, [{ location: 9, direction: "vertical" }]);
});

test("all six effect kinds survive a PSD round trip", async () => {
  // Only drop shadows used to be mapped in either direction, so a stroke or a
  // bevel authored in Photoshop vanished on import and one authored in Luma
  // vanished on export — silently, in both cases.
  const source: Psd = {
    width: 16,
    height: 16,
    children: [{
      name: "Styled",
      canvas: newCanvas(16, 16),
      left: 0,
      top: 0,
      effects: {
        dropShadow: [{ enabled: true, size: { units: "Pixels", value: 6 }, distance: { units: "Pixels", value: 4 }, angle: 0, color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }],
        innerShadow: [{ enabled: true, size: { units: "Pixels", value: 3 }, distance: { units: "Pixels", value: 2 }, angle: 90, color: { r: 10, g: 20, b: 30 }, opacity: 0.4 }],
        outerGlow: { enabled: true, size: { units: "Pixels", value: 9 }, color: { r: 255, g: 238, b: 170 }, opacity: 0.6 },
        solidFill: [{ enabled: true, color: { r: 118, g: 86, b: 239 }, opacity: 1 }],
        stroke: [{ enabled: true, size: { units: "Pixels", value: 5 }, position: "inside", color: { r: 16, g: 16, b: 20 }, opacity: 1 }],
        bevel: { enabled: true, size: { units: "Pixels", value: 7 }, angle: 120, soften: { units: "Pixels", value: 2 }, highlightColor: { r: 255, g: 255, b: 255 }, shadowColor: { r: 0, g: 0, b: 0 }, highlightOpacity: 0.75 },
      },
    }],
  };

  const imported = await importPsd(writePsd(source, { noBackground: true }));
  const layer = imported.layers.find((candidate) => candidate.name === "Styled");
  assert.ok(layer, "imported layer missing");
  const byKind = new Map<LayerEffectKind, LayerEffect>((layer.effects ?? []).map((effect) => [effect.kind, effect]));
  assert.deepEqual(
    [...byKind.keys()].sort(),
    ["bevel-emboss", "color-overlay", "drop-shadow", "inner-shadow", "outer-glow", "stroke"],
    "not every effect kind was imported",
  );
  assert.equal(byKind.get("stroke")!.width, 5);
  assert.equal(byKind.get("stroke")!.position, "inside");
  assert.equal(byKind.get("bevel-emboss")!.depth, 7);
  assert.equal(byKind.get("bevel-emboss")!.angle, 120);
  assert.equal(byKind.get("outer-glow")!.blur, 9);
  assert.equal(byKind.get("color-overlay")!.color, "#7656ef");
  assert.ok(Math.abs(byKind.get("drop-shadow")!.offsetX - 4) < 0.001, "shadow angle/distance became the wrong offset");

  // Edit one effect so the export cannot short-circuit to preserved metadata.
  layer.effects = (layer.effects ?? []).map((effect) =>
    effect.kind === "stroke" ? { ...effect, width: 11 } : effect);

  const restored = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true });
  const written = restored.children?.[0]?.effects;
  assert.ok(written, "no effects were written back");
  assert.equal(written.stroke?.[0].size?.value, 11, "the edited stroke width was not exported");
  assert.equal(written.stroke?.[0].position, "inside");
  assert.equal(written.bevel?.size?.value, 7);
  assert.equal(written.outerGlow?.size?.value, 9);
  assert.ok(written.solidFill?.length, "colour overlay was dropped on export");
  assert.ok(written.innerShadow?.length, "inner shadow was dropped on export");
  assert.ok(written.dropShadow?.length, "drop shadow was dropped on export");
});

test("inner glow, satin and gradient overlay round-trip through PSD", async () => {
  const source: Psd = {
    width: 16,
    height: 16,
    children: [{
      name: "Styled",
      canvas: newCanvas(16, 16),
      left: 0,
      top: 0,
      effects: {
        innerGlow: { enabled: true, size: { units: "Pixels", value: 8 }, color: { r: 255, g: 200, b: 0 }, opacity: 0.5, source: "center" },
        satin: { enabled: true, size: { units: "Pixels", value: 6 }, distance: { units: "Pixels", value: 9 }, angle: 0, color: { r: 20, g: 30, b: 40 }, opacity: 0.4, invert: true },
        gradientOverlay: [{
          enabled: true,
          opacity: 1,
          angle: 45,
          type: "radial",
          gradient: {
            name: "g",
            type: "solid",
            colorStops: [
              { color: { r: 255, g: 0, b: 0 }, location: 0, midpoint: 50 },
              { color: { r: 0, g: 0, b: 255 }, location: 4096, midpoint: 50 },
            ],
            opacityStops: [
              { opacity: 1, location: 0, midpoint: 50 },
              { opacity: 1, location: 4096, midpoint: 50 },
            ],
          },
        }],
      },
    }],
  };

  const imported = await importPsd(writePsd(source, { noBackground: true }));
  const layer = imported.layers.find((candidate) => candidate.name === "Styled")!;
  const byKind = new Map<LayerEffectKind, LayerEffect>((layer.effects ?? []).map((effect) => [effect.kind, effect]));
  assert.equal(byKind.get("inner-glow")?.glowSource, "center");
  assert.equal(byKind.get("inner-glow")?.blur, 8);
  assert.equal(byKind.get("satin")?.invert, true);
  assert.ok(Math.abs((byKind.get("satin")?.offsetX ?? 0) - 9) < 0.001, "satin angle/distance became the wrong offset");
  const gradient = byKind.get("gradient-overlay")!;
  assert.equal(gradient.gradientStyle, "radial");
  assert.equal(gradient.gradientAngle, 45);
  assert.deepEqual(gradient.stops?.map((stop) => stop.color), ["#ff0000", "#0000ff"]);

  // Edit so the export cannot short-circuit to the preserved descriptor.
  layer.effects = (layer.effects ?? []).map((effect) =>
    effect.kind === "inner-glow" ? { ...effect, blur: 21 } : effect);

  const restored = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true });
  const written = restored.children?.[0]?.effects;
  assert.equal(written?.innerGlow?.size?.value, 21);
  assert.equal(written?.innerGlow?.source, "center");
  assert.equal(written?.satin?.invert, true);
  assert.equal(written?.gradientOverlay?.[0].type, "radial");
  assert.equal(written?.gradientOverlay?.[0].gradient?.type === "solid"
    ? written.gradientOverlay[0].gradient.colorStops.length
    : 0, 2);
});

test("pattern overlay is reported as unexportable rather than dropped in silence", () => {
  // Photoshop patterns are library assets we cannot synthesize. Every other
  // unmapped effect used to vanish without a word; this one says so.
  const doc = createDocument(16, 16);
  const layer = createRasterLayer("Patterned", newCanvas(16, 16));
  layer.effects = [{
    id: "p1", kind: "pattern-overlay", enabled: true, opacity: 1,
    color: "#101014", blur: 0, offsetX: 0, offsetY: 0, pattern: "dots",
  }];
  doc.layers = [layer];

  const report = photoshopCompatibilityReport(doc);
  const issue = report.issues.find((candidate) => candidate.code === "PATTERN_OVERLAY_NOT_EXPORTED");
  assert.ok(issue, "no warning for an effect Photoshop cannot receive");
  assert.equal(issue.severity, "warning");
  assert.ok(report.canExport, "the rest of the document should still export");
});

test("advanced blending is reported as unexportable rather than dropped in silence", () => {
  // ag-psd has no layer knockout field, and its writer drops
  // channelBlendingRestrictions — a round trip returns an empty array — so
  // claiming to export these would be a lie. Saying so is the honest option.
  const doc = createDocument(16, 16);
  const layer = createRasterLayer("Cut", newCanvas(16, 16));
  layer.knockout = "deep";
  layer.blendChannels = { r: false, g: true, b: true };
  doc.layers = [layer];
  const issue = photoshopCompatibilityReport(doc).issues
    .find((candidate) => candidate.code === "ADVANCED_BLENDING_NOT_EXPORTED");
  assert.ok(issue, "advanced blending must not vanish without a word");
  assert.equal(issue.severity, "warning");
});

test("backdrop blur is reported as unexportable rather than dropped in silence", () => {
  const doc = createDocument(16, 16);
  const layer = createRasterLayer("Glass", newCanvas(16, 16));
  layer.effects = [{
    id: "b1", kind: "backdrop-blur", enabled: true, opacity: 1,
    color: "#ffffff", blur: 24, offsetX: 0, offsetY: 0,
  }];
  doc.layers = [layer];

  const issue = photoshopCompatibilityReport(doc).issues
    .find((candidate) => candidate.code === "BACKDROP_EFFECT_NOT_EXPORTED");
  assert.ok(issue, "no warning for an effect Photoshop has no equivalent for");
  assert.equal(issue.severity, "warning");
});

test("removing an effect in Luma removes it from the exported PSD", async () => {
  // mergedEffects used to only override dropShadow, so a stroke deleted in
  // Luma came back from the preserved source descriptor.
  const source: Psd = {
    width: 16,
    height: 16,
    children: [{
      name: "Styled",
      canvas: newCanvas(16, 16),
      left: 0,
      top: 0,
      effects: {
        stroke: [{ enabled: true, size: { units: "Pixels", value: 5 }, position: "outside", color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
      },
    }],
  };
  const imported = await importPsd(writePsd(source, { noBackground: true }));
  const layer = imported.layers.find((candidate) => candidate.name === "Styled")!;
  assert.equal(layer.effects?.length, 1);
  layer.effects = [];

  const restored = readPsd(exportPsd(imported), { skipLayerImageData: true, skipCompositeImageData: true });
  assert.ok(!restored.children?.[0]?.effects?.stroke?.length, "the deleted stroke came back");
});

test("PSB export is explicit and 32-bit output remains an honest compatibility conversion", async () => {
  const doc = createDocument(16, 12);
  doc.bitDepth = 32;
  doc.colorSpace = "display-p3";
  const nativeSmartObject = createRasterLayer("Luma smart object", newCanvas(16, 12));
  nativeSmartObject.kind = "smart-object";
  doc.layers = [nativeSmartObject];

  const report = photoshopCompatibilityReport(doc, { format: "psb" });
  assert.equal(report.container, "psb");
  assert.ok(report.issues.some((issue) => issue.code === "OUTPUT_DEPTH_CONVERTED_TO_8_BIT"));
  assert.ok(report.issues.some((issue) => issue.code === "OUTPUT_COLOR_SPACE_CONVERTED_TO_SRGB"));
  assert.ok(report.issues.some((issue) => issue.code === "SMART_OBJECT_PREVIEW_ONLY"));

  const exported = exportPhotoshopDocument(doc, { format: "psb" });
  assert.equal(inspectPhotoshopHeader(exported.buffer).container, "psb");
  const imported = await importPsd(exported.buffer);
  assert.equal(getPhotoshopDocumentMetadata(imported)?.header.container, "psb");
});

test("native 16-bit PSD and PSB exports round-trip precision samples without an 8-bit mirror", async () => {
  const sourceSamples = new Uint16Array([
    1003, 2009, 3011, 65535,
    32777, 45001, 61234, 65535,
  ]);
  const doc = createDocument(2, 1);
  doc.bitDepth = 16;
  doc.colorSpace = "srgb";
  const layer = createRasterLayer("Native precision");
  layer.surface = precisionSurfaceFromPsdPixels({ width: 2, height: 1, data: sourceSamples }, doc, 0, 0);
  doc.layers = [layer];

  for (const format of ["psd", "psb"] as const) {
    const exported = exportPhotoshopDocument(doc, { format });
    assert.ok(exported.report.issues.some((issue) => issue.code === "OUTPUT_16_BIT_NATIVE"));
    assert.ok(!exported.report.issues.some((issue) => issue.code === "OUTPUT_DEPTH_CONVERTED_TO_8_BIT"));
    assert.deepEqual(inspectPhotoshopHeader(exported.buffer), {
      container: format,
      version: format === "psb" ? 2 : 1,
      channels: 3,
      width: 2,
      height: 1,
      bitsPerChannel: 16,
      colorMode: 3,
    });

    // ag-psd endian-swaps 16-bit raw payloads in place while decoding, so each
    // independent consumer receives its own copy of the file bytes.
    const decoded = readPsd(exported.buffer.slice(0), { useImageData: true });
    const layerPixels = decoded.children?.[0].imageData?.data;
    const compositePixels = decoded.imageData?.data;
    assert.ok(layerPixels instanceof Uint16Array);
    assert.ok(compositePixels instanceof Uint16Array);
    for (const offset of [0, 1, 2, 4, 5, 6]) {
      assert.ok(Math.abs(layerPixels[offset] - sourceSamples[offset]) <= 32);
      assert.equal(compositePixels[offset], layerPixels[offset]);
    }
    // A promoted 8-bit channel can only land on multiples of 257. This sample
    // proves the native layer retained meaningful precision between those steps.
    assert.notEqual(layerPixels[0] % 257, 0);

    const originalBytes = new Uint8Array(exported.buffer.slice(0));
    const imported = await importPsd(exported.buffer);
    assert.deepEqual(new Uint8Array(exported.buffer), originalBytes);
    const sourcePassthrough = exportPhotoshopDocument(imported, { format: "source" });
    assert.deepEqual(new Uint8Array(sourcePassthrough.buffer), originalBytes);
    const secondGeneration = exportPhotoshopDocument(imported, { format });
    assert.equal(inspectPhotoshopHeader(secondGeneration.buffer).bitsPerChannel, 16);
    const restored = readPsd(secondGeneration.buffer.slice(0), { useImageData: true });
    const restoredPixels = restored.children?.[0].imageData?.data;
    assert.ok(restoredPixels instanceof Uint16Array);
    assert.ok(
      Math.abs(restoredPixels[0] - layerPixels[0]) <= 32,
      `second-generation sample drifted from ${layerPixels[0]} to ${restoredPixels[0]}`,
    );
  }
});

test("16-bit native export gate falls back explicitly when compositing would be required", () => {
  const doc = createDocument(1, 1);
  doc.bitDepth = 16;
  const layer = createRasterLayer("Translucent precision");
  layer.surface = precisionSurfaceFromPsdPixels({
    width: 1,
    height: 1,
    data: new Uint16Array([12345, 23456, 34567, 32768]),
  }, doc, 0, 0);
  doc.layers = [layer];

  const exported = exportPhotoshopDocument(doc);
  const converted = exported.report.issues.find((issue) => issue.code === "OUTPUT_DEPTH_CONVERTED_TO_8_BIT");
  assert.match(converted?.message ?? "", /contains transparency/);
  assert.ok(!exported.report.issues.some((issue) => issue.code === "OUTPUT_16_BIT_NATIVE"));
  assert.equal(inspectPhotoshopHeader(exported.buffer).bitsPerChannel, 8);
});

test("16-bit PSD channel values enter the precision master without an 8-bit preview round trip", () => {
  const doc = createDocument(2, 1);
  doc.bitDepth = 16;
  const surface = precisionSurfaceFromPsdPixels({
    width: 2,
    height: 1,
    data: new Uint16Array([
      65535, 32768, 0, 65535,
      16384, 8192, 4096, 32768,
    ]),
  }, doc, 0, 0);
  const first = surface.readPixel(0, 0);
  assert.ok(first[0] > 0.99);
  assert.ok(first[1] > 0.21 && first[1] < 0.22);
  assert.equal(first[2], 0);
  assert.ok(first[3] > 0.999);
  const second = surface.readPixel(1, 0);
  assert.ok(second[0] > second[1] && second[1] > second[2]);
  assert.ok(Math.abs(second[3] - 0.5) < 0.002);
});

function rawImageResource(id: number, data: number[]) {
  const dataPadding = data.length % 2;
  const bytes = new Uint8Array(12 + data.length + dataPadding);
  bytes.set([0x38, 0x42, 0x49, 0x4d]); // 8BIM
  const view = new DataView(bytes.buffer);
  view.setUint16(4, id, false);
  // Empty Pascal name: length byte plus one padding byte at offsets 6..7.
  view.setUint32(8, data.length, false);
  bytes.set(data, 12);
  return { id, bytes, data: new Uint8Array(data) };
}

test("unhandled RGB ICC resources are retained byte-for-byte", async () => {
  const base = exportPsd(createDocument(8, 8));
  const icc = rawImageResource(1039, [0, 1, 2, 3, 250, 251, 252]);
  const withProfile = mergePhotoshopImageResources(base, [icc], { includeIccProfile: true });
  assert.deepEqual([...extractPhotoshopImageResources(withProfile).find((resource) => resource.id === 1039)!.data], [...icc.data]);

  const imported = await importPsd(withProfile);
  assert.ok(photoshopCompatibilityReport(imported).issues.some((issue) => issue.code === "ICC_PROFILE_PRESERVED"));
  const roundTripped = exportPsd(imported);
  assert.deepEqual([...extractPhotoshopImageResources(roundTripped).find((resource) => resource.id === 1039)!.data], [...icc.data]);
});

test("color lookup is reported as unexportable rather than dropped in silence", () => {
  // A Photoshop "color lookup" descriptor names a LUT, it does not carry one.
  // We write "Luma <preset>", which resolves against nothing in Photoshop's
  // library, so the layer lands inert — the same silent loss the pattern,
  // backdrop and relight warnings above exist to prevent.
  const doc = createDocument(16, 16);
  const layer = createRasterLayer("Graded", newCanvas(16, 16));
  layer.proAdjustment = { kind: "color-lookup", preset: "cinematic", intensity: 0.65 };
  doc.layers = [layer];

  const issue = photoshopCompatibilityReport(doc).issues
    .find((candidate) => candidate.code === "COLOR_LOOKUP_NOT_EXPORTED");
  assert.ok(issue, "a LUT reference Photoshop cannot resolve must not go unmentioned");
  assert.equal(issue.severity, "warning");
  assert.ok(photoshopCompatibilityReport(doc).canExport, "the rest of the document still exports");
});

