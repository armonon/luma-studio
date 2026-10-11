import JSZip from "jszip";
import { CUTOUT_MAX_EDGE } from "./cutout";
import { generateBoundedProjectZip, inspectProjectEntry, readProjectEntryBytes } from "./project-zip-stream";

export const CUTOUT_PROJECT_LIMIT = 24 * 1024 * 1024;
export type CutoutProject = { name: string; width: number; height: number; feather: number; rgba: Uint8ClampedArray; mask: Uint8ClampedArray };

function metadata(raw: unknown): Omit<CutoutProject, "rgba" | "mask"> {
  const m = raw as Record<string, unknown> | null;
  if (!m || m.type !== "luma-cutout" || m.version !== 1) throw Error("Not a supported Cutout project.");
  for (const key of ["width", "height"] as const) {
    if (!Number.isInteger(m[key]) || (m[key] as number) < 1 || (m[key] as number) > CUTOUT_MAX_EDGE) throw Error("Invalid Cutout project dimensions.");
  }
  if (typeof m.name !== "string" || m.name.length > 200 || typeof m.feather !== "number" || !Number.isFinite(m.feather) || m.feather < 0 || m.feather > 8) throw Error("Invalid Cutout project settings.");
  return { name: m.name, width: m.width as number, height: m.height as number, feather: m.feather };
}

export async function saveCutoutProject(project: CutoutProject): Promise<Blob> {
  const manifest = { type: "luma-cutout", version: 1, name: project.name.slice(0, 200), width: project.width, height: project.height, feather: project.feather };
  metadata(manifest);
  const pixels = project.width * project.height;
  if (project.rgba.length !== pixels * 4 || project.mask.length !== pixels) throw Error("Cutout project pixels do not match its dimensions.");
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("source.rgba", new Uint8Array(project.rgba));
  zip.file("mask.alpha", new Uint8Array(project.mask));
  return (await generateBoundedProjectZip(zip, CUTOUT_PROJECT_LIMIT, 3)).slice(0, undefined, "application/x-luma-cutout");
}

export async function openCutoutProject(bytes: ArrayBuffer): Promise<CutoutProject> {
  if (bytes.byteLength > CUTOUT_PROJECT_LIMIT) throw Error("Cutout projects must be smaller than 24 MB.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw Error("This file is not a valid Cutout project."); }
  const names = Object.keys(zip.files);
  if (names.length !== 3 || names.some(name => !["manifest.json", "source.rgba", "mask.alpha"].includes(name))) throw Error("Invalid Cutout project archive.");
  async function read(name: string, max: number, expected?: number) {
    const entry = zip.file(name);
    if (!entry) throw Error(`Missing Cutout asset: ${name}`);
    const { size } = await inspectProjectEntry(entry, max, expected);
    return readProjectEntryBytes(entry, size, max);
  }
  const meta = metadata(JSON.parse(new TextDecoder().decode(await read("manifest.json", 4096))));
  const pixels = meta.width * meta.height;
  const rgba = await read("source.rgba", pixels * 4, pixels * 4);
  const mask = await read("mask.alpha", pixels, pixels);
  return { ...meta, rgba: new Uint8ClampedArray(rgba.buffer), mask: new Uint8ClampedArray(mask.buffer) };
}
