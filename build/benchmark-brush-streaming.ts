// Same rendering functions and pixels; compare growing-stroke replay with
// incremental coverage. This is CPU brush work, NOT tablet input-to-display latency.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { BrushStrokePlanner, replayStrokeFloat, type BrushCoverageCache, type BrushParams } from "../app/engine/brush.ts";

const params: BrushParams = { size: 18, hardness: 0.6, flow: 0.2, opacity: 0.7, spacing: 0.12, color: "#ff0000", pressureSize: true, pressureOpacity: true, mode: "paint" };
const points = Array.from({ length: 400 }, (_, i) => ({ x: 64 + Math.sin(i * 0.045) * 40, y: 64 + Math.cos(i * 0.057) * 40, p: 0.4 + (i % 30) / 50 }));
function run(streaming: boolean) {
  const data = new Float32Array(128 * 128 * 4);
  const cache: BrushCoverageCache = {};
  const planner = new BrushStrokePlanner(params);
  const start = performance.now();
  for (let i = 0; i < points.length; i++) {
    data.fill(0);
    replayStrokeFloat({ width: 128, height: 128, data }, { layerId: "benchmark", params, points: streaming ? [] : points.slice(0, i + 1) }, [1, 0, 0],
      streaming ? { dabs: planner.add(points[i]), cache } : undefined);
  }
  return { ms: performance.now() - start, data };
}
run(false); run(true);
const baseline: number[] = [], incremental: number[] = [];
for (let sample = 0; sample < 3; sample++) {
  const before = run(false), after = run(true);
  assert.deepEqual(before.data, after.data);
  baseline.push(before.ms); incremental.push(after.ms);
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[1];
console.log(JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, fixture: "400 pressure samples, looping 18px brush, one 128x128 float tile", baselineMs: baseline, incrementalMs: incremental, baselineMedianMs: median(baseline), incrementalMedianMs: median(incremental), pixels: "exact match" }, null, 2));
