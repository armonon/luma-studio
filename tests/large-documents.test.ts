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

test("the capability is permitted to pro but remains planned until every workflow is sparse", () => {
  assert.equal(hasCapability("pro", "large-documents"), true);
  assert.equal(hasCapability("web", "large-documents"), false);
  assert.equal(CAPABILITY_STATUS["large-documents"], "planned");
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

/**
 * Decode one of our own PNGs far enough to read pixels.
 *
 * Not a general decoder: exportTiledPng writes 8-bit RGBA with filter 0 on
 * every scanline, so undoing the filter is dropping the leading byte per row.
 * Worth the twenty lines — comparing whole files can only say "these differ",
 * and most of what can go wrong here is artwork landing in the wrong place.
 */
async function decodePng(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const { width, height } = await pngSize(blob);
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const merged = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of idat) { merged.set(part, cursor); cursor += part.length; }

  const stream = new Blob([merged]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = row * (1 + width * 4) + 1;
    pixels.set(raw.subarray(from, from + width * 4), row * width * 4);
  }
  return {
    width,
    height,
    at: (x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)),
  };
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

test("an artboard hanging off the canvas pads instead of failing", async () => {
  // Photoshop exports the whole artboard rect with transparent padding where it
  // leaves the canvas, and that is what an artboard is for. The risk is the
  // other way round: a region whose origin sits outside the document would give
  // the renderer a zero-width canvas to allocate.
  const studio = new Studio(300, 200, newCanvas(8, 8));
  studio.addBlankRaster("art");
  const { exportTiledPng } = await import("../app/engine/png-stream.ts");

  const overhang = await exportTiledPng(studio.doc, { region: { x: 250, y: 150, width: 200, height: 200 } });
  assert.deepEqual(await pngSize(overhang), { width: 200, height: 200 },
    "the file keeps the size the artboard asked for");

  // Entirely outside, and a degenerate size: both have to produce a file rather
  // than throw on an impossible canvas.
  const outside = await exportTiledPng(studio.doc, { region: { x: 900, y: 900, width: 32, height: 32 } });
  assert.deepEqual(await pngSize(outside), { width: 32, height: 32 });
  const degenerate = await exportTiledPng(studio.doc, { region: { x: 10, y: 10, width: 0, height: -5 } });
  assert.deepEqual(await pngSize(degenerate), { width: 1, height: 1 });
});

test("an artboard above or left of the canvas origin pads on that side", async () => {
  // Artboards are positioned freely, so a negative origin is ordinary rather
  // than a mistake. The covered part has to land at its own offset inside the
  // tile, or the padding ends up on the wrong side and the artwork shifts.
  const studio = new Studio(300, 200, newCanvas(8, 8));
  const layer = studio.addBlankRaster("art");
  const context = layer.bitmap!.getContext("2d")!;
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 300, 200);
  (studio as unknown as { syncLayerSurface(l: typeof layer): void }).syncLayerSurface(layer);

  const { exportTiledPng } = await import("../app/engine/png-stream.ts");
  const negative = await decodePng(
    await exportTiledPng(studio.doc, { region: { x: -40, y: -30, width: 120, height: 100 } }),
  );
  assert.equal(negative.width, 120);
  assert.equal(negative.height, 100);

  // Blitting at the wrong offset produces a correctly sized file either way, so
  // this has to look at where the artwork actually landed. The canvas covers
  // the region from (40, 30) inward; everything before that is off-canvas.
  assert.deepEqual(negative.at(10, 10), [0, 0, 0, 0], "above and left of the canvas is transparent");
  assert.deepEqual(negative.at(39, 50), [0, 0, 0, 0], "still outside one pixel short of the edge");
  assert.deepEqual(negative.at(41, 31), [255, 0, 0, 255], "and the artwork starts exactly where the canvas does");
  assert.deepEqual(negative.at(119, 99), [255, 0, 0, 255], "through to the far corner, which is inside the canvas");
});

test("a document too large to flatten says so rather than failing on an allocation", () => {
  // flatten() is one canvas, so it cannot serve a document past the ceiling.
  // That was unreachable while large documents were not really open; it is
  // reachable now, and the AI edit path goes through it.
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  assert.throws(() => studio.flatten(), /too large to flatten/);
  // An ordinary document is unaffected.
  assert.doesNotThrow(() => new Studio(64, 48, newCanvas(8, 8)).flatten());
});

test("operations that a large document cannot support refuse, and the studio says which", () => {
  // Three operations bail out past the canvas ceiling. They return falsy rather
  // than throwing, which is fine — but the UI mapped every falsy patternFill to
  // "Layer is locked" (patternFill checks the ceiling *before* the lock, so the
  // message named a lock that did not exist), and printed "Perspective crop
  // applied" without consulting the result at all. A refusal read as a
  // completed edit. These assertions pin the contract those messages rely on.
  const studio = new Studio(BIG.width, BIG.height, newCanvas(8, 8));
  const layer = studio.addBlankRaster("big");
  assert.ok(exceedsBrowserCanvas(studio.doc.width, studio.doc.height), "precondition: past the ceiling");
  assert.ok(!layer.locked, "precondition: the layer is not locked, so 'locked' would be the wrong reason");
  // The mechanism, so this does not read as a claim about the explicit ceiling
  // check in patternFill: past the ceiling a raster layer holds a tile surface
  // and no bitmap, and every one of these refuses a layer without a bitmap.
  // patternFill's own exceedsBrowserCanvas guard is therefore belt-and-braces,
  // not the thing doing the work.
  assert.equal(layer.bitmap, undefined, "a layer this size has no canvas to fill");

  assert.equal(studio.patternFill(layer.id, "dots", "#fff", "#000", 16), false);
  assert.equal(studio.perspectiveCrop([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] as never), null);
  assert.equal(studio.perspectiveWarpLayer(layer.id, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] as never), false);
  studio.dispose();
});

test("the studio page reports a perspective refusal instead of claiming success", () => {
  // A source assertion because the branch lives inside the pointer handler of a
  // component this suite cannot mount. The bug was structural: the notify call
  // did not depend on the return value, so no message could ever be wrong.
  const page = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  const handler = page.slice(page.indexOf("if (quadTool) {"));
  assert.match(handler.slice(0, 1400), /perspectiveCrop\([^)]*\) !== null/, "the crop result must be consulted");
  assert.match(handler.slice(0, 1400), /if \(applied\) notify/, "success must be conditional on it");
});
