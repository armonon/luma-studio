import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import JSZip from "jszip";
import { createDocument, createTextLayer } from "../app/engine/document.ts";
import { encodeLumaProject, decodeLumaProject } from "../app/engine/project.ts";
import { buildOtf } from "../app/engine/glyph-font.ts";
import { createGlyphProject, type GlyphProject } from "../app/engine/glyph-font.ts";
import { getUserFontBytes, installUserFont, isUserFontFamily, removeUserFont } from "../app/engine/user-fonts.ts";

// Project saves/opens run in a real browser (localStorage + IndexedDB). Node
// has neither by default; fake-indexeddb covers the DB, and this tiny
// in-memory Storage covers the family index user-fonts.ts keeps there.
class MemoryStorage {
  #map = new Map<string, string>();
  getItem(key: string) { return this.#map.has(key) ? this.#map.get(key)! : null; }
  setItem(key: string, value: string) { this.#map.set(key, String(value)); }
  removeItem(key: string) { this.#map.delete(key); }
  clear() { this.#map.clear(); }
  key(index: number) { return [...this.#map.keys()][index] ?? null; }
  get length() { return this.#map.size; }
}
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
}

function oneStrokeGlyphProject(name: string): GlyphProject {
  const project = createGlyphProject(name);
  project.glyphs.I = { advanceWidth: 300, strokes: [{ kind: "brush", points: [[150, 0], [150, 700]], width: 80 }] };
  return project;
}

function textDocument(family: string) {
  const doc = createDocument(200, 100);
  doc.layers = [createTextLayer("Caption", {
    text: "I",
    font: "48px sans-serif",
    color: "#000000",
    align: "left",
    lineHeight: 1.2,
    x: 10,
    y: 50,
    defaultStyle: { fontFamily: family },
  })];
  return doc;
}

test("saving a project embeds the installed Glyph font its text layers use", async () => {
  const bytes = buildOtf(oneStrokeGlyphProject("Embed Test Hand"));
  await installUserFont("Embed Test Hand", bytes);
  try {
    const doc = textDocument("Embed Test Hand");
    const project = await encodeLumaProject(doc, [], "Font embed test");
    const zip = await JSZip.loadAsync(await project.arrayBuffer());

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    assert.deepEqual(manifest.fonts, [{ family: "Embed Test Hand", asset: "fonts/1.font" }]);

    const embedded = await zip.file("fonts/1.font")!.async("arraybuffer");
    assert.deepEqual(new Uint8Array(embedded), new Uint8Array(bytes), "embedded bytes must match the installed font exactly");
  } finally {
    await removeUserFont("Embed Test Hand");
  }
});

test("a document that uses no installed Glyph font embeds nothing", async () => {
  const doc = textDocument("Inter, system-ui, sans-serif"); // a bundled family, never installed
  const project = await encodeLumaProject(doc, [], "No embed test");
  const zip = await JSZip.loadAsync(await project.arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.fonts, undefined);
  assert.equal(zip.file("fonts/1.font"), null);
});

test("opening a project reinstalls its embedded font on a browser that never had it", async () => {
  const bytes = buildOtf(oneStrokeGlyphProject("Reopen Test Hand"));
  await installUserFont("Reopen Test Hand", bytes);
  const doc = textDocument("Reopen Test Hand");
  const project = await encodeLumaProject(doc, [], "Font reopen test");

  // Simulate a different machine/browser profile: this font was never installed here.
  await removeUserFont("Reopen Test Hand");
  assert.equal(isUserFontFamily("Reopen Test Hand"), false);
  assert.equal(await getUserFontBytes("Reopen Test Hand"), undefined);

  const reopened = await decodeLumaProject(project);
  assert.equal(reopened.doc.layers[0].text?.defaultStyle?.fontFamily, "Reopen Test Hand");
  assert.equal(isUserFontFamily("Reopen Test Hand"), true, "the embedded font must now be installed");
  const restored = await getUserFontBytes("Reopen Test Hand");
  assert.ok(restored);
  assert.deepEqual(new Uint8Array(restored!), new Uint8Array(bytes));
  await removeUserFont("Reopen Test Hand");
});

test("opening a project never overwrites a font this browser already has under that name", async () => {
  const embeddedBytes = buildOtf(oneStrokeGlyphProject("Shared Name Hand"));
  await installUserFont("Shared Name Hand", embeddedBytes);
  const doc = textDocument("Shared Name Hand");
  const project = await encodeLumaProject(doc, [], "Font no-clobber test");

  // This browser already has its own, different font under the same family name.
  const localBytes = buildOtf(oneStrokeGlyphProject("Shared Name Hand (local)"));
  await installUserFont("Shared Name Hand", localBytes);

  await decodeLumaProject(project);
  const stillLocal = await getUserFontBytes("Shared Name Hand");
  assert.deepEqual(new Uint8Array(stillLocal!), new Uint8Array(localBytes), "the local font must not be replaced by the archive's copy");
  await removeUserFont("Shared Name Hand");
});

test("a malformed embedded-font manifest entry is rejected, not silently installed", async () => {
  const bytes = buildOtf(oneStrokeGlyphProject("Malformed Test Hand"));
  await installUserFont("Malformed Test Hand", bytes);
  try {
    const doc = textDocument("Malformed Test Hand");
    const project = await encodeLumaProject(doc, [], "Malformed font test");
    const zip = await JSZip.loadAsync(await project.arrayBuffer());
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    manifest.fonts = [{ family: "../../etc/passwd", asset: "fonts/1.font" }];
    zip.file("manifest.json", JSON.stringify(manifest));
    const tampered = await zip.generateAsync({ type: "arraybuffer" });
    await assert.rejects(decodeLumaProject(tampered), /malformed embedded font entry/);
  } finally {
    await removeUserFont("Malformed Test Hand");
  }
});
