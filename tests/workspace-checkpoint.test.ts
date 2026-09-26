import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { testCanvas } from "./canvas-harness.ts";
import { Studio } from "../app/engine/studio.ts";
import { runDesktopUpdateFlow } from "../app/desktop/desktop-updater.ts";
import { calculateDisplayViewport } from "../app/engine/viewport.ts";

function workspace() {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  studio.addBlankRaster("First");
  const first = studio.activeDocumentState().id;
  studio.markDocumentSaved(first, "/test/first.luma");
  studio.resetDocument(8, 8);
  const layer = studio.addBlankRaster("Second");
  studio.markDocumentSaved(studio.activeDocumentState().id, "/test/second.luma");
  return { studio, first, layer };
}

test("viewport, canvas remount and focus changes do not invalidate recovery or save tickets", async () => {
  const { studio, layer } = workspace();
  const encode = layer.bitmap!.toBlob.bind(layer.bitmap!);
  let unblock!: () => void, entered!: () => void;
  const encoding = new Promise<void>(resolve => { entered = resolve; });
  layer.bitmap!.toBlob = (callback, type) => encode(blob => { unblock = () => callback(blob); entered(); }, type);
  try {
    const pending = studio.exportRecoveryDocument();
    await encoding;
    studio.setVirtualViewport(calculateDisplayViewport(8, 8, 500, 300, { zoom: 2, panX: 20, panY: 10 }, 1));
    studio.attachDisplayTarget(testCanvas(500, 300));
    studio.setFocusPreview({ layerId: layer.id, target: "pixels", context: "off" });
    unblock();
    assert.equal((await pending).id, studio.activeDocumentState().id);
    layer.bitmap!.toBlob = encode;
    const ticket = await studio.prepareProjectSave("View test");
    studio.setVirtualViewport(calculateDisplayViewport(8, 8, 400, 200, { zoom: 1, panX: 0, panY: 0 }, 1));
    assert.equal(studio.completeProjectSave(ticket), true);
    const beforeEdit = await studio.prepareProjectSave("View test");
    studio.fillLayer(layer.id, "red");
    assert.equal(studio.completeProjectSave(beforeEdit), false);
  } finally { studio.dispose(); }
});

test("restart checkpoint verifies every tab after the durable write", async () => {
  const { studio, first, layer } = workspace();
  try {
    for (const change of [() => studio.setDocumentNativePath(first, "/test/changed.luma"),
      () => studio.fillLayer(layer.id, "red"), () => studio.closeDocument(first)]) {
      studio.markDocumentSaved();
      await assert.rejects(studio.checkpointForRestart(async () => { change(); }), /changed during/);
    }
    studio.markDocumentSaved();
    let written = 0;
    await studio.checkpointForRestart(async entries => { written = entries.length; });
    assert.equal(written, 1);
  } finally { studio.dispose(); }
});

test("dirty documents or failed writes never authorize restart", async () => {
  const { studio, layer } = workspace();
  try {
    studio.fillLayer(layer.id, "red");
    let written = false;
    await assert.rejects(studio.checkpointForRestart(async () => { written = true; }), /Save all open documents/);
    assert.equal(written, false);
    studio.markDocumentSaved();
    await assert.rejects(studio.checkpointForRestart(async () => { throw new Error("Disk full"); }), /Disk full/);
    assert.equal(studio.listDocuments().length, 2);
    await studio.checkpointForRestart(async () => {});
  } finally { studio.dispose(); }
});

test("workspace recovery rejects inactive-tab removal during encoding", async () => {
  const { studio, first, layer } = workspace();
  const encode = layer.bitmap!.toBlob.bind(layer.bitmap!);
  let unblock!: () => void, entered!: () => void;
  const encoding = new Promise<void>(resolve => { entered = resolve; });
  layer.bitmap!.toBlob = (callback, type) => encode(blob => { unblock = () => callback(blob); entered(); }, type);
  try {
    const pending = studio.exportRecoveryWorkspace();
    await encoding;
    const rejected = assert.rejects(pending, /workspace changed/);
    studio.closeDocument(first);
    unblock();
    await rejected;
    assert.equal(studio.listDocuments().length, 1);
  } finally { studio.dispose(); }
});

test("edits arriving during update download abort before native replacement", async () => {
  const { studio, layer } = workspace();
  const calls: string[] = [];
  try {
    await assert.rejects(runDesktopUpdateFlow({
      invoke: async command => {
        calls.push(command);
        if (command === "check_desktop_update") return { currentVersion: "0.6.0", version: "0.6.1" };
        if (command === "prepare_desktop_update") { studio.fillLayer(layer.id, "red"); return "123"; }
        return null;
      },
      confirmInstall: () => true,
      beforeInstall: () => studio.checkpointForRestart(async () => {}),
    }), /Save all open documents/);
    assert.deepEqual(calls, ["check_desktop_update", "prepare_desktop_update", "discard_desktop_update"]);
    assert.equal(studio.dirtyDocuments().length, 1);
  } finally { studio.dispose(); }
});

test("an edit after the checkpoint promise resolves is caught immediately before native install", async () => {
  const { studio, layer } = workspace();
  const calls: string[] = [];
  try {
    await assert.rejects(runDesktopUpdateFlow({
      invoke: async command => { calls.push(command); return command === "check_desktop_update" ? { currentVersion: "0.6.0", version: "0.6.1" }
        : command === "prepare_desktop_update" ? "123" : null; },
      confirmInstall: () => true,
      beforeInstall: () => studio.checkpointForRestart(async () => {}),
      onPhase: phase => { if (phase === "installing") studio.fillLayer(layer.id, "red"); },
    }), /document changed/);
    assert.equal(calls.includes("install_desktop_update"), false);
    assert.equal(calls.at(-1), "discard_desktop_update");
  } finally { studio.dispose(); }
});
