export class LosslessJpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LosslessJpegError";
  }
}

type HuffmanTable = Map<number, Map<number, number>>;

class EntropyReader {
  private byte = 0;
  private bits = 0;

  constructor(readonly source: Uint8Array, private cursor: number) {}

  readBit() {
    if (this.bits === 0) {
      if (this.cursor >= this.source.length) throw new LosslessJpegError("Lossless JPEG entropy data is truncated");
      this.byte = this.source[this.cursor++];
      if (this.byte === 0xff) {
        while (this.cursor < this.source.length && this.source[this.cursor] === 0xff) this.cursor += 1;
        const marker = this.source[this.cursor++];
        if (marker !== 0x00) throw new LosslessJpegError(`Unexpected JPEG marker 0x${marker.toString(16)} in entropy data`);
      }
      this.bits = 8;
    }
    this.bits -= 1;
    return (this.byte >>> this.bits) & 1;
  }

  readBits(count: number) {
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) value = value * 2 + this.readBit();
    return value;
  }

  restart(expected: number) {
    this.bits = 0;
    while (this.cursor < this.source.length && this.source[this.cursor] === 0xff) this.cursor += 1;
    const marker = this.source[this.cursor++];
    if (marker !== 0xd0 + expected) throw new LosslessJpegError(`Expected restart marker RST${expected}`);
  }
}

function decodeHuffman(reader: EntropyReader, table: HuffmanTable) {
  let code = 0;
  for (let length = 1; length <= 16; length += 1) {
    code = code * 2 + reader.readBit();
    const symbol = table.get(length)?.get(code);
    if (symbol !== undefined) return symbol;
  }
  throw new LosslessJpegError("Invalid lossless JPEG Huffman code");
}

function receiveDifference(reader: EntropyReader, category: number) {
  if (category === 0) return 0;
  if (category > 16) throw new LosslessJpegError(`Invalid lossless JPEG difference category ${category}`);
  const value = reader.readBits(category);
  const threshold = 1 << (category - 1);
  return value < threshold ? value - ((1 << category) - 1) : value;
}

function predictor(selection: number, left: number, above: number, upperLeft: number) {
  if (selection === 1) return left;
  if (selection === 2) return above;
  if (selection === 3) return upperLeft;
  if (selection === 4) return left + above - upperLeft;
  if (selection === 5) return left + ((above - upperLeft) >> 1);
  if (selection === 6) return above + ((left - upperLeft) >> 1);
  if (selection === 7) return (left + above) >> 1;
  throw new LosslessJpegError(`Unsupported lossless JPEG predictor ${selection}`);
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array) {
  const table: HuffmanTable = new Map();
  let code = 0;
  let symbolIndex = 0;
  for (let length = 1; length <= 16; length += 1) {
    const byCode = new Map<number, number>();
    for (let index = 0; index < counts[length - 1]; index += 1) {
      byCode.set(code++, symbols[symbolIndex++]);
    }
    if (byCode.size) table.set(length, byCode);
    code <<= 1;
  }
  return table;
}

export type DecodedLosslessJpeg = {
  width: number;
  height: number;
  precision: number;
  samples: Uint16Array;
};

/** Decoder for the single-component SOF3 lossless JPEG streams used by DNG CFA tiles. */
export function decodeLosslessJpeg(source: Uint8Array): DecodedLosslessJpeg {
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) {
    throw new LosslessJpegError("Lossless JPEG SOI marker is missing");
  }
  let cursor = 2;
  let width = 0;
  let height = 0;
  let precision = 0;
  let components = 0;
  let restartInterval = 0;
  let predictorSelection = 1;
  let pointTransform = 0;
  let dcTableId = 0;
  let entropyOffset = -1;
  const huffman = new Map<number, HuffmanTable>();

  while (cursor < source.length) {
    while (cursor < source.length && source[cursor] !== 0xff) cursor += 1;
    while (cursor < source.length && source[cursor] === 0xff) cursor += 1;
    if (cursor >= source.length) break;
    const marker = source[cursor++];
    if (marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (cursor + 2 > source.length) throw new LosslessJpegError("JPEG segment length is truncated");
    const length = (source[cursor] << 8) | source[cursor + 1];
    if (length < 2 || cursor + length > source.length) throw new LosslessJpegError("JPEG segment exceeds the source buffer");
    const start = cursor + 2;
    const end = cursor + length;
    if (marker === 0xc3) {
      precision = source[start];
      height = (source[start + 1] << 8) | source[start + 2];
      width = (source[start + 3] << 8) | source[start + 4];
      components = source[start + 5];
      if (components !== 1) throw new LosslessJpegError("Only single-component DNG lossless JPEG is supported");
    } else if (marker === 0xc4) {
      let position = start;
      while (position < end) {
        const tableClassAndId = source[position++];
        const tableClass = tableClassAndId >>> 4;
        const tableId = tableClassAndId & 0x0f;
        if (tableClass !== 0) throw new LosslessJpegError("Lossless JPEG cannot use AC Huffman tables");
        const counts = source.subarray(position, position + 16);
        position += 16;
        const symbolCount = counts.reduce((sum, value) => sum + value, 0);
        const symbols = source.subarray(position, position + symbolCount);
        position += symbolCount;
        if (position > end) throw new LosslessJpegError("JPEG Huffman table is truncated");
        huffman.set(tableId, buildHuffman(counts, symbols));
      }
    } else if (marker === 0xdd) {
      restartInterval = (source[start] << 8) | source[start + 1];
    } else if (marker === 0xda) {
      const scanComponents = source[start];
      if (scanComponents !== 1) throw new LosslessJpegError("Only one-component DNG lossless scans are supported");
      dcTableId = source[start + 2] >>> 4;
      predictorSelection = source[start + 3];
      pointTransform = source[start + 5] & 0x0f;
      entropyOffset = end;
      break;
    }
    cursor = end;
  }

  if (!width || !height || !precision || components !== 1 || entropyOffset < 0) {
    throw new LosslessJpegError("Lossless JPEG is missing SOF3 or SOS metadata");
  }
  const table = huffman.get(dcTableId);
  if (!table) throw new LosslessJpegError(`Lossless JPEG DC table ${dcTableId} is missing`);
  const reducedPrecision = precision - pointTransform;
  if (reducedPrecision < 2 || reducedPrecision > 16) throw new LosslessJpegError("Lossless JPEG precision is unsupported");
  const initial = 1 << (reducedPrecision - 1);
  const reduced = new Int32Array(width * height);
  const output = new Uint16Array(width * height);
  const reader = new EntropyReader(source, entropyOffset);
  let restartIndex = 0;
  let sinceRestart = 0;
  let resetPredictor = true;
  for (let index = 0; index < output.length; index += 1) {
    if (restartInterval && sinceRestart === restartInterval) {
      reader.restart(restartIndex);
      restartIndex = (restartIndex + 1) & 7;
      sinceRestart = 0;
      resetPredictor = true;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    let prediction = initial;
    if (!resetPredictor) {
      if (y === 0) prediction = reduced[index - 1];
      else if (x === 0) prediction = reduced[index - width];
      else prediction = predictor(
        predictorSelection,
        reduced[index - 1],
        reduced[index - width],
        reduced[index - width - 1],
      );
    }
    const category = decodeHuffman(reader, table);
    const sample = prediction + receiveDifference(reader, category);
    if (sample < 0 || sample >= (1 << reducedPrecision)) throw new LosslessJpegError("Decoded lossless JPEG sample is out of range");
    reduced[index] = sample;
    output[index] = sample << pointTransform;
    resetPredictor = false;
    sinceRestart += 1;
  }
  return { width, height, precision, samples: output };
}
