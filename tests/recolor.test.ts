import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECOLOR, recolorPixels, validateRecolor, type RecolorParams } from "../app/engine/recolor";
import { recolorDocumentMask } from "../app/engine/recolor-target";
import { Studio } from "../app/engine/studio";
import { SparseAlphaSurface } from "../app/engine/alpha-surface";
import { pixelAt, testCanvas } from "./canvas-harness";
import { createRasterLayer } from "../app/engine/document";
import { RECOLOR_MAX_PIXELS } from "../app/engine/recolor";

const params=(patch:Partial<RecolorParams>={}):RecolorParams=>({...DEFAULT_RECOLOR,tolerance:0,softness:0,preserveLightness:false,replacement:"#0000ff",...patch});
const source=new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,128,255,255,255,0]);
test("recolor matches original colors, leaves alpha/unmatched pixels and source untouched",()=>{
  const before=source.slice(),result=recolorPixels(source,params());
  assert.deepEqual([...result.mask],[255,0,0,0]);
  assert.deepEqual([...result.pixels.slice(0,4)],[0,0,255,255]);
  assert.deepEqual(result.pixels.slice(4),source.slice(4));assert.deepEqual(source,before);
});
test("multiple targets union; protected samples subtract without painting protected pixels",()=>{
  const result=recolorPixels(source,params({colors:["#ff0000","#00ff00"],protectedColors:["#00ff00"]}));
  assert.deepEqual([...result.mask],[255,0,0,0]);
  const inverted=recolorPixels(source,params({invert:true}));assert.deepEqual([...inverted.mask],[0,255,255,0]);
});
test("hue matching wraps red and does not mistake grays for red",()=>{
  const data=new Uint8ClampedArray([255,0,5,255,255,5,0,255,128,128,128,255]);
  assert.deepEqual([...recolorPixels(data,params({match:"hue",tolerance:.02})).mask],[255,255,0]);
  assert.deepEqual([...recolorPixels(data,params({match:"hue",tolerance:.02,saturationMax:.5})).mask],[0,0,0]);
});
test("soft matching has fractional falloff and selection coverage is applied once",()=>{
  const data=new Uint8ClampedArray([220,20,20,128]);
  const soft=recolorPixels(data,params({softness:.3}));assert.ok(soft.mask[0]>0&&soft.mask[0]<255);
  const exact=recolorPixels(source,params({mode:"remove"}),new Uint8Array([128,0,0,0]));
  assert.equal(exact.mask[0],128);assert.equal(exact.pixels[3],127);
});
test("remove/isolate preserve outside selection and strength zero leaves source unchanged",()=>{
  assert.deepEqual(recolorPixels(source,params({amount:0})).pixels,source);
  const removed=recolorPixels(source,params({mode:"remove"}));assert.equal(removed.pixels[3],0);assert.equal(removed.pixels[7],255);
  const isolated=recolorPixels(source,params({mode:"isolate"}),new Uint8Array([255,255,0,0]));
  assert.equal(isolated.pixels[3],255);assert.equal(isolated.pixels[7],0);assert.equal(isolated.pixels[11],128);
  const protectedResult=recolorPixels(source,params({mode:"isolate",protectedColors:["#00ff00"]}));
  assert.equal(protectedResult.pixels[7],255);assert.equal(protectedResult.pixels[11],0);
});
test("hue shifts, desaturation and preserve-lightness produce predictable pixels",()=>{
  assert.deepEqual([...recolorPixels(source,params({mode:"shift",hue:120})).pixels.slice(0,4)],[0,255,0,255]);
  assert.deepEqual([...recolorPixels(source,params({mode:"desaturate"})).pixels.slice(0,4)],[128,128,128,255]);
  const dark=new Uint8ClampedArray([128,0,0,255]);
  assert.deepEqual([...recolorPixels(dark,params({colors:["#800000"],preserveLightness:true})).pixels],[0,0,128,255]);
});
test("invalid parameters and oversized buffers fail early",()=>{
  for(const patch of [{tolerance:NaN},{colors:[]},{colors:["red"]},{saturationMin:.8,saturationMax:.2},{amount:Infinity}])assert.throws(()=>validateRecolor(params(patch)),/Invalid|minimum/);
  assert.throws(()=>recolorPixels(source,params(),new Uint8Array(1)),/bounds/);
  assert.throws(()=>recolorPixels(new Uint8ClampedArray(4_000_001*4),params()),/bounds/);
  const owned=validateRecolor(DEFAULT_RECOLOR);owned.colors.push("#ffffff");assert.equal(DEFAULT_RECOLOR.colors.length,1);
});

function fixture() {const s=new Studio(8,8,testCanvas(8,8)),layer=s.addBlankRaster("Original");s.fillLayer(layer.id,"red");return {s,layer};}
test("copy is one undo step, keeps original pixels and survives save/reopen with history",async()=>{
  const {s,layer}=fixture(),reopened=new Studio(8,8,testCanvas(8,8));const session=s.prepareRecolor(layer.id);
  try {
    const before=s.historyState().currentId,id=await s.applyRecolor(session,params(),"copy");
    assert.equal(layer.visible,false);assert.equal(pixelAt(layer.bitmap!,0,0).r,255);
    assert.equal(pixelAt(s.findLayer(id)!.bitmap!,0,0).b,255);
    s.undo();assert.equal(s.historyState().currentId,before);assert.equal(s.findLayer(id),undefined);assert.equal(s.findLayer(layer.id)!.visible,true);
    s.redo();assert.equal(s.findLayer(layer.id)!.visible,false);
    await reopened.importProject((await s.prepareProjectSave("Recolor")).blob);
    assert.equal(pixelAt(reopened.findLayer(id)!.bitmap!,0,0).b,255);
    reopened.undo();assert.equal(reopened.findLayer(id),undefined);reopened.redo();assert.ok(reopened.findLayer(id));
  }finally{session.release();s.dispose();reopened.dispose();}
});
for(const output of ["pixels","mask-keep","mask-remove","selection"] as const)test(`${output}: applies once and undo/redo restores output`,async()=>{
  const {s,layer}=fixture();s.selectRect(0,0,4,8);const session=s.prepareRecolor(layer.id),before=s.historyState().currentId;
  try {
    await s.applyRecolor(session,params(),output);
    if(output==="pixels"){assert.equal(pixelAt(layer.bitmap!,1,1).b,255);assert.equal(pixelAt(layer.bitmap!,6,1).r,255);}
    if(output.startsWith("mask")){assert.equal(layer.maskSurface!.sample(1,1),output==="mask-keep"?255:0);assert.equal(layer.maskSurface!.sample(6,1),output==="mask-keep"?0:255);}
    if(output==="selection")assert.equal(s.doc.selection!.surface!.sample(1,1),255);
    s.undo();assert.equal(s.historyState().currentId,before);assert.equal(s.findLayer(layer.id)!.maskSurface,undefined);assert.equal(pixelAt(s.findLayer(layer.id)!.bitmap!,1,1).r,255);
    s.redo();assert.notEqual(s.historyState().currentId,before);
  }finally{session.release();s.dispose();}
});
test("mask output intersects existing alpha and does not square source transparency",async()=>{
  const {s,layer}=fixture();layer.maskSurface=new SparseAlphaSurface(8,8,{defaultAlpha:128});
  const session=s.prepareRecolor(layer.id);try{await s.applyRecolor(session,params(),"mask-keep");assert.equal(layer.maskSurface!.sample(0,0),128);s.undo();assert.equal(s.findLayer(layer.id)!.maskSurface!.sample(0,0),128);}finally{session.release();s.dispose();}
});
test("transformed color selection stays sparse on extreme documents; huge transformed footprint refuses",()=>{
  const {s,layer}=fixture();try{
    s.doc.width=100_000;s.doc.height=100_000;layer.transform.tx=50000;layer.transform.ty=50000;
    const surface=recolorDocumentMask(s.doc,layer,new Uint8Array(64).fill(255));
    assert.equal(surface.sample(50001,50001),255);assert.equal(surface.sample(0,0),0);assert.ok(surface.stats().residentBytes<1_000_000);
    layer.transform.sx=1000;layer.transform.sy=1000;
    assert.throws(()=>recolorDocumentMask(s.doc,layer,new Uint8Array(64)),/working-area/);
  }finally{s.dispose();}
});
test("stale preview and concurrent edits cannot recolor another revision or document",async()=>{
  const {s,layer}=fixture();let session=s.prepareRecolor(layer.id);
  try{
    s.fillLayer(layer.id,"green");await assert.rejects(s.applyRecolor(session,params(),"copy"),/changed/);session.release();
    s.fillLayer(layer.id,"red");session=s.prepareRecolor(layer.id);
    const pending=s.applyRecolor(session,params(),"copy");s.resetDocument(4,4,"Other");
    await assert.rejects(pending,/changed/);assert.equal(s.doc.width,4);assert.equal(s.doc.layers.some(l=>l.name.includes("Recolor")),false);
  }finally{session.release();s.dispose();}
});
test("viewport-only redraws do not invalidate a recolor preview",async()=>{
  const {s,layer}=fixture(),session=s.prepareRecolor(layer.id);
  try{s.requestRender();await s.applyRecolor(session,params(),"pixels");assert.equal(pixelAt(layer.bitmap!,0,0).b,255);}
  finally{session.release();s.dispose();}
});
for(const output of ["copy","pixels","mask-remove","selection"] as const)test(`${output}: injected commit failure preserves original owners and history`,async()=>{
  const {s,layer}=fixture(),session=s.prepareRecolor(layer.id),node=s.historyState().currentId,bitmap=layer.bitmap;
  const internal=s as unknown as {commit:()=>void},commit=internal.commit;internal.commit=()=>{throw new Error("Injected commit failure");};
  try{await assert.rejects(s.applyRecolor(session,params(),output),/Injected/);assert.equal(s.historyState().currentId,node);assert.equal(s.findLayer(layer.id)!.bitmap,bitmap);assert.equal(s.findLayer(layer.id)!.visible,true);assert.equal(s.doc.layers.some(l=>l.name.includes("Recolor")),false);assert.equal(s.doc.selection,null);}
  finally{internal.commit=commit;session.release();s.dispose();}
});
test("locked, high-depth, proxy and oversized raster sources refuse without history changes",()=>{
  const {s,layer}=fixture();try{const before=s.historyState().currentId;
    layer.locked=true;assert.throws(()=>s.prepareRecolor(layer.id),/Unlock/);layer.locked=false;
    s.doc.bitDepth=16;assert.throws(()=>s.prepareRecolor(layer.id),/8-bit/);s.doc.bitDepth=8;
    layer.bitmap=testCanvas(1,1);assert.throws(()=>s.prepareRecolor(layer.id),/proxy|proxies/);
    assert.equal(s.historyState().currentId,before);
  }finally{s.dispose();}
});

for(const output of ["copy","pixels","selection","mask-remove"] as const)test(`${output}: cancellation after staged tiles leaves document, owners and history untouched`,async()=>{
  const {s,layer}=fixture(),session=s.prepareRecolor(layer.id),node=s.historyState().currentId,bitmap=layer.bitmap,surface=layer.surface;
  const abort=new AbortController();
  try {
    await assert.rejects(s.applyRecolor(session,params(),output,"replace",{signal:abort.signal,onProgress:()=>abort.abort()}),/cancelled/);
    assert.equal(layer.bitmap,bitmap);assert.equal(layer.surface,surface);assert.equal(pixelAt(bitmap!,0,0).r,255);
    assert.equal(layer.visible,true);assert.equal(layer.maskSurface,undefined);assert.equal(s.doc.selection,null);assert.equal(s.historyState().currentId,node);
    // Reservation cleanup must allow a retry with the same valid session.
    await s.applyRecolor(session,params(),output);
  }finally{session.release();s.dispose();}
});

test("50 MP bitmap: tile-only reads, small changed-tile history, apply/undo/redo and save/reopen",async()=>{
  assert.equal(RECOLOR_MAX_PIXELS,50_000_000);
  const s=new Studio(10000,5000,testCanvas(1,1)), reopened=new Studio(1,1,testCanvas(1,1));
  const bitmap=testCanvas(10000,5000),ctx=bitmap.getContext("2d")!;
  ctx.fillStyle="red";ctx.fillRect(8,8,16,16);
  const layer=createRasterLayer("50 MP",bitmap);s.doc.layers=[layer];
  const session=s.prepareRecolor(layer.id),before=s.historyState().currentId;
  const read=ctx.getImageData.bind(ctx);let maximumRead=0;
  ctx.getImageData=((x:number,y:number,w:number,h:number)=>{maximumRead=Math.max(maximumRead,w*h);return read(x,y,w,h);}) as typeof ctx.getImageData;
  try {
    let fraction=0;
    await s.applyRecolor(session,params(),"pixels","replace",{onProgress:value=>{assert.ok(value>=fraction);fraction=value;}});
    assert.equal(fraction,1);assert.ok(maximumRead<=256*256);assert.equal(pixelAt(bitmap,10,10).b,255);
    assert.ok(s.historyState().bytes<1024*1024,"history must contain the changed tile, not a 50 MP snapshot");
    s.undo();assert.equal(s.historyState().currentId,before);assert.equal(pixelAt(bitmap,10,10).r,255);s.redo();assert.equal(pixelAt(bitmap,10,10).b,255);
    const blob=(await s.prepareProjectSave("50 MP recolor")).blob;
    await reopened.importProject(blob);assert.equal(reopened.doc.width*reopened.doc.height,50_000_000);
    assert.equal(pixelAt(reopened.findLayer(layer.id)!.bitmap!,10,10).b,255);
    reopened.undo();assert.equal(pixelAt(reopened.findLayer(layer.id)!.bitmap!,10,10).r,255);
    assert.ok(maximumRead<=256*256,"undo and serialization must not read the full bitmap either");
  }finally{session.release();s.dispose();reopened.dispose();bitmap.width=1;bitmap.height=1;}
});

test("50 MP selection and mask stay sparse and mask history does not retain full bitmaps",async()=>{
  const s=new Studio(10000,5000,testCanvas(1,1)),bitmap=testCanvas(10000,5000),ctx=bitmap.getContext("2d")!;
  ctx.fillStyle="red";ctx.fillRect(8,8,16,16);
  const layer=createRasterLayer("50 MP alpha",bitmap);s.doc.layers=[layer];
  let session=s.prepareRecolor(layer.id);
  try {
    await s.applyRecolor(session,params(),"selection");session.release();
    assert.equal(s.doc.selection!.surface!.sample(10,10),255);assert.equal(s.doc.selection!.surface!.sample(9999,4999),0);
    assert.ok(s.doc.selection!.surface!.stats().residentBytes<1024*1024);
    session=s.prepareRecolor(layer.id);await s.applyRecolor(session,params(),"mask-remove");session.release();
    assert.equal(layer.maskSurface!.sample(10,10),0);assert.equal(layer.maskSurface!.sample(9999,4999),255);
    assert.ok(s.historyState().bytes<1024*1024);
    s.undo();assert.equal(layer.maskSurface,undefined);s.redo();assert.equal(layer.maskSurface!.sample(10,10),0);
    const saved=await s.prepareProjectSave("50 MP mask");assert.ok(saved.blob.size>0);
  }finally{session.release();s.dispose();bitmap.width=1;bitmap.height=1;}
});

test("changed-tile admission failure leaves original pixels untouched and releases reservations",async()=>{
  const {s,layer}=fixture(),session=s.prepareRecolor(layer.id),node=s.historyState().currentId;
  const internal=s as unknown as {reserveOperationMemory:(bytes:number)=>()=>void},original=internal.reserveOperationMemory.bind(s);let calls=0;
  internal.reserveOperationMemory=bytes=>{if(++calls===2)throw new Error("Injected memory ceiling");return original(bytes);};
  try{await assert.rejects(s.applyRecolor(session,params(),"pixels"),/ceiling/);assert.equal(pixelAt(layer.bitmap!,0,0).r,255);assert.equal(s.historyState().currentId,node);
    internal.reserveOperationMemory=original;await s.applyRecolor(session,params(),"pixels");
  }finally{internal.reserveOperationMemory=original;session.release();s.dispose();}
});

test("over 50 MP is refused before any source read",()=>{
  const {s,layer}=fixture();try{
    layer.surface=undefined;layer.bitmap={width:10000,height:5001} as HTMLCanvasElement;
    assert.throws(()=>s.prepareRecolor(layer.id),/50 MP/);
  }finally{s.dispose();}
});

test("large edit refuses before publication if save-with-history admission would fail",async()=>{
  const s=new Studio(2050,2000,testCanvas(1,1)),bitmap=testCanvas(2050,2000),ctx=bitmap.getContext("2d")!;
  ctx.fillStyle="red";ctx.fillRect(8,8,16,16);const layer=createRasterLayer("Save admission",bitmap);s.doc.layers=[layer];
  const session=s.prepareRecolor(layer.id),node=s.historyState().currentId;
  const internal=s as unknown as {serializationMemory:()=>number},original=internal.serializationMemory;
  internal.serializationMemory=()=>2*1024*1024*1024;
  try{await assert.rejects(s.applyRecolor(session,params(),"pixels"),/save this project/);assert.equal(pixelAt(bitmap,10,10).r,255);assert.equal(s.historyState().currentId,node);}
  finally{internal.serializationMemory=original;session.release();s.dispose();bitmap.width=1;bitmap.height=1;}
});
