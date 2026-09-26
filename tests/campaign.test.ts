import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { testCanvas, pixelAt } from "./canvas-harness";
import { Studio } from "../app/engine/studio";
import { DEFAULT_TEXT_SPATIAL } from "../app/engine/text-3d";
import { emptyCampaign, validateCampaign, layerBox, layerColor, setLayerColor, campaignPreflight, CAMPAIGN_FORMATS } from "../app/engine/campaign";

function fixture(){const s=new Studio(400,400,testCanvas(400,400));const text=s.addTextLayer("Design",{font:"20px sans-serif",x:20,y:40});const shape=s.addShapeLayer({x:20,y:80,w:100,h:100,fill:"#ffffff"});return{s,text,shape};}
test("linked colors are atomic, undoable, update actual text default color and preserve overrides",()=>{
 const {s,text,shape}=fixture();try{
  s.executeCampaign({kind:"color-save",name:"Accent",value:"#ff0000"});const id=s.doc.campaign!.colors[0].id;
  s.executeCampaign({kind:"color-link",id,layerIds:[text.id,shape.id],slot:"fill"});
  assert.equal(s.findLayer(text.id)!.text!.defaultStyle!.color,"#ff0000");assert.equal(layerColor(s.findLayer(shape.id)!),"#ff0000");
  s.findLayer(shape.id)!.shape!.fill="#00ff00";
  s.executeCampaign({kind:"color-save",id,name:"Accent",value:"#0000ff"});assert.equal(layerColor(s.findLayer(text.id)!),"#0000ff");assert.equal(layerColor(s.findLayer(shape.id)!),"#00ff00");
  s.undo();assert.equal(layerColor(s.findLayer(text.id)!),"#ff0000");s.redo();assert.equal(layerColor(s.findLayer(text.id)!),"#0000ff");
  const before=JSON.stringify(s.doc.campaign),node=s.historyState().currentId;s.findLayer(text.id)!.locked=true;
  assert.throws(()=>s.executeCampaign({kind:"color-save",id,name:"Accent",value:"#ffffff"}),/Unlock/);assert.equal(JSON.stringify(s.doc.campaign),before);assert.equal(s.historyState().currentId,node);
 }finally{s.dispose();}
});
test("text recipes preserve character overrides and do not replace independent colors",()=>{
 const {s,text}=fixture();try{
  const other=s.addTextLayer("Second",{font:"40px sans-serif",color:"#123456",runs:[{start:0,end:3,style:{fontWeight:900}}]});
  s.executeCampaign({kind:"type-save",name:"Heading",layerId:text.id});const id=s.doc.campaign!.types[0].id;
  s.executeCampaign({kind:"type-link",id,layerIds:[other.id]});const target=s.findLayer(other.id)!;assert.equal(target.text!.font,"20px sans-serif");assert.equal(target.text!.color,"#123456");assert.equal(target.text!.runs![0].style.fontWeight,900);
  s.findLayer(text.id)!.text!.font="30px sans-serif";s.findLayer(text.id)!.text!.defaultStyle!.fontSize=30;
  s.executeCampaign({kind:"type-save",id,name:"Heading",layerId:text.id});assert.equal(s.findLayer(other.id)!.text!.font,"30px sans-serif");
 }finally{s.dispose();}
});
test("all six formats preserve editable objects, layout updates and structural undo survive save/reopen",async()=>{
 const {s,text,shape}=fixture(),reopened=new Studio(2,2,testCanvas(2,2));try{
  s.executeCampaign({kind:"format",formats:CAMPAIGN_FORMATS.map(f=>f.id),layerIds:[text.id,shape.id]});
  assert.equal(s.doc.artboards!.length,7);assert.equal(s.doc.layers.length,14);assert.equal(s.doc.campaign!.links.filter(l=>l.sourceId).length,12);
  const width=s.doc.width;assert.equal(width,8944);
  const save=await s.prepareProjectSave("Campaign");await reopened.importProject(save.blob);
  assert.deepEqual(reopened.doc.campaign,JSON.parse(JSON.stringify(s.doc.campaign)));reopened.undo();assert.equal(reopened.doc.width,400);assert.equal(reopened.doc.layers.length,2);reopened.redo();assert.equal(reopened.doc.width,width);assert.equal(reopened.doc.layers.length,14);
  s.findLayer(text.id)!.text!.text="Updated";s.executeCampaign({kind:"sync"});
  for(const l of s.doc.campaign!.links.filter(l=>l.sourceId===text.id))assert.equal(s.findLayer(l.layerId)!.text!.text,"Updated");
 }finally{s.dispose();reopened.dispose();}
});
test("layout overflow and document-space selection refuse without publishing changes",()=>{
 const {s,text,shape}=fixture();try{
  const board=s.createArtboard("Master"),before=s.historyState().currentId;
  assert.throws(()=>s.executeCampaign({kind:"flow",layerIds:[text.id,shape.id],boardId:board.id,direction:"column",padding:300,gap:20}),/do not fit/);assert.equal(s.historyState().currentId,before);
  s.executeCampaign({kind:"flow",layerIds:[text.id,shape.id],boardId:board.id,direction:"column",padding:10,gap:20});const box=layerBox(s.findLayer(text.id)!);assert.equal(box.x,10);assert.equal(layerBox(s.findLayer(shape.id)!).y,box.y+box.height+20);
  s.selectRect(0,0,20,20);const width=s.doc.width;assert.throws(()=>s.executeCampaign({kind:"format",formats:["square"],layerIds:[text.id]}),/selections/);assert.equal(s.doc.width,width);
 }finally{s.dispose();}
});
test("variants preserve rich text and link baselines through apply, undo, and reopen",async()=>{
 const {s,text}=fixture(),reopened=new Studio(2,2,testCanvas(2,2));try{
  s.findLayer(text.id)!.text!.runs=[{start:0,end:3,style:{color:"#ff0000",fontWeight:900}}];
  s.executeCampaign({kind:"color-save",name:"Accent",value:"#00ff00"});const colorId=s.doc.campaign!.colors[0].id;
  s.executeCampaign({kind:"color-link",id:colorId,layerIds:[text.id],slot:"fill"});s.executeCampaign({kind:"variant-save",name:"Original"});
  const variant=s.doc.campaign!.variants[0],savedText=structuredClone(s.findLayer(text.id)!.text!);
  s.executeCampaign({kind:"color-save",id:colorId,name:"Accent",value:"#0000ff"});s.findLayer(text.id)!.text!.text="Changed";
  s.executeCampaign({kind:"variant-apply",id:variant.id});assert.deepEqual(s.findLayer(text.id)!.text!.runs,savedText.runs);assert.equal(s.findLayer(text.id)!.text!.text,"Design");assert.equal(s.doc.campaign!.links[0].appliedColor,"#00ff00");
  await reopened.importProject((await s.prepareProjectSave("Variants")).blob);assert.equal(reopened.doc.campaign!.variants[0].name,"Original");reopened.undo();assert.equal(reopened.findLayer(text.id)!.text!.text,"Changed");reopened.redo();assert.equal(reopened.findLayer(text.id)!.text!.text,"Design");
  s.executeCampaign({kind:"variant-delete",id:variant.id});assert.equal(s.doc.campaign!.variants.length,0);s.undo();assert.equal(s.doc.campaign!.variants.length,1);
 }finally{s.dispose();reopened.dispose();}
});
test("metadata validation refuses malformed and excessive inputs",()=>{
 const kit=emptyCampaign();kit.colors=[{id:"a",name:"A",value:"red"}];assert.throws(()=>validateCampaign(kit),/colors/);
 kit.colors=[];kit.links=[{layerId:"a",sourceId:"b",anchorX:"oops" as "left"}];assert.throws(()=>validateCampaign(kit),/link/);
 kit.links=[];kit.types=[{id:"t",name:"T",value:{font:"2px sans-serif",align:"left",lineHeight:1,defaultStyle:{fontWeight:500}}}];assert.ok(validateCampaign(kit));
  kit.types[0].value.defaultStyle!.axes={wght:NaN};assert.throws(()=>validateCampaign(kit),/OpenType/);
 kit.types[0].value.defaultStyle={};Object.assign(kit.types[0].value,{text:"injected"});assert.throws(()=>validateCampaign(kit),/typography/);
});
test("appearance-stack colors target visible paints, mixed paints refuse instead of silently flattening",()=>{
 const {s,text}=fixture();try{const layer=s.findLayer(text.id)!;
  layer.text!.appearance={fills:[{id:"a",kind:"solid",enabled:true,color:"#ff0000",opacity:1}],strokes:[]};
  setLayerColor(layer,"#00ff00");assert.equal(layer.text!.appearance!.fills[0].color,"#00ff00");assert.equal(layerColor(layer),"#00ff00");
  layer.text!.appearance!.fills.push({id:"b",kind:"solid",enabled:true,color:"#0000ff",opacity:.5});assert.equal(layerColor(layer),undefined);assert.throws(()=>setLayerColor(layer,"#ffffff"),/no editable color/);
 }finally{s.dispose();}
});
test("pending gestures block campaign edits without absorbing the preview into undo",()=>{
 const {s,shape}=fixture();try{s.liveUpdateTransform(shape.id,{tx:40});assert.throws(()=>s.executeCampaign({kind:"variant-save",name:"Unsafe"}),/gesture/);assert.equal(s.doc.campaign,undefined);s.updateTransform(shape.id,{});s.executeCampaign({kind:"variant-save",name:"Safe"});assert.equal(s.doc.campaign!.variants.length,1);}finally{s.dispose();}
});
test("grid guides deduplicate, preserve existing guides, undo once, and reject overflow",()=>{
 const {s}=fixture();try{s.addGuide("vertical",7);s.executeCampaign({kind:"grid",columns:3,rows:2,margin:20,gutter:10});assert.equal(s.doc.guides!.length,11);const original=JSON.stringify(s.doc.guides);s.executeCampaign({kind:"grid",columns:3,rows:2,margin:20,gutter:10});assert.equal(JSON.stringify(s.doc.guides),original);s.undo();s.undo();assert.equal(s.doc.guides!.length,1);s.redo();assert.equal(s.doc.guides!.length,11);assert.throws(()=>s.executeCampaign({kind:"grid",columns:24,rows:24,margin:200,gutter:20}),/exceed/);assert.equal(s.doc.guides!.length,11);}finally{s.dispose();}
});
test("portable brand kits create fresh identities and import atomically",()=>{
 const {s}=fixture();try{const color={id:"shared",name:"Brand",value:"#abcdef"};s.executeCampaign({kind:"brand-import",colors:[color],types:[]});s.executeCampaign({kind:"brand-import",colors:[color],types:[]});assert.equal(s.doc.campaign!.colors.length,2);assert.equal(new Set(s.doc.campaign!.colors.map(c=>c.id)).size,2);s.undo();assert.equal(s.doc.campaign!.colors.length,1);const node=s.historyState().currentId;assert.throws(()=>s.executeCampaign({kind:"brand-import",colors:[{...color,value:"invalid"}],types:[]}),/colors/);assert.equal(s.historyState().currentId,node);}finally{s.dispose();}
});
test("campaigns follow document ownership and 3D material edits retain editable spatial state",()=>{
 const {s,text}=fixture();try{const first=s.activeDocumentState().id;s.findLayer(text.id)!.text!.spatial=structuredClone(DEFAULT_TEXT_SPATIAL);
  s.executeCampaign({kind:"color-save",name:"Material",value:"#abcdef"});const id=s.doc.campaign!.colors[0].id;
  s.executeCampaign({kind:"color-link",id,layerIds:[text.id],slot:"front"});assert.equal(s.findLayer(text.id)!.text!.spatial!.material.frontColor,"#abcdef");assert.ok(s.activeDocumentState().dirty);
  s.resetDocument(32,32,"Second");assert.equal(s.doc.campaign,undefined);s.executeCampaign({kind:"color-save",name:"Second",value:"#112233"});s.switchDocument(first);assert.equal(s.doc.campaign!.colors[0].name,"Material");assert.equal(s.findLayer(text.id)!.text!.spatial!.material.frontColor,"#abcdef");s.undo();assert.equal(s.findLayer(text.id)!.text!.spatial!.material.frontColor,DEFAULT_TEXT_SPATIAL.material.frontColor);
 }finally{s.dispose();}
});
test("commit failure rolls back staged document ownership and metadata",()=>{
 const {s,text}=fixture();try{const owner=s.doc,layer=s.findLayer(text.id),node=s.historyState().currentId;const internals=s as unknown as {commit:(entry:unknown)=>void};const commit=internals.commit;internals.commit=()=>{throw new Error("Injected admission failure");};
  try{assert.throws(()=>s.executeCampaign({kind:"format",formats:["square"],layerIds:[text.id]}),/admission/);assert.equal(s.doc,owner);assert.equal(s.findLayer(text.id),layer);assert.equal(s.doc.campaign,undefined);assert.equal(s.historyState().currentId,node);}finally{internals.commit=commit;}
 }finally{s.dispose();}
});
test("campaign export rejects a document switch during asynchronous encoding",async()=>{
 const {s}=fixture();try{s.createArtboard("Master");s.exportArtboard=async()=>{s.resetDocument(32,32,"Other");return new Blob(["unused"]);};await assert.rejects(()=>s.exportCampaign(),/document changed/i);assert.equal(s.doc.width,32);assert.equal(s.doc.campaign,undefined);}finally{s.dispose();}
});
test("campaign export is preflighted, cancellable, emits manifest and accurate PNG pixels",async()=>{
 const s=new Studio(16,16,testCanvas(16,16));try{
  s.addShapeLayer({x:0,y:0,w:16,h:16,fill:"#ff0000",strokeWidth:0});s.createArtboard("Red");
  assert.equal(campaignPreflight(s.doc).filter(i=>i.severity==="error").length,0);
  const zip=await JSZip.loadAsync(await (await s.exportCampaign()).arrayBuffer());const manifest=JSON.parse(await zip.file("delivery.json")!.async("string"));assert.equal(manifest.files.length,1);assert.equal(manifest.colorSpace,"srgb");
  const bitmap=await createImageBitmap(new Blob([await zip.file(manifest.files[0].filename)!.async("arraybuffer")]));const canvas=testCanvas(16,16);canvas.getContext("2d")!.drawImage(bitmap,0,0);assert.equal(pixelAt(canvas,8,8).r,255);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>s.exportCampaign(controller.signal),/cancelled/);
  s.doc.artboards![0].width=50000;await assert.rejects(()=>s.exportCampaign(),/4 MP|outside/);
 }finally{s.dispose();}
});
