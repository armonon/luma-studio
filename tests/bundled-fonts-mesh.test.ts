import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "opentype.js/dist/opentype.mjs";
import { BUNDLED_FONTS, bundledFontFace, bundledFontFile } from "../app/engine/bundled-fonts.ts";
import { createTextMesh, disposeTextMesh, shapesFromGlyphPath, updateTextMesh, validateMeshText } from "../app/engine/text-mesh.ts";
import { DEFAULT_TEXT_SPATIAL, withTextSpatial } from "../app/engine/text-3d.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import type { TextStyle } from "../app/engine/document.ts";

const bytesFor = (file: string) => {
  const bytes = readFileSync(new URL(`../public/fonts/${file}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const base: TextStyle = { text: "LUMA", font: '700 96px "Lato", sans-serif', color: "#ffffff", align: "left", lineHeight: 1.1, x: 0, y: 96 };

test("every bundled font and license is local, pinned and checksum-verified", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/fonts/manifest.json", import.meta.url), "utf8"));
  assert.equal(BUNDLED_FONTS.length, 14);
  for (const font of BUNDLED_FONTS) {
    assert.match(readFileSync(new URL(`../public/fonts/${font.slug}-OFL.txt`, import.meta.url), "utf8"), /SIL OPEN FONT LICENSE/);
    for (const face of font.faces) {
      const file = bundledFontFile(font.family, face);
      const bytes = bytesFor(file);
      const entry = manifest.files.find((item: { file: string }) => item.file === file);
      assert.equal(createHash("sha256").update(new Uint8Array(bytes)).digest("hex"), entry.sha256);
      assert.ok(parse(bytes).charToGlyphIndex("A") > 0, `${file} parses and has Latin outlines`);
    }
  }
  assert.ok(manifest.files.reduce((sum: number, item: { bytes: number }) => sum + item.bytes, 0) < 9 * 1024 * 1024);
});

test("font face selection uses actual bundled weights and italics", () => {
  assert.equal(bundledFontFace('"Lato", sans-serif', 700, true).face, "BoldItalic");
  assert.equal(bundledFontFace('"Rajdhani", sans-serif', 600).face, "SemiBold");
  assert.throws(() => bundledFontFace("Helvetica"), /bundled font/);
});

test("glyph mesh has real depth, counters, material groups and finite bounded vertices", () => {
  const font = parse(bytesFor("Lato-Bold.ttf"));
  const holes = shapesFromGlyphPath(font.getPath("O", 0, 0, 96));
  assert.ok(holes.some(shape => shape.holes.length > 0), "O must remain hollow");
  const mesh = createTextMesh(base, DEFAULT_TEXT_SPATIAL, font);
  try {
    mesh.geometry.computeBoundingBox();
    assert.ok(mesh.geometry.boundingBox!.max.z - mesh.geometry.boundingBox!.min.z >= 18);
    assert.ok(mesh.geometry.groups.some(group => group.materialIndex === 0));
    assert.ok(mesh.geometry.groups.some(group => group.materialIndex === 1));
    assert.ok(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite));
    const positions = mesh.geometry.getAttribute("position").array;
    const spatial = withTextSpatial(DEFAULT_TEXT_SPATIAL, { transform: { rotationY: 45 }, material: { metalness: 0.9, roughness: 0.2, frontColor: "#ffcc00" } });
    updateTextMesh(mesh, spatial);
    assert.equal(mesh.geometry.getAttribute("position").array, positions, "material/rotation does not rebuild geometry");
    assert.equal(mesh.material[0].roughness, 0.2);
    assert.equal(mesh.material[1].metalness, 0.9);
    assert.equal(mesh.material[0].color.getHexString(), "ffcc00");
    assert.ok(Math.abs(mesh.rotation.y - Math.PI / 4) < 1e-9);
  } finally { disposeTextMesh(mesh); }
});

test("all bundled families produce actual mesh geometry", () => {
  for (const entry of BUNDLED_FONTS) {
    const text = { ...base, font: `400 64px "${entry.family}", sans-serif` };
    const mesh = createTextMesh(text, DEFAULT_TEXT_SPATIAL, parse(bytesFor(bundledFontFace(entry.family).file)));
    assert.ok(mesh.geometry.getAttribute("position").count > 0, entry.family);
    disposeTextMesh(mesh);
  }
});

test("GLB export contains actual indexed mesh data and source metadata", async () => {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const previous = globalThis.FileReader;
  // GLTFExporter uses FileReader to concatenate its binary buffers.
  globalThis.FileReader = class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); }
  } as unknown as typeof FileReader;
  const mesh = createTextMesh(base, DEFAULT_TEXT_SPATIAL, parse(bytesFor("Lato-Bold.ttf")));
  try {
    const data = await new GLTFExporter().parseAsync(mesh, { binary: true }) as ArrayBuffer;
    const header = new DataView(data);
    assert.equal(header.getUint32(0, true), 0x46546c67);
    assert.equal(header.getUint32(4, true), 2);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, header.getUint32(12, true))));
    assert.ok(json.meshes[0].primitives.some((primitive: { attributes: { POSITION: number } }) => primitive.attributes.POSITION >= 0));
    assert.equal(json.nodes[0].extras.lumaTypography.text, "LUMA");
    assert.ok(data.byteLength < 16 * 1024 * 1024);
  } finally { disposeTextMesh(mesh); globalThis.FileReader = previous; }
});

test("unsupported and extreme stories fail before mesh allocation", () => {
  assert.throws(() => validateMeshText({ ...base, text: "x".repeat(161) }), /160/);
  assert.throws(() => validateMeshText({ ...base, layout: "path" }), /Point/);
  assert.throws(() => validateMeshText({ ...base, runs: [{ start: 0, end: 1, style: { color: "#f00" } }] }), /one character style/);
  assert.throws(() => validateMeshText({ ...base, text: "مرحبا" }), /complex-script/);
  assert.throws(() => createTextMesh({ ...base, text: "😀" }, DEFAULT_TEXT_SPATIAL, parse(bytesFor("Lato-Regular.ttf"))), /no outline/);
});

test("render insertion preserves editable source, bounded bitmap, undo and project round-trip", async () => {
  const studio = new Studio(50000, 50000, testCanvas(64, 64));
  try {
    const source = studio.addTextLayer("LUMA");
    const original = JSON.stringify(source.text);
    const count = studio.doc.layers.length;
    const render = studio.addTextMeshRender(source.id, testCanvas(160, 120));
    assert.equal(render.bitmap!.width, 160, "must not allocate document-sized bitmap");
    assert.equal(render.bitmap!.height, 120);
    assert.equal(JSON.stringify(source.text), original);
    assert.equal(studio.doc.layers.length, count + 1);
    studio.undo(); assert.equal(studio.doc.layers.length, count);
    studio.redo(); assert.equal(studio.doc.layers.length, count + 1);
    const reopened = await decodeLumaProject((await studio.prepareProjectSave()).blob);
    assert.equal(reopened.doc.layers.find(layer => layer.kind === "text")!.text!.text, "LUMA");
    assert.throws(() => studio.addTextMeshRender(source.id, { width: 50000, height: 50000 } as HTMLCanvasElement), /budget/);
  } finally { studio.dispose(); }
});
