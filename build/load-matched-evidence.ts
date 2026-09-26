import { open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { validateMatchedWorkflow, type MatchedWorkflow } from "./matched-workflow-evidence";

const inside = (base: string, target: string) => {
  const rel = relative(base, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
export async function loadMatchedEvidence(path: string): Promise<MatchedWorkflow> {
  const manifest = await realpath(path), base = dirname(manifest);
  const file = await open(manifest, "r");
  let record: MatchedWorkflow;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Benchmark manifest must be a regular file of at most 1 MiB.");
    // Fixed-size read also bounds a file that grows after stat.
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > 1024 * 1024) throw new Error("Benchmark manifest exceeds 1 MiB.");
    record = JSON.parse(buffer.subarray(0, offset).toString("utf8"));
  } finally { await file.close(); }
  validateMatchedWorkflow(record);
  const seen = new Set<string>();
  for (const item of record.evidence) {
    const requested = resolve(base, item.path);
    if (isAbsolute(item.path) || !inside(base, requested)) throw new Error("Evidence must be inside the manifest directory.");
    const target = await realpath(requested);
    if (!inside(base, target)) throw new Error("Evidence symlink escapes the manifest directory.");
    if (seen.has(target)) throw new Error("Different artifact roles cannot alias the same file.");
    seen.add(target);
    const handle = await open(target, "r");
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 8 * 1024 ** 3) throw new Error("Evidence must be a regular file no larger than 8 GiB.");
      const hash = createHash("sha256");
      // Bound reads to the admitted file length even if another writer appends.
      if (before.size) for await (const chunk of handle.createReadStream({ start: 0, end: before.size - 1, autoClose: false })) hash.update(chunk);
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || hash.digest("hex") !== item.sha256.toLowerCase()) throw new Error(`Evidence changed or hash mismatched: ${item.path}`);
    } finally { await handle.close(); }
  }
  return record;
}
