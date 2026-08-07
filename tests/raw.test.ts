import assert from "node:assert/strict";
import test from "node:test";
import {
  DNG_DECODED_EXTENSIONS,
  RAW_EXTENSIONS,
  extractEmbeddedRawPreview,
  rawExtension,
  supportsSensorDecode,
} from "../app/engine/raw.ts";

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

test("supportsSensorDecode is true only for DNG", () => {
  assert.equal(supportsSensorDecode("shot.dng"), true);
  assert.equal(supportsSensorDecode("SHOT.DNG"), true);
  for (const ext of ["cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef"]) {
    assert.equal(supportsSensorDecode(`shot.${ext}`), false, `${ext} must not claim sensor decode`);
  }
  assert.equal(supportsSensorDecode("shot.jpg"), false);
  assert.equal(supportsSensorDecode("noextension"), false);
});

test("every DNG_DECODED_EXTENSIONS entry is also a recognised RAW extension", () => {
  for (const ext of DNG_DECODED_EXTENSIONS) {
    assert.ok((RAW_EXTENSIONS as readonly string[]).includes(ext));
  }
});
