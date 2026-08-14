import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import "./canvas-harness.ts";
import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_EDGE,
  canOpenDocumentSize,
  documentSizeRefusal,
  exceedsBrowserCanvas,
  fitsBrowserCanvas,
} from "../app/engine/large-documents.ts";
import { CAPABILITY_STATUS, hasCapability } from "../app/engine/edition.ts";
import { newCanvas } from "../app/engine/document.ts";
import { Studio } from "../app/engine/studio.ts";

// ---------------------------------------------------------------------------
// A 2D canvas tops out around 16384px on a side and 64 megapixels of area.
// That bounds the *rendering surface*, not the document: layers are sparse
// tiles, the viewport is tiled, and PNG export streams band by band. Past the
// ceiling a document simply may never become one canvas.
//
// The capability was declared for pro and then consulted nowhere, so the web
// edition created documents it could only partly export, and the limit itself
// was spelled out in five places across studio.ts and psd.ts.
// ---------------------------------------------------------------------------

test("the ceiling is one number, not five copies of it", () => {
  for (const file of ["studio.ts", "psd.ts", "png-stream.ts"]) {
    const source = readFileSync(new URL(`../app/engine/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /16_?384|64_?000_?000/, `${file} still spells the ceiling out itself`);
  }
});

test("the edge and the area are both limits, and either one can bite", () => {
  assert.equal(fitsBrowserCanvas(MAX_CANVAS_EDGE, 1), true);
  assert.equal(exceedsBrowserCanvas(MAX_CANVAS_EDGE + 1, 1), true, "a long thin strip still breaks the edge limit");
  // Under the edge on both sides, over on area.
  assert.equal(exceedsBrowserCanvas(10000, 10000), true, "100MP is past the area limit");
  assert.equal(fitsBrowserCanvas(8000, 8000), true, "64MP exactly is allowed");
  assert.equal(MAX_CANVAS_EDGE * 1, 16384);
  assert.equal(MAX_CANVAS_AREA, 64_000_000);
});

test("only an edition permitted large documents may open one", () => {
  assert.equal(canOpenDocumentSize(20000, 5000, "pro"), true);
  assert.equal(canOpenDocumentSize(20000, 5000, "web"), false);
  // Ordinary sizes need no permission at all.
  assert.equal(canOpenDocumentSize(4000, 3000, "web"), true);
  assert.equal(canOpenDocumentSize(4000, 3000, "pro"), true);
});

test("the refusal says what was refused and where it is available", () => {
  assert.equal(documentSizeRefusal(4000, 3000, "web"), null);
  const refusal = documentSizeRefusal(20000, 5000, "web");
  assert.ok(refusal);
  assert.match(refusal, /20000x5000/, "the refusal should name the size asked for");
  assert.match(refusal, /desktop/i, "and where it can be done");
});

test("the capability is permitted to pro and marked built", () => {
  // It was "planned" while the tile surfaces, the tiled viewport and the
  // streaming PNG writer were all already there, so nothing surfaced it.
  assert.equal(hasCapability("pro", "large-documents"), true);
  assert.equal(hasCapability("web", "large-documents"), false);
  assert.equal(CAPABILITY_STATUS["large-documents"], "shipped");
});

// --- end to end -------------------------------------------------------------

const BIG = { width: 17000, height: 4000 };

test("a document past the ceiling gets sparse layers rather than a canvas", () => {
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  const layer = studio.addBlankRaster("big");
  assert.equal(layer.bitmap, undefined, "no bitmap: a canvas this size cannot exist");
  assert.ok(layer.surface, "the tile surface is what holds the pixels instead");
});

test("a document past the ceiling exports as a streamed PNG", async () => {
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  studio.addBlankRaster("big");
  const png = await studio.exportImage("image/png");
  assert.ok(png.size > 0, "the streaming writer should have produced bytes");

  // JPEG and WebP have no streaming encoder, so they say so rather than
  // failing somewhere deeper with a canvas allocation error.
  await assert.rejects(() => studio.exportImage("image/jpeg"), /Large-document JPEG\/WebP export is unavailable/);
});

/** A PNG's IHDR carries its true dimensions; the blob size does not. */
async function pngSize(blob: Blob) {
  const header = new DataView(await blob.slice(0, 24).arrayBuffer());
  return { width: header.getUint32(16), height: header.getUint32(20) };
}

test("an artboard past the ceiling streams instead of throwing", async () => {
  // It used to throw outright, which meant a large document could hold an
  // artboard that could never be exported out of it.
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  studio.addBlankRaster("big");
  studio.doc.artboards = [{ id: "a1", name: "Wide", x: 0, y: 0, width: 17000, height: 4000 }];
  const png = await studio.exportArtboard("a1", "image/png");
  assert.deepEqual(await pngSize(png), { width: 17000, height: 4000 });

  await assert.rejects(
    () => studio.exportArtboard("a1", "image/jpeg"),
    /Artboards past the canvas ceiling export as PNG/,
  );
});

test("the streamed artboard is its own region, not the whole document", async () => {
  // Writing the document's dimensions with the artboard's pixels — or the
  // artboard's dimensions with the document's pixels — both produce a file, so
  // the size of the blob proves nothing. The header has to be read.
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  studio.addBlankRaster("big");
  studio.doc.artboards = [{ id: "a1", name: "Corner", x: 400, y: 200, width: 17000, height: 1200 }];
  const png = await studio.exportArtboard("a1", "image/png");
  assert.deepEqual(await pngSize(png), { width: 17000, height: 1200 },
    "the file should be the artboard's size, not the document's");
});

test("a large document can always be shrunk back under the ceiling", () => {
  // The permission check is on the way up only. A document opened on the
  // desktop and then reopened elsewhere must not be permanently unresizable.
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  assert.equal(studio.resizeDocument(2000, 1500), true);
  assert.equal(studio.doc.width, 2000);
});

test("a streamed region reads from where the region actually is", async () => {
  // The header alone cannot catch a dropped offset: two regions of equal size
  // produce equally-sized files. Comparing the *bytes* of two different regions
  // over spatially varying artwork can — if the offset were ignored, both
  // exports would read from the origin and come out identical.
  const studio = new Studio(300, 200, newCanvas(8, 8));
  const layer = studio.addBlankRaster("art");
  const context = layer.bitmap!.getContext("2d")!;
  const ramp = context.createLinearGradient(0, 0, 300, 200);
  ramp.addColorStop(0, "#000000");
  ramp.addColorStop(1, "#ffffff");
  context.fillStyle = ramp;
  context.fillRect(0, 0, 300, 200);
  (studio as unknown as { syncLayerSurface(l: typeof layer): void }).syncLayerSurface(layer);

  const { exportTiledPng } = await import("../app/engine/png-stream.ts");
  const size = { width: 80, height: 60 };
  const topLeft = await exportTiledPng(studio.doc, { region: { x: 0, y: 0, ...size } });
  const elsewhere = await exportTiledPng(studio.doc, { region: { x: 180, y: 120, ...size } });

  assert.deepEqual(await pngSize(topLeft), size);
  assert.deepEqual(await pngSize(elsewhere), size);
  const a = new Uint8Array(await topLeft.arrayBuffer());
  const b = new Uint8Array(await elsewhere.arrayBuffer());
  assert.notDeepEqual(a, b, "two different regions of a gradient must not encode identically");
});
