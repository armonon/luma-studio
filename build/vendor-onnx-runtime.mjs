import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Ship the runtime paired with the installed dependency. Do not execute
// third-party CDN JavaScript in the desktop webview on first model use.
const source = resolve("node_modules/onnxruntime-web");
const destination = resolve("public/onnxruntime");
await mkdir(destination, { recursive: true });
const files = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
const hashes = {};
for (const file of files) {
  await copyFile(resolve(source, "dist", file), resolve(destination, file));
  hashes[file] = createHash("sha256").update(await readFile(resolve(destination, file))).digest("hex");
}
await copyFile(resolve("build/licenses/onnxruntime-LICENSE.txt"), resolve(destination, "LICENSE"));
const pkg = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
await writeFile(resolve(destination, "manifest.json"), JSON.stringify({ package: pkg.name, version: pkg.version, sha256: hashes }, null, 2));
