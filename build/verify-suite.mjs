/**
 * Suite menu + Locker check in headless Chrome.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node build/verify-suite.mjs <base> [out-dir]
 *
 * - suite.js is loaded once with data-app="luma"; <tcc-suite-menu> sits in the
 *   studio header and the header does not move when the kit renders.
 * - The menu opens and lists the suite apps.
 * - Export PNG → "Save to Locker" → saved (iframe bridge on *.thecreatingco.com,
 *   popup handoff elsewhere — both driven by the real click).
 * - On https://*.thecreatingco.com it also round-trips TCC.locker.onOpen:
 *   an image and a font (.ttf) are put in the Locker, then /studio?tcc-open=
 *   opens the image as a document and installs the font in the type tool.
 * - With the kit blocked, the studio still loads, edits and exports.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const [base = "http://localhost:3123", outDir = "artifacts/suite"] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const sameSite = /^https:\/\/([a-z0-9-]+\.)*thecreatingco\.com$/.test(new URL(base).origin);
const checks = [];
const check = (name, pass, detail = "") => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
context.on("page", p => {
  p.on("console", m => { if (m.type() === "error") consoleErrors.push(`${m.text()} @ ${m.location()?.url ?? ""}`); });
  p.on("pageerror", e => consoleErrors.push(String(e)));
});
const page = await context.newPage();

await page.goto(`${base}/studio`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".studio-titlebar tcc-suite-menu", { timeout: 60000 });
const before = await page.locator(".studio-titlebar .studio-app-mark").boundingBox();
await page.waitForFunction(() => window.TCC && window.TCC.locker, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const after = await page.locator(".studio-titlebar .studio-app-mark").boundingBox();
const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src*="/suite/v1/suite.js"]')].map(s => ({ src: s.src, app: s.dataset.app })));
check("suite.js loaded once with data-app=luma", scripts.length === 1 && scripts[0].app === "luma" && scripts[0].src === "https://thecreatingco.com/suite/v1/suite.js", JSON.stringify(scripts));
check("header does not shift when the menu renders", before && after && before.x === after.x && before.y === after.y, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
const floating = await page.evaluate(() => document.querySelectorAll("body > tcc-suite-menu, [data-tcc-floating]").length);
check("no floating fallback button (header menu present)", floating === 0, String(floating));
await page.locator(".studio-titlebar tcc-suite-menu").click();
await page.waitForTimeout(600);
const menuText = await page.evaluate(() => {
  const texts = [];
  const walk = (root) => { for (const el of root.querySelectorAll("*")) { if (el.shadowRoot) walk(el.shadowRoot); } texts.push(root.textContent || ""); };
  walk(document);
  return texts.join(" ");
});
check("menu opens with the suite apps", ["Luma", "Glyph", "ScenePilot", "Locker"].every(n => menuText.includes(n)));
await page.screenshot({ path: join(outDir, "menu-open.png") });
await page.keyboard.press("Escape");

// Export PNG → Save to Locker.
await page.locator("button.spatial-export").click();
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Export PNG$/ }).click()]);
const pngName = download.suggestedFilename();
await page.waitForSelector(".luma-locker-offer", { timeout: 10000 });
check("Locker offer appears after export", await page.locator(".luma-locker-offer").getByText(`Downloaded ${pngName}`).isVisible());
await page.locator(".luma-locker-offer").getByRole("button", { name: "Save to Locker" }).click();
await page.locator(".luma-locker-offer").getByText(/is in your Locker/).waitFor({ timeout: 30000 });
check("Save to Locker succeeds", true, `${pngName} (${sameSite ? "bridge" : "popup"} mode)`);
await page.screenshot({ path: join(outDir, "locker-saved.png") });

if (sameSite) {
  // onOpen round trip (same-site bridge needs no gesture).
  const ids = await page.evaluate(async (fontBase64) => {
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#e4572e"; ctx.fillRect(0, 0, 64, 48);
    const png = await new Promise(r => canvas.toBlob(r, "image/png"));
    const image = await window.TCC.locker.save({ name: "locker-probe.png", type: "image/png", blob: png });
    const fontBytes = Uint8Array.from(atob(fontBase64), c => c.charCodeAt(0));
    const font = await window.TCC.locker.save({ name: "Probe Sans.ttf", type: "font/ttf", blob: new Blob([fontBytes], { type: "font/ttf" }) });
    return { image, font };
  }, (await readFile("public/fonts/Abel-Regular.ttf")).toString("base64"));
  const imagePage = await context.newPage();
  await imagePage.goto(`${base}/studio?tcc-open=${encodeURIComponent(ids.image)}`);
  await imagePage.waitForFunction(() => /locker-probe/.test(document.body.innerText), null, { timeout: 60000 });
  check("onOpen: image from Locker opens as a document", true);
  check("?tcc-open removed from the URL after delivery", !/tcc-open/.test(imagePage.url()), imagePage.url());
  await imagePage.close();
  const fontPage = await context.newPage();
  await fontPage.goto(`${base}/studio?tcc-open=${encodeURIComponent(ids.font)}`);
  await fontPage.waitForFunction(() => /from Locker is installed/.test(document.body.innerText), null, { timeout: 60000 });
  const fontNote = await fontPage.locator("text=/from Locker is installed/").first().textContent();
  check("onOpen: font from Locker installs into the type tool", /Abel|Probe Sans/.test(fontNote ?? ""), fontNote ?? "");
  await fontPage.evaluate(async (list) => { for (const id of list) await window.TCC.locker.remove(id).catch(() => {}); }, [ids.image, ids.font]);
  await fontPage.close();
}

// Kit unreachable: the studio must still work.
const blocked = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await blocked.route("https://thecreatingco.com/**", route => route.abort());
const lonely = await blocked.newPage();
const lonelyErrors = [];
lonely.on("pageerror", e => lonelyErrors.push(String(e)));
await lonely.goto(`${base}/studio`, { waitUntil: "load" });
await lonely.waitForTimeout(2500);
await lonely.locator("button.spatial-export").click();
const [d2] = await Promise.all([lonely.waitForEvent("download"), lonely.getByRole("button", { name: /^Export PNG$/ }).click()]);
check("kit blocked: studio loads and exports, no Locker offer shown", Boolean(d2) && !(await lonely.locator(".luma-locker-offer").isVisible()) && lonelyErrors.length === 0, lonelyErrors.join(" | "));
await blocked.close();

await browser.close();
const report = { base, sameSite, checks, consoleErrors, pass: checks.every(c => c.pass) && consoleErrors.length === 0 };
await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, consoleErrors }, null, 2));
process.exit(report.pass ? 0 : 1);
