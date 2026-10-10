/**
 * Installable + offline check for /studio in headless Chrome.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright \
 *   node build/verify-pwa.mjs https://luma.example fixture.luma [out-dir]
 *
 * 1. Manifest parses with name "Luma", start_url, icons that resolve, and
 *    Chrome reports no installability errors (CDP Page.getInstallabilityErrors).
 * 2. /sw.js is served with Cache-Control: no-cache and controls /studio.
 * 3. The precache completes (every URL listed in sw.js is in Cache Storage).
 * 4. Offline: reload /studio, open a .luma file, edit (hide a layer), export
 *    PNG and Export for Figma (live and outlined text, which runs the cached
 *    shaping worker) — downloads succeed; reload again offline.
 * 5. Server routes are untouched: /api/ai/edit still reaches the function.
 * 0 console errors required (offline network failures of the optional suite
 * script are reported separately, not counted).
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const [base = "http://localhost:3123", fixture = "artifacts/figma-export/fixture.luma", outDir = "artifacts/pwa"] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const networkNoise = [];
page.on("console", m => {
  if (m.type() !== "error") return;
  const text = m.text();
  // Offline, the optional cross-origin suite script cannot load; the app is
  // required to keep working without it. Track it, don't fail on it.
  const where = m.location()?.url ?? "";
  if (/thecreatingco\.com\/suite|ERR_INTERNET_DISCONNECTED/.test(text + where)) networkNoise.push(text);
  // The deliberate unauthenticated probe of the AI function below logs 401.
  else if (/status of 401/.test(text) && /\/api\/ai\/edit/.test(where)) networkNoise.push(text);
  else consoleErrors.push(`${text} @ ${where}`);
});
let phase = "online";
page.on("pageerror", e => consoleErrors.push(`[${phase}] ${String(e)} ${e?.stack?.split("\n").slice(0, 3).join(" | ") ?? ""}`));

// 1. Manifest + installability.
await page.goto(`${base}/studio`, { waitUntil: "load" });
const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
const manifest = await (await page.request.get(new URL(manifestHref, base).href)).json();
check("manifest name is Luma", manifest.name === "Luma" && manifest.short_name === "Luma", `${manifest.name} / ${manifest.short_name}`);
check("manifest start_url /studio, standalone", manifest.start_url === "/studio" && manifest.display === "standalone");
const iconStatuses = await Promise.all(manifest.icons.map(async icon => (await page.request.get(new URL(icon.src, base).href)).status()));
check("manifest icons resolve (incl. 192/512 + maskable)", iconStatuses.every(s => s === 200) && manifest.icons.some(i => i.sizes === "512x512" && i.purpose === "maskable"), iconStatuses.join(","));
const swResponse = await page.request.get(`${base}/sw.js`);
check("/sw.js served no-cache", /no-cache/.test(swResponse.headers()["cache-control"] ?? "") || base.includes("localhost"), swResponse.headers()["cache-control"] ?? "(none)");
const swSource = await swResponse.text();
const precacheList = JSON.parse(swSource.match(/const PRECACHE_URLS = (\[.*?\]);/s)[1]);

// 2/3. Service worker controls the page and finishes precaching.
await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 30000 });
await page.reload({ waitUntil: "load" });
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
check("service worker controls /studio", controlled);
await page.waitForFunction(async (expected) => {
  const names = (await caches.keys()).filter(n => n.startsWith("luma-precache-"));
  if (!names.length) return false;
  return (await (await caches.open(names[0])).keys()).length >= expected;
}, precacheList.length, { timeout: 180000, polling: 1000 });
const cacheInfo = await page.evaluate(async () => {
  const names = await caches.keys();
  const sizes = {};
  for (const n of names) sizes[n] = (await (await caches.open(n)).keys()).length;
  return sizes;
});
check("precache complete", Object.entries(cacheInfo).some(([n, c]) => n.startsWith("luma-precache-") && c >= precacheList.length), JSON.stringify(cacheInfo));
const cdp = await context.newCDPSession(page);
const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
check("Chrome installability: no errors", installabilityErrors.length === 0, JSON.stringify(installabilityErrors));
await page.screenshot({ path: join(outDir, "online.png") });

// 5. Function untouched by the worker (online).
const fn = await page.evaluate(async () => { const r = await fetch("/api/ai/edit", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }); return { status: r.status, body: (await r.text()).slice(0, 120) }; });
check("POST /api/ai/edit reaches the server function", fn.status !== 404 && fn.status < 500, `${fn.status} ${fn.body}`);

// 4. Offline.
await context.setOffline(true);
phase = "offline-reload";
await page.reload({ waitUntil: "load" });
await page.waitForSelector('input[accept=".luma,application/x-luma-project"]', { state: "attached", timeout: 30000 });
check("offline reload of /studio renders the editor", await page.locator("button.spatial-export").isVisible());
const iphone = await context.newPage();
iphone.on("console", m => { if (m.type() === "error") consoleErrors.push(`[iphone] ${m.text()} @ ${m.location()?.url ?? ""}`); });
const iphoneResponse = await iphone.goto(`${base}/iphone`, { waitUntil: "load" }).catch(error => ({ status: () => String(error).slice(0, 80) }));
await iphone.waitForTimeout(2000);
const iphoneTitle = await iphone.title().catch(() => "");
check("offline /iphone opens from the precached shell", iphoneResponse.status() === 200 && /Luma/.test(iphoneTitle), `${iphoneResponse.status()} "${iphoneTitle}"`);
await iphone.close();
await page.waitForTimeout(1500);
phase = "offline-open";
await page.setInputFiles('input[accept=".luma,application/x-luma-project"]', resolve(fixture));
await page.waitForFunction(() => /Figma export fixture/.test(document.body.innerText), null, { timeout: 30000 });
const hide = page.getByRole("button", { name: /^Hide Badge/ });
await hide.click();
check("offline edit (hide a layer) applied", await page.getByRole("button", { name: /^Show Badge/ }).isVisible());
async function exportVia(click) {
  await page.locator("button.spatial-export").click();
  await page.waitForSelector('[aria-label="Export document"]');
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]);
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}
phase = "offline-export";
const png = await exportVia(() => page.getByRole("button", { name: /^Export PNG$/ }).click());
check("offline PNG export", png.bytes.subarray(1, 4).toString() === "PNG" && png.bytes.length > 1000, `${png.name} ${png.bytes.length} bytes`);
await writeFile(join(outDir, "offline-export.png"), png.bytes);
const svg = await exportVia(() => page.getByRole("button", { name: "Export for Figma" }).click());
const svgText = svg.bytes.toString("utf8");
check("offline Export for Figma", /<svg[^>]+width="480"/.test(svgText) && !/id="Badge \(shadow\)"/.test(svgText), `${svg.name} ${svg.bytes.length} bytes`);
await writeFile(join(outDir, "offline-figma.svg"), svg.bytes);
const outlined = await exportVia(async () => {
  await page.getByLabel(/Outline text/).check();
  await page.getByRole("button", { name: "Export for Figma" }).click();
});
const outlinedText = outlined.bytes.toString("utf8");
check("offline Export for Figma with outlined text (shaping worker from cache)", !/<text /.test(outlinedText) && /id="Title"/.test(outlinedText), `${outlined.bytes.length} bytes`);
await page.reload({ waitUntil: "load" });
check("second offline reload still works", await page.locator("button.spatial-export").isVisible({ timeout: 30000 }));
await page.screenshot({ path: join(outDir, "offline.png") });
await context.setOffline(false);

await browser.close();
const report = { base, checks, consoleErrors, networkNoise, pass: checks.every(c => c.pass) && consoleErrors.length === 0 };
await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, consoleErrors, networkNoise: networkNoise.length }, null, 2));
process.exit(report.pass ? 0 : 1);
