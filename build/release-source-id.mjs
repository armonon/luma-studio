import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Include dirty and new source files: HEAD alone cannot identify this build. */
export function releaseSourceId() {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0");
  const selected = [...new Set(files)].filter(path => /^(app\/|src-tauri\/(src\/|capabilities\/|Cargo\.|tauri\.)|crates\/|build\/|tests\/|public\/|package(?:-lock)?\.json$|vite.*config|tsconfig|eslint\.config)/.test(path)).sort();
  const hash = createHash("sha256");
  for (const path of selected) {
    hash.update(path).update("\0");
    try { hash.update(readFileSync(path)); } catch (error) { if (error.code !== "ENOENT") throw error; hash.update("<deleted>"); }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function evidenceMatchesSource(report, sourceSha256) {
  return Boolean(report && /^[a-f0-9]{64}$/.test(report.sourceSha256 ?? "") && report.sourceSha256 === sourceSha256);
}
