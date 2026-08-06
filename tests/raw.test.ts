import assert from "node:assert/strict";
import test from "node:test";
import { extractEmbeddedRawPreview, rawExtension } from "../app/engine/raw.ts";

test("RAW detection is explicit and case-insensitive", () => {
  assert.equal(rawExtension("capture.DNG"), "dng");
  assert.equal(rawExtension("capture.jpg"), null);
});

test("embedded preview extraction selects the largest complete JPEG", async () => {
  const bytes = new Uint8Array(5000).fill(7);
  bytes.set([0xff, 0xd8], 50);
  bytes.set([0xff, 0xd9], 1200);
  bytes.set([0xff, 0xd8], 1800);
  bytes.set([0xff, 0xd9], 4800);
  const preview = extractEmbeddedRawPreview(bytes.buffer, "camera.nef")!;
  assert.equal(preview.format, "NEF");
  assert.equal(preview.byteOffset, 1800);
  assert.equal(preview.byteLength, 3002);
  assert.equal(preview.blob.type, "image/jpeg");
  assert.deepEqual([...new Uint8Array(await preview.blob.arrayBuffer()).slice(0, 2)], [0xff, 0xd8]);
});
