import assert from "node:assert/strict";
import test from "node:test";
import {
  demosaicBayer,
  developCameraRgb,
  invertMatrix3,
  normalizeSensorMosaic,
  recoverClippedHighlights,
  sanitizeRawDevelopSettings,
  whiteBalanceMultipliers,
} from "../app/engine/raw-develop.ts";
import { DngDevelopSession, decodeDng, orientLinearRgba, parseDng, previewDisplayRgba } from "../app/engine/raw-dng.ts";
import { ingestRaw } from "../app/engine/raw.ts";
import { developedDngToSurface } from "../app/engine/raw-surface.ts";

type FixtureOptions = { bits?: 8 | 10 | 12 | 14 | 16; compression?: number; tiled?: boolean; bigTiff?: boolean };

const TYPE_SIZE: Record<number, number> = { 1: 1, 3: 2, 4: 4, 5: 8, 10: 8 };

function packRow(values: readonly number[], bits: number, littleEndian: boolean) {
  if (bits === 8) return Uint8Array.from(values);
  if (bits === 16) {
    const output = new Uint8Array(values.length * 2);
    const view = new DataView(output.buffer);
    values.forEach((value, index) => view.setUint16(index * 2, value, littleEndian));
    return output;
  }
  const output = new Uint8Array(Math.ceil(values.length * bits / 8));
  values.forEach((value, index) => {
    for (let bit = 0; bit < bits; bit += 1) {
      const absolute = index * bits + bit;
      const set = (value >> (bits - 1 - bit)) & 1;
      output[Math.floor(absolute / 8)] |= set << (7 - absolute % 8);
    }
  });
  return output;
}

function constantLosslessJpeg(width: number, height: number, precision: number) {
  const segment = (marker: number, data: number[]) => [0xff, marker, (data.length + 2) >>> 8, (data.length + 2) & 0xff, ...data];
  const sof = [precision, height >>> 8, height & 0xff, width >>> 8, width & 0xff, 1, 1, 0x11, 0];
  const counts = [1, ...new Array(15).fill(0)];
  const dht = [0, ...counts, 0]; // DC table 0: category zero has the one-bit code 0.
  const sos = [1, 1, 0, 1, 0, 0];
  const entropy: number[] = [];
  let byte = 0;
  let bits = 0;
  for (let sample = 0; sample < width * height; sample += 1) {
    byte <<= 1;
    bits += 1;
    if (bits === 8) { entropy.push(byte); byte = 0; bits = 0; }
  }
  if (bits) entropy.push((byte << (8 - bits)) | ((1 << (8 - bits)) - 1));
  return Uint8Array.from([0xff, 0xd8, ...segment(0xc3, sof), ...segment(0xc4, dht), ...segment(0xda, sos), ...entropy, 0xff, 0xd9]);
}

function syntheticDng(options: FixtureOptions = {}) {
  const width = 6;
  const height = 6;
  const bits = options.bits ?? 16;
  const littleEndian = true;
  const max = bits === 16 ? 4095 : (2 ** bits) - 1;
  const channelCodes = bits === 8 ? [200, 160, 128] : [512, 320, 256];
  let sensor = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const site = [0, 1, 1, 2][(y % 2) * 2 + (x % 2)];
    return channelCodes[site];
  });
  const rows = Array.from({ length: height }, (_, row) => packRow(sensor.slice(row * width, (row + 1) * width), bits, littleEndian));
  let pixelBytes = new Uint8Array(rows.reduce((sum, row) => sum + row.length, 0));
  let rowOffset = 0;
  for (const row of rows) { pixelBytes.set(row, rowOffset); rowOffset += row.length; }
  if (options.compression === 7) {
    pixelBytes = constantLosslessJpeg(width, height, bits);
    sensor = new Array(width * height).fill(1 << (bits - 1));
  }

  type Entry = { tag: number; type: number; values: number[] };
  const entries: Entry[] = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: [bits] },
    { tag: 259, type: 3, values: [options.compression ?? 1] },
    { tag: 262, type: 3, values: [32803] },
    { tag: 274, type: 3, values: [1] },
    { tag: 277, type: 3, values: [1] },
    { tag: 284, type: 3, values: [1] },
    { tag: 33421, type: 3, values: [2, 2] },
    { tag: 33422, type: 1, values: [0, 1, 1, 2] },
    { tag: 50706, type: 1, values: [1, 4, 0, 0] },
    { tag: 50710, type: 1, values: [0, 1, 2] },
    { tag: 50713, type: 3, values: [2, 2] },
    { tag: 50714, type: 4, values: [64, 64, 64, 64] },
    { tag: 50717, type: 4, values: [max] },
    { tag: 50728, type: 5, values: [0.5, 1, 2 / 3] },
    { tag: 50730, type: 10, values: [0.5] },
    { tag: 50964, type: 10, values: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
  ];
  if (options.tiled) {
    entries.push({ tag: 322, type: 4, values: [width] }, { tag: 323, type: 4, values: [height] });
    entries.push({ tag: 324, type: 4, values: [0] }, { tag: 325, type: 4, values: [pixelBytes.length] });
  } else {
    entries.push({ tag: 273, type: 4, values: [0] }, { tag: 278, type: 4, values: [height] }, { tag: 279, type: 4, values: [pixelBytes.length] });
  }
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = options.bigTiff ? 16 : 8;
  const countBytes = options.bigTiff ? 8 : 2;
  const entryBytes = options.bigTiff ? 20 : 12;
  const nextBytes = options.bigTiff ? 8 : 4;
  const inlineBytes = options.bigTiff ? 8 : 4;
  const ifdSize = countBytes + entries.length * entryBytes + nextBytes;
  let dataOffset = ifdOffset + ifdSize;
  const external = new Map<Entry, number>();
  for (const entry of entries) {
    const byteLength = TYPE_SIZE[entry.type] * entry.values.length;
    if (byteLength > inlineBytes) { external.set(entry, dataOffset); dataOffset += byteLength; }
  }
  const pixelsAt = dataOffset;
  const pointer = entries.find((entry) => entry.tag === (options.tiled ? 324 : 273))!;
  pointer.values[0] = pixelsAt;
  const output = new ArrayBuffer(pixelsAt + pixelBytes.length);
  const view = new DataView(output);
  view.setUint8(0, 0x49); view.setUint8(1, 0x49);
  if (options.bigTiff) {
    view.setUint16(2, 43, true);
    view.setUint16(4, 8, true);
    view.setUint16(6, 0, true);
    view.setBigUint64(8, BigInt(ifdOffset), true);
    view.setBigUint64(ifdOffset, BigInt(entries.length), true);
  } else {
    view.setUint16(2, 42, true); view.setUint32(4, ifdOffset, true);
    view.setUint16(ifdOffset, entries.length, true);
  }

  const writeValues = (entry: Entry, offset: number) => {
    entry.values.forEach((value, index) => {
      const at = offset + TYPE_SIZE[entry.type] * index;
      if (entry.type === 1) view.setUint8(at, value);
      else if (entry.type === 3) view.setUint16(at, value, true);
      else if (entry.type === 4) view.setUint32(at, value, true);
      else {
        const denominator = 1_000_000;
        const numerator = Math.round(value * denominator);
        if (entry.type === 5) {
          view.setUint32(at, numerator, true); view.setUint32(at + 4, denominator, true);
        } else {
          view.setInt32(at, numerator, true); view.setInt32(at + 4, denominator, true);
        }
      }
    });
  };
  entries.forEach((entry, index) => {
    const at = ifdOffset + countBytes + index * entryBytes;
    view.setUint16(at, entry.tag, true); view.setUint16(at + 2, entry.type, true);
    if (options.bigTiff) view.setBigUint64(at + 4, BigInt(entry.values.length), true);
    else view.setUint32(at + 4, entry.values.length, true);
    const externalOffset = external.get(entry);
    const valueAt = at + (options.bigTiff ? 12 : 8);
    if (externalOffset === undefined) writeValues(entry, valueAt);
    else {
      if (options.bigTiff) view.setBigUint64(valueAt, BigInt(externalOffset), true);
      else view.setUint32(valueAt, externalOffset, true);
      writeValues(entry, externalOffset);
    }
  });
  const nextAt = ifdOffset + countBytes + entries.length * entryBytes;
  if (options.bigTiff) view.setBigUint64(nextAt, BigInt(0), true);
  else view.setUint32(nextAt, 0, true);
  new Uint8Array(output).set(pixelBytes, pixelsAt);
  return { output, sensor, width, height };
}

test("sensor normalization applies repeat black levels and horizontal/vertical deltas", () => {
  const normalized = normalizeSensorMosaic([20, 30, 40, 50], {
    width: 2,
    height: 2,
    blackLevel: [10, 20, 30, 40],
    blackLevelRepeatDim: [2, 2],
    blackLevelDeltaH: [1, 2],
    blackLevelDeltaV: [0, 1],
    whiteLevel: [111, 122, 133, 144],
  });
  const expected = [0.09, 0.08, 8 / 101, 7 / 101];
  normalized.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6));
});

test("edge-directed Bayer demosaic preserves flat per-channel fields at image borders", () => {
  const width = 8;
  const height = 8;
  const pattern = [0, 1, 1, 2] as const;
  const mosaic = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    mosaic[y * width + x] = [0.8, 0.4, 0.2][pattern[(y % 2) * 2 + (x % 2)]];
  }
  const rgb = demosaicBayer(mosaic, width, height, pattern);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    assert.ok(Math.abs(rgb[pixel * 3] - 0.8) < 1e-6);
    assert.ok(Math.abs(rgb[pixel * 3 + 1] - 0.4) < 1e-6);
    assert.ok(Math.abs(rgb[pixel * 3 + 2] - 0.2) < 1e-6);
  }
});

test("white balance, exposure, and highlight recovery are non-destructive settings", () => {
  assert.deepEqual(whiteBalanceMultipliers("as-shot", [0.5, 1, 2 / 3], [1, 1, 1]), [2, 1, 1.5]);
  const source = new Float32Array([0.25, 0.5, 1 / 3]);
  const original = Array.from(source);
  const developed = developCameraRgb(source, { whiteBalance: "as-shot", exposureEV: 1, highlightRecovery: 0 }, { asShotNeutral: [0.5, 1, 2 / 3] });
  assert.deepEqual(Array.from(developed.pixels).map((value) => Math.round(value * 1000) / 1000), [1, 1, 1, 1]);
  assert.deepEqual(Array.from(source), original);
  assert.equal(sanitizeRawDevelopSettings({ exposureEV: 99, highlightRecovery: -1 }).exposureEV, 10);
});

test("highlight recovery reconstructs isolated clipped-channel chroma from local ratios", () => {
  const width = 5;
  const height = 5;
  const camera = new Float32Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) camera.set([0.8, 0.2, 0.1], pixel * 3);
  const center = 12 * 3;
  camera.set([1, 0.5, 0.1], center);
  const recovered = recoverClippedHighlights(camera, width, height, 1);
  assert.ok(Math.abs(recovered[center] - 2) < 1e-6);
  assert.equal(camera[center], 1, "sensor-derived camera RGB must remain immutable");
});

test("matrix inversion is guarded and numerically stable", () => {
  assert.equal(invertMatrix3([1, 2, 3, 2, 4, 6, 0, 0, 0]), null);
  const inverse = invertMatrix3([2, 0, 0, 0, 4, 0, 0, 0, 5])!;
  assert.deepEqual(inverse, [0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.2]);
});

test("EXIF orientation rotates linear pixels without quantization", () => {
  const source = new Float32Array([
    1, 0, 0, 1,
    0, 1, 0, 1,
    0, 0, 1, 1,
    1, 1, 1, 1,
    0.5, 0.5, 0.5, 1,
    0, 0, 0, 1,
  ]);
  const rotated = orientLinearRgba(source, 3, 2, 6);
  assert.equal(rotated.width, 2);
  assert.equal(rotated.height, 3);
  assert.deepEqual(Array.from(rotated.pixels.slice(0, 4)), [1, 1, 1, 1]);
  assert.deepEqual(Array.from(rotated.pixels.slice(-4)), [0, 0, 1, 1]);
});

for (const bits of [8, 10, 12, 14, 16] as const) {
  test(`classic TIFF DNG parser decodes uncompressed ${bits}-bit Bayer strips`, () => {
    const fixture = syntheticDng({ bits });
    const parsed = parseDng(fixture.output);
    assert.equal(parsed.metadata.bitsPerSample, bits);
    assert.equal(parsed.metadata.dngVersion, "1.4.0.0");
    assert.deepEqual(parsed.metadata.cfaPattern, [0, 1, 1, 2]);
    assert.deepEqual(Array.from(parsed.sensorSamples), fixture.sensor);
  });
}

test("DNG parser decodes uncompressed tiled CFA storage", () => {
  const fixture = syntheticDng({ bits: 12, tiled: true });
  assert.deepEqual(Array.from(parseDng(fixture.output).sensorSamples), fixture.sensor);
});

test("BigTIFF DNG parser accepts 64-bit directory counts and offsets", () => {
  const fixture = syntheticDng({ bits: 12, bigTiff: true });
  const parsed = parseDng(fixture.output);
  assert.equal(parsed.container, "bigtiff");
  assert.deepEqual(Array.from(parsed.sensorSamples), fixture.sensor);
  assert.equal(decodeDng(fixture.output, "fixture.dng").provenance.boundary, "bigtiff-uncompressed-bayer");
});

test("complete DNG develop returns linear float pixels and reproducible provenance", () => {
  const fixture = syntheticDng({ bits: 12 });
  const result = decodeDng(fixture.output, "fixture.dng", { workingSpace: "display-p3", highlightRecovery: 0 });
  assert.equal(result.pixels.length, fixture.width * fixture.height * 4);
  assert.equal(result.settings.exposureEV, 0.5);
  assert.equal(result.provenance.mode, "dng-cfa-developed");
  assert.equal(result.provenance.boundary, "classic-tiff-uncompressed-bayer");
  assert.equal(result.provenance.settings.workingSpace, "display-p3");
  assert.equal(previewDisplayRgba(result).length, fixture.width * fixture.height * 4);
});

test("developed RAW moves into precision tiles without an 8-bit canvas round trip", () => {
  const fixture = syntheticDng({ bits: 12 });
  const result = decodeDng(fixture.output, "fixture.dng", { exposureEV: 3, highlightRecovery: 0 });
  const surface = developedDngToSurface(result, "rgba32f", 16);
  assert.equal(surface.format, "rgba32f");
  assert.equal(surface.colorSpace, "srgb");
  const source = Array.from(result.pixels.slice(0, 4));
  const stored = surface.readPixel(0, 0);
  stored.forEach((value, channel) => assert.ok(Math.abs(value - source[channel]) < 1e-7));
  assert.ok(stored.some((value, channel) => channel < 3 && value > 1), "HDR headroom should remain above one");
});

test("DNG develop sessions re-render settings while retaining immutable sensor codes", () => {
  const fixture = syntheticDng({ bits: 12 });
  const session = new DngDevelopSession(fixture.output, "fixture.dng", { highlightRecovery: 0 });
  const originalCodes = Array.from(session.parsed.sensorSamples);
  const first = session.develop({ exposureEV: 0 });
  const second = session.develop({ exposureEV: 1 });
  const channel = [0, 1, 2].find((candidate) => first.pixels[candidate] > 0)!;
  assert.ok(Math.abs(second.pixels[channel] / first.pixels[channel] - 2) < 1e-6);
  assert.deepEqual(Array.from(session.parsed.sensorSamples), originalCodes);
  assert.equal(session.currentSettings.exposureEV, 1);
  assert.equal(session.reset().settings.exposureEV, 0.5);
});

test("lossless-JPEG DNG develops its CFA samples locally", () => {
  const fixture = syntheticDng({ compression: 7 });
  const parsed = parseDng(fixture.output);
  assert.deepEqual(Array.from(parsed.sensorSamples), fixture.sensor);
  assert.equal(parsed.metadata.compression, 7);
  assert.equal(decodeDng(fixture.output, "compressed.dng").provenance.boundary, "tiff-lossless-jpeg-bayer");
});

test("standards-based TIFF CFA camera RAWs use the float sensor pipeline when compatible", () => {
  const fixture = syntheticDng({ compression: 1 });
  const result = ingestRaw(fixture.output, "compatible.nef");
  assert.equal(result.kind, "developed-raw");
  if (result.kind === "developed-raw") {
    assert.equal(result.developed.provenance.format, "NEF");
    assert.equal(result.developed.provenance.mode, "camera-raw-developed");
    assert.equal(result.developed.provenance.decoder, "luma-camera-tiff-v1");
    assert.ok(result.developed.metadata.warnings.some((warning) => warning.includes("TIFF CFA compatibility")));
    assert.equal(result.developed.pixels.length, result.developed.width * result.developed.height * 4);
  }
});

test("RAW ingestion falls back to an embedded preview and preserves typed decode failure", () => {
  const fixture = syntheticDng({ compression: 34892 });
  const jpeg = new Uint8Array(1400).fill(9);
  jpeg.set([0xff, 0xd8], 0);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  const combined = new Uint8Array(fixture.output.byteLength + jpeg.length);
  combined.set(new Uint8Array(fixture.output));
  combined.set(jpeg, fixture.output.byteLength);
  const result = ingestRaw(combined.buffer, "compressed.dng");
  assert.equal(result.kind, "embedded-preview");
  if (result.kind === "embedded-preview") {
    assert.equal(result.decodeFailure?.code, "unsupported-compression");
    assert.equal(result.preview.byteLength, jpeg.length);
  }
});
