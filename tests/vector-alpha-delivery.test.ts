import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness";
import { createDocument, createGroupLayer, createPathLayer, type PathStyle } from "../app/engine/document";
import { SparseAlphaSurface } from "../app/engine/alpha-surface";
import { planAlphaDelivery } from "../app/engine/vector-alpha-delivery";
import { planVectorDelivery } from "../app/engine/vector-delivery-plan";
import { exportVectorSvg } from "../app/engine/vector-delivery";
import { exportVectorPdf } from "../app/engine/vector-pdf";
import { renderClean } from "../app/engine/renderer";
import { loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Studio } from "../app/engine/studio";
import { decodeLumaProject, encodeLumaProject } from "../app/engine/project";
import { DOMParser } from "@xmldom/xmldom";
const rect=(x:number,y:number,w:number,h:number,color="#ff0000"):PathStyle=>({anchors:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([x,y])=>({x,y,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}})),closed:true,fill:color,stroke:"none",strokeWidth:0});
function fixture(grouped:boolean,legacy=false) {
  const doc=createDocument(320,192),front=createPathLayer("Blue",rect(20,20,280,152,"#0000ff")),back=createPathLayer("Red",rect(0,0,320,192));
  const mask=new SparseAlphaSurface(doc.width,doc.height,{defaultAlpha:255,tileSize:64});
  const gradient=new Uint8ClampedArray(256*128);
  for(let y=0;y<128;y++)for(let x=0;x<256;x++)gradient[y*256+x]=x;
  mask.writeRegion({x:32,y:32,width:256,height:128},gradient);mask.writeUniform("0:0",0);
  const group=createGroupLayer("Masked group");group.opacity=.8;
  const target=grouped?group:front;target.maskSurface=mask;
  target.vectorMask={...rect(8,8,304,176),fillRule:"evenodd",contours:[rect(150,90,20,20)]};
  if(legacy){
    const canvas=testCanvas(320,192),ctx=canvas.getContext("2d")!,image=ctx.createImageData(320,192),alpha=mask.readRegion({x:0,y:0,width:320,height:192});
    for(let i=0;i<alpha.length;i++){image.data[4*i]=image.data[4*i+1]=image.data[4*i+2]=255;image.data[4*i+3]=alpha[i];}ctx.putImageData(image,0,0);target.mask=canvas;target.maskSurface=undefined;
  }
  if(grouped){front.parentId=back.parentId=group.id;doc.layers=[group,front,back];}else doc.layers=[front,back];
  return{doc,target,referenceMask:mask};
}
function compare(a:HTMLCanvasElement,b:HTMLCanvasElement){
  const left=a.getContext("2d")!.getImageData(0,0,320,192).data,right=b.getContext("2d")!.getImageData(0,0,320,192).data;
  let delta=0,changed=0,worst=0,alphaDelta=0;
  for(let i=0;i<left.length;i+=4){let peak=0;for(let c=0;c<4;c++){const d=Math.abs(left[i+c]-right[i+c]);delta+=d;if(c===3)alphaDelta+=d;peak=Math.max(peak,d);}worst=Math.max(worst,peak);if(peak>8)changed++;}
  const metrics={rgbaMean:delta/left.length,alphaMean:alphaDelta/(left.length/4),changedFraction:changed/(left.length/4),worst};
  assert.ok(metrics.rgbaMean<=1.5&&metrics.alphaMean<=1&&metrics.changedFraction<=.025,JSON.stringify(metrics));return metrics;
}
for(const grouped of [false,true])for(const legacy of [false,true])test(`SVG ${grouped?"group":"layer"} ${legacy?"legacy":"sparse"} embeds exact mask samples without changing vectors`,async()=>{
  const{doc,target,referenceMask}=fixture(grouped,legacy),originalMask=target.mask,originalSurface=target.maskSurface;
  const svg=exportVectorSvg(doc);assert.match(svg,/<mask /);assert.match(svg,/<path /);assert.match(svg,/data:image\/png;base64/);
  // Skia's SVG loader omits embedded PNGs. Validate encoded mask samples here;
  // the WebKit/Chromium campaign separately compares complete rendered output.
  const parsed=new DOMParser().parseFromString(svg,"image/svg+xml"),mask=parsed.getElementsByTagName("mask")[0],decoded=testCanvas(320,192),context=decoded.getContext("2d")!;
  for(let child=mask.firstChild;child;child=child.nextSibling){if(child.nodeType!==1)continue;const e=child as import("@xmldom/xmldom").Element,x=Number(e.getAttribute("x")),y=Number(e.getAttribute("y")),w=Number(e.getAttribute("width")),h=Number(e.getAttribute("height"));if(e.tagName==="rect"){context.fillStyle=e.getAttribute("fill")!;context.fillRect(x,y,w,h);}else{assert.equal(e.tagName,"image");const image=await loadImage(e.getAttribute("xlink:href")!);context.drawImage(image as unknown as CanvasImageSource,x,y,w,h);}}
  const pixels=context.getImageData(0,0,320,192).data,expectedAlpha=referenceMask.readRegion({x:0,y:0,width:320,height:192});
  for(let i=0;i<expectedAlpha.length;i++)assert.equal(pixels[i*4],expectedAlpha[i],`mask sample ${i}`);
  // Export itself must not migrate or mutate the source mask.
  assert.equal(target.mask,originalMask);assert.equal(target.maskSurface,originalSurface);
  const expected=testCanvas(320,192);renderClean(doc,expected);
  if(process.env.LUMA_DELIVERY_REVIEW_DIR){const dir=process.env.LUMA_DELIVERY_REVIEW_DIR;await mkdir(dir,{recursive:true});const name=`svg-${grouped?"group":"layer"}-${legacy?"legacy":"sparse"}`;await writeFile(join(dir,`${name}.svg`),svg);await writeFile(join(dir,`${name}-source.png`),Buffer.from(expected.toDataURL().split(",")[1],"base64"));}
  if(process.env.LUMA_DELIVERY_REVIEW_DIR) await writeFile(join(process.env.LUMA_DELIVERY_REVIEW_DIR,`svg-${grouped?"group":"layer"}-${legacy?"legacy":"sparse"}.luma`),new Uint8Array(await (await encodeLumaProject(doc, [], "Soft mask reference")).arrayBuffer()));
});

test("50K reveal-all mask with one uniform cutout exports without raster allocation",()=>{
  const doc=createDocument(50000,50000),layer=createPathLayer("Sparse",rect(0,0,50000,50000));doc.layers=[layer];
  layer.maskSurface=new SparseAlphaSurface(50000,50000,{defaultAlpha:255});layer.maskSurface.writeUniform("80:80",0);
  const before=layer.maskSurface.stats(),svg=exportVectorSvg(doc);
  assert.ok(svg.length<2500);assert.doesNotMatch(svg,/<image/);assert.match(svg,/rgb\(0,0,0\)/);assert.deepEqual(layer.maskSurface.stats(),before);
});

test("mask admission is aggregate, bounded and rejects oversized records before copying",()=>{
  const doc=createDocument(2048,2048),surface=new SparseAlphaSurface(2048,2048,{tileSize:16});
  for(let i=0;i<4097;i++)surface.writeUniform(surface.grid.key(i%128,Math.floor(i/128)),128);
  const layer=createPathLayer("Too many records",rect(0,0,20,20));layer.maskSurface=surface;doc.layers=[layer];
  assert.throws(()=>planAlphaDelivery(layer,2048,2048),/bounded/);
  assert.ok(planVectorDelivery(doc,"svg").report.issues.some(i=>i.code==="PIXEL_MASK_BUDGET"));
  const a=fixture(true).doc.layers[0];const shared=new SparseAlphaSurface(1024,1024,{tileSize:16});
  for(let i=0;i<2100;i++)shared.writeUniform(shared.grid.key(i%64,Math.floor(i/64)),128);
  doc.width=doc.height=1024;doc.layers=[{...a,id:"a",parentId:undefined,maskSurface:shared},{...a,id:"b",parentId:undefined,maskSurface:shared}];
  assert.ok(planVectorDelivery(doc,"pdf").report.issues.some(i=>/Combined mask/.test(i.reason)));
});

test("mask project save/reopen preserves exact export, and export failure leaves the master intact",async()=>{
  const studio=new Studio(320,192,testCanvas(320,192));
  try{
    studio.doc.layers=fixture(true).doc.layers;
    const original=exportVectorSvg(studio.doc),state=studio.activeDocumentState(),saved=await studio.prepareProjectSave(),reopened=await decodeLumaProject(saved.blob);
    assert.equal(exportVectorSvg(reopened.doc),original);
    assert.deepEqual(studio.activeDocumentState(),state);
    studio.doc.layers[0].maskSurface=new SparseAlphaSurface(2,2);
    await assert.rejects(studio.exportVectorDocument("pdf"),/dimensions/);
    assert.equal(studio.doc.layers[0].maskSurface.width,2);assert.deepEqual(studio.activeDocumentState(),state);
  }finally{studio.dispose();}
});
const hasPoppler=(()=>{try{execFileSync("pdftoppm",["-v"],{stdio:"ignore",timeout:10000});return true;}catch{return false;}})();
for(const grouped of [false,true])test(`Poppler independently renders ${grouped?"group":"layer"} soft mask`,{skip:!hasPoppler&&"Poppler required"},async()=>{
  const{doc}=fixture(grouped),directory=await mkdtemp(join(tmpdir(),"luma-soft-mask-"));
  try{
    const bytes=await exportVectorPdf(doc),pdf=await PDFDocument.load(bytes),path=join(directory,"proof.pdf");
    assert.equal(pdf.getPageCount(),1);assert.ok(pdf.context.enumerateIndirectObjects().some(([,object])=>String(object).includes("/SMask")&&String(object).includes("/Luminosity")),"PDF retains a soft-mask structure");
    await writeFile(path,bytes);execFileSync("pdftoppm",["-r","72","-singlefile","-png",path,join(directory,"render")],{timeout:10000});
    const actual=testCanvas(320,192);actual.getContext("2d")!.drawImage(await loadImage(join(directory,"render.png")) as unknown as CanvasImageSource,0,0);
    const expected=testCanvas(320,192),transparent=testCanvas(320,192);renderClean(doc,transparent);const ctx=expected.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,320,192);ctx.drawImage(transparent,0,0);
    const metrics=compare(actual,expected);
    if(process.env.LUMA_DELIVERY_REVIEW_DIR){const dir=process.env.LUMA_DELIVERY_REVIEW_DIR;await mkdir(dir,{recursive:true});const name=grouped?"soft-group":"soft-layer";await writeFile(join(dir,`${name}.pdf`),bytes);await writeFile(join(dir,`${name}-metrics.json`),JSON.stringify(metrics,null,2));for(const[label,canvas]of[["pdf",actual],["source",expected]]as const)await writeFile(join(dir,`${name}-${label}.png`),Buffer.from(canvas.toDataURL().split(",")[1],"base64"));}
  }finally{await rm(directory,{recursive:true,force:true});}
});
