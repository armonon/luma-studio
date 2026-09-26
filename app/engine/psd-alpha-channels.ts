import { SparseAlphaSurface } from "./alpha-surface";
import type { Document } from "./document";
import { inspectPhotoshopHeader, extractPhotoshopImageResources } from "./psd-metadata";
import { photoshopChannelRows } from "./photoshop-channel-rows";

type Channels = NonNullable<Document["alphaChannels"]>;
const MAX_ALPHA_BYTES = 32 * 1024 * 1024;
const CHANNEL_RESOURCES = new Set([1006, 1007, 1045, 1053, 1077]);

export function photoshopAlphaExportBytes(doc: Document) {
  return (doc.alphaChannels?.length ?? 0) * doc.width * doc.height * 4;
}

export function assertPhotoshopAlphaExport(doc: Document) {
  const channels = doc.alphaChannels ?? [];
  if (channels.length > 52 || photoshopAlphaExportBytes(doc) > MAX_ALPHA_BYTES) throw new Error("Photoshop alpha export is bounded to 52 channels and 32 MiB of native alpha samples; save the .luma master instead");
  for (const channel of channels) if (!channel.name.trim() || channel.name.length > 80 || channel.surface.width !== doc.width || channel.surface.height !== doc.height) throw new Error("Invalid Photoshop alpha channel name or geometry");
}

/** Read section boundaries without touching or decoding layer pixels. */
function sections(buffer: ArrayBuffer) {
  const header = inspectPhotoshopHeader(buffer), view = new DataView(buffer);
  const u32 = (offset: number) => {
    if (offset < 0 || offset + 4 > buffer.byteLength) throw new Error("Truncated Photoshop section");
    return view.getUint32(offset);
  };
  const resources = 30 + u32(26), resourceStart = resources + 4, resourceEnd = resourceStart + u32(resources);
  const size = header.version === 2 ? 8 : 4;
  if (size === 8 && u32(resourceEnd) !== 0) throw new Error("Photoshop section exceeds browser addressing");
  const composite = resourceEnd + size + u32(resourceEnd + size - 4);
  if (composite + 2 > buffer.byteLength) throw new Error("Truncated Photoshop composite");
  return { header, view, resources, resourceStart, resourceEnd, composite, compression: view.getUint16(composite) };
}

function unicodeNames(channels: Channels) {
  const data = new Uint8Array(channels.reduce((sum, channel) => sum + 4 + (channel.name.length + 1) * 2, 0)), view = new DataView(data.buffer);
  let offset = 0;
  for (const channel of channels) {
    view.setUint32(offset, channel.name.length + 1); offset += 4;
    for (let i = 0; i < channel.name.length; i++) { view.setUint16(offset, channel.name.charCodeAt(i)); offset += 2; }
    offset += 2;
  }
  const block = new Uint8Array(12 + data.length), b = new DataView(block.buffer);
  block.set([56,66,73,77]); b.setUint16(4, 1045); b.setUint32(8, data.length); block.set(data, 12);
  return block;
}

/** Append saved alpha to an RGB writer result. Preserve its composite samples
 * and layer section verbatim; only resource names/count and extra planes change. */
export function writePhotoshopAlphaChannels(buffer: ArrayBuffer, doc: Document) {
  assertPhotoshopAlphaExport(doc);
  const channels = doc.alphaChannels ?? [], s = sections(buffer), { header } = s;
  const resources = extractPhotoshopImageResources(buffer);
  if (!channels.length && !resources.some(resource => CHANNEL_RESOURCES.has(resource.id))) return buffer;
  if (header.colorMode !== 3 || ![8,16,32].includes(header.bitsPerChannel) || header.channels < 3 || header.channels > 4 || ![0,1].includes(s.compression)) throw new Error("Unsupported Photoshop composite for alpha export");
  const kept = resources.filter(resource => !CHANNEL_RESOURCES.has(resource.id)).map(resource => resource.bytes);
  if (channels.length) kept.push(unicodeNames(channels));
  const resourceBytes = kept.reduce((sum, bytes) => sum + bytes.length, 0);
  const depthBytes = header.bitsPerChannel / 8, rowBytes = header.width * depthBytes, tableWord = header.version === 2 ? 4 : 2;
  const encodedRow = rowBytes + Math.ceil(rowBytes / 128);
  if (s.compression === 1 && tableWord === 2 && encodedRow > 65535) throw new Error("Alpha row exceeds PSD PackBits limit; use PSB");
  const originalTable = s.compression === 1 ? header.channels * header.height * tableWord : 0;
  const addedTable = s.compression === 1 ? channels.length * header.height * tableWord : 0;
  const addedPixels = channels.length * header.height * (s.compression === 1 ? encodedRow : rowBytes);
  const total = buffer.byteLength + resourceBytes - (s.resourceEnd - s.resourceStart) + addedTable + addedPixels;
  if (!Number.isSafeInteger(total) || total > 384 * 1024 * 1024 || s.composite + 2 + originalTable > buffer.byteLength) throw new Error("Photoshop alpha writer exceeds its memory or file boundary");
  const input = new Uint8Array(buffer), output = new Uint8Array(total), view = new DataView(output.buffer);
  output.set(input.subarray(0, s.resources)); view.setUint32(s.resources, resourceBytes);
  let at = s.resourceStart;
  for (const block of kept) { output.set(block, at); at += block.length; }
  output.set(input.subarray(s.resourceEnd, s.composite + 2), at); at += s.composite + 2 - s.resourceEnd;
  const tableStart = at;
  output.set(input.subarray(s.composite + 2, s.composite + 2 + originalTable), at); at += originalTable + addedTable;
  output.set(input.subarray(s.composite + 2 + originalTable), at); at += buffer.byteLength - s.composite - 2 - originalTable;
  const row = new Uint8Array(rowBytes), samples = new DataView(row.buffer);
  for (let c = 0; c < channels.length; c++) for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const alpha = channels[c].surface.sample(x, y);
      if (depthBytes === 1) row[x] = alpha;
      else if (depthBytes === 2) samples.setUint16(x * 2, alpha * 257);
      else samples.setFloat32(x * 4, alpha / 255);
    }
    if (s.compression === 0) { output.set(row, at); at += row.length; }
    else {
      const t = tableStart + originalTable + (c * header.height + y) * tableWord;
      if (tableWord === 2) view.setUint16(t, encodedRow); else view.setUint32(t, encodedRow);
      for (let x = 0; x < row.length; x += 128) {
        const count = Math.min(128, row.length - x); output[at++] = count - 1;
        output.set(row.subarray(x, x + count), at); at += count;
      }
    }
  }
  view.setUint16(12, header.channels + channels.length);
  if (at !== total) throw new Error("Photoshop alpha writer length mismatch");
  return output.buffer;
}

/** Decode named raw/PackBits composite alpha into sparse surfaces, tile-row
 * strips at a time. No RGBA composite or full decoded alpha plane is allocated. */
export function readPhotoshopAlphaChannels(buffer: ArrayBuffer, names: readonly string[]): Channels {
  if (!names.length) return [];
  const s = sections(buffer), { header, view } = s, first = header.channels - names.length;
  if (header.colorMode !== 3 || ![8,16,32].includes(header.bitsPerChannel) || names.length > 52 || ![3,4].includes(first) || ![0,1].includes(s.compression)) throw new Error("Named alpha uses an unsupported color mode, channel layout or compression");
  if (names.some(name => !name.trim() || name.length > 80) || header.width * header.height * names.length * 4 > MAX_ALPHA_BYTES) throw new Error("Named alpha exceeds the channel name or 32 MiB import bound");
  const depthBytes = header.bitsPerChannel / 8, rowBytes = header.width * depthBytes, planeBytes = rowBytes * header.height;
  const word = header.version === 2 ? 4 : 2, table = s.composite + 2;
  const tableBytes = s.compression === 1 ? header.channels * header.height * word : 0;
  if (table + tableBytes > buffer.byteLength) throw new Error("Truncated alpha row table");
  let payload = table + tableBytes;
  const offsets = [payload];
  for (let c = 0; c < header.channels; c++) {
    if (s.compression === 0) payload += planeBytes;
    else for (let y = 0; y < header.height; y++) payload += word === 2 ? view.getUint16(table + (c * header.height + y) * word) : view.getUint32(table + (c * header.height + y) * word);
    if (payload > buffer.byteLength) throw new Error("Truncated alpha channel payload");
    offsets.push(payload);
  }
  if (payload !== buffer.byteLength) throw new Error("Unexpected data after Photoshop composite");
  return names.map((name, index) => {
    const c = first + index;
    let data = new Uint8Array(buffer, offsets[c], offsets[c + 1] - offsets[c]);
    if (s.compression === 1) {
      if (data.length + header.height * word > MAX_ALPHA_BYTES) throw new Error("Compressed alpha payload exceeds its memory bound");
      const joined = new Uint8Array(header.height * word + data.length);
      joined.set(new Uint8Array(buffer, table + c * header.height * word, header.height * word)); joined.set(data, header.height * word); data = joined;
    }
    const read = photoshopChannelRows(data, rowBytes, header.height, s.compression, header.version === 2);
    const row = new Uint8Array(rowBytes), samples = new DataView(row.buffer), surface = new SparseAlphaSurface(header.width, header.height);
    // A strip keeps scratch <= width * tileSize, and compactAlpha removes
    // uniform tiles after each strip is committed.
    for (let y = 0; y < header.height; y += surface.tileSize) {
      const addresses = [...surface.grid.tilesIntersecting({ x: 0, y, width: header.width, height: Math.min(surface.tileSize, header.height - y) })];
      const tiles = addresses.map(address => new Uint8Array(address.width * address.height));
      for (let dy = 0; dy < Math.min(surface.tileSize, header.height - y); dy++) {
        read(y + dy, row);
        for (let t = 0; t < addresses.length; t++) for (let x = 0; x < addresses[t].width; x++) {
          const column = addresses[t].x + x;
          const value = depthBytes === 1 ? row[column] / 255 : depthBytes === 2 ? samples.getUint16(column * 2) / 65535 : samples.getFloat32(column * 4);
          if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid Photoshop alpha sample");
          tiles[t][dy * addresses[t].width + x] = Math.round(value * 255);
        }
      }
      addresses.forEach((address, t) => surface.writeTile(address.key, tiles[t]));
    }
    return { id: `psd-alpha-${index}`, name, surface };
  });
}
