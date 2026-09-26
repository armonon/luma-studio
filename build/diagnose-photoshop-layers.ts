// Local diagnostic copies only. These deliberately reduced files are NEVER
// delivery artifacts or compatibility passes; they isolate reader failures.
import "../tests/canvas-harness.ts";
import { readFile, stat, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import type { Layer, Psd } from "ag-psd";
import { readPsd, writePsd } from "../app/engine/ag-psd-io.ts";
import { inspectPhotoshopHeader } from "../app/engine/input-limits.ts";
import { acquireQualificationLock } from "./qualification-lock.mjs";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Supply an existing retained diagnostic PSD/PSB artifact");
  const input = resolve(path), size = (await stat(input)).size;
  if (size > 256 * 1024 * 1024) throw new Error("Diagnostic input exceeds 256 MiB");
  const unlock = acquireQualificationLock("Photoshop layer bisection");
  try {
    const bytes = await readFile(input), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const header = inspectPhotoshopHeader(buffer);
    if (header.width * header.height > 32_000_000 || header.depth !== 8 || header.colorMode !== 3) throw new Error("Diagnostic supports bounded RGB8 sources only");
    const original = readPsd(buffer, { useRawData: true, useImageData: true, skipCompositeImageData: true, skipThumbnail: true, totalMemoryLimit: 64 * 1024 * 1024 });
    const folder = await mkdtemp(resolve("artifacts/photoshop-bisect-"));
    const reduce = (layer: Layer): Layer => ({ name: layer.name, left: layer.left, top: layer.top, right: layer.right, bottom: layer.bottom,
      opacity: layer.opacity, blendMode: layer.blendMode, hidden: layer.hidden, clipping: layer.clipping,
      rawData: layer.rawData && { ...layer.rawData, channels: layer.rawData.channels.filter(channel => channel.id >= -1) },
      children: layer.children?.map(reduce) });
    const variant = process.argv[3] ?? "pixels-only";
    if (!["pixels-only", "layer-metadata", "global-metadata", "without-effects", "shadow-contours"].includes(variant)) throw new Error("Unknown diagnostic variant");
    const removeEffects = (layer: Layer): Layer => ({ ...layer, effects: undefined, effectsOpen: undefined, children: layer.children?.map(removeEffects) });
    const shadowContours = (layer: Layer): Layer => ({ ...layer, children: layer.children?.map(shadowContours),
      effects: layer.effects && { ...layer.effects, ...(layer.effects.dropShadow ? { dropShadow: layer.effects.dropShadow.map(shadow => ({ ...shadow,
        contour: shadow.contour?.curve.length ? shadow.contour : { name: "Linear", curve: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
      })) } : {}) } });
    const reduced: Psd = variant === "shadow-contours" ? { ...original, children: original.children?.map(shadowContours) } :
      variant === "without-effects" ? { ...original, children: original.children?.map(removeEffects) } :
      variant === "global-metadata" ? { ...original, linkedFiles: undefined, children: original.children?.map(reduce), engineData: undefined } :
      { width: original.width, height: original.height, linkedFiles: variant === "layer-metadata" ? original.linkedFiles : undefined,
        children: variant === "layer-metadata" ? original.children : original.children?.map(reduce) };
    const output = writePsd(reduced, { psb: header.container === "psb", noBackground: true });
    const file = join(folder, `${variant}.${header.container}`);
    await writeFile(file, new Uint8Array(output), { flag: "wx" });
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ diagnosticOnly: true, source: input,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"), output: file,
      variant, warning: "Reduced diagnostic only, not a delivery file or fidelity pass" }, null, 2));
    console.log(file);
  } finally { unlock(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
