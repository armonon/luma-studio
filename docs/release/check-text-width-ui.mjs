// Actual desktop-shell control in isolated WebKit; not the installed macOS app.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
const { webkit } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183/";
assert.equal(new URL(base).hostname, "127.0.0.1");
const release = acquireQualificationLock("Character width UI"), sourceSha256 = releaseSourceId();
const output = await mkdtemp(resolve("artifacts/text-width-ui-"));
const browser = await webkit.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { sourceSha256, scope: "Real character-width slider, history and project serialization in isolated WebKit desktop shell; not installed-app or full visual-regression qualification", pass: false, errors: [] };
const watchdog = setTimeout(() => void browser.close(), 150000);
page.on("pageerror", error => report.errors.push(String(error)));
try {
  await page.addInitScript(() => localStorage.setItem("luma.scripting", "on"));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await page.goto(base);
  await page.waitForFunction(() => window.luma?.studio.doc.layers.length > 0, { timeout: 60000 });
  await page.getByRole("status", { name: "Restoring workspace" }).waitFor({ state: "hidden" });
  const id = await page.evaluate(() => {
    const s = window.luma.studio; s.resetDocument(900, 600, "Width control review");
    const layer = s.addTextLayer("Width control proof", { font: '400 48px "Lato"', x: 100, y: 180, color: "#ffffff", defaultStyle: { fontStretch: 100, axes: { wdth: 90 } } });
    return layer.id;
  });
  await page.getByRole("option").filter({ hasText: "Width control proof" }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const slider = page.getByRole("slider", { name: /Character width/ });
  await slider.waitFor({ state: "visible", timeout: 15000 });
  const initial = await page.evaluate(id => ({ depth: window.luma.studio.historyState().currentDepth, style: window.luma.studio.findLayer(id).text.defaultStyle }), id);
  await slider.focus(); await slider.press("ArrowRight");
  await page.waitForFunction(id => window.luma.studio.findLayer(id).text.defaultStyle.fontStretch === 101, id);
  const changed = await page.evaluate(id => ({ depth: window.luma.studio.historyState().currentDepth, style: window.luma.studio.findLayer(id).text.defaultStyle }), id);
  assert.equal(changed.style.axes.wdth, 90, "character width must not mutate font variation metadata");
  assert.equal(changed.depth, initial.depth + 1, "one slider key gesture creates one undo entry");
  await slider.blur();
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Character width"]')?.value === "100");
  assert.equal(await slider.inputValue(), "100");
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Character width"]')?.value === "101");
  assert.equal(await slider.inputValue(), "101");
  await page.evaluate(async id => {
    const s = window.luma.studio, saved = await s.prepareProjectSave(); await s.importProject(saved.blob);
    const text = s.findLayer(id).text;
    if (text.defaultStyle.fontStretch !== 101 || text.defaultStyle.axes.wdth !== 90) throw new Error("Width or explicit axis changed during save/reopen");
  }, id);
  // Model installation precedes the keyed display canvas's next frame. Do not
  // mistake a model-only pass (or a blank first frame) for a rendered reopen.
  await page.waitForFunction(() => {
    const canvas = [...document.querySelectorAll("canvas")].find(c => c.clientWidth > 600 && c.clientHeight > 300);
    if (!canvas || !canvas.width || !canvas.height || canvas.width * canvas.height > 4_000_000) return false;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return false;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 16) if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245 && pixels[i + 3] > 245) ink++;
    return ink > 100;
  });
  await page.screenshot({ path: join(output, "character-width.png") });
  assert.deepEqual(report.errors, []);
  Object.assign(report, { pass: true, checks: ["Actual slider key gesture", "Independent variation axis preserved", "One committed undo entry", "Cmd-Z/Shift-Cmd-Z update the readout", "Native project serialization/reopen", "Reopened text painted onto the actual display canvas"] });
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  report.visibleControls = await page.getByRole("button").allTextContents().catch(() => []);
  report.textState = await page.evaluate(() => window.luma?.studio.doc.layers.filter(layer => layer.text).map(layer => ({ id: layer.id, width: layer.text.defaultStyle?.fontStretch, axes: layer.text.defaultStyle?.axes }))).catch(() => []);
} finally {
  clearTimeout(watchdog); await browser.close();
  report.unchanged = sourceSha256 === releaseSourceId();
  report.harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
  if (!report.unchanged) { report.pass = false; process.exitCode = 1; }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, pass: report.pass, error: report.error })); release();
}
