import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { testCanvas, pixelAt, solidCanvas } from "./canvas-harness";
import { Studio } from "../app/engine/studio";
import { SparseAlphaSurface } from "../app/engine/alpha-surface";
import { DEFAULT_TEXT_SPATIAL } from "../app/engine/text-3d";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project";
import { emptyCampaign, validateCampaign, layerBox } from "../app/engine/campaign";
import { validateDesignSnapshots } from "../app/engine/design-snapshots";
import { cloneDocument, historyEntrySize } from "../app/engine/history-payload";
import { getPhotoshopDocumentMetadata, getPhotoshopLayerMetadata, setPhotoshopDocumentMetadata, setPhotoshopLayerMetadata } from "../app/engine/psd-metadata";

test("full variants restore pixels, masks, geometry, editable 3D, deleted layers and lighting after save/reopen with undo",async()=>{
  const s=new Studio(32,32,testCanvas(32,32)),reopened=new Studio(2,2,testCanvas(2,2));
  try{
    const raster=s.addBlankRaster("Pixels");raster.bitmap=solidCanvas(32,32,"#ff0000");raster.surface=undefined;
    raster.maskSurface=new SparseAlphaSurface(32,32,{defaultAlpha:128});
    const text=s.addTextLayer("Original",{font:"12px sans-serif",spatial:structuredClone(DEFAULT_TEXT_SPATIAL)});
    const shape=s.addShapeLayer({x:3,y:4,w:12,h:14,fill:"#abcdef"});
    s.doc.globalLight={angle:240,altitude:12};s.selectRect(1,2,10,11);
    await s.executeDesignSnapshot({kind:"capture",name:"Original"});const id=s.doc.designSnapshots![0].id;
    const archive=await decodeLumaProject(s.doc.designSnapshots![0].bytes);
    assert.equal(archive.doc.designSnapshots,undefined);assert.equal(archive.history,undefined);
    assert.deepEqual(pixelAt(archive.doc.layers.find(l=>l.id===raster.id)!.bitmap!,0,0),{r:255,g:0,b:0,a:255});
    s.doc.layers=s.doc.layers.filter(l=>l.id!==text.id);s.findLayer(raster.id)!.bitmap=solidCanvas(32,32,"#0000ff");
    s.findLayer(shape.id)!.shape!.w=25;s.doc.globalLight={angle:50,altitude:60};
    await s.executeDesignSnapshot({kind:"capture",name:"Changed"});
    await reopened.importProject((await s.prepareProjectSave("Variants")).blob);
    assert.equal(reopened.doc.designSnapshots!.length,2);
    await reopened.executeDesignSnapshot({kind:"apply",id});
    assert.deepEqual(pixelAt(reopened.findLayer(raster.id)!.bitmap!,0,0),{r:255,g:0,b:0,a:255});
    assert.equal(reopened.findLayer(shape.id)!.shape!.w,12);
    assert.equal(reopened.findLayer(text.id)!.text!.text,"Original");
    assert.deepEqual(reopened.findLayer(text.id)!.text!.spatial,DEFAULT_TEXT_SPATIAL);
    assert.equal(reopened.findLayer(raster.id)!.maskSurface!.defaultAlpha,128);
    assert.deepEqual(reopened.doc.selection!.bounds,{x:1,y:2,w:10,h:11});
    assert.deepEqual(reopened.doc.globalLight,{angle:240,altitude:12});
    assert.equal(reopened.doc.designSnapshots!.length,2);
    reopened.undo();assert.equal(reopened.findLayer(text.id),undefined);assert.equal(reopened.findLayer(shape.id)!.shape!.w,25);
    reopened.redo();assert.equal(reopened.findLayer(shape.id)!.shape!.w,12);
    await reopened.executeDesignSnapshot({kind:"delete",id});assert.equal(reopened.doc.designSnapshots!.length,1);
    reopened.undo();assert.equal(reopened.doc.designSnapshots!.length,2);
    const reopenedAgain=await decodeLumaProject((await reopened.prepareProjectSave("Restored")).blob);
    assert.equal(reopenedAgain.doc.designSnapshots!.length,2);assert.equal(reopenedAgain.doc.globalLight!.angle,240);
  }finally{s.dispose();reopened.dispose();}
});

test("full variant capture rejects cancellation, document switches, live edits, resource limits and commit failure without publication",async()=>{
 const s=new Studio(32,32,testCanvas(32,32));try{
   const first=s.activeDocumentState().id,text=s.addTextLayer("Test");const controller=new AbortController();controller.abort();
   await assert.rejects(s.executeDesignSnapshot({kind:"capture",name:"Cancelled"},controller.signal),/cancelled/);assert.equal(s.doc.designSnapshots,undefined);
   const pending=s.executeDesignSnapshot({kind:"capture",name:"Stale"});s.resetDocument(8,8,"Other");await assert.rejects(pending,/changed/);assert.equal(s.doc.designSnapshots,undefined);
   s.switchDocument(first);
   s.liveUpdateTransform(text.id,{tx:4});await assert.rejects(s.executeDesignSnapshot({kind:"capture",name:"Live"}),/gesture/);s.updateTransform(text.id,{});
   const original=s.doc,node=s.historyState().currentId;
   const internal=s as unknown as {commit:(entry:unknown)=>void};const commit=internal.commit;
   internal.commit=()=>{throw new Error("Injected commit failure");};
   try{await assert.rejects(s.executeDesignSnapshot({kind:"capture",name:"Failed"}),/commit failure/);}finally{internal.commit=commit;}
   assert.equal(s.doc,original);assert.equal(s.historyState().currentId,node);assert.equal(s.doc.designSnapshots,undefined);
   for(let i=0;i<6;i++)await s.executeDesignSnapshot({kind:"capture",name:`V${i}`});
   await assert.rejects(s.executeDesignSnapshot({kind:"capture",name:"Seventh"}),/six/);
   assert.equal(s.doc.designSnapshots!.length,6);
   assert.ok(s.engineState().residentMemoryBudget.residentBytes<10*1024*1024,"inactive archives must not each retain a decoder workspace");
 }finally{s.dispose();}
});

test("variant archives are bounded, counted in history, deduplicated on disk, and malformed assets fail safely",async()=>{
 const s=new Studio(8,8,testCanvas(8,8));try{
   s.addShapeLayer({w:4,h:4});await s.executeDesignSnapshot({kind:"capture",name:"One"});
   const snapshots=s.doc.designSnapshots!;
   assert.ok(historyEntrySize({label:"Capture",before:[],after:[],designSnapshotsBefore:snapshots,designSnapshotsAfter:snapshots})>=snapshots[0].bytes.byteLength);
   assert.throws(()=>validateDesignSnapshots([...snapshots,...snapshots]),/Invalid/);
   const blob=await s.exportProject("Variants"),zip=await JSZip.loadAsync(await blob.arrayBuffer());
   assert.equal(Object.keys(zip.files).filter(p=>p.endsWith(".luma")).length,1);
   const manifest=JSON.parse(await zip.file("manifest.json")!.async("string"));manifest.document.designSnapshots[0].asset="assets/design-variants/missing.luma";
   zip.file("manifest.json",JSON.stringify(manifest));await assert.rejects(decodeLumaProject(await zip.generateAsync({type:"uint8array"})),/asset|missing/i);
   const owner=s.doc,node=s.historyState().currentId;
   s.doc.designSnapshots=[{id:"bad",name:"Bad",bytes:new Uint8Array([1,2,3,4])}];
   await assert.rejects(s.executeDesignSnapshot({kind:"apply",id:"bad"}));assert.equal(s.doc,owner);assert.equal(s.historyState().currentId,node);
   await assert.rejects(encodeLumaProject(s.doc,[],"Too small",undefined,{maximumArchiveBytes:32}),/archive limit/);
 }finally{s.dispose();}
});

test("saved wrapping layouts persist, reflow after geometry edits, resize atomically, and undo",async()=>{
 const s=new Studio(400,400,testCanvas(400,400));try{
   const shapes=[0,1,2].map(()=>s.addShapeLayer({x:0,y:0,w:140,h:40}));const board=s.createArtboard("Layout");
   s.executeCampaign({kind:"flow",boardId:board.id,layerIds:shapes.map(s=>s.id),direction:"row",padding:10,gap:10,wrap:true,align:"center"});
   assert.equal(layerBox(s.findLayer(shapes[2].id)!).y,60);
   const restored=await decodeLumaProject((await s.prepareProjectSave()).blob);assert.deepEqual(restored.doc.campaign!.layouts,s.doc.campaign!.layouts);
   s.findLayer(shapes[0].id)!.shape!.w=250;s.executeCampaign({kind:"reflow"});assert.equal(layerBox(s.findLayer(shapes[1].id)!).y,60);
   s.executeCampaign({kind:"board-resize",boardId:board.id,width:300,height:300});assert.equal(s.doc.artboards![0].width,300);s.undo();assert.equal(s.doc.artboards![0].width,400);
   const before=s.doc,node=s.historyState().currentId;
   assert.throws(()=>s.executeCampaign({kind:"board-resize",boardId:board.id,width:12,height:12}),/fit|inset/);assert.equal(s.doc,before);assert.equal(s.historyState().currentId,node);
   s.findLayer(shapes[0].id)!.locked=true;assert.throws(()=>s.executeCampaign({kind:"board-resize",boardId:board.id,width:350,height:350}),/Unlock/);
   s.executeCampaign({kind:"layout-remove",boardId:board.id});assert.equal(s.doc.campaign!.layouts!.length,0);s.undo();assert.equal(s.doc.campaign!.layouts!.length,1);
   const invalid={...emptyCampaign(),layouts:[{boardId:"b",layerIds:["x","x"],direction:"row" as const,padding:2,gap:2}]};assert.throws(()=>validateCampaign(invalid),/layout/);
 }finally{s.dispose();}
});

test("explicit linked replacement copies pixels, geometry and appearance; undo and reopen preserve both directions",async()=>{
 const s=new Studio(32,32,testCanvas(32,32)),r=new Studio(2,2,testCanvas(2,2));try{
  const pixel=s.addBlankRaster("Pixel");pixel.bitmap=solidCanvas(32,32,"#ff0000");pixel.surface=undefined;
  const shape=s.addShapeLayer({x:1,y:1,w:10,h:10,fill:"#ff0000"});
  s.executeCampaign({kind:"format",formats:["square"],layerIds:[pixel.id,shape.id]});
  const links=s.doc.campaign!.links.filter(l=>l.sourceId),copyPixel=links.find(l=>l.sourceId===pixel.id)!.layerId,copyShape=links.find(l=>l.sourceId===shape.id)!.layerId;
  s.findLayer(pixel.id)!.bitmap=solidCanvas(32,32,"#0000ff");s.findLayer(shape.id)!.shape!.fill="#00ff00";s.findLayer(shape.id)!.shape!.w=20;
  s.executeCampaign({kind:"sync"});assert.equal(s.findLayer(copyShape)!.shape!.fill,"#ff0000");
  s.executeCampaign({kind:"sync",replaceContent:true});assert.deepEqual(pixelAt(s.findLayer(copyPixel)!.bitmap!,0,0),{r:0,g:0,b:255,a:255});assert.equal(s.findLayer(copyShape)!.shape!.w,20);
  s.undo();assert.deepEqual(pixelAt(s.findLayer(copyPixel)!.bitmap!,0,0),{r:255,g:0,b:0,a:255});assert.equal(s.findLayer(copyShape)!.shape!.w,10);s.redo();
  await r.importProject((await s.prepareProjectSave()).blob);r.undo();assert.equal(r.findLayer(copyShape)!.shape!.w,10);r.redo();assert.equal(r.findLayer(copyShape)!.shape!.w,20);
  const node=s.historyState().currentId;s.findLayer(copyPixel)!.maskSurface=new SparseAlphaSurface(s.doc.width,s.doc.height,{defaultAlpha:255});
  s.executeCampaign({kind:"sync",replaceContent:true});assert.equal(s.findLayer(copyPixel)!.maskSurface,undefined);assert.notEqual(s.historyState().currentId,node);
  s.undo();assert.equal(s.findLayer(copyPixel)!.maskSurface!.defaultAlpha,255);
 }finally{s.dispose();r.dispose();}
});

test("document clones preserve Photoshop descriptor metadata and independently own lighting",()=>{
 const s=new Studio(8,8,testCanvas(8,8));try{
   const layer=s.addBlankRaster();const metadata={header:{container:"psd" as const,version:1 as const,channels:3,width:8,height:8,bitsPerChannel:8,colorMode:3},rawImageResources:[],importedIssues:[]};
   layer.vectorMask={anchors:[{x:1,y:1,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}}],closed:false,fill:"#ffffff",stroke:"none",strokeWidth:0};
   setPhotoshopDocumentMetadata(s.doc,metadata);setPhotoshopLayerMetadata(layer,{source:{name:"Retained"},preservation:"descriptor-preserved"});s.doc.globalLight={angle:120,altitude:30};
   const copy=cloneDocument(s.doc);assert.equal(getPhotoshopDocumentMetadata(copy),metadata);assert.equal(getPhotoshopLayerMetadata(copy.layers[0])?.source.name,"Retained");copy.globalLight!.angle=80;assert.equal(s.doc.globalLight.angle,120);
   copy.layers[0].vectorMask!.anchors[0].x=7;assert.equal(layer.vectorMask.anchors[0].x,1);
 }finally{s.dispose();}
});

test("linked replacement admits the sum of enlarged master copies before cloning any pixels",()=>{
 const s=new Studio(32,32,testCanvas(32,32));try{
   const source=s.addBlankRaster();s.executeCampaign({kind:"format",formats:["square","story"],layerIds:[source.id]});
   const layer=s.findLayer(source.id)!;layer.surface=undefined;
   // An allocation sentinel: any attempted getContext/clone would fail this test.
   layer.bitmap={width:5000,height:5000} as HTMLCanvasElement;
   const doc=s.doc,node=s.historyState().currentId;
   assert.throws(()=>s.executeCampaign({kind:"sync",replaceContent:true}),/128 MiB/);
   assert.equal(s.doc,doc);assert.equal(s.historyState().currentId,node);
 }finally{s.dispose();}
});

test("50K sparse variants retain sparse selection and masks without document-sized canvases",async()=>{
 const edition=process.env.NEXT_PUBLIC_LUMA_EDITION;
 const s=new Studio(50000,50000,testCanvas(8,8));try{
   const layer=s.addBlankRaster("Sparse");assert.equal(layer.bitmap,undefined);
   layer.maskSurface=new SparseAlphaSurface(50000,50000,{defaultAlpha:255});
   s.selectRect(49000,49000,32,32);
   await s.executeDesignSnapshot({kind:"capture",name:"Sparse 50K"});
   const snapshot=s.doc.designSnapshots![0];assert.ok(snapshot.bytes.byteLength<1024*1024);
   process.env.NEXT_PUBLIC_LUMA_EDITION="web";await assert.rejects(s.executeDesignSnapshot({kind:"apply",id:snapshot.id}),/edition/);
   process.env.NEXT_PUBLIC_LUMA_EDITION="pro";
   await s.executeDesignSnapshot({kind:"apply",id:snapshot.id});
   assert.equal(s.doc.width,50000);assert.equal(s.findLayer(layer.id)!.bitmap,undefined);
   assert.deepEqual(s.doc.selection!.bounds,{x:49000,y:49000,w:32,h:32});
   assert.ok(s.doc.selection!.surface!.stats().residentBytes<1024*1024);
   assert.equal(s.findLayer(layer.id)!.maskSurface!.defaultAlpha,255);
   s.undo();s.redo();assert.equal(s.doc.width,50000);
 }finally{s.dispose();if(edition===undefined)delete process.env.NEXT_PUBLIC_LUMA_EDITION;else process.env.NEXT_PUBLIC_LUMA_EDITION=edition;}
});
