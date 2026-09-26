import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createCmykPrintPdf, convertPrintPixels, encodePrintRequest, validatePrinterProfile, type PrintOptions } from "../app/engine/print-output.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";

// Structural fixture only: native tests use a real system CMYK printer profile.
function options(): PrintOptions {
  const profile = new Uint8Array(132), view = new DataView(profile.buffer);
  view.setUint32(0, profile.length);
  for (const [at, value] of [[12, "prtr"], [16, "CMYK"], [20, "XYZ "], [36, "acsp"]] as const) profile.set(new TextEncoder().encode(value), at);
  return { profile, profileName: "Test printer", intent: "relative-colorimetric", blackPointCompensation: true, trimInsetMm: 0 };
}

test("print binary protocol preserves exact profile and pixels; rejects geometry/profile/intent errors", () => {
  const config = options(), rgb = new Uint8Array([255, 0, 128]);
  const bytes = encodePrintRequest(1, 1, rgb, config), view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "LCP1");
  assert.deepEqual([4, 8, 12, 16, 20].map(at => view.getUint32(at)), [1, 1, 1, 1, 132]);
  assert.deepEqual(bytes.subarray(24, 156), config.profile);
  assert.deepEqual(bytes.subarray(156), rgb);
  assert.throws(() => encodePrintRequest(50_000, 50_000, rgb, config), /4 megapixels/);
  assert.throws(() => encodePrintRequest(1, 1, rgb, { ...config, intent: "absolute-colorimetric" }), /intent/);
  assert.throws(() => validatePrinterProfile(new Uint8Array(132)), /printer/);
  new DataView(config.profile.buffer).setUint32(128, 4097);
  assert.throws(() => validatePrinterProfile(config.profile), /tag table/);
});

test("CMYK response length is validated and native failures are never replaced by generic conversion", async () => {
  await assert.rejects(convertPrintPixels(1, 1, new Uint8Array(3), options(), async () => new Uint8Array(3) as never), /invalid pixel/);
  await assert.rejects(convertPrintPixels(1, 1, new Uint8Array(3), options(), async () => { throw new Error("ICC failure"); }), /ICC failure/);
});

test("print PDF reopens with exact CMYK bytes, embedded ICC, physical size and explicit boxes", async () => {
  const config = options(), pixels = new Uint8Array([0, 255, 255, 0, 0, 0, 0, 255]);
  const blob = await createCmykPrintPdf(2, 1, 72, pixels, config);
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  assert.equal(pdf.getPageCount(), 1);
  const page = pdf.getPages()[0];
  assert.deepEqual(page.getSize(), { width: 2, height: 1 });
  assert.ok(page.node.has(PDFName.of("TrimBox"))); assert.ok(page.node.has(PDFName.of("BleedBox")));
  const intents = pdf.catalog.lookup(PDFName.of("OutputIntents"), PDFArray);
  const profile = intents.lookup(0, PDFDict).lookup(PDFName.of("DestOutputProfile"));
  assert.ok(profile instanceof PDFRawStream);
  assert.equal(profile.dict.lookup(PDFName.of("N"), PDFNumber).asNumber(), 4);
  assert.deepEqual(decodePDFRawStream(profile).decode(), config.profile);
  const resources = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  const image = resources.lookup(resources.keys()[0]);
  assert.ok(image instanceof PDFRawStream);
  assert.deepEqual(decodePDFRawStream(image).decode(), pixels);
  assert.equal(image.dict.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber(), 8);
  assert.match(pdf.getSubject()!, /Not certified PDF\/X/);
  await assert.rejects(createCmykPrintPdf(2, 1, 72, pixels, { ...config, trimInsetMm: 3 }), /Trim inset/);
  await assert.rejects(createCmykPrintPdf(2, 1, NaN, pixels, config), /resolution/);
});

test("print export owns its profile and refuses results after a document switch", async () => {
  const studio = new Studio(2, 1, testCanvas(2, 1)), global = globalThis as unknown as Record<string, unknown>;
  const previous = global.window;
  try {
    studio.addBlankRaster("Source");
    const config = options(), original = config.profile.slice();
    global.window = { __TAURI__: { core: { invoke: async () => {
      config.profile.fill(0); // Caller mutation must not corrupt the embedded profile.
      return new Uint8Array(8);
    } } } };
    const result = await studio.exportPrintPdf(config);
    const pdf = await PDFDocument.load(await result.arrayBuffer());
    const profile = pdf.catalog.lookup(PDFName.of("OutputIntents"), PDFArray).lookup(0, PDFDict).lookup(PDFName.of("DestOutputProfile"));
    assert.ok(profile instanceof PDFRawStream);
    assert.deepEqual(decodePDFRawStream(profile).decode(), original);
    global.window = { __TAURI__: { core: { invoke: async () => {
      studio.resetDocument(2, 1, "Other");
      return new Uint8Array(8);
    } } } };
    await assert.rejects(studio.exportPrintPdf(options()), /document changed/);
    assert.equal(studio.activeDocumentState().name, "Other");
  } finally { studio.dispose(); if (previous === undefined) delete global.window; else global.window = previous; }
});
