import { SRGB_PROFILE } from "../app/engine/color-management.ts";
import { D50_WHITE, D65_WHITE, chromaticAdaptationMatrix } from "../app/engine/color-math.ts";

type TagPayload = { signature: string; bytes: Uint8Array };

function signature(value: string) {
  if (value.length !== 4) throw new Error("ICC signatures must contain four characters.");
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

export function setSignature(bytes: Uint8Array, offset: number, value: string) {
  bytes.set(signature(value), offset);
}

export function setU32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint32(offset, value, false);
}

function setS15Fixed16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setInt32(offset, Math.round(value * 65536), false);
}

function setU16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint16(offset, value, false);
}

function xyzTag(xyz: readonly number[]) {
  const bytes = new Uint8Array(20);
  setSignature(bytes, 0, "XYZ ");
  xyz.forEach((value, index) => setS15Fixed16(bytes, 8 + index * 4, value));
  return bytes;
}

function parametricSrgbTag() {
  const parameters = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045, 0, 0];
  const bytes = new Uint8Array(12 + parameters.length * 4);
  setSignature(bytes, 0, "para");
  new DataView(bytes.buffer).setUint16(8, 4, false);
  parameters.forEach((value, index) => setS15Fixed16(bytes, 12 + index * 4, value));
  return bytes;
}

function descriptionTag(value: string) {
  const encoded = new TextEncoder().encode(`${value}\0`);
  const bytes = new Uint8Array(12 + encoded.length);
  setSignature(bytes, 0, "desc");
  setU32(bytes, 8, encoded.length);
  bytes.set(encoded, 12);
  return bytes;
}

function sf32Tag(values: readonly number[]) {
  const bytes = new Uint8Array(8 + values.length * 4);
  setSignature(bytes, 0, "sf32");
  values.forEach((value, index) => setS15Fixed16(bytes, 8 + index * 4, value));
  return bytes;
}

export function buildIcc(tags: TagPayload[], options: { colorSpace?: string; pcs?: string } = {}) {
  const tableEnd = 132 + tags.length * 12;
  let nextOffset = (tableEnd + 3) & ~3;
  const placements = tags.map((tag) => {
    const placement = { ...tag, offset: nextOffset };
    nextOffset = (nextOffset + tag.bytes.length + 3) & ~3;
    return placement;
  });
  const bytes = new Uint8Array(nextOffset);
  setU32(bytes, 0, bytes.length);
  bytes[8] = 4;
  bytes[9] = 0x30;
  setSignature(bytes, 12, "mntr");
  setSignature(bytes, 16, options.colorSpace ?? "RGB ");
  setSignature(bytes, 20, options.pcs ?? "XYZ ");
  setSignature(bytes, 36, "acsp");
  setU32(bytes, 64, 1);
  D50_WHITE.forEach((value, index) => setS15Fixed16(bytes, 68 + index * 4, value));
  setU32(bytes, 128, tags.length);
  placements.forEach((tag, index) => {
    const tableOffset = 132 + index * 12;
    setSignature(bytes, tableOffset, tag.signature);
    setU32(bytes, tableOffset + 4, tag.offset);
    setU32(bytes, tableOffset + 8, tag.bytes.length);
    bytes.set(tag.bytes, tag.offset);
  });
  return bytes;
}

export function matrixTrcIcc() {
  const matrix = SRGB_PROFILE.matrixToPcs!;
  const adaptation = chromaticAdaptationMatrix(D65_WHITE, D50_WHITE);
  return buildIcc([
    { signature: "desc", bytes: descriptionTag("Synthetic sRGB matrix profile") },
    { signature: "wtpt", bytes: xyzTag(D50_WHITE) },
    { signature: "rXYZ", bytes: xyzTag([matrix[0], matrix[3], matrix[6]]) },
    { signature: "gXYZ", bytes: xyzTag([matrix[1], matrix[4], matrix[7]]) },
    { signature: "bXYZ", bytes: xyzTag([matrix[2], matrix[5], matrix[8]]) },
    { signature: "rTRC", bytes: parametricSrgbTag() },
    { signature: "gTRC", bytes: parametricSrgbTag() },
    { signature: "bTRC", bytes: parametricSrgbTag() },
    { signature: "chad", bytes: sf32Tag(adaptation) },
  ]);
}

export function linearSrgbA2B1LutTag() {
  const grid = 2;
  const entries = 2;
  const channelTableValues = 3 * entries;
  const clutValues = grid ** 3 * 3;
  const bytes = new Uint8Array(52 + (channelTableValues + clutValues + channelTableValues) * 2);
  setSignature(bytes, 0, "mft2");
  bytes[8] = 3;
  bytes[9] = 3;
  bytes[10] = grid;
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, index) => setS15Fixed16(bytes, 12 + index * 4, value));
  setU16(bytes, 48, entries);
  setU16(bytes, 50, entries);
  let offset = 52;
  for (let channel = 0; channel < 3; channel += 1) {
    setU16(bytes, offset, 0);
    setU16(bytes, offset + 2, 65535);
    offset += 4;
  }
  const matrix = SRGB_PROFILE.matrixToPcs!;
  const xyzScale = 65535 / 32768;
  for (let red = 0; red < grid; red += 1) {
    for (let green = 0; green < grid; green += 1) {
      for (let blue = 0; blue < grid; blue += 1) {
        const rgb = [red, green, blue];
        for (let channel = 0; channel < 3; channel += 1) {
          const xyz = matrix[channel * 3] * rgb[0] + matrix[channel * 3 + 1] * rgb[1] + matrix[channel * 3 + 2] * rgb[2];
          setU16(bytes, offset, Math.round(Math.max(0, Math.min(1, xyz / xyzScale)) * 65535));
          offset += 2;
        }
      }
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    setU16(bytes, offset, 0);
    setU16(bytes, offset + 2, 65535);
    offset += 4;
  }
  return bytes;
}
