import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAndParseEmbeddedColorProfile,
  extractEmbeddedColorProfile,
} from "../app/engine/embedded-color-profile.ts";
import { matrixTrcIcc } from "./icc-fixture.ts";

function concat(parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(value: string) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function jpegIccSegment(part: Uint8Array, sequence: number, count: number) {
  const payload = concat([ascii("ICC_PROFILE\0"), Uint8Array.of(sequence, count), part]);
  const length = payload.length + 2;
  return concat([Uint8Array.of(0xff, 0xe2, length >> 8, length & 0xff), payload]);
}

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function u32le(value: number) {
  return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24);
}

async function deflate(bytes: Uint8Array) {
  const input = new ArrayBuffer(bytes.length);
  new Uint8Array(input).set(bytes);
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

test("reassembles out-of-order JPEG ICC_PROFILE APP2 segments", async () => {
  const profile = matrixTrcIcc();
  const middle = Math.floor(profile.length / 2);
  const jpeg = concat([
    Uint8Array.of(0xff, 0xd8),
    jpegIccSegment(profile.slice(middle), 2, 2),
    jpegIccSegment(profile.slice(0, middle), 1, 2),
    Uint8Array.of(0xff, 0xd9),
  ]);
  const result = await extractAndParseEmbeddedColorProfile(jpeg);
  assert.equal(result.extraction.container, "jpeg");
  assert.equal(result.extraction.chunks, 2);
  assert.deepEqual(result.extraction.bytes, profile);
  assert.equal(result.profile?.name, "Synthetic sRGB matrix profile");
  assert.equal(result.parseError, null);
});

test("inflates and parses a PNG iCCP profile", async () => {
  const profile = matrixTrcIcc();
  const compressed = await deflate(profile);
  const chunkData = concat([ascii("Studio RGB"), Uint8Array.of(0, 0), compressed]);
  const png = concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    u32be(chunkData.length), ascii("iCCP"), chunkData, new Uint8Array(4),
    u32be(0), ascii("IEND"), new Uint8Array(4),
  ]);
  const result = await extractAndParseEmbeddedColorProfile(png);
  assert.equal(result.extraction.profileName, "Studio RGB");
  assert.deepEqual(result.extraction.bytes, profile);
  assert.equal(result.profile?.capabilities.canTransform, true);
});

test("extracts a WebP ICCP chunk and reports absent profiles explicitly", async () => {
  const profile = matrixTrcIcc();
  const padding = profile.length & 1 ? Uint8Array.of(0) : new Uint8Array();
  const body = concat([ascii("WEBP"), ascii("ICCP"), u32le(profile.length), profile, padding]);
  const webp = concat([ascii("RIFF"), u32le(body.length), body]);
  const result = await extractEmbeddedColorProfile(webp);
  assert.equal(result.container, "webp");
  assert.deepEqual(result.bytes, profile);

  const absent = await extractEmbeddedColorProfile(Uint8Array.of(1, 2, 3));
  assert.equal(absent.container, "unknown");
  assert.equal(absent.capability.embeddedProfileFound, false);
  assert.match(absent.capability.fallbackReason!, /supported JPEG, PNG, or WebP/);
});

test("does not return a partial JPEG profile when a segment is missing", async () => {
  const profile = matrixTrcIcc();
  const jpeg = concat([
    Uint8Array.of(0xff, 0xd8),
    jpegIccSegment(profile.slice(0, 100), 1, 2),
    Uint8Array.of(0xff, 0xd9),
  ]);
  const result = await extractEmbeddedColorProfile(jpeg);
  assert.equal(result.bytes, null);
  assert.equal(result.capability.embeddedProfileFound, true);
  assert.equal(result.capability.decoded, false);
  assert.match(result.capability.fallbackReason!, /incomplete/);
});
