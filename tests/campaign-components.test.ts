import test from "node:test";
import assert from "node:assert/strict";
import { GlobalFonts } from "@napi-rs/canvas";
import { testCanvas, solidCanvas, pixelAt } from "./canvas-harness";
import { Studio } from "../app/engine/studio";
import { SparseAlphaSurface } from "../app/engine/alpha-surface";
import { createDocument, createGroupLayer, createShapeLayer, createTextLayer, drawLayerContent, type TextStyle } from "../app/engine/document";
import { layerBox, remapCampaign, validateCampaign } from "../app/engine/campaign";
import { bundledFontFace } from "../app/engine/bundled-fonts";
import { decodeLumaProject } from "../app/engine/project";
import { renderClean, renderViewport } from "../app/engine/renderer";
import { mapComponentMasks } from "../app/engine/campaign-components";

for(const family of ["Noto Sans Arabic","Noto Sans Hebrew","Lato"])GlobalFonts.registerFromPath(new URL(`../public/fonts/${bundledFontFace(family).file}`,import.meta.url).pathname,family);

test("nested masked/clipped components synchronize membership, ordering, editable content and identity with undo/reopen",async()=>{
 const s=new Studio(1080,1080,testCanvas(32,32)),r=new Studio(2,2,testCanvas(2,2));try{
  const base=s.addShapeLayer({x:20,y:20,w:80,h:80,fill:"#ff0000",strokeWidth:0});
  const clip=s.addShapeLayer({x:30,y:30,w:90,h:90,fill:"#0000ff",strokeWidth:0});clip.clipping=true;
  const inner=s.groupLayers([base.id,clip.id]);
  const label=s.addTextLayer("Master",{font:'20px "Lato"',x:20,y:140});
  const root=s.groupLayers([inner.id,label.id]);
  root.maskSurface=new SparseAlphaSurface(1080,1080,{defaultAlpha:255});root.maskSurface.fillRect({x:0,y:0,width:60,height:1080},0);
  base.vectorMask={anchors:[{x:20,y:20,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}},{x:100,y:20,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}},{x:100,y:100,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}}],closed:true,fill:"#fff",stroke:"none",strokeWidth:0};
  s.executeCampaign({kind:"format",layerIds:[root.id,base.id],formats:["square"]});
  const links=s.doc.campaign!.links.filter(l=>l.sourceId),target=links.find(l=>l.sourceId===root.id)!.layerId;
  const copy=(source:string)=>s.doc.campaign!.links.find(l=>l.sourceId===source)!.layerId;
  const baseCopy=copy(base.id),innerCopy=copy(inner.id),clipCopy=copy(clip.id),labelCopy=copy(label.id);
  assert.equal(s.doc.layers.length,10);assert.equal(s.findLayer(baseCopy)!.parentId,innerCopy);assert.equal(s.findLayer(innerCopy)!.parentId,target);assert.equal(s.findLayer(clipCopy)!.clipping,true);
  assert.equal(s.findLayer(root.id)!.maskSurface!.width,s.doc.width);
  assert.equal(s.findLayer(target)!.maskSurface!.sample(1144+30,40),0);assert.equal(s.findLayer(target)!.maskSurface!.sample(1144+80,40),255);
  assert.equal(s.findLayer(baseCopy)!.vectorMask!.anchors[0].x,1164);
  const canvas=testCanvas(s.doc.width,s.doc.height);renderClean(s.doc,canvas);
  const pixels=canvas.getContext("2d")!;
  assert.deepEqual(pixels.getImageData(0,0,1080,1080).data,pixels.getImageData(1144,0,1080,1080).data,"masked group composites identically at unit scale");
  s.findLayer(label.id)!.text!.text="Changed";s.findLayer(base.id)!.shape!.fill="#00ff00";
  s.doc.layers=s.doc.layers.filter(l=>l.id!==clip.id);
  const added=s.addShapeLayer({x:40,y:150,w:30,h:40});added.parentId=inner.id;
  const node=s.historyState().currentId;
  assert.throws(()=>s.executeCampaign({kind:"sync"}),/membership/);assert.equal(s.historyState().currentId,node);
  s.executeCampaign({kind:"sync",replaceContent:true});const addedCopy=copy(added.id);
  assert.equal(s.findLayer(clipCopy),undefined);assert.equal(s.findLayer(addedCopy)!.parentId,innerCopy);assert.equal(s.findLayer(labelCopy)!.text!.text,"Changed");assert.equal(s.findLayer(baseCopy)!.shape!.fill,"#00ff00");
  assert.equal(copy(root.id),target);assert.equal(copy(base.id),baseCopy);assert.notEqual(s.findLayer(target)!.maskSurface,s.findLayer(root.id)!.maskSurface);
  const sourceOrder=s.doc.layers.filter(l=>[root.id,inner.id,label.id,base.id,added.id].includes(l.id)).map(l=>l.id);
  const targetOrder=s.doc.layers.filter(l=>s.doc.campaign!.links.some(link=>link.componentId===target&&link.layerId===l.id)).map(l=>s.doc.campaign!.links.find(link=>link.layerId===l.id)!.sourceId);
  assert.deepEqual(targetOrder,sourceOrder);
  await r.importProject((await s.prepareProjectSave()).blob);
  r.undo();assert.ok(r.findLayer(clipCopy));assert.equal(r.findLayer(addedCopy),undefined);r.redo();assert.equal(r.findLayer(clipCopy),undefined);assert.ok(r.findLayer(addedCopy));
  const ids=new Map(s.doc.layers.map(l=>[l.id,`new-${l.id}`]));const kit=remapCampaign(s.doc.campaign,ids)!;assert.equal(kit.links.find(l=>l.sourceId===ids.get(base.id))!.componentId,ids.get(target));validateCampaign(kit);
 }finally{s.dispose();r.dispose();}
});

test("component failures preserve work, lock descendants, restore deleted copies and detach whole ownership",()=>{
 const s=new Studio(1080,1080,testCanvas(16,16));try{
  const shape=s.addShapeLayer({w:40,h:40}),root=s.groupLayers([shape.id]);
  s.executeCampaign({kind:"format",layerIds:[root.id],formats:["square"]});
  const target=s.doc.campaign!.links.find(l=>l.sourceId===root.id)!.layerId,child=s.doc.campaign!.links.find(l=>l.sourceId===shape.id)!.layerId;
  s.findLayer(child)!.locked=true;const owner=s.doc,node=s.historyState().currentId;
  assert.throws(()=>s.executeCampaign({kind:"sync",replaceContent:true}),/Unlock/);assert.equal(s.doc,owner);assert.equal(s.historyState().currentId,node);
  s.findLayer(child)!.locked=false;
  const internal=s as unknown as {commit:(entry:unknown)=>void},commit=internal.commit;
  internal.commit=()=>{throw new Error("Injected component failure");};
  try{assert.throws(()=>s.executeCampaign({kind:"sync",replaceContent:true}),/Injected/);assert.equal(s.doc,owner);assert.equal(s.historyState().currentId,node);}finally{internal.commit=commit;}
  s.doc.layers=s.doc.layers.filter(l=>l.id!==child);s.executeCampaign({kind:"sync",replaceContent:true});
  const restored=s.doc.campaign!.links.find(l=>l.sourceId===shape.id)!.layerId;assert.equal(s.findLayer(restored)!.parentId,target);
  s.executeCampaign({kind:"unlink",layerIds:[restored]});assert.ok(!s.doc.campaign!.links.some(l=>l.componentId===target));s.undo();assert.ok(s.doc.campaign!.links.some(l=>l.componentId===target));
 }finally{s.dispose();}
});

test("legacy and sparse masks stay aligned across format, saved flow, resize, undo and reopen",async()=>{
 const s=new Studio(1080,1080,testCanvas(16,16));try{
  const shape=s.addShapeLayer({x:20,y:30,w:80,h:70});shape.mask=solidCanvas(1080,1080,"#ffffff");shape.mask.getContext("2d")!.clearRect(20,30,40,70);
  s.executeCampaign({kind:"format",layerIds:[shape.id],formats:["square"]});
  const link=s.doc.campaign!.links.find(l=>l.sourceId===shape.id)!,copy=s.findLayer(link.layerId)!;
  assert.equal(copy.mask,undefined);assert.equal(copy.maskSurface!.sample(1165,40),0);assert.equal(copy.maskSurface!.sample(1205,40),255);
  s.executeCampaign({kind:"flow",layerIds:[copy.id],boardId:link.boardId!,direction:"column",padding:10,gap:0});
  const box=layerBox(s.findLayer(copy.id)!);assert.equal(s.findLayer(copy.id)!.maskSurface!.sample(box.x+10,box.y+10),0);assert.equal(s.findLayer(copy.id)!.maskSurface!.sample(box.x+60,box.y+10),255);
  s.undo();assert.equal(s.findLayer(copy.id)!.maskSurface!.sample(1205,40),255);s.redo();
  const decoded=await decodeLumaProject((await s.prepareProjectSave()).blob);assert.equal(decoded.doc.layers.find(l=>l.id===copy.id)!.maskSurface!.sample(box.x+10,box.y+10),0);
 }finally{s.dispose();}
});

test("extreme sparse masks remap in bounded tiles and reject enlargement before allocating",()=>{
 const mask=new SparseAlphaSurface(300000,300000,{defaultAlpha:255});
 mask.fillRect({x:50,y:60,width:5,height:5},0);
 const moved=mask.remapped(300000,300000,1,50000,25000,1024*1024);
 assert.equal(moved.sample(50052,25062),0);assert.equal(moved.sample(299999,299999),255);assert.ok(moved.stats().residentBytes<1024*1024);
 assert.throws(()=>mask.remapped(300000,300000,1000,0,0,1024),/budget/);assert.equal(mask.sample(52,62),0);
 const uniform=new SparseAlphaSurface(50000,50000,{defaultAlpha:128}).remapped(300000,300000,6,0,0,0);assert.equal(uniform.stats().residentBytes,0);assert.equal(uniform.sample(299999,299999),128);
});

test("vector-masked groups render in a bounded viewport on a 50K document",()=>{
 const doc=createDocument(50000,50000),group=createGroupLayer("Masked component");
 const shape=createShapeLayer("Red",{kind:"rect",x:20000,y:20000,w:100,h:100,fill:"#ff0000",stroke:"none",strokeWidth:0,radius:0});shape.parentId=group.id;
 group.vectorMask={anchors:[[20000,20000],[20050,20000],[20050,20100],[20000,20100]].map(([x,y])=>({x,y,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}})),closed:true,fill:"#fff",stroke:"none",strokeWidth:0};
 doc.layers=[group,shape];const canvas=testCanvas(100,100);
 renderViewport(doc,canvas,{x:20000,y:20000,width:100,height:100,zoom:1,outputWidth:100,outputHeight:100,cssScale:1,devicePixelRatio:1},{checkerboard:false});
 assert.equal(pixelAt(canvas,25,25).r,255);assert.equal(pixelAt(canvas,75,25).a,0);
 group.vectorMaskHidesEffects=true;
 renderViewport(doc,canvas,{x:20000,y:20000,width:100,height:100,zoom:1,outputWidth:100,outputHeight:100,cssScale:1,devicePixelRatio:1},{checkerboard:false});assert.equal(pixelAt(canvas,75,25).a,0);
});

test("resizing a master group maps descendants once, including masks, and undo restores coordinates",()=>{
 const s=new Studio(1080,1080,testCanvas(16,16));try{
  const shape=s.addShapeLayer({x:0,y:0,w:80,h:80});shape.transform.tx=100;shape.transform.ty=120;
  shape.maskSurface=new SparseAlphaSurface(1080,1080,{defaultAlpha:255});shape.maskSurface.fillRect({x:100,y:120,width:40,height:40},0);
  const root=s.groupLayers([shape.id]);s.executeCampaign({kind:"format",layerIds:[root.id],formats:["square"]});
  const master=s.doc.artboards!.find(b=>b.name==="Master")!;
  s.executeCampaign({kind:"board-resize",boardId:master.id,width:540,height:540});
  assert.equal(s.findLayer(shape.id)!.transform.tx,50);assert.equal(s.findLayer(shape.id)!.transform.sx,.5);assert.equal(s.findLayer(shape.id)!.maskSurface!.sample(55,65),0);
  s.undo();assert.equal(s.findLayer(shape.id)!.transform.tx,100);assert.equal(s.findLayer(shape.id)!.maskSurface!.sample(110,130),0);
 }finally{s.dispose();}
});

test("paragraph overrides affect drawing and measured layout without flattening text",()=>{
 const style:TextStyle={text:"First\nSecond",font:'30px "Lato"',color:"#fff",align:"left",lineHeight:1.2,x:30,y:60,paragraphs:[{start:0,end:5,style:{spaceBefore:8,spaceAfter:20,startIndent:10,firstLineIndent:5}},{start:6,end:12,style:{lineHeight:1.5,startIndent:25}}]};
 const layer=createTextLayer("Paragraph styles",style),canvas=testCanvas(400,300),ctx=canvas.getContext("2d")!,positions:Array<{text:string;x:number;y:number}>=[],fill=ctx.fillText.bind(ctx);
 ctx.fillText=(text,x,y)=>{positions.push({text,x,y});fill(text,x,y);};drawLayerContent(ctx,layer);
 assert.deepEqual(positions,[{text:"First",x:45,y:68},{text:"Second",x:55,y:124}]);
 const ink=inkBox(canvas),box=layerBox(layer);for(const key of["x","y","width","height"]as const)assert.ok(Math.abs(ink[key]-box[key])<3);
 assert.equal(layer.text!.paragraphs!.length,2);
});

test("editable mask construction recipes follow copied geometry without mutating the source",()=>{
 const layer=createGroupLayer("Recipe mask"),anchors=[[0,0],[20,0],[20,20]].map(([x,y])=>({x,y,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}}));
 layer.vectorMask={anchors,closed:true,fill:"#fff",stroke:"none",strokeWidth:0,offsetSource:{contours:[{anchors:structuredClone(anchors),closed:true}],distance:2,join:"round",fillRule:"nonzero"}};
 const original=layer.vectorMask;
 mapComponentMasks(layer,100,100,200,200,{scale:2,dx:50,dy:10},{remaining:1024});
 assert.equal(layer.vectorMask.offsetSource!.distance,4);assert.equal(layer.vectorMask.anchors[0].x,50);assert.equal(layer.vectorMask.offsetSource!.contours[0].anchors[0].x,50);assert.equal(original.anchors[0].x,0);assert.equal(original.offsetSource!.distance,2);
});

test("oversized exact-ink layout refuses atomically before a large scratch canvas is allocated",()=>{
 const s=new Studio(800,800,testCanvas(16,16));try{
  const text=s.addTextLayer("Wide ".repeat(100),{font:'1000px "Lato"'}),board=s.createArtboard("Layout");
  const owner=s.doc,node=s.historyState().currentId;
  assert.throws(()=>s.executeCampaign({kind:"flow",layerIds:[text.id],boardId:board.id,direction:"column",padding:20,gap:10}),/layout budget/);
  assert.equal(s.doc,owner);assert.equal(s.historyState().currentId,node);assert.equal(s.doc.campaign,undefined);
 }finally{s.dispose();}
});

function inkBox(canvas:HTMLCanvasElement){
 const {data}=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height);let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;
 for(let row=0;row<canvas.height;row++)for(let col=0;col<canvas.width;col++)if(data[(row*canvas.width+col)*4+3]>8){x=Math.min(x,col);y=Math.min(y,row);r=Math.max(r,col+1);b=Math.max(b,row+1);}
 return{x,y,width:r-x,height:b-y};
}
const cases:Array<[string,Partial<TextStyle>]>=[
 ["combining marks and ligatures",{text:"office e\u0301 ﬁ ffi",font:'40px "Lato"',tracking:30}],
 ["rich baseline and decoration",{text:"Design type",font:'35px "Lato"',runs:[{start:0,end:6,style:{fontSize:60,baselineShift:12,decoration:"underline"}}]}],
 ["wrapped rich text",{text:"Editable rich text with wrapping",font:'32px "Lato"',layout:"paragraph",boxWidth:180,boxHeight:300,runs:[{start:0,end:8,style:{fontSize:40}}]}],
 ["vertical graphemes",{text:"e\u0301AB",font:'35px "Lato"',layout:"vertical",runs:[{start:0,end:2,style:{color:"#ff0000"}}]}],
];
for(const [name,style]of cases)test(`auto-layout measures rendered ink: ${name}`,()=>{
 const layer=createTextLayer(name,{text:"",font:"40px sans-serif",align:"left",lineHeight:1.2,x:320,y:100,color:"#fff",...style}),canvas=testCanvas(640,500);
 drawLayerContent(canvas.getContext("2d")!,layer);const ink=inkBox(canvas),box=layerBox(layer);
 for(const key of ["x","y","width","height"]as const)assert.ok(Math.abs(ink[key]-box[key])<=3,`${name} ${key}: ink ${ink[key]} / measured ${box[key]}`);
 const s=new Studio(800,800,testCanvas(16,16));try{
  s.doc.layers.push(layer);const after=s.addShapeLayer({w:40,h:30}),board=s.createArtboard("Layout");
  s.executeCampaign({kind:"flow",layerIds:[layer.id,after.id],boardId:board.id,direction:"column",padding:20,gap:12});
  const placed=layerBox(s.findLayer(layer.id)!),next=layerBox(s.findLayer(after.id)!);
  assert.ok(Math.abs(placed.x-20)<.001&&Math.abs(placed.y-20)<.001);assert.ok(Math.abs(next.y-placed.y-placed.height-12)<.001);
 }finally{s.dispose();}
});

test("font-ready command cancels without publishing and synchronous complex layout undo/reopen retains editable runs",async()=>{
 const s=new Studio(800,800,testCanvas(16,16));try{
  const text=s.addTextLayer("e\u0301 ﬁ office",{font:'40px "Lato"',direction:"auto",runs:[{start:5,end:11,style:{fontSize:60}}]}),board=s.createArtboard("Layout");
  const action={kind:"flow" as const,layerIds:[text.id],boardId:board.id,direction:"column" as const,padding:10,gap:10};
  const before=s.doc,node=s.historyState().currentId,controller=new AbortController();controller.abort();
  await assert.rejects(s.executeCampaignReady(action,controller.signal),/cancelled/);assert.equal(s.doc,before);assert.equal(s.historyState().currentId,node);
  await s.executeCampaignReady(action);const position=layerBox(s.findLayer(text.id)!);s.undo();assert.notDeepEqual(layerBox(s.findLayer(text.id)!),position);s.redo();
  const decoded=await decodeLumaProject((await s.prepareProjectSave()).blob);assert.deepEqual(layerBox(decoded.doc.layers.find(l=>l.id===text.id)!),position);assert.ok(decoded.doc.layers.find(l=>l.id===text.id)!.text!.runs?.length);
 }finally{s.dispose();}
});
