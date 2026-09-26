// Explicit local diagnostic, not installed-app or production qualification.
// Run with node --import tsx and a loopback desktop Vite server.
import assert from "node:assert/strict";
import { readFile, stat, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fidelityMetrics, withinFidelityTolerance } from "../../build/fidelity-metrics.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";

const inputFolder = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Supply a retained independent Photoshop evidence directory");
const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183";
assert.equal(new URL(base).hostname, "127.0.0.1", "Private fixtures stay on loopback");
const runtime = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const original = JSON.parse(await readFile(join(inputFolder, "report.json"), "utf8"));
const sourceSha256 = releaseSourceId();
assert.equal(original.sourceSha256, sourceSha256, "Reference workflow must match current source");
const release = acquireQualificationLock("WebKit Photoshop import preview");
const output = await mkdtemp(resolve("artifacts/webkit-import-")), results = [];
const hash = data => createHash("sha256").update(data).digest("hex");
async function pixels(bytes, width, height) {
  const image = await loadImage(bytes);
  assert.equal(image.width, width); assert.equal(image.height, height);
  const canvas = createCanvas(width, height), ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}
try {
  for (const entry of original.results) {
    assert.match(entry.id, /^[a-z0-9-]+$/); assert.ok(["psd", "psb"].includes(entry.kind));
    const folder = join(inputFolder, entry.id), input = join(folder, `source.${entry.kind}`);
    assert.ok((await stat(input)).size <= 256 * 1024 * 1024);
    assert.equal(hash(await readFile(input)), entry.inputSha256);
    const reference = JSON.parse(await readFile(join(folder, "photoshop-original.json"), "utf8"));
    assert.ok(reference.width * reference.height <= 32_000_000);
    const { width, height } = reference.render;
    assert.ok(width * height <= 1048576);
    const browser = await runtime.webkit.launch({ headless: true });
    const timeout = setTimeout(() => { void browser.close(); }, 120000);
    const result = { id: entry.id, browser: await browser.version(), pass: false };
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/qualification-source") return route.fulfill({ path: input, contentType: "application/octet-stream" });
        if (url.pathname === "/qualify.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Luma isolated preview qualification</title>" });
        return route.continue();
      });
      await page.goto(`${base}/qualify.html`);
      const png = await page.evaluate(async ({ root, width, height }) => {
        const { importPsd } = await import(`${root}/app/engine/psd.ts`);
        const { renderViewport } = await import(`${root}/app/engine/renderer.ts`);
        const { pendingDocumentFonts } = await import(`${root}/app/engine/text-font-resources.ts`);
        const doc = await importPsd(await (await fetch("/qualification-source")).arrayBuffer());
        await pendingDocumentFonts(doc);
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        renderViewport(doc, canvas, { x: 0, y: 0, width: doc.width, height: doc.height, zoom: width / doc.width,
          outputWidth: width, outputHeight: height, cssScale: 1, devicePixelRatio: 1 },
          { checkerboard: false, selectionOverlay: false, proofing: false });
        return canvas.toDataURL("image/png").split(",")[1];
      }, { root: `/@fs${process.cwd()}`, width, height });
      const bytes = Buffer.from(png, "base64");
      await writeFile(join(output, `${entry.id}.png`), bytes, { flag: "wx" });
      result.metrics = fidelityMetrics(await pixels(bytes, width, height), await pixels(await readFile(join(folder, "photoshop-original.png")), width, height), width, height);
      result.pass = withinFidelityTolerance(result.metrics);
    } catch (error) { result.error = String(error); }
    finally { clearTimeout(timeout); await browser.close(); }
    results.push(result); console.log(JSON.stringify(result));
  }
  const report = { sourceSha256, unchanged: releaseSourceId() === sourceSha256, harnessSha256: hash(await readFile(new URL(import.meta.url))),
    generatedAt: new Date().toISOString(), independentReference: inputFolder,
    scope: "Headless WebKit import preview at 512px long edge; not installed Tauri, full-resolution, external re-edit or performance qualification", results };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(output);
  if (!report.unchanged || results.some(result => !result.pass)) process.exitCode = 1;
} finally { release(); }
