import type { Layer as PsdLayer } from "ag-psd";
import { readPsd } from "./ag-psd-io";
import { photoshopChannelRows } from "./photoshop-channel-rows";
import { displaySrgbToWorking } from "./color";
import { TileGrid, type ImmutableTileSource, type PixelBuffer } from "./tile-store";
import { inspectPhotoshopHeader } from "./input-limits";
import { exceedsBrowserCanvas } from "./large-documents";

export class UnsupportedPhotoshopTileSource extends Error {}

// A compressed immutable base is shared by layers and history snapshots. This
// is NOT disk paging: source bytes remain resident and must be admitted once.
const sourceLayers = new WeakMap<Uint8Array<ArrayBuffer>, PsdLayer[]>();
const sourceHashes = new WeakMap<Uint8Array<ArrayBuffer>, string>();
const tileSources = new WeakMap<Uint8Array<ArrayBuffer>, Map<number, PhotoshopTileSource>>();
const MAX_BAND_BYTES = 32 * 1024 * 1024;
let band: { owner: WeakRef<PhotoshopTileSource>; y: number; rows: number; pixels: Uint8ClampedArray } | undefined;
let working: { owner: WeakRef<PhotoshopTileSource>; key: string; bytes: Uint8Array } | undefined;

export function registerPhotoshopTileSource(bytes: Uint8Array<ArrayBuffer>, layers: PsdLayer[]) {
  const flat: PsdLayer[] = [];
  const visit = (items: PsdLayer[]) => { for (const layer of items) { flat.push(layer); if (layer.children) visit(layer.children); } };
  visit(layers);
  let indexes = 0;
  for (const layer of flat) {
    const rows = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0));
    for (const channel of layer.rawData?.channels ?? []) if (channel.compression === 1 && channel.data?.length) indexes += (rows + 1) * 4;
  }
  // Reader indexes are real retained memory too, even before a tile is read.
  if (flat.length > 4096 || indexes > 16 * 1024 * 1024 || !Number.isSafeInteger(indexes)
      || bytes.length + 192 * 1024 * 1024 + flat.length * 128 * 1024 > 512 * 1024 * 1024) throw new UnsupportedPhotoshopTileSource("Photoshop source index/descriptor budget exceeded");
  sourceLayers.set(bytes, flat);
}

export function photoshopSourceLayer(bytes: Uint8Array<ArrayBuffer>, index: number) {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid Photoshop source layer index");
  if (!sourceLayers.has(bytes)) {
    if (bytes.byteOffset || bytes.byteLength !== bytes.buffer.byteLength) throw new Error("Photoshop tile source must own its buffer");
    const header = inspectPhotoshopHeader(bytes);
    if (header.depth !== 8 || header.colorMode !== 3 || header.layers > 4096 || bytes.byteLength + 192 * 1024 * 1024 > 512 * 1024 * 1024) throw new Error("Photoshop tile source exceeds restore admission");
    const psd = readPsd(bytes.buffer, { useRawData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: 64 * 1024 * 1024 });
    registerPhotoshopTileSource(bytes, psd.children ?? []);
  }
  const layer = sourceLayers.get(bytes)![index];
  if (!layer) throw new Error("Missing Photoshop source layer");
  return layer;
}

function fingerprint(bytes: Uint8Array<ArrayBuffer>) {
  let saved = sourceHashes.get(bytes);
  if (!saved) {
    let hash = 0x811c9dc5;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
    saved = `${bytes.length}:${hash >>> 0}`;
    sourceHashes.set(bytes, saved);
  }
  return saved;
}

/** RGB8 raw/PackBits base; bounded shared scratch, no decoded layer canvases. */
export class PhotoshopTileSource implements ImmutableTileSource {
  readonly format = "rgba32f" as const;
  readonly source: ImmutableTileSource["source"];
  readonly fingerprint: string;
  readonly grid: TileGrid;
  private readonly readers: { offset: number; read: (row: number, output: Uint8Array) => void }[];
  constructor(bytes: Uint8Array<ArrayBuffer>, layerIndex: number, tileSize = 256) {
    const layer = photoshopSourceLayer(bytes, layerIndex), raw = layer.rawData;
    const width = (layer.right ?? 0) - (layer.left ?? 0), height = (layer.bottom ?? 0) - (layer.top ?? 0);
    if (!raw || raw.bitsPerChannel !== 8 || raw.colorMode !== 3 || width < 1 || height < 1 || exceedsBrowserCanvas(width, height) || tileSize !== 256) throw new UnsupportedPhotoshopTileSource("Unsupported Photoshop tile source");
    this.grid = new TileGrid(width, height, tileSize);
    if (raw.channels.some(channel => ![-1, 0, 1, 2].includes(channel.id))) throw new UnsupportedPhotoshopTileSource("Photoshop source has additional channels that require the compatibility decoder");
    const channels = raw.channels.filter(channel => channel.id >= -1 && channel.id <= 2 && channel.data?.length);
    if (!channels.length || channels.some(channel => channel.compression !== 0 && channel.compression !== 1)) throw new UnsupportedPhotoshopTileSource("Unsupported Photoshop source channels");
    if (new Set(channels.map(channel => channel.id)).size !== channels.length) throw new Error("Duplicate Photoshop source channel");
    this.readers = channels.map(channel => ({ offset: channel.id === -1 ? 3 : channel.id,
      read: photoshopChannelRows(channel.data!, width, height, channel.compression, raw.large) }));
    // Validate every compressed row before publishing a document. Rendering
    // must not be the first place a corrupt offscreen channel is discovered.
    const validationRow = new Uint8Array(width);
    for (const reader of this.readers) for (let y = 0; y < height; y++) reader.read(y, validationRow);
    this.source = { kind: "photoshop-rgb8", bytes, layerIndex };
    this.fingerprint = `${fingerprint(bytes)}:${layerIndex}`;
  }
  *keys() { for (let y = 0; y < this.grid.rows; y++) for (let x = 0; x < this.grid.columns; x++) yield this.grid.key(x, y); }
  has(key: string) { try { this.grid.parseKey(key); return true; } catch { return false; } }
  display(key: string): PixelBuffer {
    const address = this.grid.parseKey(key);
    const output = new Uint8ClampedArray(address.width * address.height * 4);
    const rowsPerBand = Math.max(1, Math.min(256, Math.floor(MAX_BAND_BYTES / (this.grid.width * 4))));
    for (let dy = 0; dy < address.height; dy++) {
      const row = address.y + dy, y = Math.floor(row / rowsPerBand) * rowsPerBand;
      if (!band || band.owner.deref() !== this || band.y !== y) {
        const rows = Math.min(rowsPerBand, this.grid.height - y);
        const pixels = new Uint8ClampedArray(rows * this.grid.width * 4);
        const scratch = new Uint8Array(this.grid.width);
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
        for (const reader of this.readers) for (let yy = 0; yy < rows; yy++) {
          reader.read(y + yy, scratch);
          for (let x = 0; x < this.grid.width; x++) pixels[(yy * this.grid.width + x) * 4 + reader.offset] = scratch[x];
        }
        band = { owner: new WeakRef(this), y, rows, pixels };
      }
      const offset = ((row - y) * this.grid.width + address.x) * 4;
      output.set(band.pixels.subarray(offset, offset + address.width * 4), dy * address.width * 4);
    }
    return { width: address.width, height: address.height, data: output };
  }
  read(key: string) {
    if (working?.owner.deref() === this && working.key === key) return working.bytes;
    const pixels = this.display(key), floats = new Float32Array(pixels.data.length);
    for (let i = 0; i < floats.length; i += 4) {
      const rgb = displaySrgbToWorking([pixels.data[i] / 255, pixels.data[i + 1] / 255, pixels.data[i + 2] / 255], "srgb");
      floats[i] = rgb[0]; floats[i + 1] = rgb[1]; floats[i + 2] = rgb[2]; floats[i + 3] = pixels.data[i + 3] / 255;
    }
    const bytes = new Uint8Array(floats.buffer);
    working = { owner: new WeakRef(this), key, bytes };
    return bytes;
  }
}

/** Reuse validated immutable bases across layer/history deserialization. */
export function getPhotoshopTileSource(bytes: Uint8Array<ArrayBuffer>, layerIndex: number) {
  let sources = tileSources.get(bytes);
  if (!sources) { sources = new Map(); tileSources.set(bytes, sources); }
  let source = sources.get(layerIndex);
  if (!source) { source = new PhotoshopTileSource(bytes, layerIndex); sources.set(layerIndex, source); }
  return source;
}
