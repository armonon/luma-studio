// Camera RAW extensions the picker accepts. Only "dng" gets a real sensor
// decode via decodeDng(); every other extension falls through to
// extractEmbeddedRawPreview(), which returns the largest embedded JPEG and is
// tagged as "embedded-raw-preview" by ingestRaw. See DNG_DECODED_EXTENSIONS
// if you need the narrower list for UI copy that promises full RAW develop.
export const RAW_EXTENSIONS = ["dng", "cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef"] as const;
export const DNG_DECODED_EXTENSIONS = ["dng"] as const;

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
 * Whether this file will get a real sensor decode (Bayer demosaic to a float
 * master) as opposed to having its embedded JPEG preview lifted out. Callers
 * should use this to set expectations *before* import rather than explaining
 * after the fact.
 */
export function supportsSensorDecode(name: string): boolean {
  const extension = rawExtension(name);
  return !!extension && (DNG_DECODED_EXTENSIONS as readonly string[]).includes(extension);
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

export type RawIngestResult =
  | { kind: "developed-dng"; developed: ReturnType<typeof decodeDng> }
  | { kind: "embedded-preview"; preview: RawPreview; decodeFailure?: { code: string; message: string } };

/**
 * Browser-safe RAW ingestion boundary. Classic TIFF and BigTIFF Bayer DNGs
 * using uncompressed or lossless-JPEG CFA blocks are developed from sensor
 * samples; other camera RAWs fall back to a tagged embedded JPEG when present.
 */
export function ingestRaw(
  source: ArrayBuffer,
  name: string,
  settings: Partial<RawDevelopSettings> = {},
): RawIngestResult {
  const extension = rawExtension(name);
  if (!extension) throw new RawDecodeError("invalid-container", "The file extension is not a supported camera RAW type");
  let failure: RawDecodeError | undefined;
  if (extension === "dng") {
    try {
      return { kind: "developed-dng", developed: decodeDng(source, name, settings) };
    } catch (error) {
      if (!(error instanceof RawDecodeError)) throw error;
      failure = error;
    }
  }
  const preview = extractEmbeddedRawPreview(source, name);
  if (preview) {
    return {
      kind: "embedded-preview",
      preview,
      decodeFailure: failure ? { code: failure.code, message: failure.message } : undefined,
    };
  }
  if (failure) throw failure;
  throw new RawDecodeError(
    "unsupported-container",
    `${extension.toUpperCase()} sensor decoding is not available locally and this file has no readable embedded JPEG`,
  );
}
import { decodeDng, RawDecodeError } from "./raw-dng";
import { RawDevelopSettings } from "./raw-develop";

export * from "./raw-develop";
export * from "./raw-dng";
export * from "./raw-surface";
