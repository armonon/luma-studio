import type { LayerRawData } from "ag-psd";
import { photoshopChannelRows } from "./photoshop-channel-rows";
import { photoshopSourceLayer } from "./photoshop-tile-source";
import type { PrecisionTileSurface, PixelBuffer } from "./tile-store";
import { PHOTOSHOP_DECODE_MEMORY_CEILING } from "./input-limits";

/** Includes codec scratch and writer growth/final-copy overhead before writing.
 * In particular, repeated blend passes must not multiply borrowed channels
 * into an unbounded output merely because their inputs require no copies. */
export function assertSourceBackedExportBudget(width: number, height: number, encodedBytes: number, sourceBytes: number, ownedBytes: number) {
  const estimate = width * height * 12 + encodedBytes * 4 + sourceBytes + ownedBytes + 128 * 1024 * 1024;
  if (![width, height, encodedBytes, sourceBytes, ownedBytes].every(value => Number.isFinite(value) && value >= 0)
      || !Number.isSafeInteger(estimate) || estimate > PHOTOSHOP_DECODE_MEMORY_CEILING) throw new Error("Photoshop writer would exceed its memory ceiling; save the Luma project instead");
  return estimate;
}

function packRow(row: Uint8Array) {
  const output = new Uint8Array(row.length + Math.ceil(row.length / 128));
  let input = 0, written = 0;
  while (input < row.length) {
    let run = 1;
    while (run < 128 && input + run < row.length && row[input + run] === row[input]) run++;
    if (run >= 3) { output[written++] = 257 - run; output[written++] = row[input]; input += run; continue; }
    const start = input;
    input += run;
    while (input < row.length && input - start < 128) {
      if (input + 2 < row.length && row[input] === row[input + 1] && row[input] === row[input + 2]) break;
      input++;
    }
    output[written++] = input - start - 1;
    output.set(row.subarray(start, input), written); written += input - start;
  }
  return output.slice(0, written);
}

/** Reuses immutable channel bytes when possible; encodes only edited rows.
 * The caller admits the cumulative owned channel bytes before allocation. */
export function sourceBackedPhotoshopChannels(surface: PrecisionTileSurface, large: boolean, admit: (bytes: number) => void): LayerRawData {
  const state = surface.store.sourceState();
  if (!state) throw new Error("Missing Photoshop tile base");
  const original = photoshopSourceLayer(state.base.source.bytes, state.base.source.layerIndex).rawData!;
  const edits = new Set([...surface.store.editKeys(), ...state.deleted]);
  if (!edits.size && original.large === large) return original;
  const width = surface.grid.width, height = surface.grid.height;
  const changedRows = new Set<number>();
  for (const key of edits) {
    const tile = surface.grid.parseKey(key);
    for (let y = tile.y; y < tile.y + tile.height; y++) changedRows.add(y);
  }
  let previewRow = -1;
  let previewBytes = 0;
  const previews = new Map<string, PixelBuffer>();
  const channels: LayerRawData["channels"] = [];
  for (const id of [-1, 0, 1, 2]) {
    const channel = original.channels.find(c => c.id === id);
    const reader = channel?.data?.length ? photoshopChannelRows(channel.data, width, height, channel.compression, original.large) : null;
    const inputLengthBytes = original.large ? 4 : 2, lengthBytes = large ? 4 : 2;
    const inputView = channel?.data ? new DataView(channel.data.buffer, channel.data.byteOffset, channel.data.byteLength) : null;
    let inputOffset = height * inputLengthBytes;
    const rows: Uint8Array[] = [], row = new Uint8Array(width);
    let length = height * lengthBytes;
    // Re-encoded rows coexist with the final contiguous channel briefly.
    let scratchBytes = 0;
    for (let y = 0; y < height; y++) {
      const encodedLength = channel?.compression === 1 && inputView ? (original.large ? inputView.getUint32(y * 4) : inputView.getUint16(y * 2)) : 0;
      let encoded: Uint8Array;
      if (!changedRows.has(y) && channel?.compression === 1 && channel.data) {
        encoded = channel.data.subarray(inputOffset, inputOffset + encodedLength);
      } else {
        if (reader) reader(y, row); else row.fill(id === -1 ? 255 : 0);
        if (changedRows.has(y)) {
          const tileRow = Math.floor(y / surface.grid.tileSize);
          if (previewRow !== tileRow) { previews.clear(); previewBytes = 0; previewRow = tileRow; }
          for (let x = 0; x < surface.grid.columns; x++) {
            const key = surface.grid.key(x, tileRow);
            if (!edits.has(key)) continue;
            const address = surface.grid.parseKey(key);
            let pixels = previews.get(key);
            if (!pixels) {
              if (previewBytes + address.width * address.height * 4 > 32 * 1024 * 1024) { previews.clear(); previewBytes = 0; }
              pixels = surface.tileToRgba8(key); previews.set(key, pixels); previewBytes += pixels.data.byteLength;
            }
            const offset = (y - address.y) * address.width * 4 + (id === -1 ? 3 : id);
            for (let dx = 0; dx < address.width; dx++) row[address.x + dx] = pixels.data[offset + dx * 4];
          }
        }
        admit(row.length + Math.ceil(row.length / 128));
        encoded = packRow(row);
        scratchBytes += encoded.length;
      }
      if (!large && encoded.length > 65535) throw new Error("Photoshop row exceeds PSD encoding limit; choose PSB");
      inputOffset += encodedLength;
      length += encoded.length;
      if (length + scratchBytes > 256 * 1024 * 1024) throw new Error("Edited Photoshop channel exceeds export memory admission");
      rows.push(encoded);
    }
    admit(length);
    const data = new Uint8Array(length), view = new DataView(data.buffer);
    let offset = height * lengthBytes;
    for (let y = 0; y < height; y++) {
      if (large) view.setUint32(y * 4, rows[y].length); else view.setUint16(y * 2, rows[y].length);
      data.set(rows[y], offset); offset += rows[y].length;
    }
    channels.push({ id, compression: 1, data });
  }
  return { bitsPerChannel: 8, colorMode: 3, large, channels };
}
