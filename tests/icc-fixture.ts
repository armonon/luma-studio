import { SRGB_PROFILE } from "../app/engine/color-management.ts";
import { D50_WHITE, D65_WHITE, chromaticAdaptationMatrix, invertColorMatrix } from "../app/engine/color-math.ts";

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

export function setS15Fixed16(bytes: Uint8Array, offset: number, value: number) {
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

export function buildIcc(
  tags: TagPayload[],
  options: { colorSpace?: string; pcs?: string; deviceClass?: string } = {},
) {
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
  setSignature(bytes, 12, options.deviceClass ?? "mntr");
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

function identityCurve() {
  const bytes = new Uint8Array(12);
  setSignature(bytes, 0, "curv");
  return bytes;
}

function setMatrix3x4(bytes: Uint8Array, offset: number, matrix: readonly number[]) {
  [...matrix, 0, 0, 0].forEach((value, index) => setS15Fixed16(bytes, offset + index * 4, value));
}

/** ICC.1 F.3-equivalent mAB/mBA pipeline using M curves, a matrix, and B curves. */
export function linearSrgbMultiFunctionTag(direction: "mAB" | "mBA") {
  const bOffset = 32;
  const matrixOffset = bOffset + 3 * 12;
  const mOffset = matrixOffset + 48;
  const bytes = new Uint8Array(mOffset + 3 * 12);
  setSignature(bytes, 0, direction === "mAB" ? "mAB " : "mBA ");
  bytes[8] = 3;
  bytes[9] = 3;
  setU32(bytes, 12, bOffset);
  setU32(bytes, 16, matrixOffset);
  setU32(bytes, 20, mOffset);
  for (let channel = 0; channel < 3; channel += 1) {
    bytes.set(identityCurve(), bOffset + channel * 12);
    bytes.set(identityCurve(), mOffset + channel * 12);
  }
  const xyzEncodingScale = 65535 / 32768;
  const matrix = direction === "mAB"
    ? SRGB_PROFILE.matrixToPcs!.map((value) => value / xyzEncodingScale)
    : invertColorMatrix(SRGB_PROFILE.matrixToPcs!).map((value) => value * xyzEncodingScale);
  setMatrix3x4(bytes, matrixOffset, matrix);
  return bytes;
}

/** A+CLUT+B mAB identity transform with a 2×2×2 16-bit CLUT. */
export function identityClutMabTag() {
  const bOffset = 32;
  const clutOffset = bOffset + 3 * 12;
  const clutSize = 20 + 2 ** 3 * 3 * 2;
  const aOffset = clutOffset + clutSize;
  const bytes = new Uint8Array(aOffset + 3 * 12);
  setSignature(bytes, 0, "mAB ");
  bytes[8] = 3;
  bytes[9] = 3;
  setU32(bytes, 12, bOffset);
  setU32(bytes, 24, clutOffset);
  setU32(bytes, 28, aOffset);
  for (let channel = 0; channel < 3; channel += 1) {
    bytes.set(identityCurve(), bOffset + channel * 12);
    bytes.set(identityCurve(), aOffset + channel * 12);
  }
  bytes[clutOffset] = 2;
  bytes[clutOffset + 1] = 2;
  bytes[clutOffset + 2] = 2;
  bytes[clutOffset + 16] = 2;
  let offset = clutOffset + 20;
  for (let red = 0; red < 2; red += 1) {
    for (let green = 0; green < 2; green += 1) {
      for (let blue = 0; blue < 2; blue += 1) {
        for (const value of [red, green, blue]) {
          setU16(bytes, offset, value * 65535);
          offset += 2;
        }
      }
    }
  }
  return bytes;
}

/** Classic BToA LUT whose nonlinear input table makes matrix ordering observable. */
export function orderedClassicB2ALutTag() {
  const grid = 2;
  const inputEntries = 3;
  const outputEntries = 2;
  const values = 3 * inputEntries + grid ** 3 * 3 + 3 * outputEntries;
  const bytes = new Uint8Array(52 + values * 2);
  setSignature(bytes, 0, "mft2");
  bytes[8] = 3;
  bytes[9] = 3;
  bytes[10] = grid;
  [0.5, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, index) => {
    setS15Fixed16(bytes, 12 + index * 4, value);
  });
  setU16(bytes, 48, inputEntries);
  setU16(bytes, 50, outputEntries);
  let offset = 52;
  for (let channel = 0; channel < 3; channel += 1) {
    const middle = channel === 0 ? 0.25 : 0.5;
    for (const value of [0, middle, 1]) {
      setU16(bytes, offset, Math.round(value * 65535));
      offset += 2;
    }
  }
  for (let red = 0; red < 2; red += 1) {
    for (let green = 0; green < 2; green += 1) {
      for (let blue = 0; blue < 2; blue += 1) {
        for (const value of [red, green, blue]) {
          setU16(bytes, offset, value * 65535);
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
