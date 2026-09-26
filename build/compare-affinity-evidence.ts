import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { compareWorkflowMeasurements, validateWorkflowMeasurement, type WorkflowMeasurement } from "./affinity-evidence.ts";

async function load(path: string) {
  if ((await stat(path)).size > 1024 * 1024) throw new Error("Benchmark manifest exceeds 1 MiB");
  const record = JSON.parse(await readFile(path, "utf8")) as WorkflowMeasurement;
  validateWorkflowMeasurement(record);
  const base = dirname(resolve(path));
  for (const item of record.evidence) {
    const target = resolve(base, item.path), rel = relative(base, target);
    if (isAbsolute(item.path) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Evidence must be inside the manifest directory");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest("hex") !== item.sha256.toLowerCase()) throw new Error(`Evidence hash mismatch: ${item.path}`);
  }
  return record;
}
if (process.argv.length !== 4) throw new Error("Usage: tsx build/compare-affinity-evidence.ts luma.json affinity.json");
const [luma, affinity] = await Promise.all(process.argv.slice(2).map(load));
console.log(JSON.stringify(compareWorkflowMeasurements(luma, affinity), null, 2));
