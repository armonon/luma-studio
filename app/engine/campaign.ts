import { affineForLayerTransform, reserveId, type Artboard, type Document, type Layer, type TextStyle, type TextRunStyle, type Transform } from "./document";
import { vectorPathBounds } from "./vector-path";
import { textLayoutBounds } from "./text-layout-bounds";
import { componentTree, mapComponentMasks, type MaskWorkBudget } from "./campaign-components";

export type BrandColor = { id: string; name: string; value: string };
export type TypeRecipe = Pick<TextStyle, "font" | "align" | "lineHeight" | "tracking" | "paragraphSpacing" | "defaultStyle">;
export type BrandType = { id: string; name: string; value: TypeRecipe };
export type ColorSlot = "fill" | "stroke" | "front" | "side";
export type DesignLink = {
  layerId: string; colorId?: string; slot?: ColorSlot; appliedColor?: string;
  typeId?: string; appliedType?: TypeRecipe;
  sourceId?: string; boardId?: string;
  /** Target root owning a synchronized subtree, including the root itself. */
  componentId?: string;
  anchorX?: "scale" | "left" | "center" | "right";
  anchorY?: "scale" | "top" | "center" | "bottom";
};
export type DesignVariant = {
  id: string; name: string; colors: BrandColor[]; types: BrandType[];
  links: DesignLink[];
  layers: Array<{ id: string; transform: Transform; visible: boolean; opacity: number; color?: string; slot?: ColorSlot; type?: TypeRecipe; text?: string; runs?: TextStyle["runs"]; paragraphs?: TextStyle["paragraphs"] }>;
};
export type DesignLayout = { boardId: string; layerIds: string[]; direction: "row" | "column"; padding: number; gap: number; wrap?: boolean; align?: "start" | "center" | "end" };
export type Campaign = { version: 1; colors: BrandColor[]; types: BrandType[]; links: DesignLink[]; variants: DesignVariant[]; layouts?: DesignLayout[] };
export const emptyCampaign = (): Campaign => ({ version: 1, colors: [], types: [], links: [], variants: [] });
export type CampaignAction =
  | {kind:"color-save";id?:string;name:string;value:string}
  | {kind:"brand-import";colors:BrandColor[];types:BrandType[]}
  | {kind:"color-link";id:string;layerIds:string[];slot:ColorSlot}
  | {kind:"type-save";id?:string;name:string;layerId:string}
  | {kind:"type-link";id:string;layerIds:string[]}
  | {kind:"unlink";layerIds:string[]}
  | {kind:"format";formats:string[];layerIds:string[];sourceBoardId?:string}
  | ({kind:"flow"} & DesignLayout)
  | {kind:"reflow";boardId?:string}
  | {kind:"layout-remove";boardId:string}
  | {kind:"board-resize";boardId:string;width:number;height:number}
  | {kind:"grid";boardId?:string;columns:number;rows:number;margin:number;gutter:number}
  | {kind:"anchors";layerIds:string[];x:NonNullable<DesignLink["anchorX"]>;y:NonNullable<DesignLink["anchorY"]>}
  | {kind:"sync";sourceBoardId?:string;replaceContent?:boolean}
  | {kind:"variant-save";name:string}
  | {kind:"variant-apply";id:string}
  | {kind:"variant-delete";id:string};
export const CAMPAIGN_COMMANDS:Record<CampaignAction["kind"],{label:string;shortcut:string}>={
  "color-save":{label:"Save brand color",shortcut:""},"color-link":{label:"Link brand color",shortcut:""},
  "brand-import":{label:"Import brand kit",shortcut:""},
  "type-save":{label:"Capture text style",shortcut:""},"type-link":{label:"Link text style",shortcut:""},
  unlink:{label:"Detach design links",shortcut:""},format:{label:"Create linked formats",shortcut:""},
  flow:{label:"Arrange layout",shortcut:""},anchors:{label:"Set layout anchors",shortcut:""},sync:{label:"Update linked formats",shortcut:""},
  grid:{label:"Create layout grid",shortcut:""},
  reflow:{label:"Reflow saved layouts",shortcut:""},"layout-remove":{label:"Detach saved layout",shortcut:""},"board-resize":{label:"Resize design artboard",shortcut:""},
  "variant-save":{label:"Save design variant",shortcut:""},"variant-apply":{label:"Apply design variant",shortcut:""},"variant-delete":{label:"Delete design variant",shortcut:""},
};
export const CAMPAIGN_FORMATS = [
  {id:"square",name:"Square",width:1080,height:1080},
  {id:"portrait",name:"Portrait",width:1080,height:1350},
  {id:"story",name:"Story",width:1080,height:1920},
  {id:"landscape",name:"Landscape",width:1920,height:1080},
  {id:"banner",name:"Banner",width:1600,height:600},
  {id:"poster",name:"Poster",width:1400,height:2000},
] as const;

const color = (value: unknown): value is string => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,100}$/.test(value);
const name = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 80;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
function validRun(style: TextRunStyle) {
  if(!style || typeof style!=="object")throw new Error("Invalid campaign character style");
  for(const [key,value] of Object.entries(style)) {
    if(value===undefined)continue;
    if(["axes","features"].includes(key)) {
      if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length>64||Object.entries(value).some(([tag,v])=>!/^\w{4}$/.test(tag)||(key==="axes"?!finite(v,-10000,10000):typeof v!=="boolean")))throw new Error("Invalid campaign OpenType settings");
    }else if(["fontFamily","color","fontStyle","decoration"].includes(key)) {
      if(typeof value!=="string"||value.length>300)throw new Error("Invalid campaign character style");
    }else if(!["fontSize","fontWeight","fontStretch","tracking","baselineShift"].includes(key)||!finite(value,-10000,10000))throw new Error("Invalid campaign character style");
  }
  if(style.fontSize!==undefined&&!finite(style.fontSize,1,4096))throw new Error("Invalid campaign font size");
}
function validType(value: TypeRecipe) {
  if (!value || typeof value.font !== "string" || value.font.length > 300 || !/\d+(?:\.\d+)?px\s+.+$/.test(value.font) ||
      Object.keys(value).some(k=>!["font","align","lineHeight","tracking","paragraphSpacing","defaultStyle"].includes(k)) || !finite(Number(value.font.match(/(\d+(?:\.\d+)?)px/)?.[1]),1,4096) ||
      !["left","right","center","start","end"].includes(value.align) || !finite(value.lineHeight,.5,5) ||
      (value.tracking!==undefined&&!finite(value.tracking,-1000,10000)) || (value.paragraphSpacing!==undefined&&!finite(value.paragraphSpacing,0,10))) throw new Error("Invalid campaign typography");
  if(value.defaultStyle)validRun(value.defaultStyle);
}
export function validateCampaign(input: Campaign | undefined): Campaign | undefined {
  if (input===undefined)return undefined;
  if (!input || input.version!==1 || !Array.isArray(input.colors)||!Array.isArray(input.types)||!Array.isArray(input.links)||!Array.isArray(input.variants) ||
      input.colors.length>64||input.types.length>64||input.links.length>1024||input.variants.length>12 || JSON.stringify(input).length>2_000_000)throw new Error("Campaign exceeds its metadata limits");
  const checkColors=(values:BrandColor[])=>{if(!Array.isArray(values)||values.length>64||values.some(v=>!v||!id(v.id)||!name(v.name)||!color(v.value))||new Set(values.map(v=>v.id)).size!==values.length)throw new Error("Invalid brand colors");};
  const checkTypes=(values:BrandType[])=>{if(!Array.isArray(values)||values.length>64||values.some(v=>!v||!id(v.id)||!name(v.name))||new Set(values.map(v=>v.id)).size!==values.length)throw new Error("Invalid text styles");values.forEach(v=>validType(v.value));};
  checkColors(input.colors);checkTypes(input.types);
  if(input.layouts!==undefined) {
    if(!Array.isArray(input.layouts)||input.layouts.length>128||new Set(input.layouts.map(l=>l?.boardId)).size!==input.layouts.length)throw new Error("Invalid saved layouts");
    for(const layout of input.layouts) {
      if(!layout||!id(layout.boardId)||!Array.isArray(layout.layerIds)||!layout.layerIds.length||layout.layerIds.length>128||layout.layerIds.some(v=>!id(v))||new Set(layout.layerIds).size!==layout.layerIds.length||!["row","column"].includes(layout.direction)||![layout.padding,layout.gap].every(n=>finite(n,0,1000))||(layout.wrap!==undefined&&typeof layout.wrap!=="boolean")||(layout.align!==undefined&&!["start","center","end"].includes(layout.align)))throw new Error("Invalid saved layout");
    }
    const members=input.layouts.flatMap(l=>l.layerIds);if(new Set(members).size!==members.length)throw new Error("A layer cannot belong to multiple saved layouts");
  }
  for(const link of input.links) {
    if(!link||!id(link.layerId)||[link.sourceId,link.boardId,link.colorId,link.typeId,link.componentId].some(v=>v!==undefined&&!id(v)) ||
      (link.colorId&&!input.colors.some(v=>v.id===link.colorId)) || (link.typeId&&!input.types.some(v=>v.id===link.typeId)) ||
      (link.slot!==undefined&&!["fill","stroke","front","side"].includes(link.slot)) || (link.appliedColor!==undefined&&!color(link.appliedColor)) ||
      (link.anchorX!==undefined&&!["scale","left","center","right"].includes(link.anchorX)) || (link.anchorY!==undefined&&!["scale","top","center","bottom"].includes(link.anchorY)))throw new Error("Invalid design link");
    if(link.appliedType)validType(link.appliedType);
  }
  for(const link of input.links)if(link.componentId&&!input.links.some(root=>root.layerId===link.componentId&&root.componentId===root.layerId&&root.sourceId&&root.boardId===link.boardId))throw new Error("Invalid component ownership");
  if(new Set(input.links.map(v=>v.layerId)).size!==input.links.length || new Set(input.variants.map(v=>v.id)).size!==input.variants.length)throw new Error("Duplicate campaign identity");
  for(const variant of input.variants) {
    if(!variant||!id(variant.id)||!name(variant.name)||!Array.isArray(variant.layers)||variant.layers.length>1024||new Set(variant.layers.map(l=>l?.id)).size!==variant.layers.length)throw new Error("Invalid design variant");
    checkColors(variant.colors);checkTypes(variant.types);
    validateCampaign({...emptyCampaign(),colors:variant.colors,types:variant.types,links:variant.links});
    for(const layer of variant.layers) {
      if(!layer||!id(layer.id)||typeof layer.visible!=="boolean"||!finite(layer.opacity,0,1)||!layer.transform||
         !Object.values(layer.transform).every(v=>finite(v,-1_000_000,1_000_000))||!["tx","ty","sx","sy","rotation"].every(k=>Number.isFinite(layer.transform[k as keyof Transform]))||
         (layer.color!==undefined&&!color(layer.color))||(layer.text!==undefined&&(typeof layer.text!=="string"||layer.text.length>100_000))||
         (layer.slot!==undefined&&!["fill","stroke","front","side"].includes(layer.slot)))throw new Error("Invalid variant layer");
      if(layer.type)validType(layer.type);
      if(layer.runs){if(!Array.isArray(layer.runs)||layer.runs.length>4096)throw new Error("Invalid variant text runs");for(const run of layer.runs){if(!finite(run.start,0,layer.text?.length??0)||!finite(run.end,run.start,layer.text?.length??0))throw new Error("Invalid variant text run range");validRun(run.style);}}
      if(layer.paragraphs && (!Array.isArray(layer.paragraphs)||layer.paragraphs.length>4096||layer.paragraphs.some(p=>!p||!finite(p.start,0,layer.text?.length??0)||!finite(p.end,p.start,layer.text?.length??0))))throw new Error("Invalid variant paragraphs");
      for(const p of layer.paragraphs??[]) {
        if(!p.style||typeof p.style!=="object")throw new Error("Invalid variant paragraph style");
        for(const [key,value] of Object.entries(p.style)) {
          if(value===undefined)continue;
          const valid=key==="align"?["left","center","right","justify"].includes(value as string):key==="direction"?["auto","ltr","rtl"].includes(value as string):key==="hyphenate"?typeof value==="boolean":key==="lineHeight"?finite(value,.5,5):["spaceBefore","spaceAfter","firstLineIndent","startIndent","endIndent"].includes(key)&&finite(value,-10000,10000);
          if(!valid)throw new Error("Invalid variant paragraph style");
        }
      }
    }
  }
  return structuredClone(input);
}
export function remapCampaign(input: Campaign | undefined, ids?: Map<string,string>) {
  const result=validateCampaign(input);if(!result)return result;
  [...result.colors,...result.types,...result.variants].forEach(v=>reserveId(v.id));
  if(!ids)return result;
  result.layouts=result.layouts?.map(layout=>({...layout,layerIds:layout.layerIds.map(id=>ids.get(id)??id)}));
  result.links=result.links.map(link=>({...link,layerId:ids.get(link.layerId)??link.layerId,sourceId:link.sourceId?(ids.get(link.sourceId)??link.sourceId):undefined,componentId:link.componentId?(ids.get(link.componentId)??link.componentId):undefined}));
  result.variants.forEach(v=>{v.layers.forEach(l=>{l.id=ids.get(l.id)??l.id;});v.links=v.links.map(l=>({...l,layerId:ids.get(l.layerId)??l.layerId,sourceId:l.sourceId?(ids.get(l.sourceId)??l.sourceId):undefined,componentId:l.componentId?(ids.get(l.componentId)??l.componentId):undefined}));});return result;
}
export function textRecipe(text: TextStyle): TypeRecipe {
  const defaultStyle=text.defaultStyle?{...text.defaultStyle}:undefined;
  if(defaultStyle)delete defaultStyle.color;
  return structuredClone({font:text.font,align:text.align,lineHeight:text.lineHeight,tracking:text.tracking,paragraphSpacing:text.paragraphSpacing,defaultStyle});
}
export function layerColor(layer: Layer, slot: ColorSlot="fill") {
  if(slot==="front"||slot==="side")return (layer.text?.spatial??layer.spatial)?.material[slot==="front"?"frontColor":"sideColor"];
  if(layer.text?.appearance){const paints=slot==="fill"?layer.text.appearance.fills:layer.text.appearance.strokes;const colors=paints.filter(p=>p.enabled).map(p=>p.color);return colors.length&&colors.every(c=>c===colors[0])?colors[0]:undefined;}
  if(layer.path?.appearance){const colors=layer.path.appearance.filter(p=>p.enabled&&p.kind===slot).map(p=>p.color);return colors.length&&colors.every(c=>c===colors[0])?colors[0]:undefined;}
  if(layer.text)return slot==="fill"?(layer.text.defaultStyle?.color??layer.text.color):undefined;
  return layer.path?.[slot]??layer.shape?.[slot];
}
export function setLayerColor(layer: Layer, value:string, slot:ColorSlot="fill") {
  if(layer.path?.symbolId)throw new Error("Detach the vector symbol before assigning an independent campaign color");
  if(!color(value)||layerColor(layer,slot)===undefined)throw new Error("This layer has no editable color in that slot. Raster colors use Recolor.");
  if(slot==="front"||slot==="side") {
    const spatial=structuredClone(layer.text?.spatial??layer.spatial)!;spatial.material[slot==="front"?"frontColor":"sideColor"]=value;
    if(layer.text)layer.text={...layer.text,spatial};else layer.spatial=spatial;
  }else if(layer.text){
    const text=layer.text;
    layer.text={...text,...(slot==="fill"?{color:value,defaultStyle:{...text.defaultStyle,color:value},runs:text.runs?.map(r=>({...r,style:{...r.style,...(r.style.color?{color:value}:{})}}))}:{}),appearance:text.appearance?{...text.appearance,[slot==="fill"?"fills":"strokes"]:text.appearance[slot==="fill"?"fills":"strokes"].map(p=>p.enabled?{...p,color:value}:p)}:undefined};
  }
  else if(layer.shape)layer.shape={...layer.shape,[slot]:value};
  else if(layer.path)layer.path={...layer.path,[slot]:value,appearance:layer.path.appearance?.map(p=>p.kind===slot?{...p,color:value}:p)};
}
export function layerBox(layer:Layer) {
  if(layer.text)return textLayoutBounds(layer);
  let x=0,y=0,width=layer.bitmap?.width??layer.surface?.grid.width??0,height=layer.bitmap?.height??layer.surface?.grid.height??0;
  if(layer.shape){x=layer.shape.x;y=layer.shape.y;width=layer.shape.w;height=layer.shape.h;}
  if(layer.path){const bounds=vectorPathBounds(layer.path);x=bounds.x;y=bounds.y;width=bounds.width;height=bounds.height;}
  const a=affineForLayerTransform(layer.transform),points=[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].map(([px,py])=>({x:a.a*px+a.c*py+a.e,y:a.b*px+a.d*py+a.f}));
  return {x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};
}
/** Deterministic, bounded row/column wrapping. Call on staged layers only. */
export function applyDesignLayout(doc:Document,layout:DesignLayout,maskBudget?:MaskWorkBudget) {
  const board=doc.artboards?.find(b=>b.id===layout.boardId);if(!board)throw new Error("Saved layout artboard is missing");
  const row=layout.direction==="row",main=(row?board.width:board.height)-2*layout.padding,cross=(row?board.height:board.width)-2*layout.padding;
  if(main<=0||cross<=0)throw new Error("These objects do not fit: layout inset exceeds the artboard");
  const items=layout.layerIds.map(id=>{
    const layer=doc.layers.find(l=>l.id===id);if(!layer)throw new Error("A saved layout layer is missing; detach or rebuild the layout");
    if(layer.parentId||layer.kind==="group"||layer.clipping)throw new Error("Saved layouts require standalone layers");
    const box=layerBox(layer);return{layer,box,size:row?box.width:box.height,cross:row?box.height:box.width};
  });
  const lines:Array<{items:typeof items;size:number;cross:number}>=[];
  for(const item of items){
    if(!Number.isFinite(item.size+item.cross)||item.size>main||item.cross>cross)throw new Error("These objects do not fit with the chosen spacing; no layout was changed");
    let line=lines.at(-1);
    if(!line||(layout.wrap&&line.size+layout.gap+item.size>main)){line={items:[],size:0,cross:0};lines.push(line);}
    line.size+=(line.items.length?layout.gap:0)+item.size;line.cross=Math.max(line.cross,item.cross);line.items.push(item);
    if(line.size>main)throw new Error("These objects do not fit with the chosen spacing; no layout was changed");
  }
  if(lines.reduce((n,l)=>n+l.cross,0)+Math.max(0,lines.length-1)*layout.gap>cross)throw new Error("These objects do not fit with the chosen spacing; no layout was changed");
  let crossCursor=0;
  for(const line of lines){let cursor=layout.align==="center"?(main-line.size)/2:layout.align==="end"?main-line.size:0;
    for(const item of line.items){const x=board.x+layout.padding+(row?cursor:crossCursor),y=board.y+layout.padding+(row?crossCursor:cursor);
      const dx=x-item.box.x,dy=y-item.box.y;
      if(maskBudget)mapComponentMasks(item.layer,doc.width,doc.height,doc.width,doc.height,{scale:1,dx,dy},maskBudget);
      item.layer.transform={...item.layer.transform,tx:item.layer.transform.tx+dx,ty:item.layer.transform.ty+dy};cursor+=item.size+layout.gap;}
    crossCursor+=line.cross+layout.gap;
  }
}
export function adaptTransform(source:Transform,from:Artboard,to:Artboard,link:DesignLink):Transform {
  const scale=Math.min(to.width/from.width,to.height/from.height),dx=source.tx-from.x,dy=source.ty-from.y;
  const x=link.anchorX==="left"?dx:link.anchorX==="right"?to.width-(from.width-dx):link.anchorX==="center"?to.width/2+dx-from.width/2:dx*scale+(to.width-from.width*scale)/2;
  const y=link.anchorY==="top"?dy:link.anchorY==="bottom"?to.height-(from.height-dy):link.anchorY==="center"?to.height/2+dy-from.height/2:dy*scale+(to.height-from.height*scale)/2;
  return {...source,tx:to.x+x,ty:to.y+y,sx:source.sx*scale,sy:source.sy*scale};
}
export type CampaignIssue={severity:"error"|"warning";message:string;layerId?:string};
export function campaignFormatRefusal(doc:Document,layerIds:string[]):string|null {
  if(!layerIds.length||layerIds.length>128||new Set(layerIds).size!==layerIds.length)return "Select 1–128 distinct layers";
  const layers=layerIds.map(id=>doc.layers.find(l=>l.id===id));if(layers.some(l=>!l))return "Selected design layer is missing";
  if(doc.selection||doc.alphaChannels?.length)return "Clear selections and save/detach alpha channels before expanding the campaign canvas";
  try{componentTree(doc,layerIds);}catch(error){return error instanceof Error?error.message:"Invalid component";}
  return null;
}
export function campaignPreflight(doc:Document):CampaignIssue[] {
  const issues:CampaignIssue[]=[];
  if(!doc.artboards?.length)issues.push({severity:"error",message:"Add an artboard before delivering a campaign."});
  for(const board of doc.artboards??[]) {
    if(board.width*board.height>4_000_000)issues.push({severity:"error",message:`${board.name}: campaign delivery is bounded to 4 MP per artboard.`});
    if(board.x<0||board.y<0||board.x+board.width>doc.width||board.y+board.height>doc.height)issues.push({severity:"error",message:`${board.name}: artboard lies outside the document.`});
  }
  for(const link of doc.campaign?.links??[]) {
    const layer=doc.layers.find(l=>l.id===link.layerId);if(!layer){issues.push({severity:"warning",message:"A linked design layer was deleted."});continue;}
    if(link.sourceId&&!doc.layers.some(l=>l.id===link.sourceId))issues.push({severity:"error",message:`${layer.name}: linked source is missing.`,layerId:layer.id});
    if(link.colorId&&layerColor(layer,link.slot)!==link.appliedColor)issues.push({severity:"warning",message:`${layer.name}: local color override is preserved.`,layerId:layer.id});
    const board=doc.artboards?.find(a=>a.id===link.boardId);
    try{const box=layerBox(layer);if(board&&(box.x<board.x||box.y<board.y||box.x+box.width>board.x+board.width||box.y+box.height>board.y+board.height))issues.push({severity:"warning",message:`${layer.name}: content bounds exceed ${board.name}; inspect overflow.`,layerId:layer.id});}
    catch(error){issues.push({severity:"error",message:`${layer.name}: ${error instanceof Error?error.message:"Unable to measure text"}`,layerId:layer.id});}
    if(layer.bitmap&&(Math.abs(layer.transform.sx)>1||Math.abs(layer.transform.sy)>1))issues.push({severity:"warning",message:`${layer.name}: raster is enlarged beyond native pixels.`,layerId:layer.id});
  }
  if(doc.layers.some(l=>l.text))issues.push({severity:"warning",message:"Verify font availability and shaping on the delivery machine. PNG delivery rasterizes text."});
  if(doc.colorSpace!=="srgb"||doc.bitDepth!==8)issues.push({severity:"warning",message:"Campaign PNG delivery converts to 8-bit sRGB; the project retains its master settings."});
  issues.push({severity:"warning",message:"PNG campaign output is RGB, not certified CMYK/PDF-X print delivery."});return issues;
}
