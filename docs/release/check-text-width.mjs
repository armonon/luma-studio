// Browser regression: explicit geometric Canvas reference, not Photoshop parity.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";

const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183";
assert.equal(new URL(base).hostname, "127.0.0.1");
const runtime = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const release = acquireQualificationLock("Text width browser regressions"), sourceSha256 = releaseSourceId();
const output = await mkdtemp(resolve("artifacts/text-width-browsers-"));
const results = [];
try {
  for (const name of ["chromium", "webkit"]) {
    const browser = await runtime[name].launch({ headless: true });
    const watchdog = setTimeout(() => { void browser.close(); }, 120000);
    try {
      const page = await browser.newPage(), errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/qualify.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Text width regression</title>" });
        return route.continue();
      });
      await page.goto(`${base}/qualify.html`);
      const result = await page.evaluate(async root => {
        const { createDocument, createTextLayer, drawLayerContent } = await import(`${root}/app/engine/document.ts`);
        const { waitForDocumentFonts } = await import(`${root}/app/engine/text-font-resources.ts`);
        const { encodeLumaProject, decodeLumaProject } = await import(`${root}/app/engine/project.ts`);
        const rows = [], preview = document.createElement("canvas"); preview.width = 1200; preview.height = 24 * 180;
        const display = preview.getContext("2d"); display.fillStyle = "white"; display.fillRect(0, 0, preview.width, preview.height);
        for (const align of ["left", "center", "right"]) for (const percent of [50, 80, 125, 200]) for (const tracking of [0, 100]) {
          const x = align === "left" ? 40 : align === "right" ? 560 : 300;
          const source = createDocument(600, 180);
          source.layers = [createTextLayer("Width", { text: "Wide office", font: "400 32px Lato", color: "#143c5f", align, x, y: 70,
            lineHeight: 1.2, tracking, defaultStyle: { fontStretch: percent } })];
          await waitForDocumentFonts(source);
          const blob = await encodeLumaProject(source, [], "Width trust"), doc = (await decodeLumaProject(blob)).doc;
          if (doc.layers[0].text.defaultStyle.fontStretch !== percent) throw new Error("Saved width changed");
          const actual = document.createElement("canvas"), expected = document.createElement("canvas");
          actual.width = expected.width = 600; actual.height = expected.height = 180;
          drawLayerContent(actual.getContext("2d"), doc.layers[0]);
          const ref = expected.getContext("2d");
          ref.translate(x, 0); ref.scale(percent / 100, 1); ref.translate(-x, 0);
          ref.font = "400 32px Lato"; ref.fillStyle = "#143c5f"; ref.textAlign = align; ref.textBaseline = "alphabetic"; ref.fontKerning = "normal";
          const track = tracking / 1000 * 32; ref.letterSpacing = `${track}px`;
          ref.fillText("Wide office", x + (align === "center" ? track / 2 : align === "right" ? track : 0), 70);
          const a = actual.getContext("2d").getImageData(0, 0, 600, 180).data, b = ref.getImageData(0, 0, 600, 180).data;
          let sum = 0, alpha = 0, maximum = 0, over = 0;
          for (let i = 0; i < a.length; i += 4) {
            let worst = 0;
            for (let c = 0; c < 4; c++) { const delta = Math.abs(a[i + c] - b[i + c]); sum += delta; worst = Math.max(worst, delta); }
            alpha += Math.abs(a[i + 3] - b[i + 3]); maximum = Math.max(maximum, worst); if (worst > 8) over++;
          }
          const mean = sum / a.length, alphaMean = alpha / (a.length / 4), fractionOver8 = over / (a.length / 4);
          const row = rows.length; display.drawImage(expected, 0, row * 180); display.drawImage(actual, 600, row * 180);
          rows.push({ align, percent, tracking, mean, alphaMean, maximum, fractionOver8, pass: mean <= 1.5 && alphaMean <= 1 && fractionOver8 <= .025 });
        }
        return { rows, png: preview.toDataURL("image/png").split(",")[1] };
      }, `/@fs${process.cwd()}`);
      await writeFile(join(output, `${name}.png`), Buffer.from(result.png, "base64"), { flag: "wx" });
      results.push({ browser: name, version: await browser.version(), errors, rows: result.rows, pass: errors.length === 0 && result.rows.every(row => row.pass) });
    } catch (error) { results.push({ browser: name, pass: false, error: String(error) }); }
    finally { clearTimeout(watchdog); await browser.close(); }
  }
  const report = { sourceSha256, unchanged: sourceSha256 === releaseSourceId(), generatedAt: new Date().toISOString(),
    harnessSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
    scope: "48 saved/reopened character-width/alignment/tracking cases against explicit same-browser geometric Canvas. Not independent font shaping, Photoshop fidelity or installed-app qualification.", results };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, unchanged: report.unchanged, browsers: results.map(result => ({ browser: result.browser, pass: result.pass, error: result.error, failed: result.rows?.filter(row => !row.pass) })) }));
  if (!report.unchanged || results.some(result => !result.pass)) process.exitCode = 1;
} finally { release(); }
