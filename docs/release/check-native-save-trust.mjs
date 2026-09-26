// Engine diagnostic in WebKit, not evidence of a complete installed-app job.
import { resolve } from "node:path";
import { writeFile, mkdtemp, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { releaseSourceId } from "../../build/release-source-id.mjs";
if (!process.argv[2] || process.argv[2] === '--help') {
  console.log('Usage: LUMA_PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs node docs/release/check-native-save-trust.mjs retained-private-source.psb [--warp | --filter | --ui] [--concurrent] [--edits=1..100]');
  process.exit(process.argv[2] === '--help' ? 0 : 1);
}
const input = resolve(process.argv[2]);
if (['--warp', '--filter', '--ui'].filter(flag => process.argv.includes(flag)).length > 1) throw new Error('Choose one diagnostic mode');
const editsArgument = process.argv.find(arg => arg.startsWith('--edits='));
const edits = editsArgument ? Number(editsArgument.slice(8)) : 1;
if (!Number.isInteger(edits) || edits < 1 || edits > 100 || (editsArgument && !process.argv.includes('--filter'))) throw new Error('--edits requires filter mode and an integer from 1 to 100');
if (!/\.ps[db]$/i.test(input) || (await stat(input)).size > 256 * 1024 * 1024) throw new Error('Diagnostic requires a PSD/PSB no larger than 256 MiB');
const inputSha256 = createHash('sha256').update(await readFile(input)).digest('hex');
const runtime = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const sourceSha256 = releaseSourceId();
const harnessSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const browser = await runtime.webkit.launch({ headless: true });
const output = await mkdtemp(resolve("artifacts/native-save-trust-"));
const watchdog = setTimeout(() => { void browser.close(); }, 180000);
try {
  const page = await browser.newPage();
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4183") return route.abort();
    if (url.pathname === "/source.psb") return route.fulfill({ path: resolve(process.argv[2]), contentType: "application/octet-stream" });
    if (url.pathname === "/qa.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Save trust diagnostic</title>" });
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:4183/${process.argv.includes("--ui") ? "" : "qa.html"}`);
  if (process.argv.includes("--ui")) {
    await page.locator('input[accept^=".luma,.pdf"]').waitFor({ state: "attached" });
    await page.evaluate(async () => {
      const moduleUrl = performance.getEntriesByType('resource').map(x => x.name).find(x => /\/engine\/studio\.ts(?:\?|$)/.test(x));
      if (!moduleUrl) throw new Error('Studio module was not loaded');
      const { Studio } = await import(moduleUrl);
      const original = Studio.prototype.prepareProjectSave;
      Studio.prototype.prepareProjectSave = async function (...args) {
        const state = { history: this.historyState(), layers: this.doc.layers.map(l => ({ name: l.name, bitmap: l.bitmap && [l.bitmap.width,l.bitmap.height], precision: l.surface?.stats() })) };
        try { const ticket = await original.apply(this, args); globalThis.saveTrustResult = { ...state, pass:true, bytes:ticket.blob.size }; return ticket; }
        catch (error) { globalThis.saveTrustResult = { ...state, pass:false, error:String(error) }; throw error; }
      };
    });
    await page.locator('input[accept^=".luma,.pdf"]').setInputFiles(resolve(process.argv[2]));
    await page.getByRole("button", { name: "Close Imported PSD", exact: true }).waitFor({ timeout: 90000 });
    await page.locator('#studio-canvas').focus();
    await page.getByLabel("More application actions", {exact:true}).click();
    await page.getByRole("button", { name: "Save project ⌘S", exact: true }).click();
    try { await page.waitForFunction(() => !!globalThis.saveTrustResult, undefined, { timeout: 60000 }); }
    catch (error) { console.log(await page.locator('body').innerText()); throw error; }
    const report = { sourceSha256, harnessSha256, inputSha256, generatedAt: new Date().toISOString(), scope: 'Headless desktop UI save preparation; not native dialogs', unchanged: releaseSourceId() === sourceSha256, result: await page.evaluate(() => globalThis.saveTrustResult) };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2), output);
    if (!report.unchanged || !report.result.pass) process.exitCode = 1;
  } else {
  const result = await page.evaluate(async ({root, warp, filter, concurrent, edits}) => {
    const { Studio } = await import(`${root}/app/engine/studio.ts`);
    const studio = new Studio(8, 8, document.createElement("canvas"));
    try {
      await studio.importPsd(await (await fetch("/source.psb")).arrayBuffer());
      const target = studio.doc.layers.find(layer => layer.bitmap);
      const pixels = bitmap => bitmap.toDataURL('image/png');
      const edited = warp || filter;
      const before = edited ? pixels(target.bitmap) : null;
      if (warp) studio.radialWarpLayer(target.id, {x:300,y:300}, {x:320,y:310}, 360);
      if (filter) {
        const { selectRect } = await import(`${root}/app/engine/selection.ts`);
        selectRect(studio.doc, target.transform.tx + 300, target.transform.ty + 300, 128, 96, 'replace');
        for (let i = 0; i < edits; i++) studio.filter(target.id, 'invert');
      }
      const after = edited ? pixels(target.bitmap) : null;
      const layers = studio.doc.layers.map(layer => ({ name: layer.name, kind: layer.kind,
        bitmap: layer.bitmap && [layer.bitmap.width, layer.bitmap.height],
        precision: layer.surface?.store.stats(),
      }));
      const history = studio.historyState();
      try {
        const [blob, recovery] = await Promise.all([
          studio.exportProject("Native trust QA"),
          concurrent ? studio.exportRecoveryDocument() : Promise.resolve(null),
        ]);
        if (edited) {
          await studio.importProject(blob);
          const restored = studio.doc.layers.find(layer => layer.name === target.name);
          const reopened = pixels(restored.bitmap) === after;
          const steps = filter ? edits : 1;
          for (let i = 0; i < steps; i++) studio.undo();
          const undo = pixels(restored.bitmap) === before;
          for (let i = 0; i < steps; i++) studio.redo();
          const redo = pixels(restored.bitmap) === after;
          return { pass: reopened && undo && redo, reopened, undo, redo, editingSteps: steps, concurrentRecoveryBytes: recovery?.blob.size, bytes: blob.size, layers, history };
        }
        return { pass: true, bytes: blob.size, layers, history };
      } catch (error) { return { pass: false, error: String(error), layers, history }; }
    } finally { studio.dispose(); }
  }, {root:`/@fs${process.cwd()}`, warp:process.argv.includes('--warp'), filter:process.argv.includes('--filter'), concurrent:process.argv.includes('--concurrent'), edits});
  const report = { sourceSha256, harnessSha256, inputSha256, scope:'Headless WebKit engine; not installed-app qualification', unchanged: releaseSourceId() === sourceSha256, generatedAt: new Date().toISOString(), result };
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2), output);
  if (!report.unchanged || !result.pass) process.exitCode = 1;
  }
} finally { clearTimeout(watchdog); await browser.close(); }
