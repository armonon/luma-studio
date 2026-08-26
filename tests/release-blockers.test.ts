import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { Studio } from "../app/engine/studio.ts";
import {
  assertSafeProjectArchive,
  decodeLumaProject,
  LUMA_PROJECT_LIMITS,
} from "../app/engine/project.ts";
import { saveNativeProject } from "../app/engine/native-files.ts";
import { resolvedBlendIf } from "../app/engine/document.ts";
import { testCanvas } from "./canvas-harness.ts";

test("document dirty state follows its saved history cursor and remembers its path", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  assert.equal(studio.activeDocumentState().dirty, false);
  const layer = studio.addBlankRaster("Paint");
  assert.equal(studio.activeDocumentState().dirty, true);
  studio.markDocumentSaved(undefined, "/tmp/work.luma");
  assert.deepEqual(studio.activeDocumentState(), {
    id: studio.activeDocumentState().id,
    name: "work",
    nativePath: "/tmp/work.luma",
    dirty: false,
  });
  studio.setLayerProp(layer.id, "opacity", 0.4, "Opacity");
  assert.equal(studio.activeDocumentState().dirty, true);
  studio.undo();
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.dispose();
});

test("fill opacity changes pixels and survives action recording", () => {
  const studio = new Studio(4, 4, testCanvas(4, 4));
  const layer = studio.addBlankRaster("Paint");
  studio.startRecording("Half fill");
  studio.fillLayer(layer.id, "#ff0000", 0.25);
  const action = studio.stopRecording();
  const pixel = layer.bitmap!.getContext("2d")!.getImageData(0, 0, 1, 1).data;
  assert.deepEqual([...pixel], [255, 0, 0, 63]);
  assert.equal(action?.steps[0].op, "fill");
  assert.equal(action?.steps[0].op === "fill" ? action.steps[0].opacity : null, 0.25);
  studio.dispose();
});

test("live layer-effect updates coalesce to one history operation", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("Paint");
  const effect = studio.addLayerEffect(layer.id, "drop-shadow")!;
  const before = studio.historyState().operations;
  studio.liveUpdateLayerEffect(layer.id, effect.id, { blur: 10 });
  studio.liveUpdateLayerEffect(layer.id, effect.id, { blur: 20 });
  studio.liveUpdateLayerEffect(layer.id, effect.id, { blur: 30 });
  assert.equal(studio.historyState().operations, before);
  assert.equal(studio.commitLiveLayerEffect(layer.id, effect.id), true);
  assert.equal(studio.historyState().operations, before + 1);
  studio.undo();
  assert.equal(layer.effects?.[0].blur, 24);
  studio.dispose();
});

test("live adjustment previews mark the document dirty and commit once", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addLevelsLayer();
  studio.markDocumentSaved();
  const before = studio.historyState().operations;

  studio.liveUpdateLevels(layer.id, { ...layer.levels!, gamma: 1.4 });
  studio.liveUpdateLevels(layer.id, { ...layer.levels!, gamma: 2.2 });
  assert.equal(studio.activeDocumentState().dirty, true);
  assert.equal(studio.historyState().operations, before);
  assert.equal(layer.levels?.gamma, 2.2);

  studio.updateLevels(layer.id, { ...layer.levels!, gamma: 2.2 });
  assert.equal(studio.historyState().operations, before + 1);
  studio.undo();
  assert.equal(layer.levels?.gamma, 1);
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.dispose();
});

test("Blend If preview remains live but produces one undo node", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("Blend If");
  studio.markDocumentSaved();
  const before = studio.historyState().operations;
  const original = resolvedBlendIf(layer);
  const first = {
    ...original,
    channels: {
      ...original.channels,
      gray: { ...original.channels.gray, source: { ...original.channels.gray.source, black: 0.1 } },
    },
  };
  const final = {
    ...first,
    channels: {
      ...first.channels,
      gray: { ...first.channels.gray, source: { ...first.channels.gray.source, black: 0.25 } },
    },
  };

  studio.liveUpdateLayerBlendIf(layer.id, first);
  studio.liveUpdateLayerBlendIf(layer.id, final);
  assert.equal(studio.activeDocumentState().dirty, true);
  assert.equal(studio.historyState().operations, before);
  assert.equal(resolvedBlendIf(layer).channels.gray.source.black, 0.25);

  studio.commitLayerBlendIf(layer.id, final);
  assert.equal(studio.historyState().operations, before + 1);
  studio.undo();
  assert.equal(resolvedBlendIf(layer).channels.gray.source.black, 0);
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.dispose();
});

test("text, shape, and global-light sliders commit once and ignore blur duplicates", () => {
  const studio = new Studio(80, 60, testCanvas(80, 60));
  const textLayer = studio.addTextLayer("Type");
  let before = studio.historyState().operations;
  studio.liveUpdateText(textLayer.id, { tracking: 10 });
  studio.liveUpdateText(textLayer.id, { tracking: 20 });
  studio.updateText(textLayer.id, {});
  studio.updateText(textLayer.id, {});
  assert.equal(studio.historyState().operations, before + 1);

  const shapeLayer = studio.addShapeLayer();
  before = studio.historyState().operations;
  studio.liveUpdateShape(shapeLayer.id, { radius: 8 });
  studio.liveUpdateShape(shapeLayer.id, { radius: 18 });
  studio.updateShape(shapeLayer.id, {});
  studio.updateShape(shapeLayer.id, {});
  assert.equal(studio.historyState().operations, before + 1);

  before = studio.historyState().operations;
  studio.liveUpdateGlobalLight({ angle: 33 });
  studio.setGlobalLight({ angle: 33 });
  studio.setGlobalLight({ angle: 33 });
  assert.equal(studio.historyState().operations, before + 1);
  studio.dispose();
});

test("project decoder rejects unsafe dimensions before allocating canvases", async () => {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    format: "luma-project",
    version: 4,
    name: "Hostile",
    savedAt: new Date().toISOString(),
    document: { width: 300_001, height: 1, layers: [] },
    actions: [],
  }));
  const archive = await zip.generateAsync({ type: "uint8array" });
  await assert.rejects(() => decodeLumaProject(archive), /dimensions exceed/);
});

test("project archive preflight rejects corrupt paths, sizes, and expansion bombs", () => {
  const forgedArchive = (name: string, uncompressedSize: number, compressedSize = 1024) => {
    const zip = new JSZip();
    (zip.files as Record<string, unknown>)[name] = {
      name,
      dir: false,
      _data: { uncompressedSize, compressedSize },
    };
    return zip;
  };

  assert.throws(
    () => assertSafeProjectArchive(forgedArchive("../outside.bin", 16), 16),
    /Unsafe project archive path/,
  );
  assert.throws(
    () => assertSafeProjectArchive(forgedArchive("asset.bin", Number.NaN), 16),
    /invalid size/,
  );
  assert.throws(
    () => assertSafeProjectArchive(forgedArchive("asset.bin", LUMA_PROJECT_LIMITS.entryBytes + 1), 16),
    /entry is too large/,
  );
  assert.throws(
    () => assertSafeProjectArchive(forgedArchive("asset.bin", 300 * 1024 * 1024), 1024 * 1024),
    /unsafe archive expansion ratio/,
  );
});

test("native project Save uses a remembered path and Save As returns its new path", async () => {
  const commands: string[] = [];
  const invoke = async <T>(command: string) => {
    commands.push(command);
    return (command === "save_native_file_as" ? "/tmp/new.luma" : true) as T;
  };
  assert.equal(await saveNativeProject(new Uint8Array([1]), "work.luma", "/tmp/work.luma", invoke), "/tmp/work.luma");
  assert.equal(await saveNativeProject(new Uint8Array([1]), "new.luma", undefined, invoke), "/tmp/new.luma");
  assert.deepEqual(commands, ["save_native_path", "save_native_file_as"]);
});
