/** Read only the two bounded SFNT fields needed for paragraph first baselines.
 * Missing/older OS/2 tables fall back to the renderer's capital-H metrics. */
export function sfntCapHeightRatio(bytes: ArrayBuffer): number | undefined {
  if (bytes.byteLength < 12) return;
  const view = new DataView(bytes), count = view.getUint16(4);
  if (count > 4096 || 12 + count * 16 > bytes.byteLength) return;
  const table = (tag: number, minimum: number) => {
    for (let i = 0; i < count; i++) {
      const entry = 12 + i * 16;
      if (view.getUint32(entry) !== tag) continue;
      const offset = view.getUint32(entry + 8), length = view.getUint32(entry + 12);
      if (length < minimum || offset < 12 + count * 16 || offset + length > bytes.byteLength) return;
      return offset;
    }
  };
  const head = table(0x68656164, 20), os2 = table(0x4f532f32, 90);
  if (head === undefined || os2 === undefined || view.getUint16(os2) < 2) return;
  const units = view.getUint16(head + 18), cap = view.getInt16(os2 + 88);
  if (units >= 16 && units <= 16384 && cap > 0 && cap <= units * 2) return cap / units;
}
