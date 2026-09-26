/** Cross-repository source exchange check. Form scene/mesh fidelity is deliberately not implied. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Studio } from "../app/engine/studio.ts";
import { formTextAssetFromLayer, formTextAssetWithOutlines, serializeFormTextAsset } from "../app/engine/form-studio-bridge.ts";
import { shapeTextOutlines } from "../app/engine/text-shaping.ts";
import { decodeLumaProject } from "../app/engine/project.ts";
import { testCanvas } from "../tests/canvas-harness.ts";

const formRoot = process.argv[2];
if (!formRoot) throw new Error("Usage: tsx build/verify-form-roundtrip.ts /absolute/path/to/form-studio");
const bridge = await import(pathToFileURL(resolve(formRoot, "app/luma-text-bridge.ts")).href);
const studio = new Studio(800, 600, testCanvas(32, 32));
let object: ReturnType<typeof bridge.createLumaTextObject> | undefined;
try {
  const original = studio.addTextLayer("LUMA × FORM", { color: "#2876cc", font: '700 96px "Lato", sans-serif' });
  const bytes = await readFile("public/fonts/Lato-Bold.ttf");
  const source = await formTextAssetWithOutlines(original, text => shapeTextOutlines(text, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  object = bridge.createLumaTextObject(bridge.parseLumaFormTextAsset(serializeFormTextAsset(source)));
  assert.equal(object.children.length, 1);
  assert.equal(object.children[0].geometry.type, "ExtrudeGeometry");
  assert.ok(object.children[0].geometry.getAttribute("position").count > 100);
  object.rotation.y = Math.PI / 4;
  const returned = bridge.returnedLumaTextSource(object);
  const next = await studio.importFormText(returned);
  assert.equal(next.layers[0].text?.text, original.text!.text);
  assert.ok(Math.abs(next.layers[0].text!.spatial!.transform.rotationY - 45) < 1e-8);
  const saved = await studio.prepareProjectSave();
  const reopened = await decodeLumaProject(saved.blob);
  assert.equal(reopened.doc.layers[0].text?.text, original.text!.text);
  assert.deepEqual(reopened.doc.layers[0].text?.spatial, next.layers[0].text?.spatial);
  assert.equal(formTextAssetFromLayer(reopened.doc.layers[0]).id, source.id);
  const output = resolve("artifacts/vector-qualification"); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "actual-form-return.lumaformtext"), returned);
  await writeFile(resolve(output, "actual-form-return.luma"), new Uint8Array(await saved.blob.arrayBuffer()));
  console.log("PASS: Luma shaped text → actual Form glyph extrusion → rotation edit → Form source return → Luma editable text → .luma save/reopen. Arbitrary mesh editing, scene placement and live-sync fidelity are NOT covered.");
} finally {
  object?.traverse((child: { geometry?: { dispose(): void }; material?: { map?: { dispose(): void }; dispose(): void } | { dispose(): void }[] }) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
    else { child.material?.map?.dispose(); child.material?.dispose(); }
  });
  studio.dispose();
}
