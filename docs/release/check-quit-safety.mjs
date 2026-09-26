// Real desktop React UI + IndexedDB; deterministic native-boundary fault double.
// This is not evidence of Cocoa dialogs, Dock Quit or an actual full disk.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseSourceId } from '../../build/release-source-id.mjs';
import { acquireQualificationLock } from '../../build/qualification-lock.mjs';
const { webkit } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.LUMA_UI_URL ?? 'http://127.0.0.1:4183/';
assert.equal(new URL(base).hostname, '127.0.0.1');
const release = acquireQualificationLock('Quit safety fault campaign');
const output = await mkdtemp(resolve('artifacts/quit-safety-'));
const report = { sourceSha256: releaseSourceId(), harnessSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  scope: 'Isolated persistent WebKit desktop UI; native IPC fault double, not installed-app qualification', cases: [], pass: false };
let context, page;
try {
  context = await webkit.launchPersistentContext(join(output, 'profile'), { headless: true, viewport: { width: 1440, height: 900 } });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.addInitScript(() => {
    localStorage.setItem('luma.scripting', 'on');
    const listeners = new Map();
    const qa = window.quitQA = { saves: [], mode: 'cancel', exits: 0, releaseSave: null, exitFails: true,
      transactionErrors: [],
      emit: () => listeners.get('luma://close-requested')?.({ payload: null }) };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      tx.addEventListener('abort', () => qa.transactionErrors.push({ name: tx.error?.name, message: tx.error?.message }));
      return tx;
    };
    window.__TAURI__ = {
      event: { listen: async (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name); } },
      core: { invoke: async (command, payload) => {
        if (command === 'take_pending_open_files' || command === 'list_font_families') return [];
        if (command === 'confirm_native_exit') { qa.exits++; if (qa.exitFails) throw new Error('Injected exit failure'); return; }
        if (command === 'save_native_path' || command === 'save_native_file_as') {
          const bytes = new Uint8Array(payload), size = new DataView(bytes.buffer).getUint32(0, true);
          const name = new TextDecoder().decode(bytes.subarray(4, 4 + size));
          qa.saves.push(name);
          if (qa.mode === 'cancel' || (qa.mode === 'cancel-second' && qa.saves.length === 2)) return null;
          if (qa.mode === 'disk-full') throw new Error('Injected disk full: ENOSPC');
          if (qa.mode === 'defer') return new Promise(resolve => { qa.releaseSave = () => resolve(null); });
          return command === 'save_native_path' ? true : `/qa/${name}`;
        }
        if (command === 'composite_native_tile') throw new Error('Native renderer unavailable in boundary test');
        return undefined;
      } },
    };
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await page.goto(base);
  await page.waitForFunction(() => window.luma?.studio.doc.layers.length > 0);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Restoring workspace"]'));
  const recoveryUrl = `/@fs/${resolve('app/engine/autosave.ts')}`;
  await page.evaluate(async url => {
    const studio = window.luma.studio;
    studio.resetDocument(64, 64, 'Keep clean');
    for (const doc of studio.listDocuments()) if (doc.id !== studio.activeDocumentState().id) studio.closeDocument(doc.id);
    studio.addBlankRaster('Saved base'); studio.markDocumentSaved();
    for (const name of ['Dirty A', 'Dirty B']) { studio.resetDocument(64, 64, name); studio.addBlankRaster('Unsaved layer'); }
    const recovery = await import(url); await recovery.writeRecoveryWorkspace(await studio.exportRecoveryWorkspace());
  }, recoveryUrl);
  await page.evaluate(async url => {
    const recovery = await import(url);
    const checkpoint = await window.luma.studio.exportRecoveryDocument();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args);
      if (args[1] === 'luma-recovery-workspace/v3') this.transaction.abort();
      return result;
    };
    let rejected = false;
    try { await recovery.writeRecoveryDocument({ ...checkpoint, updatedAt: Date.now() + 60000, blob: new Blob(['must not commit']) }); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.put = put; }
    if (!rejected) throw new Error('Late index abort must reject the checkpoint');
    for (const entry of await recovery.readRecoveryWorkspace()) {
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Index abort damaged an existing payload');
    }
  }, recoveryUrl);
  report.cases.push('Late index-commit abort preserves readable project payloads for every tab');
  await page.evaluate(() => window.quitQA.emit());
  const dialog = page.getByRole('dialog', { name: 'Save before quitting Luma Studio?' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Save All', exact: true }).click();
  await page.waitForFunction(() => window.quitQA.saves.length === 1 && !document.querySelector('button[disabled]')?.textContent?.includes('Finishing'));
  await dialog.getByRole('button', { name: 'Save All', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.luma.studio.dirtyDocuments().length), 2);
  assert.equal(await page.evaluate(() => window.quitQA.exits), 0);
  report.cases.push('Canceled first Save As retains both dirty documents; no exit');

  await page.evaluate(() => { window.quitQA.mode = 'cancel-second'; window.quitQA.saves = []; });
  await dialog.getByRole('button', { name: 'Save All', exact: true }).click();
  await page.waitForFunction(() => window.quitQA.saves.length === 2);
  await dialog.getByRole('button', { name: 'Save All', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.luma.studio.dirtyDocuments().length), 1);
  assert.equal(await page.evaluate(() => window.quitQA.exits), 0);
  report.cases.push('Canceled second Save As retains the remaining dirty document; first remains saved');

  await page.evaluate(() => { window.quitQA.mode = 'disk-full'; window.quitQA.saves = []; });
  await dialog.getByRole('button', { name: 'Save All', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save All', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.luma.studio.dirtyDocuments().length), 1);
  assert.equal(await page.evaluate(() => window.quitQA.exits), 0);
  assert.ok(await page.getByText('Injected disk full: ENOSPC', { exact: true }).count());
  report.cases.push('Rejected native write leaves dirty state and blocks termination');

  await page.evaluate(() => { window.quitQA.mode = 'defer'; });
  await dialog.getByRole('button', { name: 'Save All', exact: true }).click();
  await page.waitForFunction(() => window.quitQA.releaseSave !== null);
  assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: 'Don’t Save', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.quitQA.emit());
  assert.equal(await page.evaluate(() => window.quitQA.exits), 0);
  await page.evaluate(() => window.quitQA.releaseSave());
  await dialog.getByRole('button', { name: 'Save All', exact: true }).waitFor();
  report.cases.push('Pending native save prevents concurrent Cancel, discard and repeated Quit');

  // Discard failure must not exit or suppress later autosaves.
  await page.evaluate(() => {
    window.quitQA.put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { const result = window.quitQA.put.apply(this, args); this.transaction.abort(); return result; };
  });
  await dialog.getByRole('button', { name: 'Don’t Save', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save All', exact: true }).waitFor();
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.quitQA.put; });
  assert.equal(await page.evaluate(() => window.quitQA.exits), 0);
  const read = () => page.evaluate(async url => (await (await import(url)).readRecoveryWorkspace()).map(doc => ({ name: doc.name, dirty: doc.dirty })), recoveryUrl);
  assert.equal((await read()).length, 3);
  report.cases.push('Aborted discard transaction retains all recovery documents and does not quit');

  await dialog.getByRole('button', { name: 'Don’t Save', exact: true }).click();
  await page.waitForFunction(() => window.quitQA.exits === 1);
  await dialog.getByRole('button', { name: 'Save All', exact: true }).waitFor();
  assert.equal((await read()).length, 3);
  await page.evaluate(async url => {
    for (const entry of await (await import(url)).readRecoveryWorkspace()) {
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Restored checkpoint Blob is not readable');
    }
  }, recoveryUrl);
  report.cases.push('Native exit rejection compensates recovery removal');

  await page.evaluate(() => { window.quitQA.exitFails = false; });
  await dialog.getByRole('button', { name: 'Don’t Save', exact: true }).click();
  await page.waitForFunction(() => window.quitQA.exits === 2);
  const retained = await read();
  assert.equal(retained.length, 2); assert.ok(retained.every(doc => !doc.dirty));
  await page.reload();
  await page.waitForFunction(() => window.luma?.studio.listDocuments().length === 2);
  assert.equal(await page.evaluate(() => window.luma.studio.dirtyDocuments().length), 0);
  report.cases.push('Successful discard and reload restores only retained clean tabs, not discarded edits');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Restoring workspace"]'));
  await page.evaluate(async url => {
    const recovery = await import(url);
    const documents = await window.luma.studio.exportRecoveryWorkspace();
    if (documents.length !== 2 || documents.some(doc => doc.dirty)) throw new Error('Expected two retained clean fixtures');
    // Pause app checkpoints while constructing an old-format startup fixture.
    await recovery.discardRecoveryDocuments(['legacy-only-dirty']);
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('luma-studio', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('recovery', 'readwrite'), store = tx.objectStore('recovery');
        store.put({ version: 2, documents: [...documents.map(doc => ({ ...doc, active: false })),
          { ...documents[0], id: 'legacy-only-dirty', name: 'Legacy discarded', dirty: true, active: true }] }, 'luma-recovery-workspace/v2');
        store.delete('luma-recovery-workspace/v3');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const retained = await recovery.readRecoveryWorkspace();
    if (retained.length !== 2 || retained.some(doc => doc.dirty) || !retained[0].active) throw new Error('Legacy discard hid a clean tab');
    for (const doc of retained) {
      const bytes = new Uint8Array(await doc.blob.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Legacy retained payload is unreadable');
    }
    // Leave the disposition pending: actual startup must migrate and clean it.
  }, recoveryUrl);
  await page.reload();
  await page.waitForFunction(() => window.luma?.studio.listDocuments().length === 2);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Restoring workspace"]'));
  assert.equal(await page.evaluate(() => window.luma.studio.dirtyDocuments().length), 0);
  assert.equal((await read()).length, 2);
  report.cases.push('Pre-migration v2 discard and startup preserve both clean tabs and readable payloads');
  report.pass = report.sourceSha256 === releaseSourceId();
} catch (error) {
  report.error = error.stack; process.exitCode = 1;
  if (page) {
    report.visibleFailureState = await page.locator('body').innerText().catch(() => 'unavailable');
    report.transactionErrors = await page.evaluate(() => window.quitQA?.transactionErrors).catch(() => []);
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  }
}
finally {
  await context?.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  release(); console.log(JSON.stringify({ output, ...report }, null, 2));
}
