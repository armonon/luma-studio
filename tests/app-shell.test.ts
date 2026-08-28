import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

function jpegDimensions(bytes: Buffer) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    assert.ok(length >= 2, "JPEG segment length must be valid");
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions were not found");
}

test("the studio page composes the seven structural shell regions", () => {
  const source = readFileSync(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  for (const region of [
    "AppShell", "MenuBarRegion", "ToolRailRegion", "DocumentAreaRegion",
    "DockRegion", "ContextualTaskBarRegion", "StatusBarRegion",
  ]) assert.match(source, new RegExp(`<${region}[\\s>]`));
  assert.match(source, /<DockManager/);
  assert.match(source, /createCommandRegistry/);
  assert.match(source, /TOOL_REGISTRY\[activeTool\]\.options/);
  for (const panelId of [
    "layers", "properties", "channels", "structure", "assets", "document", "selection", "mask",
    "raw", "curves", "levels", "hsl", "pro-adjustment", "tone", "paint", "vector", "transform",
    "measure", "neural", "actions", "history",
  ]) assert.match(source, new RegExp(`<DockPanelContent panelId=["']${panelId}["']`), `${panelId} must mount through DockManager`);
});

test("visual references cover the three release viewport floors", () => {
  const manifestUrl = new URL("./visual-regression/manifest.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
    references: Array<{ file: string; width: number; height: number }>;
  };
  assert.deepEqual(manifest.references.map(({ width, height }) => `${width}x${height}`), [
    "1920x1080", "1440x900", "1280x800",
  ]);
  for (const reference of manifest.references) {
    const url = new URL(`./visual-regression/${reference.file}`, import.meta.url);
    const jpeg = readFileSync(url);
    const dimensions = jpegDimensions(jpeg);
    assert.equal(dimensions.width, reference.width);
    assert.equal(dimensions.height, reference.height);
    assert.ok(statSync(url).size > 40_000, `${reference.file} should contain a real rendered workspace`);
  }
});
