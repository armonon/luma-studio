/**
 * Rasterize the Luma mark (public/favicon.svg) into PWA icons with headless
 * Chromium — no native image dependency needed.
 *   PLAYWRIGHT=/path/to/node_modules/playwright node build/generate-pwa-icons.mjs
 * "any" icons: mark on a rounded dark tile. Maskable: full-bleed tile, mark
 * kept inside the 80% safe-zone circle.
 */
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const mark = (await readFile("public/favicon.svg", "utf8")).replace(/width="24" height="24"/, 'width="100%" height="100%"');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await mkdir("public/icons", { recursive: true });
for (const size of [192, 512]) for (const maskable of [false, true]) {
  const inset = maskable ? 0.25 : 0.2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;background:#141619;border-radius:${maskable ? 0 : size * 0.22}px;display:grid;place-items:center">
      <div style="width:${size * (1 - inset * 2)}px;height:${size * (1 - inset * 2)}px">${mark}</div>
    </div></body></html>`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  const name = `public/icons/luma-${maskable ? "maskable-" : ""}${size}.png`;
  await writeFile(name, png);
  console.log(name, png.length);
}
await browser.close();
