import { createDocument, createRasterLayer, createProAdjustmentLayer } from "../app/engine/document";
import { renderClean } from "../app/engine/renderer";

export function qualifyAdjustmentVariants() {
  const canvas = () => { const c = document.createElement("canvas"); c.width = 3; c.height = 1; return c; };
  const results = [];
  for (const alpha of [0, 64, 160, 255]) for (const variant of [
    { name: "master", opacity: .5, fill: 1, masked: false, pass: 1 },
    { name: "fill", opacity: 1, fill: .5, masked: false, pass: 1 },
    { name: "mask", opacity: 1, fill: 1, masked: true, pass: 1 },
    { name: "combined", opacity: .5, fill: .5, masked: true, pass: 1 },
    { name: "pass", opacity: 1, fill: 1, masked: true, pass: .5 },
    { name: "zero", opacity: 0, fill: 1, masked: true, pass: 1 },
  ]) {
    const bitmap = canvas(); const data = new Uint8ClampedArray(12);
    for (let x = 0; x < 3; x++) data.set([80, 120, 160, alpha], x * 4);
    bitmap.getContext("2d")!.putImageData(new ImageData(data, 3, 1), 0, 0);
    const doc = createDocument(3, 1); doc.layers = [createRasterLayer("Input", bitmap)];
    const before = canvas(); renderClean(doc, before);
    const original = before.getContext("2d")!.getImageData(0, 0, 3, 1).data;
    const layer = createProAdjustmentLayer("Invert", { kind: "invert" });
    layer.opacity = variant.opacity; layer.fillOpacity = variant.fill;
    layer.blendStack = [{ id: "pass", mode: "source-over", opacity: variant.pass, enabled: true }];
    if (variant.masked) {
      layer.mask = canvas(); const mask = new Uint8ClampedArray(12);
      [255,128,0].forEach((a, x) => mask.set([255,255,255,a], x*4));
      layer.mask.getContext("2d")!.putImageData(new ImageData(mask, 3, 1), 0, 0);
    }
    doc.layers.unshift(layer); const after = canvas(); renderClean(doc, after);
    const actual = after.getContext("2d")!.getImageData(0, 0, 3, 1).data;
    const failures = [];
    for (let x=0; x<3; x++) {
      const off=x*4, mask = variant.masked ? [255,128,0][x]/255 : 1;
      if (actual[off+3] !== original[off+3]) failures.push(`alpha ${x}: ${actual[off+3]} != ${original[off+3]}`);
      if (!alpha) continue;
      const amount=variant.opacity*variant.fill*variant.pass*mask;

      for(let c=0;c<3;c++) {
        const expected=original[off+c]*(1-amount)+(255-original[off+c])*amount;
        if(Math.abs(actual[off+c]-expected)*alpha/255>2) failures.push(`RGB ${x}/${c}: ${actual[off+c]} != ${expected}`);
      }
    }
    results.push({ alpha, variant:variant.name, input:[...original], output:[...actual], failures, pass:failures.length===0 });
  }
  return { results, passed: results.filter(r=>r.pass).length, total:results.length };
}
