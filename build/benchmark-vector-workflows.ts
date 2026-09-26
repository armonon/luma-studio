/** Synthetic local baseline, never an Affinity or Illustrator comparison. */
import { performance } from "node:perf_hooks";
import { createDocument, createPathLayer, type PathStyle } from "../app/engine/document";
import { evaluateBoolean } from "../app/engine/vector-boolean";
import { exportVectorSvg } from "../app/engine/vector-delivery";
import { pathContours } from "../app/engine/vector-path";
import { evaluateOffset } from "../app/engine/vector-offset";
import { parseEditableSvg } from "../app/engine/vector-svg-import";

const star = (cx: number, cy: number): PathStyle => ({ anchors: Array.from({ length: 64 }, (_, index) => {
  const angle = index * Math.PI / 32, radius = index % 2 ? 80 : 120;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, hIn: { dx: 0, dy: 0 }, hOut: { dx: 0, dy: 0 } };
}), closed: true, fill: "#4388ff", stroke: "none", strokeWidth: 0 });
const reports = [];
for (const dimension of [10000, 25000, 50000]) {
  const start = performance.now();
  const doc = createDocument(dimension, dimension);
  doc.layers = Array.from({ length: 100 }, (_, i) => createPathLayer(`Star ${i}`, star(150 + (i % 10) * 300, 150 + Math.floor(i / 10) * 300)));
  const timings = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    evaluateBoolean({ operation: "unite", operands: [pathContours(star(200, 200)), pathContours(star(260, 200))] }, star(200, 200));
    timings.push(performance.now() - t);
  }
  timings.sort((a, b) => a - b);
  const svgStart = performance.now(), svg = exportVectorSvg(doc);
  const svgMs = performance.now() - svgStart;
  const importStart = performance.now(), reopened = parseEditableSvg(svg), svgImportMs = performance.now() - importStart;
  const offsetTimings = [];
  for (let i = 0; i < 10; i++) {
    const offsetStart = performance.now(), path = star(200, 200);
    evaluateOffset({ contours: pathContours(path), distance: 8, join: "round", fillRule: "nonzero" }, path);
    offsetTimings.push(performance.now() - offsetStart);
  }
  offsetTimings.sort((a, b) => a - b);
  reports.push({ dimension, objects: 100, anchors: 6400, booleanMedianMs: timings[5], booleanMaxMs: timings[9], svgMs, svgImportMs, importedPaths: reopened.layers.length, offsetMedianMs: offsetTimings[5], offsetMaxMs: offsetTimings[9], svgBytes: Buffer.byteLength(svg), totalMs: performance.now() - start, processPeakRssMiB: process.resourceUsage().maxRSS / 1024 });
}
console.log(JSON.stringify({ scope: "Synthetic sparse vector geometry, CPU booleans, offsets, SVG serialization/import only; not GUI latency, dense photos, PDF, or an Affinity comparison. Peak RSS is cumulative for this process, not isolated per operation.", reports }, null, 2));
