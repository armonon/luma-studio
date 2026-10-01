// WebKit emulation + synthetic painting; not physical iPhone/Pencil qualification.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const { webkit } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const url = process.env.LUMA_UI_URL ?? "http://localhost:4184/iphone";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const output = await mkdtemp(resolve("artifacts/brush-toolbox-"));
const report = { pass: false, errors: [], warnings: [], checks: [] };
const browser = await webkit.launch({ headless: true });
const watchdog = setTimeout(() => void browser.close(), 180000);
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => localStorage.setItem("luma.scripting", "on"));
  page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e)));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.luma?.studio.doc.layers.length > 0, { timeout: 90000 });
  await page.getByRole("status", { name: "Restoring workspace" }).waitFor({ state: "hidden" });
  report.warnings.push(...(await page.locator('.spatial-toast').allTextContents()).filter(text => /recovery|failed|error/i.test(text)));
  await page.getByRole("button", { name: "Paint tools", exact: true }).tap();
  assert.equal(await page.locator('.tool-family-menu').count(), 0, 'one tap selects Paint without opening a right-click menu');
  await page.getByRole("button", { name: "Open brush library" }).tap();
  const toolbox = page.locator(".brush-toolbox");
  assert.equal(await page.locator('[data-contextual-panel="paint"]').evaluate(el => getComputedStyle(el).backgroundColor), "rgb(32, 35, 40)", "brush panel must not inherit the old white card background");
  const depth = await page.evaluate(() => window.luma.studio.historyState().currentDepth);
  assert.equal(await toolbox.locator(".brush-preset-grid button").count(), 24);
  await page.waitForFunction(() => [...document.querySelectorAll('.brush-preset-grid canvas')].slice(0, 6).every(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0)));
  assert.equal(await toolbox.locator('.brush-preset-grid button').evaluateAll(buttons => buttons.every(b => b.querySelector('small').getBoundingClientRect().bottom <= b.getBoundingClientRect().bottom)), true, "preset names and categories fit their cards");
  const notices = await page.locator('.spatial-toast').allTextContents();
  report.warnings.push(...notices.filter(text => /recovery|failed|error/i.test(text) && !report.warnings.includes(text)));
  if (report.warnings.some(text => /Recovery needs attention/.test(text))) {
    report.warnings.push(await page.evaluate(() => new Promise(resolve => {
      // Separate empty probe in this isolated context, never a user's recovery DB.
      const request = indexedDB.open("luma-brush-qa-probe");
      request.onerror = () => resolve(`Independent IndexedDB probe: ${request.error?.name}: ${request.error?.message}`);
      request.onsuccess = () => { request.result.close(); resolve("Independent IndexedDB works; the legacy private-file storage lookup failed. Checkpoints remain protected."); };
    })));
  }
  await page.screenshot({ path: join(output, "brush-library.png") });
  await toolbox.getByRole("button", { name: "Ink", exact: true }).tap();
  assert.equal(await toolbox.locator(".brush-preset-grid button").count(), 4);
  await toolbox.getByRole("searchbox", { name: "Search brushes" }).fill("no-such-brush");
  await toolbox.getByRole("status").waitFor();
  await toolbox.getByRole("searchbox", { name: "Search brushes" }).fill("");
  await toolbox.getByRole("button", { name: "Monoline Ink", exact: true }).tap();
  assert.equal(await toolbox.getByRole("button", { name: "Monoline Ink", exact: true }).getAttribute("aria-pressed"), "true");
  report.checks.push("24 brushes, category filtering, empty search, preset selection");
  await toolbox.getByRole("button", { name: "Mirror", exact: true }).tap();
  assert.equal(await toolbox.getByRole("searchbox", { name: "Search brushes" }).isVisible(), false);
  await toolbox.getByRole("button", { name: "Four-way", exact: true }).tap();
  assert.equal(await page.locator('[data-brush-mirror="both"] line').count(), 2);
  await toolbox.getByRole("button", { name: "Kaleidoscope", exact: true }).tap();
  const repeat = toolbox.getByRole("slider", { name: "Symmetry repeats" });
  await repeat.focus(); await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  assert.equal(await repeat.inputValue(), "8");
  assert.equal(await page.locator('[data-brush-mirror="kaleidoscope"] line').count(), 8);
  await toolbox.locator("summary").click();
  const center = toolbox.getByRole("slider", { name: "Symmetry center X" });
  await center.focus(); await page.keyboard.press("Home");
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowRight");
  assert.equal(await center.inputValue(), "25");
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const bounds = await toolbox.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await toolbox.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "no horizontal panel overflow");
    await page.screenshot({ path: join(output, `brushes-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await toolbox.getByRole("button", { name: "Settings", exact: true }).tap();
  const toolSettings = page.locator('.brush-tool-settings');
  await toolSettings.getByRole('slider', { name: /^Size/ }).waitFor();
  assert.equal(await toolSettings.getByRole('slider', { name: /^Size/ }).inputValue(), "12");
  await page.screenshot({ path: join(output, "phone-paint-settings.png") });
  await toolbox.getByRole("button", { name: "Brushes", exact: true }).tap();
  assert.equal(await toolbox.getByRole("button", { name: "Monoline Ink", exact: true }).getAttribute("aria-pressed"), "true");
  const search = toolbox.getByRole('searchbox', { name: 'Search brushes' });
  await search.focus();
  // Emulate only visual viewport occlusion; this is not an iOS keyboard claim.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 360 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.locator('[data-soft-keyboard="true"]').waitFor();
  const keyboardPanel = await page.locator('.tablet-panel').boundingBox();
  assert.ok(keyboardPanel.y >= 0 && keyboardPanel.y + keyboardPanel.height <= 360);
  await search.fill('charcoal');
  await toolbox.getByRole('button', { name: 'All', exact: true }).tap();
  assert.equal(await toolbox.locator('.brush-preset-grid button').count(), 1);
  await page.locator('[data-soft-keyboard="true"]').waitFor();
  await toolbox.getByRole('button', { name: 'Charcoal Dry', exact: true }).scrollIntoViewIfNeeded();
  const resultBox = await toolbox.getByRole('button', { name: 'Charcoal Dry', exact: true }).boundingBox();
  assert.ok(resultBox.y >= 0 && resultBox.y + resultBox.height <= 360, 'search results stay above the keyboard after a category tap');
  await page.screenshot({ path: join(output, "phone-keyboard-occlusion.png") });
  await search.fill('');
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event('resize'));
    document.activeElement.blur();
  });
  await page.locator('[data-soft-keyboard="false"]').waitFor();
  report.checks.push('Three touch sections retain brush settings; visible-viewport keyboard occlusion keeps panel reachable');
  assert.equal(await page.evaluate(() => window.luma.studio.historyState().currentDepth), depth, "tool settings must not edit the document");
  await toolbox.getByRole("button", { name: "Done", exact: true }).tap();
  await page.evaluate(() => {
    const studio = window.luma.studio, begin = studio.beginStroke.bind(studio);
    studio.beginStroke = (layer, params, point) => { window.__brushSeen = structuredClone(params); return begin(layer, params, point); };
    const checkpoint = studio.exportRecoveryDocument.bind(studio);
    window.__recoveryEncodes = 0;
    studio.exportRecoveryDocument = (...args) => { window.__recoveryEncodes++; return checkpoint(...args); };
  });
  const canvas = page.locator("#studio-canvas canvas").filter({ visible: true }).first();
  await canvas.evaluate(el => { el.setPointerCapture = () => {}; el.releasePointerCapture = () => {}; });
  const box = await canvas.boundingBox();
  for (const [type, dx] of [["pointerdown", 0], ["pointermove", 25], ["pointerup", 25]]) await canvas.dispatchEvent(type, { pointerId: 77, pointerType: "touch", clientX: box.x + box.width / 2 + dx, clientY: box.y + box.height / 2, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true });
  const seen = await page.evaluate(() => ({ params: window.__brushSeen, width: window.luma.studio.doc.width, depth: window.luma.studio.historyState().currentDepth }));
  assert.equal(seen.params.size, 12); assert.equal(seen.params.pressureSize, false);
  assert.equal(seen.params.symmetry.radialSegments, 8); assert.equal(seen.params.symmetry.mirrorAlternating, true);
  assert.equal(seen.params.symmetry.centerX, seen.width * 0.25);
  assert.equal(seen.depth, depth + 1);
  assert.equal(await page.locator('.dynamic-canvas-cursor').getAttribute('data-visible'), 'false', 'finger strokes skip desktop cursor geometry');
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  assert.equal(await page.evaluate(() => window.luma.studio.historyState().currentDepth), depth);
  await page.getByRole("button", { name: "Redo", exact: true }).tap();
  assert.equal(await page.evaluate(() => window.luma.studio.historyState().currentDepth), depth + 1);
  report.checks.push("Off-center 8-way kaleidoscope reaches live stroke params; single-step undo/redo; three phone layouts");
  if (report.warnings.some(text => /private-file storage/.test(text))) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save project', exact: true }).tap();
    const backup = await download;
    assert.match(backup.suggestedFilename(), /\.luma$/);
    await backup.saveAs(join(output, 'phone-backup.luma'));
    await page.waitForFunction(() => document.querySelector('.studio-phone-save')?.getAttribute('aria-busy') !== 'true');
    assert.equal(await page.evaluate(() => window.__recoveryEncodes), 0, 'blocked storage must not repeatedly encode recovery ZIPs');
    assert.equal(await page.getByRole('button', { name: 'Save project', exact: true }).getAttribute('data-save-state'), 'error');
    report.checks.push('Explicit .luma download still works with failed private storage; recovery stays visibly unavailable and no checkpoint ZIP is encoded');
  }
  assert.equal(report.errors.length, 0);
  report.pass = true;
} catch (error) { report.errors.push(String(error)); process.exitCode = 1; }
finally {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, "last-state.png") }).catch(() => {});
  clearTimeout(watchdog); await browser.close();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(output); console.log(JSON.stringify(report, null, 2));
}
