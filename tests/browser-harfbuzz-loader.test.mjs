import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require=createRequire(import.meta.url);
const transform=require('../build/browser-harfbuzz-loader.cjs');
test('browser font shaper preserves emitted WASM resolution and runs without a build-machine URL',async()=>{
 const entry=require.resolve('harfbuzzjs');
 const vendor=new URL('./harfbuzz.js',new URL('file://'+entry));
 const source=await readFile(vendor,'utf8');
 const transformed=transform(source);
 assert.equal((transformed.match(/import\.meta\.url/g)||[]).length,1);
 assert.match(transformed,/new URL\("harfbuzz.wasm",import.meta.url\)/);
 assert.equal(transformed.includes('file:///Users/'),false);
 const context=vm.createContext({window:{},location:{href:'https://luma.example/_next/static/chunks/font.js'},console,WebAssembly,TextDecoder,TextEncoder,URL});
 const executable=transformed.replace('import.meta.url','globalThis.location.href').replace(/export default createHarfBuzz;?/, 'globalThis.createHarfBuzz=createHarfBuzz;');
 new vm.Script(executable).runInContext(context);
 const shaper=await context.createHarfBuzz({wasmBinary:await readFile(new URL('./harfbuzz.wasm',vendor))});
 assert.equal(typeof shaper._hb_blob_create,'function');
});
test('unknown vendor revisions require review instead of silent partial rewriting',()=>{
 assert.throws(()=>transform('changed vendor'),/Review the HarfBuzz/);
});
