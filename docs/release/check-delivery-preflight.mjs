import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const runtime = await import(process.env.LUMA_PLAYWRIGHT_MODULE || "playwright");
const name = process.env.LUMA_UI_BROWSER || "chromium";
const browser = await runtime[name].launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(30000);
await page.addInitScript(() => localStorage.setItem("luma.scripting", "on"));
await mkdir("artifacts/delivery-preflight-ui", { recursive: true });
async function open() {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export PSD", exact: true }).click();
  return page.getByRole("dialog", { name: "Review PSD delivery" });
}
try {
  await page.goto(process.env.LUMA_UI_URL || "http://127.0.0.1:4179/");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => window.luma?.studio);
  const target = await page.evaluate(() => {
    const studio = window.luma.studio;
    studio.resetDocument(160, 160, "Delivery safety");
    const layer = studio.addBlankRaster("Masked master"); studio.fillLayer(layer.id, "#ff6644");
    layer.vectorMask = { closed: true, fill: "#fff", stroke: "none", strokeWidth: 0,
      anchors: [[0, 0], [80, 0], [80, 160], [0, 160]].map(([x, y]) => ({ x, y, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })) };
    studio.setLayerProp(layer.id, "opacity", .99); return layer.id;
  });
  for (const [width, height] of [[1280, 720], [1280, 800], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const dialog = await open(); await dialog.getByText("Export blocked", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Export with these limitations" }).count(), 0);
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false);
    await page.screenshot({ path: `artifacts/delivery-preflight-ui/${name}-blocked-${width}x${height}.png` });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  }
  let dialog = await open();
  await dialog.getByRole("button", { name: "Show affected layer" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(id => window.luma.studio.doc.layers.some(layer => layer.id === id && layer.vectorMask), target), true);
  await page.evaluate(() => { const s = window.luma.studio; s.resetDocument(160, 160, "Limited copy"); s.addProAdjustmentLayer("color-lookup"); });
  dialog = await open(); await dialog.getByText("Partially editable copy", { exact: true }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  await page.screenshot({ path: `artifacts/delivery-preflight-ui/${name}-partial.png` });
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  assert.deepEqual(errors, []);
  console.log(`${name}: blocked export, cancellation, affected-layer route, partial-copy disclosure, focus containment and four viewports passed`);
} catch (error) {
  await page.screenshot({ path: `artifacts/delivery-preflight-ui/${name}-failure.png` });
  console.error(await page.locator("body").innerText());
  console.error(errors); throw error;
} finally { await browser.close(); }
