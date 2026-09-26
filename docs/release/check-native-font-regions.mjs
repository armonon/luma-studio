// Full-resolution regional diagnostic, not complete-document qualification.
// Private Photoshop copies only; exact native font extraction, simulated IPC.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, copyFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fidelityMetrics, withinFidelityTolerance } from "../../build/fidelity-metrics.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
const exec = promisify(execFile), hash = value => createHash("sha256").update(value).digest("hex");
const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183";
assert.equal(new URL(base).hostname, "127.0.0.1");
const inputFolder = resolve(process.argv[2] ?? ""); assert.ok(process.argv[2]);
const original = JSON.parse(await readFile(join(inputFolder, "report.json"), "utf8"));
const runtime = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const sourceSha256 = releaseSourceId(), release = acquireQualificationLock("Full-resolution typography regions");
const output = await mkdtemp(resolve("artifacts/native-font-regions-"));
const paragraph = process.argv.includes("--paragraph");
const regions = paragraph ? [{ id: "paragraph", x: 0, y: 0, width: 600, height: 400 }] : [
  { id: "private-ndw", x: 900, y: 900, width: 768, height: 768 },
  { id: "private-ndw", x: 1100, y: 2110, width: 768, height: 400 },
];
// ExtendScript touches only the newly opened private copy and its duplicate.
const script = String.raw`(function(a){
  var input=new File(a[0]),output=new File(a[1]),x=Number(a[2]),y=Number(a[3]),w=Number(a[4]),h=Number(a[5]);
  if(!input.exists||output.exists||x<0||y<0||!(w>0&&h>0&&w*h<=1048576))throw Error('Unsafe region request');
  for(var i=0;i<app.documents.length;i++){try{if(app.documents[i].fullName.fsName===input.fsName)throw Error('LUMA_INPUT_ALREADY_OPEN');}catch(e){if(String(e).indexOf('LUMA_INPUT_ALREADY_OPEN')>=0)throw e;}}
  var dialogs=app.displayDialogs,units=app.preferences.rulerUnits,previous=app.documents.length?app.activeDocument:null,doc=null,copy=null;
  try{
    app.displayDialogs=DialogModes.NO;app.preferences.rulerUnits=Units.PIXELS;doc=app.open(input);
    if(x+w>doc.width.as('px')||y+h>doc.height.as('px'))throw Error('Region outside original');
    copy=doc.duplicate('Luma isolated full-resolution region',false);
    copy.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
    if(copy.layers.length>1)copy.mergeVisibleLayers();copy.bitsPerChannel=BitsPerChannelType.EIGHT;
    copy.crop([UnitValue(x,'px'),UnitValue(y,'px'),UnitValue(x+w,'px'),UnitValue(y+h,'px')]);
    if(copy.width.as('px')!==w||copy.height.as('px')!==h)throw Error('Unexpected cropped dimensions');
    copy.saveAs(output,new PNGSaveOptions(),true,Extension.LOWERCASE);return app.version;
  }finally{if(copy)copy.close(SaveOptions.DONOTSAVECHANGES);if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);app.displayDialogs=dialogs;app.preferences.rulerUnits=units;if(previous)try{app.activeDocument=previous;}catch(ignore){}}
})(arguments);`;
const apple = 'on run argv\ntell application "Adobe Photoshop 2026"\nwith timeout of 120 seconds\nreturn do javascript (item 1 of argv) with arguments {item 2 of argv,item 3 of argv,item 4 of argv,item 5 of argv,item 6 of argv,item 7 of argv}\nend timeout\nend tell\nend run';
async function rgba(file, width, height) {
  const image = await loadImage(file); assert.equal(image.width, width); assert.equal(image.height, height);
  const c = createCanvas(width, height), ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}
try {
  const binary = join(output, "exact-font"), results = [];
  await exec("rustc", ["--edition", "2021", "build/diagnose-installed-font.rs", "-o", binary], { timeout: 120000 });
  for (const [index, region] of regions.entries()) {
    const entry = paragraph ? { id: "paragraph", kind: "psd", inputSha256: original.inputSha256 }
      : original.results.find(entry => entry.id === region.id); assert.ok(entry);
    const retained = paragraph ? join(inputFolder, "photoshop-source.psd") : join(inputFolder, entry.id, `source.${entry.kind}`);
    assert.ok((await stat(retained)).size <= 256 * 1024 * 1024);
    const inputSha256 = hash(await readFile(retained)); assert.equal(inputSha256, entry.inputSha256);
    const input = join(output, `${index}-source.${entry.kind}`), reference = join(output, `${index}-photoshop.png`), actual = join(output, `${index}-luma.png`);
    await copyFile(retained, input);
    const result = { region, inputSha256, pass: false };
    let browser;
    let watchdog;
    try {
      const ref = await exec("osascript", ["-e", apple, script, input, reference, ...[region.x, region.y, region.width, region.height].map(String)], { timeout: 125000 });
      result.photoshop = ref.stdout.trim(); result.referenceSha256 = hash(await readFile(reference));
      browser = await runtime.webkit.launch({ headless: true }); result.webkit = await browser.version();
      watchdog = setTimeout(() => { void browser.close(); }, 120000);
      const page = await browser.newPage();
      await page.exposeFunction("nativeExactFont", async name => (await exec(binary, [name], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024, timeout: 20000 })).stdout.toString("base64"));
      await page.addInitScript(() => { globalThis.__TAURI__ = { core: { invoke: async (command, args) => {
        if (command !== "read_installed_font") throw new Error("Unsupported diagnostic command");
        return Uint8Array.from(atob(await globalThis.nativeExactFont(args.postscriptName)), ch => ch.charCodeAt(0)).buffer;
      } } }; });
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/qualification-source") return route.fulfill({ path: input, contentType: "application/octet-stream" });
        if (url.pathname === "/qualify.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated full-resolution region</title>" });
        return route.continue();
      });
      await page.goto(`${base}/qualify.html`);
      const png = await page.evaluate(async ({ root, region }) => {
        const { importPsd } = await import(`${root}/app/engine/psd.ts`);
        const { renderViewport } = await import(`${root}/app/engine/renderer.ts`);
        const { waitForDocumentFonts } = await import(`${root}/app/engine/text-font-resources.ts`);
        const doc = await importPsd(await (await fetch("/qualification-source")).arrayBuffer());
        await waitForDocumentFonts(doc);
        const c = document.createElement("canvas"); c.width = region.width; c.height = region.height;
        renderViewport(doc, c, { ...region, zoom: 1, outputWidth: region.width, outputHeight: region.height, cssScale: 1, devicePixelRatio: 1 }, { checkerboard: false, selectionOverlay: false, proofing: false });
        return c.toDataURL("image/png").split(",")[1];
      }, { root: `/@fs${process.cwd()}`, region });
      await writeFile(actual, Buffer.from(png, "base64"), { flag: "wx" });
      result.metrics = fidelityMetrics(await rgba(actual, region.width, region.height), await rgba(reference, region.width, region.height), region.width, region.height);
      result.pass = withinFidelityTolerance(result.metrics);
    } catch (error) { result.error = String(error); }
    finally { clearTimeout(watchdog); await browser?.close(); }
    results.push(result); console.log(JSON.stringify(result));
  }
  const report = { sourceSha256, unchanged: releaseSourceId() === sourceSha256, generatedAt: new Date().toISOString(),
    scope: paragraph ? "One independently authored Photoshop paragraph at native resolution; not installed-app or real-project corpus qualification"
      : "Two selected native-resolution typography regions, not a full-document or installed-app qualification", harnessSha256: hash(await readFile(new URL(import.meta.url))), results };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(output);
  if (!report.unchanged || results.some(result => !result.pass)) process.exitCode = 1;
} finally { release(); }
