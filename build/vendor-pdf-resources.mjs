// Deterministic local assets from the pinned PDF.js package, never a CDN request.
import { mkdir, readdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
for (const directory of ["standard_fonts", "cmaps", "wasm"]) {
  const source = new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url);
  const destination = new URL(`../public/pdfjs/${directory}/`, import.meta.url);
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) {
    await copyFile(new URL(name, source), new URL(name, destination));
  }
  console.log(`Vendored PDF.js ${directory} → ${fileURLToPath(destination)}`);
}
