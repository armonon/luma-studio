// Read-only, same-process comparison against the checked-in implementation.
// This measures history-summary queries, not renderer FPS or Photoshop parity.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import ts from "typescript";

const file = "app/engine/operation-history.ts";
async function load(source, label) {
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  return (await import(`data:text/javascript;base64,${Buffer.from(`${js}\n//# sourceURL=${label}`).toString("base64")}`)).OperationHistory;
}
const Baseline = await load(execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" }), "baseline");
const Current = await load(readFileSync(file, "utf8"), "current");
function measure(History) {
  const history = new History({ maxNodes: 2000 });
  for (let i = 0; i < 1500; i++) history.commit("Edit", i);
  let checksum = 0;
  for (let i = 0; i < 100; i++) checksum += history.summary().currentDepth;
  const milliseconds = [];
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) checksum += history.summary().currentDepth;
    milliseconds.push(performance.now() - start);
  }
  return { milliseconds, medianMs: [...milliseconds].sort((a, b) => a - b)[2], checksum };
}
const baseline = measure(Baseline), current = measure(Current);
if (baseline.checksum !== current.checksum) throw new Error("Benchmark results differ");
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, scenario: "1500 history nodes; 10000 summary reads per sample", baseline, current }, null, 2));
