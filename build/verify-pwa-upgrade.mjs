/**
 * Update-path check against a local `next start` (which serves public/sw.js
 * from disk on every request — standing in for a new deploy at the same URL).
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node build/verify-pwa-upgrade.mjs http://localhost:3123
 *
 * v1 installs → returning visit → public/sw.js changes (v2) → the studio shows
 * "A new version of Luma is ready." and nothing activates until Reload is
 * clicked → after Reload the v2 worker controls the page. sw.js is restored.
 */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const base = process.argv[2] ?? "http://localhost:3123";
const original = await readFile("public/sw.js", "utf8");
const version = (source) => source.match(/const VERSION = "([^"]+)"/)[1];
let failed = false;
const check = (name, pass, detail = "") => { if (!pass) failed = true; console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`${base}/studio`);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForSelector("text=Luma now works offline on this device.", { timeout: 120000 });
  check("first install shows the offline-ready note", true);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const v1 = version(original);
  await writeFile("public/sw.js", original.replace(`const VERSION = "${v1}"`, `const VERSION = "${v1}-v2"`));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForSelector("text=A new version of Luma is ready.", { timeout: 120000 });
  const stillV1 = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL && caches.keys());
  check("update waits for the user (old worker still in control)", stillV1.some(n => n === `luma-precache-${v1}`), JSON.stringify(stillV1));
  await Promise.all([page.waitForEvent("load", { timeout: 60000 }), page.getByRole("button", { name: "Reload" }).click()]);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const keys = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 1000)); return caches.keys(); });
  check("after Reload the new worker controls the page and old precache is gone", keys.includes(`luma-precache-${v1}-v2`) && !keys.includes(`luma-precache-${v1}`), JSON.stringify(keys));
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await writeFile("public/sw.js", original);
  await browser.close();
}
process.exit(failed ? 1 : 0);
