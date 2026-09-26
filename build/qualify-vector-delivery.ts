/** Reproducible interchange fixtures + local timings; no competitor or certification inference. */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cpus, release, totalmem, platform } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DOMMatrix } from "@napi-rs/canvas";
import { parseEditableSvg } from "../app/engine/vector-svg-import.ts";
import { pdfVectorOperators } from "../app/engine/pdf-vector-operators.ts";
import { createDocument, createPathLayer, createTextLayer } from "../app/engine/document.ts";
import { formTextAssetFromLayer, serializeFormTextAsset } from "../app/engine/form-studio-bridge.ts";
import { exportVectorSvg } from "../app/engine/vector-delivery.ts";
import { exportVectorPdf } from "../app/engine/vector-pdf.ts";
import { importEditablePdf } from "../app/engine/pdf-import.ts";
import { PDFDocument, PDFName } from "pdf-lib";

Object.assign(globalThis, { DOMMatrix });
const folder = resolve("artifacts/vector-qualification"); await mkdir(folder, { recursive: true });
// A failed rerun must not leave an old successful report looking current.
await writeFile(resolve(folder, "report.json"), JSON.stringify({ status: "incomplete", startedAt: new Date().toISOString(), note: "Qualification is running or failed before completion; inspect the command log." }, null, 2));
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fixture = (dimension: number, objects: number) => {
  const doc = createDocument(dimension, dimension);
  doc.layers = Array.from({ length: objects }, (_, i) => createPathLayer(`Triangle ${i + 1}`, {
    anchors: [[20, 20], [75, 25], [50, 80]].map(([x, y]) => ({ x: x + (i % 10) * 90, y: y + Math.floor(i / 10) * 90, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } })),
    closed: true, fill: i % 2 ? "#2876cc" : "#ed7542", stroke: "none", strokeWidth: 0,
    appearance: [{ kind: "fill", color: i % 2 ? "#2876cc" : "#ed7542", width: 0, enabled: true, opacity: 1 }],
  }));
  // Keep cross-application fixture bytes stable, independent of runtime UUIDs.
  doc.layers.forEach((layer, i) => { layer.id = `qualification-${i}`; });
  return doc;
};
const results = [];
for (const dimension of [10000, 25000, 50000]) {
  const doc = fixture(dimension, 100), source = exportVectorSvg(doc);
  const name = `sparse-${dimension}.svg`; await writeFile(resolve(folder, name), source);
  const runs = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now(); const parsed = parseEditableSvg(source);
    if (parsed.layers.length !== 100 || parsed.width !== dimension) throw new Error("SVG structural fidelity failed");
    if (i) runs.push(performance.now() - start);
  }
  results.push({ fixture: name, sha256: hash(source), dimension, layers: 100, timingKind: "engine-only SVG import", warmupRuns: 1, runsMs: runs, medianMs: [...runs].sort((a, b) => a - b)[2], fidelity: "dimensions and path count checked; GUI/visual fidelity not measured", affinity: null });
}
const pdf = await exportVectorPdf(fixture(1000, 10));
const textSource = createTextLayer("Form return QA", { text: "LUMA × FORM", font: '700 96px "Lato", sans-serif', color: "#2876cc", align: "left", lineHeight: 1.1, x: 100, y: 250 });
textSource.id = "form-return-qualification";
await writeFile(resolve(folder, "form-return-qa.lumaformtext"), serializeFormTextAsset(formTextAssetFromLayer(textSource, 1000)));
const pdfPath = resolve(folder, "rgb-vector-proof.pdf"); await writeFile(pdfPath, pdf);
const imported = await importEditablePdf(pdf.buffer as ArrayBuffer, 1, { workerSrc: new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href, convert: pdfVectorOperators });
if (imported.layers.length !== 10) throw new Error("PDF structural fidelity failed");
const parsedPdf = await PDFDocument.load(pdf);
let independentRaster = "unavailable";
try {
  execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1000", "-png", pdfPath, resolve(folder, "rgb-vector-proof")], { timeout: 30000, stdio: "pipe" });
  independentRaster = "Poppler rendered successfully; visual/color agreement still requires review";
} catch (error) { independentRaster = `not verified: ${error instanceof Error ? error.message : String(error)}`; }
const report = {
  status: "local checks passed; external qualification blocked",
  generatedAt: new Date().toISOString(),
  environment: { platform: platform(), os: release(), cpu: cpus()[0]?.model, ramBytes: totalmem(), node: process.version, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), workingTree: "Includes uncommitted changes; archive source with this report for reproduction" },
  results, processPeakRssMiB: process.resourceUsage().maxRSS / 1024,
  print: { status: "NOT CERTIFIED", pdf: "rgb-vector-proof.pdf", sha256: hash(pdf), pages: parsedPdf.getPageCount(), editablePaths: imported.layers.length, outputIntentPresent: parsedPdf.catalog.has(PDFName.of("OutputIntents")), independentRaster, blockers: ["Select printer and required PDF/X specification", "Implement and validate the required ICC/output-intent and page-box pipeline", "Independent PDF/X preflight and GWG test corpus", "Printer/RIP proof and color-chart approval"] },
  comparison: { status: "BLOCKED", reason: "Affinity not found in /Applications or ~/Applications. Do not compare these engine-only timings to GUI timings.", required: "Same Mac, app versions, fixture hashes, view size, warmup, five measured full-workflow runs, peak process memory and approved output fidelity from both apps." },
};
await writeFile(resolve(folder, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
