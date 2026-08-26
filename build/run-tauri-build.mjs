import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

if (process.env.RUSTFLAGS && !process.env.CARGO_ENCODED_RUSTFLAGS) {
  throw new Error("Use CARGO_ENCODED_RUSTFLAGS for release builds so Luma can safely add path remapping");
}
const remap = `--remap-path-prefix=${homedir()}=/build-home`;
const encoded = [process.env.CARGO_ENCODED_RUSTFLAGS, remap].filter(Boolean).join("\x1f");
const cli = resolve("node_modules/.bin/tauri");
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
process.exitCode = result.status ?? 1;
