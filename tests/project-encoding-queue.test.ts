import assert from "node:assert/strict";
import test from "node:test";
import "./canvas-harness.ts";
import { ProjectEncodingQueue } from "../app/engine/project-encoding-queue.ts";
import { Studio } from "../app/engine/studio.ts";
import { testCanvas } from "./canvas-harness.ts";
import { decodeLumaProject } from "../app/engine/project.ts";

test("project encoder admission is FIFO, bounded, and release is idempotent", async () => {
  const queue = new ProjectEncodingQueue(1);
  const release = await queue.acquire();
  let admitted = false;
  const waiting = queue.acquire().then(done => { admitted = true; return done; });
  await assert.rejects(queue.acquire(), /Too many project saves/);
  assert.equal(admitted, false);
  release(); release();
  const next = await waiting;
  let thirdAdmitted = false;
  const third = queue.acquire().then(done => { thirdAdmitted = true; return done; });
  await Promise.resolve(); assert.equal(thirdAdmitted, false);
  next(); (await third)();
});

test("an encoder wait timeout does not release the still-running encoder", async () => {
  const queue = new ProjectEncodingQueue(2, 10);
  const active = await queue.acquire();
  await assert.rejects(queue.acquire(), /still encoding/);
  await assert.rejects(queue.acquire(), /still encoding/);
  active(); (await queue.acquire())();
});

function heldStudio() {
  const studio = new Studio(16, 16, testCanvas(1, 1));
  const layer = studio.addBlankRaster("Saved pixels");
  studio.fillLayer(layer.id, "red");
  const encode = layer.bitmap!.toBlob.bind(layer.bitmap!);
  let unblock!: () => void, signal!: () => void, first = true;
  const entered = new Promise<void>(resolve => { signal = resolve; });
  layer.bitmap!.toBlob = (callback, type) => encode(blob => {
    if (!first) { callback(blob); return; }
    first = false; unblock = () => callback(blob); signal();
  }, type);
  return { studio, layer, entered, unblock: () => unblock() };
}

test("manual Save waits for recovery before reserving scratch or encoding", async () => {
  const held = heldStudio(), { studio } = held;
  const internal = studio as unknown as { reserveOperationMemory(bytes: number): () => void; reservedOperationBytes: number };
  const reserve = internal.reserveOperationMemory.bind(studio);
  let active = 0, peak = 0;
  internal.reserveOperationMemory = bytes => {
    assert.equal(active, 0, "recovery and manual save must never overlap scratch reservations");
    const release = reserve(bytes); active++; peak = Math.max(peak, active);
    return () => { active--; release(); };
  };
  try {
    const recovery = studio.exportRecoveryDocument();
    await held.entered;
    const manual = studio.prepareProjectSave("Manual save");
    held.unblock();
    const [checkpoint, ticket] = await Promise.all([recovery, manual]);
    assert.equal(checkpoint.id, ticket.documentId);
    assert.equal((await decodeLumaProject(ticket.blob)).doc.layers.length, 1);
    assert.equal(peak, 1); assert.equal(active, 0); assert.equal(internal.reservedOperationBytes, 0);
  } finally { studio.dispose(); }
});

test("queued saves reject changed documents and failures do not wedge future saves", async () => {
  const held = heldStudio(), { studio, layer } = held;
  try {
    const recovery = studio.exportRecoveryDocument();
    await held.entered;
    const manual = studio.prepareProjectSave();
    const failedRecovery = assert.rejects(recovery, /document changed/);
    const failedSave = assert.rejects(manual, /document changed/);
    studio.fillLayer(layer.id, "blue");
    held.unblock();
    await Promise.all([failedRecovery, failedSave]);
    assert.ok((await studio.prepareProjectSave()).blob.size > 0);
    const internal = studio as unknown as { reservedOperationBytes: number };
    assert.equal(internal.reservedOperationBytes, 0);
  } finally { studio.dispose(); }
});

test("scratch admission failure releases the encoding slot for retry", async () => {
  const studio = new Studio(8, 8, testCanvas(1, 1));
  studio.addBlankRaster("A");
  const internal = studio as unknown as { reserveOperationMemory(bytes: number): () => void };
  const reserve = internal.reserveOperationMemory.bind(studio);
  try {
    internal.reserveOperationMemory = () => { throw new Error("Injected admission failure"); };
    await assert.rejects(studio.prepareProjectSave(), /Injected admission/);
    await assert.rejects(studio.exportRecoveryDocument(), /Injected admission/);
    internal.reserveOperationMemory = reserve;
    assert.ok((await studio.prepareProjectSave()).blob.size > 0);
  } finally { studio.dispose(); }
});
