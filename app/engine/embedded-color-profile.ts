import { parseIccProfile, type ColorProfile } from "./icc-profile";

export type EmbeddedProfileContainer = "jpeg" | "png" | "webp" | "unknown";

export type EmbeddedProfileExtraction = {
  readonly container: EmbeddedProfileContainer;
  readonly profileName?: string;
  readonly bytes: Uint8Array | null;
  readonly chunks: number;
  readonly warnings: readonly string[];
  readonly capability: {
    readonly embeddedProfileFound: boolean;
    readonly decoded: boolean;
    readonly fallbackReason: string | null;
  };
};

export type ParsedEmbeddedProfile = {
  readonly extraction: EmbeddedProfileExtraction;
  readonly profile: ColorProfile | null;
  readonly parseError: string | null;
};

const MAX_PROFILE_BYTES = 32 * 1024 * 1024;

/** Extracts ICC_PROFILE APP2, PNG iCCP, or WebP ICCP payloads without decoding pixels. */
export async function extractEmbeddedColorProfile(
  input: ArrayBuffer | ArrayBufferView,
): Promise<EmbeddedProfileExtraction> {
  const bytes = copyInput(input);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return extractJpegProfile(bytes);
  if (isPng(bytes)) return extractPngProfile(bytes);
  if (isWebp(bytes)) return extractWebpProfile(bytes);
  return noProfile("unknown", "Container does not expose a supported JPEG, PNG, or WebP ICC embedding format.");
}

export async function extractAndParseEmbeddedColorProfile(
  input: ArrayBuffer | ArrayBufferView,
): Promise<ParsedEmbeddedProfile> {
  const extraction = await extractEmbeddedColorProfile(input);
  if (!extraction.bytes) return { extraction, profile: null, parseError: null };
  try {
    return { extraction, profile: parseIccProfile(extraction.bytes), parseError: null };
  } catch (error) {
    return {
      extraction,
      profile: null,
      parseError: error instanceof Error ? error.message : "Embedded ICC profile could not be parsed.",
    };
  }
}

function extractJpegProfile(bytes: Uint8Array): EmbeddedProfileExtraction {
  const warnings: string[] = [];
  const parts = new Map<number, Uint8Array>();
  let expectedParts = 0;
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0xff) break;
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > bytes.length) break;
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (length < 2 || cursor + length > bytes.length) {
      warnings.push("JPEG ended inside a marker segment.");
      break;
    }
    const payloadStart = cursor + 2;
    const payloadEnd = cursor + length;
    if (marker === 0xe2 && ascii(bytes, payloadStart, Math.min(payloadEnd, payloadStart + 12)) === "ICC_PROFILE\0") {
      if (payloadStart + 14 > payloadEnd) {
        warnings.push("A JPEG ICC_PROFILE segment was too short.");
      } else {
        const sequence = bytes[payloadStart + 12];
        const count = bytes[payloadStart + 13];
        if (sequence === 0 || count === 0 || sequence > count) {
          warnings.push("A JPEG ICC_PROFILE segment had invalid sequence metadata.");
        } else if (expectedParts !== 0 && count !== expectedParts) {
          warnings.push("JPEG ICC_PROFILE segments disagreed about their total count.");
        } else if (parts.has(sequence)) {
          warnings.push(`Duplicate JPEG ICC_PROFILE segment ${sequence} was ignored.`);
        } else {
          expectedParts = count;
          parts.set(sequence, bytes.slice(payloadStart + 14, payloadEnd));
        }
      }
    }
    cursor += length;
  }
  if (parts.size === 0) return noProfile("jpeg", "JPEG has no ICC_PROFILE APP2 segments.", warnings);
  if (expectedParts !== parts.size || Array.from({ length: expectedParts }, (_, index) => index + 1).some((part) => !parts.has(part))) {
    return undecodedProfile("jpeg", parts.size, "JPEG ICC_PROFILE segment sequence is incomplete.", warnings);
  }
  const profile = concatenate(Array.from({ length: expectedParts }, (_, index) => parts.get(index + 1)!));
  if (profile.length > MAX_PROFILE_BYTES) return undecodedProfile("jpeg", parts.size, "Embedded ICC profile exceeds the 32 MiB safety limit.", warnings);
  return decodedProfile("jpeg", profile, parts.size, warnings);
}

async function extractPngProfile(bytes: Uint8Array): Promise<EmbeddedProfileExtraction> {
  const warnings: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = view.getUint32(cursor, false);
    const type = ascii(bytes, cursor + 4, cursor + 8);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length - 4) return undecodedProfile("png", 0, "PNG chunk table is truncated.", warnings);
    if (type === "iCCP") {
      const nameEnd = bytes.indexOf(0, dataStart);
      if (nameEnd < dataStart || nameEnd + 2 > dataEnd) {
        return undecodedProfile("png", 1, "PNG iCCP header is malformed.", warnings);
      }
      const profileName = new TextDecoder("latin1").decode(bytes.subarray(dataStart, nameEnd));
      const compressionMethod = bytes[nameEnd + 1];
      if (compressionMethod !== 0) {
        return undecodedProfile("png", 1, `PNG iCCP compression method ${compressionMethod} is unsupported.`, warnings, profileName);
      }
      if (typeof DecompressionStream === "undefined") {
        return undecodedProfile("png", 1, "This runtime cannot inflate PNG iCCP profile data.", warnings, profileName);
      }
      try {
        const profile = await decompressZlib(bytes.slice(nameEnd + 2, dataEnd));
        return decodedProfile("png", profile, 1, warnings, profileName);
      } catch (error) {
        return undecodedProfile(
          "png",
          1,
          error instanceof Error ? error.message : "PNG iCCP profile could not be inflated.",
          warnings,
          profileName,
        );
      }
    }
    cursor = dataEnd + 4;
    if (type === "IEND") break;
  }
  return noProfile("png", "PNG has no iCCP chunk.", warnings);
}

function extractWebpProfile(bytes: Uint8Array): EmbeddedProfileExtraction {
  const warnings: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const type = ascii(bytes, cursor, cursor + 4);
    const size = view.getUint32(cursor + 4, true);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) return undecodedProfile("webp", 0, "WebP chunk table is truncated.", warnings);
    if (type === "ICCP") {
      if (size > MAX_PROFILE_BYTES) return undecodedProfile("webp", 1, "Embedded ICC profile exceeds the 32 MiB safety limit.", warnings);
      return decodedProfile("webp", bytes.slice(dataStart, dataEnd), 1, warnings);
    }
    cursor = dataEnd + (size & 1);
  }
  return noProfile("webp", "WebP has no ICCP chunk.", warnings);
}

async function decompressZlib(compressed: Uint8Array) {
  const compressedBuffer = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(compressedBuffer).set(compressed);
  const stream = new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PROFILE_BYTES) {
      await reader.cancel();
      throw new Error("Inflated ICC profile exceeds the 32 MiB safety limit.");
    }
    chunks.push(value);
  }
  return concatenate(chunks);
}

function decodedProfile(
  container: EmbeddedProfileContainer,
  bytes: Uint8Array,
  chunks: number,
  warnings: readonly string[],
  profileName?: string,
): EmbeddedProfileExtraction {
  return {
    container,
    profileName,
    bytes,
    chunks,
    warnings,
    capability: { embeddedProfileFound: true, decoded: true, fallbackReason: null },
  };
}

function undecodedProfile(
  container: EmbeddedProfileContainer,
  chunks: number,
  reason: string,
  warnings: readonly string[],
  profileName?: string,
): EmbeddedProfileExtraction {
  return {
    container,
    profileName,
    bytes: null,
    chunks,
    warnings,
    capability: { embeddedProfileFound: true, decoded: false, fallbackReason: reason },
  };
}

function noProfile(
  container: EmbeddedProfileContainer,
  reason: string,
  warnings: readonly string[] = [],
): EmbeddedProfileExtraction {
  return {
    container,
    bytes: null,
    chunks: 0,
    warnings,
    capability: { embeddedProfileFound: false, decoded: false, fallbackReason: reason },
  };
}

function concatenate(parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function copyInput(input: ArrayBuffer | ArrayBufferView) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return bytes.slice();
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function isPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= 8 && signature.every((value, index) => bytes[index] === value);
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}
