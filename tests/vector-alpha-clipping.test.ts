import test from "node:test";
import assert from "node:assert/strict";
import { testCanvas } from "./canvas-harness";
import { createDocument, createPathLayer, findClippingBase, type PathStyle } from "../app/engine/document";
import { SparseAlphaSurface } from "../app/engine/alpha-surface";
import { exportVectorSvg } from "../app/engine/vector-delivery";
import { exportVectorPdf } from "../app/engine/vector-pdf";
import { renderClean } from "../app/engine/renderer";
import { loadImage } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeLumaProject } from "../app/engine/project";
const rect = (x: number, y: number, width: number, height: number, fill: string): PathStyle => ({ anchors: [[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([x,y])=>({x,y,hIn:{dx:0,dy:0},hOut:{dx:0,dy:0}})), closed:true,fill,stroke:"none",strokeWidth:0 });
function fixture(mode: string) {
  const doc=createDocument(320,192),base=createPathLayer("Alpha base",rect(20,20,260,140,"#ff0000"));
  base.path!.appearance=[{kind:"fill",color:"#ff0000",opacity:.45,width:0,enabled:true},{kind:"stroke",color:"#000000",opacity:.75,width:12,enabled:true}];
  base.opacity=.65;base.fillOpacity=.8;base.blendClippedAsGroup=mode!=="separate";
  const middle=createPathLayer("Green clip",rect(20,20,100,140,"#00ff00")),top=createPathLayer("Blue clip",rect(80,0,240,192,"#0000ff"));
  middle.clipping=top.clipping=true;middle.opacity=.7;top.opacity=.85;
  if(mode==="masked") {base.maskSurface=new SparseAlphaSurface(320,192,{defaultAlpha:128});top.maskSurface=new SparseAlphaSurface(320,192,{defaultAlpha:180});base.vectorMask=rect(30,30,200,100,"#ffffff");}
  if(mode==="hidden-middle") middle.visible=false;
  doc.layers=[top,middle,base];return {doc,base,middle,top};
}

test("all clipped members resolve the same non-clipped base, not the adjacent member",()=>{
  const {doc,base,middle,top}=fixture("grouped");
  assert.equal(findClippingBase(doc,top),base);assert.equal(findClippingBase(doc,middle),base);
  base.path=rect(20,20,260,140,"#ff0000");base.opacity=base.fillOpacity=1;top.opacity=1;
  const canvas=testCanvas(320,192);renderClean(doc,canvas);
  assert.deepEqual([...canvas.getContext("2d")!.getImageData(200,80,1,1).data],[0,0,255,255],"upper clip must survive outside the narrower middle member");
});

const hasPoppler=(()=>{try{execFileSync("pdftoppm",["-v"],{stdio:"ignore",timeout:10000});return true;}catch{return false;}})();
for(const mode of ["grouped","separate","masked","hidden-middle"])test(`alpha clipping ${mode} exports with vector structure and independently matching PDF`,{skip:!hasPoppler&&"Poppler required"},async()=>{
  const {doc}=fixture(mode),svg=exportVectorSvg(doc);
  assert.match(svg,/mask-type:alpha/);assert.match(svg,/<path /);assert.doesNotMatch(svg,/<image/);
  const transparent=testCanvas(320,192);renderClean(doc,transparent);
  if(process.env.LUMA_DELIVERY_REVIEW_DIR){const dir=process.env.LUMA_DELIVERY_REVIEW_DIR;await mkdir(dir,{recursive:true});await writeFile(join(dir,`svg-clipping-${mode}.svg`),svg);await writeFile(join(dir,`svg-clipping-${mode}-source.png`),Buffer.from(transparent.toDataURL().split(",")[1],"base64"));}
  if(process.env.LUMA_DELIVERY_REVIEW_DIR) await writeFile(join(process.env.LUMA_DELIVERY_REVIEW_DIR,`svg-clipping-${mode}.luma`),new Uint8Array(await (await encodeLumaProject(doc, [], "Clipping reference")).arrayBuffer()));
  const directory=await mkdtemp(join(tmpdir(),"luma-alpha-clip-"));
  try{
    const pdf=await exportVectorPdf(doc),path=join(directory,"proof.pdf");await writeFile(path,pdf);
    execFileSync("pdftoppm",["-r","72","-singlefile","-png",path,join(directory,"render")],{timeout:10000});
    const actual=testCanvas(320,192),expected=testCanvas(320,192);actual.getContext("2d")!.drawImage(await loadImage(join(directory,"render.png")) as unknown as CanvasImageSource,0,0);
    const ctx=expected.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,320,192);ctx.drawImage(transparent,0,0);
    const a=actual.getContext("2d")!.getImageData(0,0,320,192).data,b=ctx.getImageData(0,0,320,192).data;
    let delta=0,changed=0,worst=0;for(let i=0;i<a.length;i+=4){let peak=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);delta+=d;peak=Math.max(peak,d);}if(peak>8)changed++;worst=Math.max(worst,peak);}
    const metrics={mean:delta/a.length,changedFraction:changed/(a.length/4),worst};
    if(process.env.LUMA_DELIVERY_REVIEW_DIR){const dir=process.env.LUMA_DELIVERY_REVIEW_DIR;await writeFile(join(dir,`clipping-${mode}.pdf`),pdf);await writeFile(join(dir,`clipping-${mode}-metrics.json`),JSON.stringify(metrics,null,2));await writeFile(join(dir,`clipping-${mode}-pdf.png`),Buffer.from(actual.toDataURL().split(",")[1],"base64"));}
    assert.ok(metrics.mean<=1.5&&metrics.changedFraction<=.025,JSON.stringify(metrics));
  }finally{await rm(directory,{recursive:true,force:true});}
});
