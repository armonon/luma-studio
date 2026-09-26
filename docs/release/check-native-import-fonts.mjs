// Diagnostic only: real CoreText font extraction + actual engine modules in
// headless WebKit, with a simulated binary IPC transport. NOT installed Tauri.
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { readFile, stat, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fidelityMetrics, withinFidelityTolerance } from "../../build/fidelity-metrics.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
const exec = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.ok(process.argv[2], "Supply retained independent Photoshop references");
const inputFolder = resolve(process.argv[2]), base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183";
assert.equal(new URL(base).hostname, "127.0.0.1");
const runtime = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const original = JSON.parse(await readFile(join(inputFolder, "report.json"), "utf8"));
const sourceSha256 = releaseSourceId(), release = acquireQualificationLock("CoreText/WebKit imported typography");
const output = await mkdtemp(resolve("artifacts/native-font-preview-")), results = [];
async function pixels(bytes, width, height) {
  const image = await loadImage(bytes); assert.equal(image.width, width); assert.equal(image.height, height);
  const canvas = createCanvas(width, height), ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}
try {
  const binary = join(output, "exact-font");
  await exec("rustc", ["--edition", "2021", "build/diagnose-installed-font.rs", "-o", binary], { timeout: 120000 });
  for (const entry of original.results) {
    assert.match(entry.id, /^[a-z0-9-]+$/); assert.ok(["psd", "psb"].includes(entry.kind));
    const folder = join(inputFolder, entry.id), input = join(folder, `source.${entry.kind}`);
    assert.ok((await stat(input)).size <= 256 * 1024 * 1024);
    assert.equal(hash(await readFile(input)), entry.inputSha256);
    const reference = JSON.parse(await readFile(join(folder, "photoshop-original.json"), "utf8"));
    assert.ok(reference.width * reference.height <= 32_000_000);
    const { width, height } = reference.render; assert.ok(width * height <= 1048576);
    const referencePng = await readFile(join(folder, "photoshop-original.png"));
    const result = { id: entry.id, pass: false, inputSha256: entry.inputSha256, referencePngSha256: hash(referencePng), faces: [] };
    const browser = await runtime.webkit.launch({ headless: true });
    const watchdog = setTimeout(() => { void browser.close(); }, 120000);
    try {
      const page = await browser.newPage(); result.browser = await browser.version();
      await page.exposeFunction("nativeExactFont", async name => {
        try {
          const { stdout } = await exec(binary, [name], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024, timeout: 20000 });
          result.faces.push({ name, bytes: stdout.length, sha256: hash(stdout) });
          return stdout.toString("base64");
        } catch (error) { result.faces.push({ name, error: String(error) }); throw error; }
      });
      await page.addInitScript(() => {
        globalThis.__TAURI__ = { core: { invoke: async (command, args) => {
          if (command !== "read_installed_font") throw new Error(`Diagnostic does not implement ${command}`);
          const bytes = atob(await globalThis.nativeExactFont(args.postscriptName));
          return Uint8Array.from(bytes, ch => ch.charCodeAt(0)).buffer;
        } } };
      });
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/qualification-source") return route.fulfill({ path: input, contentType: "application/octet-stream" });
        if (url.pathname === "/qualify.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local native font diagnostic</title>" });
        return route.continue();
      });
      await page.goto(`${base}/qualify.html`);
      const rendered = await page.evaluate(async ({ root, width, height }) => {
        const { importPsd } = await import(`${root}/app/engine/psd.ts`);
        const { renderViewport } = await import(`${root}/app/engine/renderer.ts`);
        const { waitForDocumentFonts } = await import(`${root}/app/engine/text-font-resources.ts`);
        const { nativeFontResourceStats } = await import(`${root}/app/engine/native-font-resources.ts`);
        const doc = await importPsd(await (await fetch("/qualification-source")).arrayBuffer()), errors = [];
        // Still render a diagnostic when fonts are missing, but never pass it.
        for (const layer of doc.layers) if (layer.text) {
          try { await waitForDocumentFonts({ layers: [layer] }); }
          catch (error) { errors.push({ layerId: layer.id, name: layer.name, error: String(error) }); }
        }
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        renderViewport(doc, canvas, { x: 0, y: 0, width: doc.width, height: doc.height, zoom: width / doc.width,
          outputWidth: width, outputHeight: height, cssScale: 1, devicePixelRatio: 1 },
          { checkerboard: false, selectionOverlay: false, proofing: false });
        return { png: canvas.toDataURL("image/png").split(",")[1], errors, fonts: nativeFontResourceStats() };
      }, { root: `/@fs${process.cwd()}`, width, height });
      const png = Buffer.from(rendered.png, "base64");
      await writeFile(join(output, `${entry.id}.png`), png, { flag: "wx" });
      result.fontErrors = rendered.errors; result.fonts = rendered.fonts;
      result.metrics = fidelityMetrics(await pixels(png, width, height), await pixels(referencePng, width, height), width, height);
      result.pass = !rendered.errors.length && !rendered.fonts.pendingFaces && withinFidelityTolerance(result.metrics);
    } catch (error) { result.error = String(error); }
    finally { clearTimeout(watchdog); await browser.close(); }
    results.push(result); console.log(JSON.stringify(result));
  }
  const report = { sourceSha256, unchanged: releaseSourceId() === sourceSha256, harnessSha256: hash(await readFile(new URL(import.meta.url))),
    generatedAt: new Date().toISOString(), independentReference: inputFolder, referenceWorkflowSource: original.sourceSha256,
    scope: "512px headless WebKit preview, actual CoreText extraction, simulated IPC. Retained independently rendered Photoshop references; NOT a new external export round trip, full-resolution or installed-app qualification.", results };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(output);
  if (!report.unchanged || results.some(result => !result.pass)) process.exitCode = 1;
} finally { release(); }
