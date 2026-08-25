import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafePhotoshopHeader,
  assertSafePhotoshopDecodeBudget,
  estimatePhotoshopDecodeBytes,
  assertSafeRasterHeader,
  inspectPhotoshopHeader,
  inspectRasterHeader,
} from "../app/engine/input-limits.ts";
import { exceedsBrowserCanvas } from "../app/engine/large-documents.ts";

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegHeader(width: number, height: number) {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  bytes[11] = 3;
  return bytes;
}

function littleEndianTiff(width: number, height: number) {
  const bytes = new Uint8Array(38);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, 8, true);
  view.setUint16(8, 2, true);
  view.setUint16(10, 256, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, width, true);
  view.setUint16(22, 257, true);
  view.setUint16(24, 4, true);
  view.setUint32(26, 1, true);
  view.setUint32(30, height, true);
  return bytes;
}

function photoshopHeader(width: number, height: number, version: 1 | 2 = 1) {
  const bytes = new Uint8Array(version === 1 ? 38 : 42);
  const view = new DataView(bytes.buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53], 0);
  view.setUint16(4, version, false);
  view.setUint16(12, 3, false);
  view.setUint32(14, height, false);
  view.setUint32(18, width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes;
}

test("bounded raster-header parsing finds dimensions before browser decode", () => {
  assert.deepEqual(inspectRasterHeader(pngHeader(640, 480)), { format: "png", width: 640, height: 480 });
  assert.deepEqual(inspectRasterHeader(jpegHeader(320, 200)), { format: "jpeg", width: 320, height: 200 });
  assert.deepEqual(inspectRasterHeader(littleEndianTiff(1024, 768)), { format: "tiff", width: 1024, height: 768 });
});

test("compressed raster bombs are refused before pixel allocation", () => {
  assert.throws(() => assertSafeRasterHeader(pngHeader(100_000, 100_000), "bomb.png", exceedsBrowserCanvas), /too large to decode/);
  assert.throws(() => assertSafeRasterHeader(pngHeader(0, 20), "broken.png", exceedsBrowserCanvas), /invalid image dimensions/);
  assert.throws(() => assertSafeRasterHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xc0]), "broken.jpg", exceedsBrowserCanvas), /JPEG dimensions/);
});

test("PSD and PSB headers are bounded before the codec sees them", () => {
  assert.deepEqual(inspectPhotoshopHeader(photoshopHeader(800, 600)), {
    container: "psd", channels: 3, width: 800, height: 600, depth: 8, colorMode: 3, layers: 0,
  });
  assert.equal(inspectPhotoshopHeader(photoshopHeader(1200, 900, 2)).container, "psb");
  assert.throws(() => assertSafePhotoshopHeader(photoshopHeader(100_000, 100_000), "huge.psb", exceedsBrowserCanvas), /safe PSD\/PSB import canvas/);
  const malformed = photoshopHeader(800, 600);
  new DataView(malformed.buffer).setUint32(26, 1000, false);
  assert.throws(() => inspectPhotoshopHeader(malformed), /Malformed Photoshop section length/);
});

test("layered Photoshop files are refused before their decoded planes cross the memory ceiling", () => {
  const locallyBounded = {
    container: "psd" as const,
    channels: 3,
    width: 3600,
    height: 3600,
    depth: 8,
    colorMode: 3,
    layers: 4,
  };
  assert.ok(estimatePhotoshopDecodeBytes(locallyBounded, 6 * 1024 * 1024) < 2 * 1024 * 1024 * 1024);
  assert.doesNotThrow(() => assertSafePhotoshopDecodeBudget(locallyBounded, 6 * 1024 * 1024));
  assert.throws(
    () => assertSafePhotoshopDecodeBudget({ ...locallyBounded, width: 4800, height: 6000, layers: 8 }, 64 * 1024 * 1024),
    /approximately .* safe import ceiling/i,
  );
});
