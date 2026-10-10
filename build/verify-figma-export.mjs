/**
 * End-to-end check of "Export for Figma" in the real studio (headless Chrome).
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright \
 *   RESVG=/path/to/node_modules/@resvg/resvg-js \
 *   node build/verify-figma-export.mjs http://localhost:3123 fixture.luma out-dir
 *
 * Playwright and resvg are not dependencies of this repo; point at any local
 * install. Steps: open /studio, open the fixture project, export PNG (Luma's
 * own renderer = reference), export for Figma (live text) and again with
 * "Outline text", then:
 *   1. parse each SVG with an independent XML parser (resvg's usvg),
 *   2. rasterize with resvg and with Chrome (inline SVG in the studio page so
 *      the same bundled web fonts apply),
 *   3. pixel-compare against the PNG within tolerance.
 * Figma itself is not installed here; this verifies by spec + rasterization.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const { Resvg } = require(process.env.RESVG ?? "@resvg/resvg-js");
const { PNG } = require(process.env.PNGJS ?? "pngjs");

const [base = "http://localhost:3123", fixture = "artifacts/figma-export/fixture.luma", outDir = "artifacts/figma-export"] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const fontDir = resolve("public/fonts");
const fontFiles = readdirSync(fontDir).filter(f => f.endsWith(".ttf")).map(f => join(fontDir, f));

const decode = (buffer) => PNG.sync.read(buffer);
function compare(reference, actual, label, { channel = 32, maxFraction = 0.02 } = {}) {
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error(`${label}: size ${actual.width}x${actual.height} != ${reference.width}x${reference.height}`);
  let differing = 0, worst = 0, total = 0;
  const diff = new PNG({ width: reference.width, height: reference.height });
  for (let i = 0; i < reference.data.length; i += 4) {
    // Compare premultiplied-on-white so transparent pixels with junk RGB agree.
    const over = (d, j) => [0, 1, 2].map(c => d[j + c] * d[j + 3] / 255 + 255 * (1 - d[j + 3] / 255));
    const a = over(reference.data, i), b = over(actual.data, i);
    const delta = Math.max(...a.map((v, c) => Math.abs(v - b[c])), Math.abs(reference.data[i + 3] - actual.data[i + 3]));
    total += delta; worst = Math.max(worst, delta);
    const bad = delta > channel;
    if (bad) differing += 1;
    diff.data[i] = bad ? 255 : a[0] * 0.3; diff.data[i + 1] = bad ? 0 : a[1] * 0.3; diff.data[i + 2] = bad ? 0 : a[2] * 0.3; diff.data[i + 3] = 255;
  }
  const pixels = reference.width * reference.height;
  const result = { label, differingFraction: differing / pixels, meanDelta: total / pixels, worst, pass: differing / pixels <= maxFraction };
  return { result, diff: PNG.sync.write(diff) };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push(String(e)));

await page.goto(`${base}/studio`, { waitUntil: "load" });
await page.waitForSelector('input[accept=".luma,application/x-luma-project"]', { state: "attached", timeout: 60000 });
await page.waitForTimeout(1500);
await page.setInputFiles('input[accept=".luma,application/x-luma-project"]', resolve(fixture));
await page.waitForFunction(() => /Figma export fixture/.test(document.body.innerText), null, { timeout: 30000 });
await page.waitForTimeout(1000);

async function exportVia(click) {
  await page.locator("button.spatial-export").click();
  await page.waitForSelector('[aria-label="Export document"]');
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path) };
}

const png = await exportVia(() => page.getByRole("button", { name: /^Export PNG$/ }).click());
await writeFile(join(outDir, "luma.png"), png.bytes);
const live = await exportVia(() => page.getByRole("button", { name: "Export for Figma" }).click());
await writeFile(join(outDir, "figma-live-text.svg"), live.bytes);
const outlined = await exportVia(async () => {
  await page.getByLabel(/Outline text/).check();
  await page.getByRole("button", { name: "Export for Figma" }).click();
});
await writeFile(join(outDir, "figma-outlined.svg"), outlined.bytes);
const toast = await page.locator("text=/Exported for Figma/").first().textContent({ timeout: 5000 }).catch(() => null);

const reference = decode(png.bytes);
const results = [];
const structure = {};
for (const [label, file] of [["live text", live], ["outlined text", outlined]]) {
  const svg = file.bytes.toString("utf8");
  // 1. Independent parse (usvg inside resvg) — throws on malformed SVG.
  const resvg = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Lato" }, background: "rgba(0,0,0,0)" });
  const ids = [...svg.matchAll(/<g id="([^"]+)"/g)].map(m => m[1]);
  structure[label] = { file: file.name, bytes: file.bytes.length, groupIds: ids, texts: (svg.match(/<text /g) ?? []).length, images: (svg.match(/<image /g) ?? []).length, paths: (svg.match(/<path /g) ?? []).length, rects: (svg.match(/<rect /g) ?? []).length, ellipses: (svg.match(/<ellipse /g) ?? []).length, size: `${resvg.width}x${resvg.height}` };
  // 2a. resvg rasterization.
  const resvgPng = resvg.render().asPng();
  await writeFile(join(outDir, `resvg-${label.replace(" ", "-")}.png`), resvgPng);
  const r = compare(reference, decode(resvgPng), `resvg · ${label}`);
  await writeFile(join(outDir, `diff-resvg-${label.replace(" ", "-")}.png`), r.diff);
  results.push(r.result);
  // 2b. Chrome rasterization, inline in the studio page (bundled fonts loaded).
  const shot = await page.evaluate(async (markup) => {
    const host = document.createElement("div");
    host.id = "__figma_probe";
    host.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;line-height:0;background:transparent;pointer-events:none";
    host.innerHTML = markup.replace(/^<\?xml[^>]*>\s*/, "");
    document.body.appendChild(host);
    await document.fonts.ready;
    const svg = host.querySelector("svg");
    return { width: svg.width.baseVal.value, height: svg.height.baseVal.value };
  }, svg);
  await page.waitForTimeout(300);
  const chromePng = await page.screenshot({ clip: { x: 0, y: 0, width: shot.width, height: shot.height }, omitBackground: true });
  await page.evaluate(() => document.getElementById("__figma_probe")?.remove());
  await writeFile(join(outDir, `chrome-${label.replace(" ", "-")}.png`), chromePng);
  const c = compare(reference, decode(chromePng), `chrome · ${label}`);
  await writeFile(join(outDir, `diff-chrome-${label.replace(" ", "-")}.png`), c.diff);
  results.push(c.result);
}
await browser.close();
const report = { base, fixture, toast, structure, results, consoleErrors, pass: results.every(r => r.pass) && consoleErrors.length === 0 };
await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
