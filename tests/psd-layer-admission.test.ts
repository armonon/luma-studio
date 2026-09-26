import assert from "node:assert/strict";
import test from "node:test";
import { assertSafePhotoshopDecodeBudget, estimatePhotoshopDecodeBytes, inspectPhotoshopHeader, planPhotoshopImport } from "../app/engine/input-limits.ts";

function records(sizes: Array<[number, number]>, psb = false) {
  const lengthBytes = psb ? 8 : 4;
  const infoBytes = 2 + sizes.length * 38;
  const bytes = new Uint8Array(34 + lengthBytes * 2 + infoBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([56, 66, 80, 83]);
  view.setUint16(4, psb ? 2 : 1);
  view.setUint16(12, 3); view.setUint32(14, 6000); view.setUint32(18, 4800);
  view.setUint16(22, 8); view.setUint16(24, 3);
  const setLength = (offset: number, n: number) => psb ? view.setBigUint64(offset, BigInt(n)) : view.setUint32(offset, n);
  setLength(34, lengthBytes + infoBytes); setLength(34 + lengthBytes, infoBytes);
  const countOffset = 34 + lengthBytes * 2;
  view.setInt16(countOffset, sizes.length);
  for (let i = 0; i < sizes.length; i++) {
    const at = countOffset + 2 + i * 38;
    view.setInt32(at + 8, sizes[i][1]); view.setInt32(at + 12, sizes[i][0]);
    bytes.set([56, 66, 73, 77, 110, 111, 114, 109], at + 18);
    view.setUint32(at + 30, 4);
  }
  return bytes;
}

for (const psb of [false, true]) {
  test(`${psb ? "PSB" : "PSD"} budgets use validated local rectangles, including empty group records`, () => {
    const bytes = records([[4800, 6000], ...Array.from({ length: 30 }, () => [32, 32] as [number, number]), [0, 0]], psb);
    const header = inspectPhotoshopHeader(bytes);
    assert.equal(header.layerPixels, 4800 * 6000 + 30 * 32 * 32);
    assert.equal(header.largestLayerPixels, 4800 * 6000);
    assert.equal(planPhotoshopImport(header, bytes.length).mode, "layered");
    assert.equal(planPhotoshopImport({ ...header, layerPixels: undefined, largestLayerPixels: undefined }, bytes.length).mode, "flattened");
  });
}

test("large actual layer bounds still fall back; cropped geometry does not bypass ceilings", () => {
  const bytes = records(Array.from({ length: 10 }, () => [8000, 8000]));
  assert.equal(planPhotoshopImport(inspectPhotoshopHeader(bytes), bytes.length).mode, "flattened");
  assert.throws(() => inspectPhotoshopHeader(records([[-1, 20]])), /bounds/);
  const broken = records([[20, 20]]);
  new DataView(broken.buffer).setUint32(44 + 30, 0xffff_ffff);
  assert.throws(() => inspectPhotoshopHeader(broken), /layer record/);
});

test("truncated channels and excessive channel counts fail before pixel decoding", () => {
  const broken = records([[20, 20]]);
  new DataView(broken.buffer).setUint16(44 + 16, 57);
  assert.throws(() => inspectPhotoshopHeader(broken), /channel count/);
  new DataView(broken.buffer).setUint16(44 + 16, 4);
  assert.throws(() => inspectPhotoshopHeader(broken), /layer record/);
});

test("auto import preserves the native-save boundary even when serial PSD decoding fits", () => {
  const bytes = records([[4800, 6000], [4800, 6000], [4800, 6000]]);
  const header = inspectPhotoshopHeader(bytes);
  const sourceBytes = 90 * 1024 * 1024;
  assert.ok(estimatePhotoshopDecodeBytes(header, sourceBytes) < 2 * 1024 * 1024 * 1024);
  assert.equal(planPhotoshopImport(header, sourceBytes).mode, "flattened");
  assert.throws(() => assertSafePhotoshopDecodeBudget(header, sourceBytes), /native project restore memory ceiling/);
});
