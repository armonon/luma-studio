export const RAW_EXTENSIONS = ["dng", "cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef"] as const;

export type RawPreview = {
  blob: Blob;
  format: string;
  byteOffset: number;
  byteLength: number;
};

export function rawExtension(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return (RAW_EXTENSIONS as readonly string[]).includes(extension) ? extension : null;
}

/**
 * Extracts the largest embedded JPEG rendition from TIFF-based camera RAW and
 * RAF containers. This is intentionally identified as a preview, never as a
 * demosaiced RAW result, so downstream provenance remains honest.
 */
export function extractEmbeddedRawPreview(source: ArrayBuffer, name: string): RawPreview | null {
  const bytes = new Uint8Array(source);
  if (bytes.length < 4 || !rawExtension(name)) return null;
  let best: { start: number; end: number } | null = null;
  let start = -1;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8) {
      if (start < 0) start = index;
      index += 1;
      continue;
    }
    if (start >= 0 && bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
      const end = index + 2;
      if (end - start >= 1024 && (!best || end - start > best.end - best.start)) best = { start, end };
      start = -1;
      index += 1;
    }
  }
  if (!best) return null;
  const payload = source.slice(best.start, best.end);
  return {
    blob: new Blob([payload], { type: "image/jpeg" }),
    format: rawExtension(name)!.toUpperCase(),
    byteOffset: best.start,
    byteLength: best.end - best.start,
  };
}
