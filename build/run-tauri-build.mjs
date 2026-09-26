import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { releaseSourceId } from "./release-source-id.mjs";
import { acquireQualificationLock } from "./qualification-lock.mjs";

const releaseLock = acquireQualificationLock("Native candidate build");
try {
if (process.env.RUSTFLAGS && !process.env.CARGO_ENCODED_RUSTFLAGS) {
  throw new Error("Use CARGO_ENCODED_RUSTFLAGS for release builds so Luma can safely add path remapping");
}
const remap = `--remap-path-prefix=${homedir()}=/build-home`;
const encoded = [process.env.CARGO_ENCODED_RUSTFLAGS, remap].filter(Boolean).join("\x1f");
const cli = resolve("node_modules/.bin/tauri");
const sourceSha256 = releaseSourceId();
const result = spawnSync(cli, ["build", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_PUBLIC_LUMA_EDITION: "pro",
    CARGO_ENCODED_RUSTFLAGS: encoded,
  },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status === 0 && process.platform === "darwin") {
  let config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) if (args[i] === "--config") {
    const value = args[++i];
    config = { ...config, ...JSON.parse(value.startsWith("{") ? value : readFileSync(value, "utf8")) };
  }
  const profile = args.includes("--debug") ? "debug" : "release";
  const appPath = resolve("src-tauri/target", profile, "bundle/macos", `${config.productName}.app`);
  const executable = resolve(appPath, "Contents/MacOS/luma-studio");
  if (existsSync(executable)) {
    if (sourceSha256 !== releaseSourceId()) throw new Error("Source changed during native build; rebuild before qualification");
    mkdirSync("artifacts", { recursive: true });
    writeFileSync("artifacts/native-build-report.json", JSON.stringify({
      generatedAt: new Date().toISOString(), sourceSha256, appPath,
      executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
    }, null, 2));
  }
}
process.exitCode = result.status ?? 1;
} finally { releaseLock(); }
