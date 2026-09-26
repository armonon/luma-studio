import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { commandForShortcut } from "../app/desktop/command-shortcuts.ts";
import { createMenuStatePublisher } from "../app/desktop/native-menu.ts";
import { decodeLumaProject } from "../app/engine/project.ts";

test("a save receipt belongs to the exported document, never the newly active tab", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("original");
  studio.fillLayer(layer.id, "#ff0000");
  const original = studio.activeDocumentState().id;
  const ticket = await studio.prepareProjectSave("original");
  const saved = await decodeLumaProject(ticket.blob);
  assert.equal(saved.doc.layers[0].name, "original");
  studio.resetDocument(12, 12, "other");
  studio.addBlankRaster("other");
  assert.equal(studio.completeProjectSave(ticket, "/tmp/original.luma"), false);
  assert.equal(studio.activeDocumentState().nativePath, undefined);
  assert.equal(studio.activeDocumentState().dirty, true);
  assert.equal(studio.listDocuments().find(doc => doc.id === original)?.nativePath, "/tmp/original.luma");
  studio.dispose();
});

test("successful saves clear dirty state; edits during encoding or writing do not", async () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  const layer = studio.addBlankRaster("test");
  const pending = studio.prepareProjectSave();
  studio.updateTransform(layer.id, { tx: 1 });
  await assert.rejects(pending, /changed while saving/);
  const older = await studio.prepareProjectSave();
  studio.updateTransform(layer.id, { tx: 2 });
  assert.equal(studio.completeProjectSave(older), false);
  assert.equal(studio.activeDocumentState().dirty, true);
  const current = await studio.prepareProjectSave();
  assert.equal(studio.completeProjectSave(current, "/tmp/current.luma"), true);
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.dispose();
});

test("closing the last document creates a fresh untitled session without its old file path", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  studio.addBlankRaster("last");
  studio.markDocumentSaved(undefined, "/tmp/last.luma");
  const id = studio.activeDocumentState().id;
  studio.closeDocument(id);
  assert.equal(studio.listDocuments().length, 1);
  assert.notEqual(studio.activeDocumentState().id, id);
  assert.equal(studio.activeDocumentState().nativePath, undefined);
  assert.equal(studio.doc.layers.length, 0);
  assert.equal(studio.activeDocumentState().dirty, false);
  studio.dispose();
});

test("empty saved documents and dirty empty documents are not overwritten by New", () => {
  const studio = new Studio(8, 8, testCanvas(8, 8));
  studio.markDocumentSaved(undefined, "/tmp/empty.luma");
  const original = studio.activeDocumentState().id;
  studio.resetDocument(10, 10);
  assert.equal(studio.listDocuments().length, 2);
  studio.restoreDocumentSessionState(studio.activeDocumentState().id, { dirty: true });
  studio.resetDocument(20, 20);
  assert.equal(studio.listDocuments().length, 3);
  assert.ok(studio.listDocuments().some(doc => doc.id === original));
  assert.throws(() => studio.resetDocument(NaN, 12));
  assert.throws(() => studio.resetDocument(1.5, 12));
  assert.equal(studio.doc.width, 20);
  studio.dispose();
});

test("native and web accelerators resolve from the same command table", () => {
  const key = (key: string, shiftKey = false) => commandForShortcut({ key, shiftKey, metaKey: true, ctrlKey: false, altKey: false });
  assert.equal(key("n"), "new-document");
  assert.equal(key("w"), "close-document");
  assert.equal(key("s", true), "save-as");
  assert.equal(key("z", true), "redo");
  assert.equal(key("+", true), "zoom-in");
  assert.equal(key("n", true), "new-layer");
  assert.equal(commandForShortcut({ key: "n", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }), null);
});

test("native menu IPC coalesces pending states and preserves newest availability", async () => {
  const calls: Array<Record<string, boolean>> = [];
  const releases: Array<() => void> = [];
  const publisher = createMenuStatePublisher(states => {
    calls.push(states);
    return new Promise<void>(resolve => releases.push(resolve));
  });
  publisher.publish({ save: false });
  publisher.publish({ save: true });
  publisher.publish({ save: false, undo: true });
  assert.equal(calls.length, 1);
  releases.shift()!();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls[1], { save: false, undo: true });
  publisher.dispose(); releases.shift()!();
  publisher.publish({ save: true });
  await Promise.resolve();
  assert.equal(calls.length, 2);
});
