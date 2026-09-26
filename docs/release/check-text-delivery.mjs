// Focused functional qualification, not a substitute for the full RC gate.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";

const release = acquireQualificationLock("Focused typography/delivery checks");
const sourceSha256 = releaseSourceId(), output = mkdtempSync(resolve("artifacts/text-delivery-checks-"));
const host = () => ({ logicalCpus: os.cpus().length, load: os.loadavg(), freeBytes: os.freemem() });
const startHost = host(), checks = [];
const tests = ["text-horizontal-scale", "text-render-dependencies", "text-model", "text-paint-context", "text-shaping", "text-bidi", "paragraph-layout", "psd-text-units", "psd-text-preview", "native-font-document-trust", "native-font-resources", "native-font-budget", "export-formats", "print-output", "campaign-completion", "campaign-components", "smart-object-font-admission"].map(name => `tests/${name}.test.ts`);
try {
  for (const [id, args] of [
    ["types", ["tsc", "--noEmit"]],
    ["regressions", ["tsx", "--test", "--test-concurrency=2", ...tests]],
    ["changed-file-lint", ["eslint", "app/engine/document.ts", "app/engine/text-model.ts", "app/engine/text-render-dependencies.ts", "app/engine/studio.ts", "app/engine/psd.ts", "app/studio/panels/type-panel.tsx", "tests/text-horizontal-scale.test.ts", "tests/text-render-dependencies.test.ts", "tests/psd-text-units.test.ts"]],
  ]) {
    const result = spawnSync("npx", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 180000 });
    writeFileSync(join(output, `${id}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`);
    checks.push({ id, executable: "npx", args, pass: result.status === 0, exitCode: result.status, error: result.error?.message });
    console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${id}`);
  }
  const report = { sourceSha256, unchanged: sourceSha256 === releaseSourceId(), generatedAt: new Date().toISOString(),
    harnessSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
    scope: "Focused typography, saved history and export-admission regressions; NOT a full suite or performance qualification", startHost, endHost: host(), checks };
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(output);
  if (!report.unchanged || checks.some(check => !check.pass)) process.exitCode = 1;
} finally { release(); }
