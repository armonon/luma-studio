import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { releaseSourceId } from "./release-source-id.mjs";
import { acquireQualificationLock } from "./qualification-lock.mjs";

const releaseLock = acquireQualificationLock("Local qualification");
try {
const sourceSha256 = releaseSourceId();
const tests = readdirSync("tests").filter(file => file.endsWith(".test.ts")).sort().map(file => `tests/${file}`);
const commands = [
  ["types", "npx", ["tsc", "--noEmit"]],
  // Limit simultaneous canvas/font harnesses on developer laptops. The test
  // set is unchanged; concurrency must not become a memory-pressure test.
  ["engine-regressions", "npx", ["tsx", "--test", "--test-concurrency=2", ...tests]],
  ["lint", "npm", ["run", "lint"]],
  ["native-bridge", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["native-core", "cargo", ["test", "--manifest-path", "crates/luma-core/Cargo.toml"]],
];
mkdirSync("artifacts/local-qualification", { recursive: true });
const checks = commands.map(([id, executable, args]) => {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  const log = `artifacts/local-qualification/${id}.log`;
  writeFileSync(log, `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`);
  const pass = result.status === 0;
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${log}`);
  return { id, executable, args, pass, exitCode: result.status, log };
});
const unchanged = releaseSourceId() === sourceSha256;
writeFileSync("artifacts/local-hardening-report.json", JSON.stringify({ sourceSha256, generatedAt: new Date().toISOString(), unchanged, checks }, null, 2));
if (!unchanged || checks.some(check => !check.pass)) process.exitCode = 1;
} finally { releaseLock(); }
