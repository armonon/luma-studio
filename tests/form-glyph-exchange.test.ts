import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTextLayer } from "../app/engine/document.ts";
import { formTextAssetWithOutlines, parseFormTextAsset, serializeFormTextAsset } from "../app/engine/form-studio-bridge.ts";
import { shapeTextOutlines } from "../app/engine/text-shaping.ts";
import { validateFormTextOutlines } from "../app/engine/form-text-outlines.ts";

test("Form exchange includes validated glyphs and rejects stale, open or oversized contours", async () => {
  const layer = createTextLayer("Glyphs", { text: "Office", font: '400 96px "Lato"', color: "#ffffff", align: "left", lineHeight: 1.1, x: 0, y: 100 });
  const bytes = readFileSync(new URL("../public/fonts/Lato-Regular.ttf", import.meta.url));
  const asset = await formTextAssetWithOutlines(layer, text => shapeTextOutlines(text, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  const reopened = parseFormTextAsset(serializeFormTextAsset(asset));
  assert.equal(JSON.stringify(reopened.geometry), JSON.stringify(asset.geometry));
  const stale = structuredClone(asset); stale.typography.text = "Changed";
  assert.throws(() => parseFormTextAsset(JSON.stringify(stale)), /stale/);
  const bad = structuredClone(asset.geometry!);
  bad.paths = [{ commands: [{ type: "L", x: 0, y: 0 }] }];
  assert.throws(() => validateFormTextOutlines(bad, asset.typography), /Invalid/);
  bad.paths = [{ commands: [{ type: "M", x: 0, y: 0 }] }];
  assert.throws(() => validateFormTextOutlines(bad, asset.typography), /Invalid/);
  bad.paths = Array.from({ length: 1281 }, () => ({ commands: [] }));
  assert.throws(() => validateFormTextOutlines(bad, asset.typography), /Invalid/);
});
