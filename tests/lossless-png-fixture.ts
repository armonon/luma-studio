// Real, unfiltered RGBA PNGs for pixel-exact archive mocks. Unlike a premultiplied
// canvas codec, these retain RGB bytes even beneath zero alpha.
import { deflateSync, inflateSync } from "node:zlib";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(name: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(name), data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
export function encodeFixturePng(width: number, height: number, pixels: Uint8ClampedArray) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array())]);
}
export async function decodeFixturePng(blob: Blob) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Fixture is not a PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) { const size = bytes.readUInt32BE(offset); if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + size)); offset += size + 12; }
  const rows = inflateSync(Buffer.concat(idat)), pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) { const start = y * (width * 4 + 1); if (rows[start] !== 0) throw new Error("Fixture decoder only supports filter 0"); pixels.set(rows.subarray(start + 1, start + 1 + width * 4), y * width * 4); }
  return { width, height, pixels: [...pixels], close() {} };
}
