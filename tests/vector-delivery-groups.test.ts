import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness";
import { createDocument, createGroupLayer, createPathLayer, createRasterLayer, type Document, type PathStyle } from "../app/engine/document";
import { exportVectorSvg } from "../app/engine/vector-delivery";
import { exportVectorPdf } from "../app/engine/vector-pdf";
import { planVectorDelivery } from "../app/engine/vector-delivery-plan";
import { renderClean } from "../app/engine/renderer";
import { loadImage } from "@napi-rs/canvas";
import { DOMParser } from "@xmldom/xmldom";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Studio } from "../app/engine/studio";
import { decodeLumaProject } from "../app/engine/project";

const rect = (x: number, y: number, w: number, h: number, color = "#ff0000"): PathStyle => ({
  anchors: [[x, y], [x+w, y], [x+w, y+h], [x, y+h]].map(([x,y]) => ({x,y,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}})), closed: true, fill: color, stroke: "none", strokeWidth: 0,
});
function fixture() {
  const doc = createDocument(160,160);
  const group = createGroupLayer("Campaign"), nested = createGroupLayer("Art"), hidden = createGroupLayer("Hidden unsupported content");
  group.id = "campaign"; nested.id = "art"; hidden.id = "hidden";
  group.opacity = .5; nested.parentId = group.id; nested.fillOpacity = .8; hidden.visible = false;
  const blue = createPathLayer("Accent", rect(45,25,85,95,"#0000ff")), red = createPathLayer("Base", rect(10,10,90,100));
  blue.id = "accent"; red.id = "base"; blue.parentId = nested.id; red.parentId = nested.id;
  blue.transform.tx = 5;
  const raster = createRasterLayer("Hidden photo",testCanvas(1,1)); raster.parentId = hidden.id;
  group.vectorMask = {...rect(15,15,110,110), fillRule: "evenodd", contours: [rect(60,60,20,20)]};
  blue.vectorMask = rect(55,10,40,130);
  doc.layers = [group,nested,blue,red,hidden,raster];
  return doc;
}
function clippedFixture() {
  const doc=createDocument(160,160),group=createGroupLayer("Clipped art");group.opacity=.65;
  const base=createPathLayer("Opaque base",{...rect(10,10,100,100),fillRule:"evenodd",contours:[rect(60,60,20,20)]});
  base.transform.tx=5;
  const top=createPathLayer("Clipped accent",rect(35,25,100,110,"#0000ff"));top.clipping=true;top.opacity=.75;
  base.parentId=group.id;top.parentId=group.id;doc.layers=[group,top,base];return doc;
}
async function svgPixels(doc: Document) {
  const canvas = testCanvas(doc.width,doc.height);
  canvas.getContext("2d")!.drawImage(await loadImage(Buffer.from(exportVectorSvg(doc))) as unknown as CanvasImageSource,0,0);
  return canvas;
}
const pixel = (canvas: HTMLCanvasElement,x:number,y:number) => [...canvas.getContext("2d")!.getImageData(x,y,1,1).data];
const points = [[5,5],[20,20],[35,45],[70,45],[70,70],[110,45],[140,140]];
function compare(actual: HTMLCanvasElement, expected: HTMLCanvasElement, tolerance = 2) {
  for (const [x,y] of points) pixel(actual,x,y).forEach((v,c) => assert.ok(Math.abs(v-pixel(expected,x,y)[c]) <= tolerance, `${x},${y} channel ${c}: ${v} vs ${pixel(expected,x,y)[c]}`));
  const a=actual.getContext("2d")!.getImageData(0,0,160,160).data,b=expected.getContext("2d")!.getImageData(0,0,160,160).data;
  let delta=0,alphaDelta=0,changed=0,worst=0;
  for(let i=0;i<a.length;i+=4){let peak=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);delta+=d;peak=Math.max(peak,d);if(c===3)alphaDelta+=d;}if(peak>8)changed++;worst=Math.max(worst,peak);}
  const metrics={meanAbsoluteDelta:delta/a.length,alphaMeanAbsoluteDelta:alphaDelta/(a.length/4),changedPixelFraction:changed/(a.length/4),worstChannelDelta:worst};
  assert.ok(metrics.meanAbsoluteDelta<=1.5&&metrics.alphaMeanAbsoluteDelta<=1&&metrics.changedPixelFraction<=.02,JSON.stringify(metrics));
  return metrics;
}

test("nested SVG groups preserve tree, order, isolated opacity and document-space masks",async()=>{
  const doc=fixture(), source=exportVectorSvg(doc), parsed=new DOMParser().parseFromString(source,"image/svg+xml");
  const art=parsed.getElementById("art")!;
  assert.equal(art.parentNode,parsed.getElementById("campaign"));
  assert.equal(parsed.getElementById("accent")!.parentNode,art);
  assert.ok(source.indexOf('id="base"')<source.indexOf('id="accent"'));
  assert.doesNotMatch(source,/<image|Hidden photo/);
  const expected=testCanvas(160,160);renderClean(doc,expected);
  compare(await svgPixels(doc),expected);
});

test("selection retains ancestors, excludes unselected siblings, and includes group descendants independent of selection order",()=>{
  const doc=fixture(), [group,nested,blue]=doc.layers;
  const plan=planVectorDelivery(doc,"svg",[blue]);
  assert.equal(plan.report.canExport,true);assert.equal(plan.report.objectCount,3);
  assert.equal(plan.nodes[0].children[0].children[0].layer,blue);
  assert.equal(planVectorDelivery(doc,"svg",[blue,group]).report.objectCount,4);
  assert.equal(planVectorDelivery(doc,"svg",[group,nested,blue]).report.objectCount,4);
  assert.equal(planVectorDelivery(doc,"svg",[{...blue}]).report.canExport,false);
});

test("preflight identifies all unsupported objects with layer paths, conversion and editability impact",()=>{
  const doc=fixture();doc.layers[2].clipping=true;doc.layers[3].mask=testCanvas(20,20);doc.layers[3].path=undefined;doc.layers[3].kind="raster";
  const report=planVectorDelivery(doc,"svg").report;
  assert.equal(report.canExport,false);
  assert.ok(report.issues.some(i=>i.code==="CLIPPING"&&i.layerPath==="Campaign / Art / Accent"));
  assert.ok(report.issues.some(i=>i.code==="PIXEL_MASK_BUDGET"&&i.classification==="B"));
  assert.ok(report.issues.every(i=>i.conversion&&i.impact));
  assert.throws(()=>exportVectorSvg(doc),/Campaign \/ Art \/ Accent/);
});

test("malformed hierarchy, nonfinite transforms and group alpha fail before writing",()=>{
  for(const mode of ["cycle","orphan","empty-parent","duplicate","depth","transform","opacity"]){
    const doc=fixture();
    if(mode==="cycle")doc.layers[0].parentId=doc.layers[1].id;
    if(mode==="orphan")doc.layers[2].parentId="missing";
    if(mode==="empty-parent")doc.layers[2].parentId="";
    if(mode==="duplicate")doc.layers[2].id=doc.layers[1].id;
    if(mode==="transform")doc.layers[2].transform.tx=Infinity;
    if(mode==="opacity")doc.layers[0].opacity=NaN;
    if(mode==="depth") { doc.layers=Array.from({length:34},(_,i)=>({...createGroupLayer(`G${i}`),id:`g${i}`,parentId:i?`g${i-1}`:undefined})); }
    assert.equal(planVectorDelivery(doc,"svg").report.canExport,false,mode);
    assert.throws(()=>exportVectorSvg(doc),mode);
  }
});

test("preflight stops retaining geometry once the aggregate anchor budget is exceeded",()=>{
  const doc=createDocument(160,160),path=rect(1,1,100,100);
  path.anchors=Array.from({length:2048},(_,i)=>({...path.anchors[i%4],hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}}));
  doc.layers=Array.from({length:100},(_,i)=>createPathLayer(`Complex ${i}`,path));
  const {nodes,report}=planVectorDelivery(doc,"pdf");
  assert.equal(report.canExport,false);assert.ok(report.issues.some(i=>i.code==="ANCHOR_BUDGET"));
  assert.equal(report.objectCount,100);
  assert.ok(nodes.filter(n=>n.path).length<=4,"Do not retain all rejected path clones");
  assert.ok(report.anchorCount<=12288,"Do not visit geometry after admission fails");
});

test("generated mask IDs cannot collide with user layer IDs; mask budget is counted",()=>{
  const doc=fixture();doc.layers[2].id="luma-mask-0";
  const source=exportVectorSvg(doc);assert.match(source,/<clipPath id="luma-mask-1"/);
  assert.equal(planVectorDelivery(doc,"svg").report.anchorCount,20);
});

test("50K grouped SVG stays geometry-sized without allocating a canvas",()=>{
  const doc=fixture();doc.width=50000;doc.height=50000;
  const svg=exportVectorSvg(doc);assert.ok(svg.length<5000);assert.match(svg,/width="50000"/);
});

test("opaque vector clipping preserves transformed base holes without rasterization",async()=>{
  const doc=clippedFixture(),expected=testCanvas(160,160);renderClean(doc,expected);
  assert.equal(planVectorDelivery(doc,"svg").report.canExport,true);
  assert.doesNotMatch(exportVectorSvg(doc),/<image/);
  compare(await svgPixels(doc),expected);
  doc.layers[2].opacity=.5;
  assert.equal(planVectorDelivery(doc,"svg").report.canExport,true);
  renderClean(doc,expected);compare(await svgPixels(doc),expected);
  assert.ok((await exportVectorPdf(doc)).byteLength>0);
});

test("vector preflight cannot authorize a different tab, committed edit, or undo",async()=>{
  const studio=new Studio(160,160,testCanvas(160,160));
  try {
    const layer=studio.addPathLayer(rect(0,0,20,20)),ready=await studio.prepareVectorDelivery("svg");
    ready.assertCurrent();assert.equal(ready.report.canExport,true);
    studio.setLayerProp(layer.id,"opacity",.5);
    assert.throws(ready.assertCurrent,/changed/);
    const edited=await studio.prepareVectorDelivery("svg");studio.undo();assert.throws(edited.assertCurrent,/changed/);
    const restored=await studio.prepareVectorDelivery("svg");studio.resetDocument(16,16,"Other");assert.throws(restored.assertCurrent,/changed/);
  } finally {studio.dispose();}
});

test("grouped masked project survives save/reopen and export without changing history or dirty state",async()=>{
  const studio=new Studio(160,160,testCanvas(160,160));
  try {
    studio.doc.layers=fixture().layers;
    const original=exportVectorSvg(studio.doc), saved=await studio.prepareProjectSave();
    const reopened=await decodeLumaProject(saved.blob);
    assert.equal(exportVectorSvg(reopened.doc),original);
    const state=studio.activeDocumentState();
    assert.equal(await (await studio.exportVectorDocument("svg")).text(),original);
    assert.deepEqual(studio.activeDocumentState(),state);
  } finally {studio.dispose();}
});

const hasPoppler=(()=>{try{execFileSync("pdftoppm",["-v"],{stdio:"ignore",timeout:10000});return true;}catch{return false;}})();
for(const [name,make] of [["grouped-mask",fixture],["clipped-vector",clippedFixture]] as const)test(`Poppler renders ${name} like the source compositor`,{skip:!hasPoppler&&"Independent Poppler renderer required"},async()=>{
  const doc=make(), directory=await mkdtemp(join(tmpdir(),"luma-grouped-delivery-"));
  try {
    const bytes=await exportVectorPdf(doc), path=join(directory,"fixture.pdf");await writeFile(path,bytes);
    execFileSync("pdftoppm",["-r","72","-singlefile","-png",path,join(directory,"render")],{timeout:10000});
    const actual=testCanvas(160,160);actual.getContext("2d")!.drawImage(await loadImage(join(directory,"render.png")) as unknown as CanvasImageSource,0,0);
    const expected=testCanvas(160,160), transparent=testCanvas(160,160);renderClean(doc,transparent);
    const ctx=expected.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,160,160);ctx.drawImage(transparent,0,0);
    const metrics=compare(actual,expected);
    if(process.env.LUMA_DELIVERY_REVIEW_DIR){
      await mkdir(process.env.LUMA_DELIVERY_REVIEW_DIR,{recursive:true});
      await writeFile(join(process.env.LUMA_DELIVERY_REVIEW_DIR,`${name}.pdf`),bytes);
      await writeFile(join(process.env.LUMA_DELIVERY_REVIEW_DIR,`${name}.svg`),exportVectorSvg(doc));
      await writeFile(join(process.env.LUMA_DELIVERY_REVIEW_DIR,`${name}-metrics.json`),JSON.stringify({scope:"Synthetic fixture compared against independent Poppler; not a professional project",renderer:"pdftoppm",metrics,tolerances:{meanAbsoluteDelta:1.5,alphaMeanAbsoluteDelta:1,changedPixelFraction:.02,changedChannelThreshold:8}},null,2));
      for(const [kind,canvas]of [["pdf",actual],["source",expected],["svg",await svgPixels(doc)]]as const)await writeFile(join(process.env.LUMA_DELIVERY_REVIEW_DIR,`${name}-${kind}.png`),Buffer.from(canvas.toDataURL().split(",")[1],"base64"));
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
