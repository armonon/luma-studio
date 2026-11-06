import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url);
const transform=require('../build/browser-vendor-url-loader.cjs');
test('installed browser vendors retain their emitted WASM references and use runtime URL fallbacks',async()=>{
 const vendors=['pdfjs-dist/legacy/build/pdf.mjs','pdfjs-dist/legacy/build/pdf.worker.min.mjs','onnxruntime-web/dist/ort.webgpu.bundle.min.mjs','@huggingface/transformers/dist/transformers.web.js'];
 for(const vendor of vendors){
  const text=await readFile(new URL('../node_modules/'+vendor,import.meta.url),'utf8');
  const assetCalls=[...text.matchAll(/new URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g)].filter(m=>m[2]!=='.'&&m[2]!=='./').map(m=>m[0]);
  const browser=transform(text);
  for(const call of assetCalls)assert.ok(browser.includes(call),`${vendor} keeps ${call}`);
  assert.equal((browser.match(/import\.meta\.url/g)||[]).length,assetCalls.length,vendor);
  assert.ok(browser.includes('globalThis.location.href'),`${vendor} has runtime base`);
 }
});
