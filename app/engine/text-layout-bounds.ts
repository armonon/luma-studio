import { drawLayerContent, newCanvas, type Layer } from "./document";
import { fontResourceRevision } from "./bundled-fonts";

type Bounds = { x: number; y: number; width: number; height: number };
const cache = new Map<string, Bounds>();
let cachedBytes = 0;

/** Measure the actual canvas shaping/placement pipeline on a 1×1 context.
 * There is no character-count estimate, document-sized bitmap or second text
 * composer. Native shaping, bidi, rich runs, paths, tracking and transforms
 * are identical to preview. Call after pendingDocumentFonts for final layout.
 * A bounded ink pass corrects browser TextMetrics overhang/whitespace errors.
 * Layer effects are deliberately outside typographic layout bounds.
 */
export function textLayoutBounds(layer: Layer) {
  if (!layer.text) throw new Error("Text layout requires a text layer");
  if (layer.text.text.length > 100_000 || (layer.text.runs?.length ?? 0) > 4096) throw new Error("Text layout exceeds the bounded story budget");
  const key=JSON.stringify([layer.text,layer.transform,layer.spatial,fontResourceRevision(),typeof document!=="undefined"?document.fonts?.status:""]);
  const hit=cache.get(key);if(hit)return {...hit};
  const canvas = newCanvas(1, 1), context = canvas.getContext("2d")!;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (x: number, y: number, width: number, height: number, padding = 0) => {
    const m = context.getTransform();
    for (const [px, py] of [[x-padding,y-padding],[x+width+padding,y-padding],[x+width+padding,y+height+padding],[x-padding,y+height+padding]]) {
      const tx = m.a * px + m.c * py + m.e, ty = m.b * px + m.d * py + m.f;
      if (!Number.isFinite(tx + ty)) throw new Error("Invalid text layout bounds");
      left = Math.min(left, tx); top = Math.min(top, ty); right = Math.max(right, tx); bottom = Math.max(bottom, ty);
    }
  };
  let lineStart: [number, number] | undefined, lineEnd: [number, number] | undefined;
  const measured = new Proxy(context, {
    get(target, key) {
      if (key === "fillText" || key === "strokeText") return (text: string, x: number, y: number) => {
        if (!text || target.globalAlpha === 0) return;
        const metrics = target.measureText(text);
        if (![metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight, metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent].every(Number.isFinite)) throw new Error("This renderer does not expose accurate text metrics");
        if (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight > metrics.width + 10000) throw new Error("This renderer returned inconsistent text metrics; layout was not changed");
        include(x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent,
          metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
          key === "strokeText" ? target.lineWidth / 2 : 0);
      };
      if (key === "beginPath") return () => { lineStart = undefined; lineEnd = undefined; };
      if (key === "moveTo") return (x: number, y: number) => { lineStart = [x,y]; };
      if (key === "lineTo") return (x: number, y: number) => { lineEnd = [x,y]; };
      if (key === "stroke") return () => {
        if(lineStart&&lineEnd){const half=target.lineWidth/2,cap=target.lineCap==="butt"?0:half;
          // Text decorations are horizontal strokes. Butt caps do not extend
          // the ink past either endpoint, unlike a padded glyph rectangle.
          include(Math.min(lineStart[0],lineEnd[0])-cap,Math.min(lineStart[1],lineEnd[1])-half,Math.abs(lineEnd[0]-lineStart[0])+cap*2,Math.abs(lineEnd[1]-lineStart[1])+half*2);
        }
      };
      // Paint-span clips split color, never glyph geometry. Their union covers
      // the same shaped run; measuring it twice does not change the bounds.
      if (key === "clip" || key === "rect") return () => {};
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
  drawLayerContent(measured, layer);
  let bounds=left === Infinity ? { x: layer.transform.tx + layer.text.x, y: layer.transform.ty + layer.text.y, width: 0, height: 0 }
    : { x: left, y: top, width: right - left, height: bottom - top };
  if(bounds.width>0&&bounds.height>0){
    const originX=Math.floor(bounds.x)-4,originY=Math.floor(bounds.y)-4;
    const width=Math.ceil(bounds.x+bounds.width)-originX+4,height=Math.ceil(bounds.y+bounds.height)-originY+4;
    // At most 8 MiB of RGBA + 8 MiB readback, independently of document size.
    if(width>16384||height>16384||width*height>2*1024*1024)throw new Error("Text ink measurement exceeds the 2 MP layout budget; reduce the type size or split the text layer");
    canvas.width=width;canvas.height=height;
    try{
      // Preserve spatial projection but exclude depth shadows from type bounds.
      const spatial=layer.spatial??layer.text.spatial;
      const measuredLayer=spatial?{...layer,spatial:{...spatial,extrusion:{depth:0,bevel:0}}}:layer;
      drawLayerContent(context,measuredLayer,{a:1,b:0,c:0,d:1,e:-originX,f:-originY});
      const data=context.getImageData(0,0,width,height).data;
      let minX=width,minY=height,maxX=-1,maxY=-1;
      for(let row=0;row<height;row++)for(let col=0;col<width;col++)if(data[(row*width+col)*4+3]>0){minX=Math.min(minX,col);minY=Math.min(minY,row);maxX=Math.max(maxX,col);maxY=Math.max(maxY,row);}
      if(maxX>=0&&(minX===0||minY===0||maxX===width-1||maxY===height-1))throw new Error("Text ink exceeds the renderer's reported metrics; no layout was changed");
      bounds=maxX<0?{x:bounds.x,y:bounds.y,width:0,height:0}:{x:originX+minX,y:originY+minY,width:maxX-minX+1,height:maxY-minY+1};
    }finally{canvas.width=1;canvas.height=1;}
  }
  // Bound cache keys as well as entries; long editable stories cannot retain
  // an unbounded duplicate text history in the layout cache.
  if(key.length*2<=2*1024*1024){
    while(cache.size&&(cache.size>=64||cachedBytes+key.length*2>2*1024*1024)){const oldest=cache.keys().next().value!;cachedBytes-=oldest.length*2;cache.delete(oldest);}
    cache.set(key,bounds);cachedBytes+=key.length*2;
  }
  return {...bounds};
}
