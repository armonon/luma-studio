// Isolated WebKit desktop-shell interaction/capture campaign. Screenshots are
// candidates, never automatically blessed as visual-regression references.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const { webkit } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183/";
assert.equal(new URL(base).hostname, "127.0.0.1");
const sourceSha256 = releaseSourceId(), release = acquireQualificationLock("Desktop shell matrix");
const output = await mkdtemp(resolve("artifacts/shell-matrix-"));
// WebKit's ephemeral profile cannot persist Blob checkpoints on this host.
// Use an isolated disk profile so real recovery remains enabled and testable.
const context = await webkit.launchPersistentContext(join(output, "profile"), { headless: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [], screenshots = [], interactions = [];
const references = JSON.parse(await readFile(resolve('tests/visual-regression/shell-matrix.json'), 'utf8'));
page.on("pageerror", error => errors.push(error.message));
const watchdog = setTimeout(() => { void context.close(); }, 240000);
const report = { sourceSha256, scope: "Isolated persistent WebKit desktop-shell UI, not installed macOS dialogs or clean-machine qualification", screenshots, interactions, errors, pass: false };
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function compare(file, state, width, height) {
  const reference = references.references.find(item => item.state === state && item.width === width && item.height === height);
  assert.ok(reference, 'A reviewed reference is required');
  const canvas = createCanvas(width, height), context2d = canvas.getContext('2d');
  context2d.drawImage(await loadImage(resolve('tests/visual-regression', reference.file)), 0, 0);
  const before = context2d.getImageData(0, 0, width, height).data;
  context2d.clearRect(0, 0, width, height); context2d.drawImage(await loadImage(join(output, file)), 0, 0);
  const after = context2d.getImageData(0, 0, width, height).data;
  const status = await page.locator('.studio-project-title > span').boundingBox();
  assert.ok(status);
  // Only asynchronous recovery text is excluded. Never conceal a status error:
  // it is checked separately, as are the actual durable checkpoints and reload.
  assert.notEqual(await page.locator('.studio-project-title > span').innerText(), 'Save needs attention');
  const ignore = { x: status.x - 40, y: status.y - 2, width: status.width + 80, height: status.height + 4 };
  let delta = 0, changed = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= ignore.x && x <= ignore.x + ignore.width && y >= ignore.y && y <= ignore.y + ignore.height) continue;
    const offset = (y * width + x) * 4; let peak = 0;
    for (let c = 0; c < 4; c++) { const d = Math.abs(before[offset + c] - after[offset + c]); delta += d; peak = Math.max(peak, d); }
    if (peak > 8) changed++; count++;
  }
  const result = { meanAbsoluteDelta: delta / (count * 4), changedPixelFraction: changed / count,
    tolerances: { meanAbsoluteDelta: 0.25, changedPixelFraction: 0.001, changedChannelDelta: 8 }, excludedStatusRect: ignore };
  result.pass = result.meanAbsoluteDelta <= 0.25 && result.changedPixelFraction <= 0.001;
  return result;
}
async function capture(state, transform = false) {
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800]]) {
    await page.setViewportSize({ width, height }); await frame();
    assert.notEqual(await page.evaluate(() => window.getSelection()?.type), 'Range', 'Workspace gestures must not select the page');
    assert.equal(await page.locator('.studio-project-title strong').innerText(), await page.evaluate(() => window.luma.studio.activeDocumentState().name));
    const overflow = await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth > innerWidth,
      vertical: document.documentElement.scrollHeight > innerHeight,
      floating: [...document.querySelectorAll(".dock-floating-panel")].map(element => {
        const box = element.getBoundingClientRect(); return box.left < 0 || box.top < 0 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1;
      }) }));
    assert.equal(overflow.horizontal, false, `${state}: horizontal overflow at ${width}`);
    assert.equal(overflow.vertical, false, `${state}: vertical overflow at ${width}`);
    assert.ok(overflow.floating.every(value => !value), `${state}: floating panel offscreen`);
    let original;
    if (transform) {
      original = await page.evaluate(() => JSON.stringify(window.luma.studio.doc.layers.find(layer => layer.name === "Shape card").transform));
      const handle = await page.getByTitle("Scale · Shift constrains proportions (br)").boundingBox(); assert.ok(handle);
      const tl = await page.getByTitle("Scale · Shift constrains proportions (tl)").boundingBox(); assert.ok(tl);
      const scale = parseFloat(await page.locator('.studio-zoom-readout').innerText()) / 100;
      assert.ok(Math.abs(handle.x - tl.x - 240 * scale) < 4, 'Handles enclose the 240 px shape, not the entire document');
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down(); await page.mouse.move(handle.x + 35, handle.y + 25, { steps: 6 }); await frame();
      assert.notEqual(await page.evaluate(() => JSON.stringify(window.luma.studio.doc.layers.find(layer => layer.name === "Shape card").transform)), original);
    }
    const file = `${state}-${width}x${height}.png`;
    await page.screenshot({ path: join(output, file), animations: "disabled" });
    const comparison = await compare(file, state, width, height);
    screenshots.push({ state, file, width, height, reviewed: false, comparison });
    assert.ok(comparison.pass, `${file}: visual difference requires review: ${JSON.stringify(comparison)}`);
    if (transform) {
      await page.keyboard.press("Escape"); await page.mouse.up();
      assert.equal(await page.evaluate(() => JSON.stringify(window.luma.studio.doc.layers.find(layer => layer.name === "Shape card").transform)), original, "Escape restores the original transform");
    }
  }
}
try {
  await page.addInitScript(() => localStorage.setItem("luma.scripting", "on"));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await page.goto(base);
  await page.waitForFunction(() => window.luma?.studio.doc.layers.length > 0, { timeout: 60000 });
  await page.evaluate(() => {
    const studio = window.luma.studio; studio.resetDocument(900, 600, "Workspace review");
    for (const doc of studio.listDocuments()) if (doc.id !== studio.activeDocumentState().id) studio.closeDocument(doc.id);
    studio.markDocumentSaved();
  });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await capture("empty-document");
  await page.evaluate(() => {
    const studio = window.luma.studio, layer = studio.addBlankRaster("Canvas base"); studio.fillLayer(layer.id, "#183b50");
    studio.addTextLayer("Build with confidence", { font: '700 60px "Lato"', x: 70, y: 140, color: "#ffffff" });
    const shape = studio.addShapeLayer({ x: 200, y: 240, w: 240, h: 160, fill: "#73b5db", stroke: "none", strokeWidth: 0 });
    studio.setLayerProp(shape.id, "name", "Shape card");
  });
  await page.getByRole("option").filter({ hasText: "Canvas base" }).click();
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Brush", exact: true }).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("v");
  assert.equal(await page.getByRole("button", { name: "Move", exact: true }).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("b");
  assert.equal(await page.getByRole("button", { name: "Brush", exact: true }).getAttribute("aria-pressed"), "true");
  await capture("brush-selected"); interactions.push("Brush click and B/V shortcuts agree");
  await page.getByRole("option").filter({ hasText: "Build with confidence" }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await capture("text-selected");
  await page.getByRole("option").filter({ hasText: "Shape card" }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  const handles = page.getByRole("button", { name: "Handles", exact: true });
  if (await handles.getAttribute("aria-pressed") !== "true") await handles.click();
  await capture("transform-active", true); interactions.push("Actual corner drag and Escape rollback at all three viewports");
  await page.getByRole("button", { name: "Layers panel options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Float panel", exact: true }).click();
  await capture("floating-panel");
  const floating = page.locator(".dock-floating-panel");
  const size = await floating.boundingBox(), resize = await floating.locator(".dock-floating-resizer").boundingBox(); assert.ok(size && resize);
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down();
  await page.mouse.move(resize.x + 35, resize.y + 35, { steps: 6 }); await page.mouse.up();
  assert.ok((await floating.boundingBox()).width > size.width);
  await floating.getByRole("button", { name: "Dock", exact: true }).click();
  interactions.push("Float, resize and dock Layers via actual controls");
  await page.getByRole("button", { name: "Collapse right panel group", exact: true }).first().click();
  await capture("collapsed-panel-rail");
  assert.ok((await page.getByRole("navigation", { name: "right collapsed panels", exact: true }).boundingBox()).width <= 44);
  await page.getByRole("button", { name: "Open Layers panel", exact: true }).click();
  await page.evaluate(() => window.luma.studio.resetDocument(640, 480, "Second review"));
  await page.locator('.spatial-document-tabs > div > button:first-child').filter({ hasText: "Workspace review" }).click();
  await capture("multiple-documents");
  await page.getByRole("button", { name: "Close Workspace review", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => window.luma.studio.listDocuments().length), 2);
  interactions.push("Dirty-tab close Cancel retains both documents");
  assert.equal(await page.getByText("Save needs attention", { exact: true }).count(), 0);
  await page.evaluate(async moduleUrl => {
    const { writeRecoveryWorkspace, readRecoveryWorkspace } = await import(moduleUrl);
    await writeRecoveryWorkspace(await window.luma.studio.exportRecoveryWorkspace());
    const checkpoints = await readRecoveryWorkspace();
    if (checkpoints.length !== 2) throw new Error('Expected both durable document checkpoints');
  }, `/@fs/${resolve("app/engine/autosave.ts")}`);
  await page.reload();
  await page.waitForFunction(() => window.luma?.studio.listDocuments().length === 2 && window.luma.studio.doc.layers.length === 3);
  assert.equal(await page.locator('.studio-project-title strong').innerText(), "Workspace review");
  interactions.push("Real IndexedDB checkpoint and reload restores both tabs, active document and layers");
  await page.getByRole('option').filter({ hasText: 'Build with confidence' }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const textField = page.locator('textarea').filter({ visible: true }).first();
  await textField.click(); await page.keyboard.press('Meta+a');
  assert.equal(await textField.evaluate(element => element.selectionEnd - element.selectionStart), 'Build with confidence'.length);
  interactions.push('Text fields still support keyboard range selection');
  assert.deepEqual(errors, []);
  report.pass = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  try {
    await page.screenshot({ path: join(output, "failure.png") }); report.body = (await page.locator("body").innerText()).slice(0, 12000);
    report.domSelection = await page.evaluate(() => {
      const selection = window.getSelection();
      return { text: selection?.toString(), type: selection?.type, ranges: selection?.rangeCount,
        anchor: selection?.anchorNode?.parentElement?.outerHTML.slice(0, 800), focus: selection?.focusNode?.parentElement?.outerHTML.slice(0, 800),
        canvasStyle: [...document.querySelectorAll('.spatial-canvas')].map(element => ({ userSelect: getComputedStyle(element).userSelect, webkitUserSelect: getComputedStyle(element).webkitUserSelect })) };
    });
    if (report.domSelection?.type === 'Range') {
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.screenshot({ path: join(output, 'diagnostic-without-dom-selection.png') });
    }
  } catch {}
} finally {
  clearTimeout(watchdog); await context.close();
  report.unchanged = releaseSourceId() === sourceSha256;
  report.harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, pass: report.pass, error: report.error, screenshots: screenshots.length })); release();
}
