import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { readRecoveryWorkspace, recoveryReadFailure, writeRecoveryDocument, writeRecoveryWorkspace, writeRecovery, discardRecoveryDocuments } from "../app/engine/autosave.ts";

test("unreadable legacy browser storage protects checkpoints and resumes only after a successful read", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "storage");
  const failure = new DOMException("Storage unavailable", "UnknownError");
  Object.defineProperty(navigator, "storage", { configurable: true, value: { getDirectory: async () => { throw failure; } } });
  const checkpoint = { id: "new-work", name: "New work", active: true, dirty: true, blob: new Blob(["new work"]) };
  try {
    await assert.rejects(readRecoveryWorkspace(), error => error instanceof Error && error.cause === failure && /private-file storage/.test(error.message));
    assert.match(recoveryReadFailure()!, /legacy recovery file may still exist/);
    await assert.rejects(writeRecoveryDocument(checkpoint), /Recovery is paused/);
    await assert.rejects(writeRecoveryWorkspace([checkpoint]), /Recovery is paused/);
    await assert.rejects(writeRecovery(checkpoint.blob), /Recovery is paused/);
    await assert.rejects(discardRecoveryDocuments([checkpoint.id]), /Recovery is paused/);

    // Once the same storage is readable, the old work must still be discovered.
    const legacy = new Blob(["older recovery checkpoint"]);
    Object.defineProperty(navigator, "storage", { configurable: true, value: { getDirectory: async () => ({ getFileHandle: async () => ({ getFile: async () => legacy }) }) } });
    const restored = await readRecoveryWorkspace();
    assert.equal(restored.length, 1);
    assert.equal(await restored[0].blob.text(), "older recovery checkpoint");
    assert.equal(recoveryReadFailure(), null);
    await writeRecoveryDocument(checkpoint);
    assert.equal((await readRecoveryWorkspace())[0].id, checkpoint.id);
  } finally {
    if (descriptor) Object.defineProperty(navigator, "storage", descriptor);
    else Reflect.deleteProperty(navigator, "storage");
  }
});
