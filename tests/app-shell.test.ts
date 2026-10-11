import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

function jpegDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint16(0), 0xffd8);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = view.getUint16(offset + 2);
    assert.ok(length >= 2, "JPEG segment length must be valid");
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions were not found");
}

test("the studio page composes the seven structural shell regions", () => {
  const source = readFileSync(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8");
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

test("document title and save names come from the engine, not a second UI identity", () => {
  const source = readFileSync(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /customName|setCustomName/);
  assert.match(source, /const projectName = openDocuments\.find\(document => document\.active\)\?\.name/);
  assert.match(source, /const saveName = nameOverride \?\? studio\.activeDocumentState\(\)\.name/);
  assert.match(source, /studio\.importPsd\(photoshopBytes, file\.name\.replace/);
});

test("WebKit workspace gestures suppress page selection but preserve editable fields", () => {
  const css = readFileSync(new URL("../app/studio/workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.spatial-studio \{ -webkit-user-select: none; user-select: none; \}/);
  assert.match(css, /:is\(input, textarea, \[contenteditable="true"\]\) \{ -webkit-user-select: text; user-select: text; \}/);
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

test("reviewed shell matrix contains seven states at each viewport with real PNG references", () => {
  const matrix = JSON.parse(readFileSync(new URL("./visual-regression/shell-matrix.json", import.meta.url), "utf8"));
  assert.equal(matrix.references.length, 21);
  assert.equal(new Set(matrix.references.map((r: { state: string }) => r.state)).size, 7);
  const keys = new Set<string>();
  for (const reference of matrix.references) {
    const key = `${reference.state}-${reference.width}x${reference.height}`;
    assert.ok(!keys.has(key)); keys.add(key);
    const png = readFileSync(new URL(`./visual-regression/${reference.file}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const dimensions = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.equal(dimensions.getUint32(16), reference.width);
    assert.equal(dimensions.getUint32(20), reference.height);
    assert.ok(png.length > 20_000);
  }
});
