import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { IDBObjectStore, IDBDatabase } from "fake-indexeddb";
import { normalizeRecoveryWorkspace, readRecoveryWorkspace, writeRecoveryDocument, writeRecoveryWorkspace, removeRecoveryDocument, discardRecoveryDocuments, finalizePreviousDiscard } from "../app/engine/autosave.ts";

test("recovery workspace validates documents and keeps one active tab", () => {
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);
  const documents = normalizeRecoveryWorkspace({ documents: [
    { id: "one", name: "One", active: true, nativePath: "/projects/one.luma", dirty: true, blob: first, updatedAt: 12 },
    { id: "two", name: "Two", active: true, nativePath: 42, dirty: "yes", blob: second, updatedAt: Number.NaN },
    { id: "bad", name: "Bad", active: false, blob: "not-a-blob" },
  ] });
  assert.deepEqual(documents.map(({ id, active, updatedAt }) => ({ id, active, updatedAt })), [
    { id: "one", active: true, updatedAt: 12 },
    { id: "two", active: false, updatedAt: 0 },
  ]);
  assert.equal(documents[0].nativePath, "/projects/one.luma");
  assert.equal(documents[0].dirty, true);
  assert.equal(documents[1].nativePath, undefined);
  assert.equal(documents[1].dirty, false);
});

test("recovery workspace makes the first valid document active when needed", () => {
  const documents = normalizeRecoveryWorkspace({ documents: [
    { id: "one", name: "", active: false, blob: new Blob(["one"]) },
    { id: "two", name: "Two", active: false, blob: new Blob(["two"]) },
  ] });
  assert.equal(documents[0].name, "Untitled");
  assert.deepEqual(documents.map((document) => document.active), [true, false]);
});

const checkpoint = (id: string) => ({ id, name: id, active: true, dirty: true, blob: new Blob([id]) });

async function inspectStored(key: string) {
  return new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("luma-studio", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("recovery", "readonly");
      const read = tx.objectStore("recovery").get(key);
      tx.oncomplete = () => { db.close(); resolve(read.result ?? null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

test("legacy Blob workspace migrates without rewriting untouched payloads", async () => {
  await writeRecoveryWorkspace([checkpoint("migration-seed")]);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("luma-studio", 1);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("recovery", "readwrite"), store = tx.objectStore("recovery");
      store.put({ version: 2, documents: [checkpoint("legacy-a"), checkpoint("legacy-b")] }, "luma-recovery-workspace/v2");
      store.delete("luma-recovery-workspace/v3");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
  await writeRecoveryDocument({ ...checkpoint("legacy-b"), blob: new Blob(["updated B"]) });
  const migrated = await readRecoveryWorkspace();
  assert.equal(await migrated.find(doc => doc.id === "legacy-a")!.blob.text(), "legacy-a");
  assert.equal(await migrated.find(doc => doc.id === "legacy-b")!.blob.text(), "updated B");
  assert.notEqual(await inspectStored("luma-recovery-workspace/v2"), null);
  await writeRecoveryDocument({ ...checkpoint("legacy-a"), blob: new Blob(["updated A"]) });
  assert.equal(await inspectStored("luma-recovery-workspace/v2"), null);
  assert.equal(await (await readRecoveryWorkspace()).find(doc => doc.id === "legacy-a")!.blob.text(), "updated A");
});

test("quit before v3 migration preserves clean v2 tabs through startup cleanup", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("luma-studio", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("recovery", "readwrite"), store = tx.objectStore("recovery");
      store.put({ version: 2, documents: [
        { ...checkpoint("legacy-quit-clean"), dirty: false, active: false, nativePath: "/qa/clean.luma" },
        checkpoint("legacy-quit-dirty"),
      ] }, "luma-recovery-workspace/v2");
      store.delete("luma-recovery-workspace/v3");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
  await discardRecoveryDocuments(["legacy-quit-dirty"]);
  const retained = await readRecoveryWorkspace();
  assert.deepEqual(retained.map(doc => doc.id), ["legacy-quit-clean"]);
  assert.equal(retained[0].active, true);
  assert.equal(retained[0].dirty, false);
  assert.equal(retained[0].nativePath, "/qa/clean.luma");
  assert.equal(await retained[0].blob.text(), "legacy-quit-clean");
  await finalizePreviousDiscard();
  assert.deepEqual((await readRecoveryWorkspace()).map(doc => doc.id), ["legacy-quit-clean"]);
  assert.equal(await inspectStored("luma-recovery-disposition/v1"), null);
  await writeRecoveryDocument({ ...checkpoint("legacy-quit-clean"), dirty: false });
  assert.equal(await inspectStored("luma-recovery-workspace/v2"), null);
});

test("checkpoint updates do not reserialize other documents and retain at most two payloads per tab", async () => {
  await writeRecoveryWorkspace([checkpoint("stable-a"), checkpoint("changing-b")]);
  const initial = await inspectStored("luma-recovery-workspace/v3") as { documents: { id: string; blobKey: string }[] };
  const stableKey = initial.documents.find(doc => doc.id === "stable-a")!.blobKey;
  const keys: IDBValidKey[] = [], put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (args[1] !== undefined) keys.push(args[1]);
    return put.apply(this, args);
  };
  try { for (let revision = 0; revision < 12; revision++) await writeRecoveryDocument({ ...checkpoint("changing-b"), blob: new Blob([`revision ${revision}`]) }); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.ok(!keys.includes(stableKey));
  const payloadKeys = keys.filter(key => typeof key === "string" && key.startsWith("luma-recovery-payload/")) as string[];
  assert.equal(payloadKeys.length, 12);
  for (const obsolete of payloadKeys.slice(0, -2)) assert.equal(await inspectStored(obsolete), null);
  assert.equal(await (await inspectStored(stableKey) as Blob).text(), "stable-a");
  const workspace = await readRecoveryWorkspace();
  assert.equal(await workspace.find(doc => doc.id === "changing-b")!.blob.text(), "revision 11");
});

test("durable recovery replaces one tab without losing the other and closed tabs cannot resurrect", async () => {
  await writeRecoveryWorkspace([checkpoint("first"), checkpoint("second")]);
  await writeRecoveryDocument({ ...checkpoint("first"), name: "First edited" });
  assert.deepEqual((await readRecoveryWorkspace()).map(item => item.name).sort(), ["First edited", "second"]);
  await removeRecoveryDocument("first");
  await writeRecoveryDocument(checkpoint("first"));
  assert.deepEqual((await readRecoveryWorkspace()).map(item => item.id), ["second"]);
});

test("aborted recovery write rejects, closes its connection and preserves the prior commit", async () => {
  await writeRecoveryWorkspace([checkpoint("safe")]);
  const put = IDBObjectStore.prototype.put, close = IDBDatabase.prototype.close, open = indexedDB.open;
  let closed = 0, opened = 0;
  indexedDB.open = function (...args: Parameters<typeof open>) { opened++; return open.apply(this, args); };
  IDBDatabase.prototype.close = function () { closed++; return close.call(this); };
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    const request = put.apply(this, args); this.transaction.abort(); return request;
  };
  try { await assert.rejects(writeRecoveryDocument(checkpoint("never-committed")), /abort/i); }
  finally { IDBObjectStore.prototype.put = put; IDBDatabase.prototype.close = close; indexedDB.open = open; }
  assert.ok(opened > 0);
  assert.equal(closed, opened);
  assert.deepEqual((await readRecoveryWorkspace()).map(item => item.id), ["safe"]);
});

test("aborted workspace read does not return success or silently fall back to a legacy file", async () => {
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args: Parameters<typeof get>) {
    const request = get.apply(this, args); this.transaction.abort(); return request;
  };
  try { await assert.rejects(readRecoveryWorkspace(), /abort/i); }
  finally { IDBObjectStore.prototype.get = get; }
});

test("closing the final recovered tab never resurrects a legacy checkpoint", async () => {
  const storage = Object.getOwnPropertyDescriptor(navigator, "storage");
  Object.defineProperty(navigator, "storage", { configurable: true, value: {} });
  try {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("luma-studio", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("recovery", "readwrite");
        tx.objectStore("recovery").put(new Blob(["obsolete project"]), "luma-recovery.luma");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    await writeRecoveryWorkspace([checkpoint("last-closed")]);
    await removeRecoveryDocument("last-closed");
    assert.deepEqual(await readRecoveryWorkspace(), []);
    await writeRecoveryDocument(checkpoint("last-closed"));
    assert.deepEqual(await readRecoveryWorkspace(), []);
    await writeRecoveryDocument(checkpoint("fresh-after-close"));
    assert.deepEqual((await readRecoveryWorkspace()).map(item => item.id), ["fresh-after-close"]);
  } finally {
    if (storage) Object.defineProperty(navigator, "storage", storage);
    else Reflect.deleteProperty(navigator, "storage");
  }
});

test("quit discard atomically removes dirty tabs, preserves clean tabs and blocks stale checkpoints", async () => {
  await writeRecoveryWorkspace([checkpoint("discard-a"), checkpoint("discard-b"), { ...checkpoint("retain-clean"), dirty: false }]);
  const queued = writeRecoveryDocument(checkpoint("discard-a"));
  await discardRecoveryDocuments(["discard-a", "discard-b"]);
  await queued;
  await writeRecoveryDocument(checkpoint("discard-b"));
  const workspace = await readRecoveryWorkspace();
  assert.deepEqual(workspace.map(entry => entry.id), ["retain-clean"]);
  assert.equal(workspace[0].dirty, false);
  await finalizePreviousDiscard();
});

test("aborted multi-tab discard preserves every checkpoint and re-enables autosave", async () => {
  await writeRecoveryWorkspace([checkpoint("abort-a"), checkpoint("abort-b")]);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    const request = put.apply(this, args); this.transaction.abort(); return request;
  };
  try { await assert.rejects(discardRecoveryDocuments(["abort-a", "abort-b"]), /abort|inactive/i); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual((await readRecoveryWorkspace()).map(entry => entry.id), ["abort-a", "abort-b"]);
  await writeRecoveryDocument({ ...checkpoint("abort-a"), name: "Autosave still works" });
  assert.equal((await readRecoveryWorkspace()).find(entry => entry.id === "abort-a")?.name, "Autosave still works");
});

test("failed native exit can compensate discard and subsequent edits remain recoverable", async () => {
  await writeRecoveryWorkspace([checkpoint("restore-a"), { ...checkpoint("restore-clean"), dirty: false }]);
  const restore = await discardRecoveryDocuments(["restore-a"]);
  assert.deepEqual((await readRecoveryWorkspace()).map(entry => entry.id), ["restore-clean"]);
  await restore();
  assert.deepEqual((await readRecoveryWorkspace()).map(entry => entry.id).sort(), ["restore-a", "restore-clean"]);
  await writeRecoveryDocument({ ...checkpoint("restore-a"), name: "After canceled exit" });
  assert.equal((await readRecoveryWorkspace()).find(entry => entry.id === "restore-a")?.name, "After canceled exit");
});

test("discarding all tabs persists an authoritative empty workspace", async () => {
  await writeRecoveryWorkspace([checkpoint("discard-last")]);
  await discardRecoveryDocuments(["discard-last"]);
  await finalizePreviousDiscard();
  assert.deepEqual(await readRecoveryWorkspace(), []);
  await writeRecoveryWorkspace([checkpoint("discard-last")]);
  assert.deepEqual(await readRecoveryWorkspace(), []);
});

test("failed discard compensation makes recovery visibly fail rather than silently skipping later edits", async () => {
  await writeRecoveryWorkspace([checkpoint("compensation-failure")]);
  const restore = await discardRecoveryDocuments(["compensation-failure"]);
  const remove = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args: Parameters<typeof remove>) {
    const request = remove.apply(this, args); this.transaction.abort(); return request;
  };
  try { await assert.rejects(restore(), /abort/i); }
  finally { IDBObjectStore.prototype.delete = remove; }
  await assert.rejects(writeRecoveryDocument(checkpoint("compensation-failure")), /Recovery is paused/);
  await restore();
  await writeRecoveryDocument({ ...checkpoint("compensation-failure"), name: "Recovery resumed" });
  assert.equal((await readRecoveryWorkspace())[0].name, "Recovery resumed");
});

test("damaged workspace is reported and retained rather than replaced by routine recovery", async () => {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    return put.call(this, { version: 2, documents: [{ id: "broken", name: "Broken", blob: "invalid" }] }, args[1]);
  };
  try { await writeRecoveryWorkspace([checkpoint("seed")]); }
  finally { IDBObjectStore.prototype.put = put; }
  await assert.rejects(readRecoveryWorkspace(), /damaged/);
  await assert.rejects(writeRecoveryDocument(checkpoint("new")), /damaged/);
  await assert.rejects(writeRecoveryWorkspace([checkpoint("new")]), /damaged/);
  await assert.rejects(removeRecoveryDocument("broken"), /damaged/);
  await assert.rejects(readRecoveryWorkspace(), /damaged/);
});
