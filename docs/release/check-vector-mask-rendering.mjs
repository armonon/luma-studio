// Compare independent SVG consumers with both browser Luma and Node Luma.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
const browsers = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183/";
assert.equal(new URL(base).hostname, "127.0.0.1");
const output = await mkdtemp(resolve("artifacts/vector-mask-browsers-"));
const input = output;
const release = acquireQualificationLock("Independent SVG mask rendering"), sourceSha256 = releaseSourceId();
const report = { sourceSha256, scope: "Synthetic vector layer/group with masks and clipping: independent browser SVG renderer versus Luma browser compositor after native-project reopen. Node canvas comparisons retained separately because alpha quantization differs. Not installed-app or real professional-project qualification.", pass: false, cases: [] };
try {
  execFileSync("pdftoppm", ["-v"], { stdio: "ignore", timeout: 10000 });
  const fixtures = execFileSync("npx", ["tsx", "--test", "tests/vector-alpha-delivery.test.ts", "tests/vector-alpha-clipping.test.ts"], { env: { ...process.env, LUMA_DELIVERY_REVIEW_DIR: input }, encoding: "utf8", timeout: 120000 });
  await writeFile(join(output, "fixtures.log"), fixtures);
  for (const engine of ["chromium", "webkit"]) {
    const browser = await browsers[engine].launch({ headless: true });
    const watchdog = setTimeout(() => void browser.close(), 120000);
    try {
      const page = await browser.newPage();
      await page.route("**/*", route => /^(blob:|data:)/.test(route.request().url()) || new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
      await page.route(`${base}__mask_qa__`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
      await page.goto(`${base}__mask_qa__`);
      for (const name of ["svg-layer-sparse", "svg-layer-legacy", "svg-group-sparse", "svg-group-legacy", ...["grouped", "separate", "masked", "hidden-middle"].map(mode => `svg-clipping-${mode}`)]) {
        const svg = await readFile(join(input, `${name}.svg`), "utf8");
        const reference = (await readFile(join(input, `${name}-source.png`))).toString("base64");
        const project = (await readFile(join(input, `${name}.luma`))).toString("base64");
        const result = await page.evaluate(async ({ svg, reference, project, moduleRoot }) => {
          const { decodeLumaProject } = await import(`${moduleRoot}/project.ts`);
          const { renderClean } = await import(`${moduleRoot}/renderer.ts`);
          const reopened = await decodeLumaProject(new Blob([Uint8Array.from(atob(project), c => c.charCodeAt(0))]));
          const native = document.createElement("canvas"); native.width = reopened.doc.width; native.height = reopened.doc.height;
          renderClean(reopened.doc, native);
          const draw = async url => {
            const image = new Image(); image.src = url; await image.decode();
            const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
            return { canvas, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
          };
          const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          try {
            const actual = await draw(url), expected = await draw(`data:image/png;base64,${reference}`);
            const compare = data => {
            if (actual.data.length !== data.length) throw new Error("Dimensions differ");
            let absolute = 0, alpha = 0, worst = 0, changed = 0;
            for (let i = 0; i < actual.data.length; i += 4) {
              let max = 0;
              for (let c = 0; c < 4; c++) {
                const delta = Math.abs(actual.data[i + c] - data[i + c]);
                absolute += delta; max = Math.max(max, delta); if (c === 3) alpha += delta;
              }
              worst = Math.max(worst, max); if (max > 8) changed++;
            }
            const pixels = actual.data.length / 4;
            return { mean: absolute / actual.data.length, alphaMean: alpha / pixels, worst, changedFraction: changed / pixels };
            };
            return { ...compare(native.getContext("2d").getImageData(0, 0, native.width, native.height).data), nodeReference: compare(expected.data), png: actual.canvas.toDataURL("image/png").split(",")[1], nativePng: native.toDataURL("image/png").split(",")[1] };
          } finally { URL.revokeObjectURL(url); }
        }, { svg, reference, project, moduleRoot: `/@fs${resolve("app/engine")}` });
        const { png, nativePng, ...metrics } = result;
        await writeFile(join(output, `${engine}-${name}.png`), Buffer.from(png, "base64"));
        await writeFile(join(output, `${engine}-${name}-luma.png`), Buffer.from(nativePng, "base64"));
        const acceptable = m => m.mean <= 1.5 && m.alphaMean <= 1 && m.changedFraction <= .025;
        report.cases.push({ engine, name, ...metrics, nodeReferencePass: acceptable(metrics.nodeReference), tolerance: { mean: 1.5, alphaMean: 1, changedFraction: .025, changedThreshold: 8 }, fixtureSha256: createHash("sha256").update(svg).digest("hex"), projectSha256: createHash("sha256").update(Buffer.from(project, "base64")).digest("hex") });
        assert.ok(metrics.mean <= 1.5 && metrics.alphaMean <= 1 && metrics.changedFraction <= .025, `${engine} ${name}: ${JSON.stringify(metrics)}`);
      }
    } finally { clearTimeout(watchdog); await browser.close(); }
  }
  report.browserDeliveryPass = true;
  report.nodeCanvasConsistencyPass = report.cases.every(item => item.nodeReferencePass);
  report.pass = true; // Scope is browser delivery; Node consistency is a separate, explicit result.
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  report.unchanged = releaseSourceId() === sourceSha256;
  report.harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
  if (!report.unchanged) { report.pass = false; process.exitCode = 1; }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  release(); console.log(JSON.stringify({ output, ...report }, null, 2));
}
