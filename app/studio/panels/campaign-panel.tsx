"use client";

import { useEffect, useRef, useState } from "react";
import type { Studio } from "../../engine/studio";
import { DESIGN_SNAPSHOT_COMMANDS, type DesignSnapshotAction } from "../../engine/design-snapshots";
import { CAMPAIGN_COMMANDS, CAMPAIGN_FORMATS, campaignPreflight, campaignFormatRefusal, emptyCampaign, layerColor, validateCampaign, type CampaignAction, type ColorSlot, type DesignLink } from "../../engine/campaign";
import "./campaign-panel.css";

/** View state only. Every edit goes through Studio's transactional command route. */
export default function CampaignPanel({ studio, selectedIds, onChange, onNotify, onSave, onOpenType, onRecolor, onPrint }: {
  studio: Studio; selectedIds: string[]; onChange: () => void; onNotify: (message:string)=>void;
  onSave: (blob:Blob,name:string)=>Promise<unknown>; onOpenType:()=>void; onRecolor:()=>void;
  onPrint?:()=>void;
}) {
  const [tab,setTab]=useState("Brand");
  const [name,setName]=useState("Accent");const [value,setValue]=useState("#6979ff");const [colorId,setColorId]=useState("");
  const [slot,setSlot]=useState<ColorSlot>("fill");const [typeName,setTypeName]=useState("Heading");const [typeId,setTypeId]=useState("");
  const [boardId,setBoardId]=useState("");const [formats,setFormats]=useState<string[]>(["square","story"]);
  const [padding,setPadding]=useState(32);const [gap,setGap]=useState(24);const [direction,setDirection]=useState<"row"|"column">("column");
  const [wrap,setWrap]=useState(false);const [align,setAlign]=useState<"start"|"center"|"end">("start");
  const [replaceContent,setReplaceContent]=useState(false);const [boardWidth,setBoardWidth]=useState(1080);const [boardHeight,setBoardHeight]=useState(1080);
  const [columns,setColumns]=useState(3);const [rows,setRows]=useState(1);
  const [anchorX,setAnchorX]=useState<NonNullable<DesignLink["anchorX"]>>("scale");const [anchorY,setAnchorY]=useState<NonNullable<DesignLink["anchorY"]>>("scale");
  const [variantName,setVariantName]=useState("Direction A");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const doc=studio.doc,kit=doc.campaign??emptyCampaign(),layers=selectedIds.map(id=>studio.findLayer(id)).filter(l=>!!l);
  const unlocked=layers.length>0&&layers.every(l=>!studio.isLayerLocked(l.id));
  const textOnly=unlocked&&layers.every(l=>!!l.text),colorable=unlocked&&layers.every(l=>layerColor(l,slot)!==undefined);
  // Delivery preflight may measure many text objects. Do not perform it on
  // every keystroke in Brand/Layout/Variants, where its result is not shown.
  const issues=tab==="Deliver"?campaignPreflight(doc):[],boards=doc.artboards??[],selectedBoard=boards.find(a=>a.id===boardId)??boards[0];
  const formatRefusal=campaignFormatRefusal(doc,selectedIds);
  async function execute(action:CampaignAction){
    if(abort.current)return;
    const controller=new AbortController();abort.current=controller;setBusy(true);
    try{await studio.executeCampaignReady(action,controller.signal);if(!controller.signal.aborted){onChange();setMessage(CAMPAIGN_COMMANDS[action.kind].label);}}
    catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Campaign command failed");}
    finally{if(abort.current===controller){abort.current=null;setBusy(false);}}
  }
  async function snapshot(action:DesignSnapshotAction) {
    const controller=new AbortController();abort.current=controller;setBusy(true);setMessage(`${DESIGN_SNAPSHOT_COMMANDS[action.kind]}…`);
    try { await studio.executeDesignSnapshot(action,controller.signal);if(!controller.signal.aborted){onChange();setMessage(DESIGN_SNAPSHOT_COMMANDS[action.kind]);} }
    catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Variant failed");}
    finally{if(abort.current===controller){abort.current=null;setBusy(false);}}
  }
  const field=(title:string,child:React.ReactNode)=><label className="campaign-field"><span>{title}</span>{child}</label>;
  return <section className="campaign-panel" aria-label="Campaign workspace">
    <nav className="campaign-tabs" aria-label="Campaign sections">{["Brand","Layout","Variants","Deliver"].map(t=><button key={t} type="button" aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
    <p className="campaign-selection">{layers.length?`${layers.length} selected · ${layers.length===1?layers[0].name:"multiple layers"}`:"Select layers to link or arrange"}</p>
    <fieldset disabled={busy}>
    {tab==="Brand"&&<>
      <details><summary>Portable brand kit</summary><div className="campaign-row">
        <button type="button" disabled={!kit.colors.length&&!kit.types.length} onClick={async()=>{try{const saved=await onSave(new Blob([JSON.stringify({format:"luma-brand-kit",version:1,colors:kit.colors,types:kit.types},null,2)],{type:"application/json"}),"brand.lumabrand");if(saved!==false)setMessage("Brand kit exported");}catch(error){setMessage(error instanceof Error?error.message:"Export failed");}}}>Export kit</button>
        <label className="campaign-import">Import kit<input aria-label="Import brand kit" type="file" accept=".lumabrand,.json" onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;const owner=studio.doc;try{if(file.size>512*1024)throw new Error("Brand kit exceeds 512 KB");const input=JSON.parse(await file.text());if(input.format!=="luma-brand-kit"||input.version!==1)throw new Error("Unsupported brand kit");const imported=validateCampaign({...emptyCampaign(),colors:input.colors,types:input.types})!;if(studio.doc!==owner)throw new Error("Document changed while reading the brand kit");execute({kind:"brand-import",colors:imported.colors,types:imported.types});}catch(error){setMessage(error instanceof Error?error.message:"Import failed");}}}/></label>
      </div><small>Colors and typography recipes only; fonts and image assets are not embedded. Import adds new styles without replacing existing links.</small></details>
      <h3>Linked colors</h3>
      <div className="campaign-swatches">{kit.colors.map(c=><button type="button" key={c.id} title={`${c.name} · ${c.value}`} aria-label={`Edit ${c.name}`} aria-pressed={colorId===c.id} onClick={()=>{setColorId(c.id);setName(c.name);setValue(c.value);}}><span style={{background:c.value}}/>{c.name}</button>)}</div>
      {field("Name",<input aria-label="Brand color name" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/>)}
      {field("Color",<input aria-label="Brand color value" type="color" value={value} onChange={e=>setValue(e.target.value)}/>)}
      <div className="campaign-row"><button type="button" disabled={!name.trim()} onClick={()=>execute({kind:"color-save",id:colorId||undefined,name:name.trim(),value})}>{colorId?"Update linked color":"Save color"}</button><button type="button" onClick={()=>{setColorId("");setName("Accent");}}>New</button></div>
      {field("Target",<select aria-label="Color target" value={slot} onChange={e=>setSlot(e.target.value as ColorSlot)}><option value="fill">Text / vector fill</option><option value="stroke">Vector stroke</option><option value="front">3D front material</option><option value="side">3D side material</option></select>)}
      <button type="button" disabled={!colorId||!colorable} onClick={()=>execute({kind:"color-link",id:colorId,layerIds:selectedIds,slot})}>Link selected to color</button>
      <small>Updates preserve local overrides. Raster pixels use Recolor separately.</small>
      <button type="button" disabled={layers.length!==1||!layers[0]?.bitmap} onClick={onRecolor}>Open raster Recolor…</button>
      <h3>Reusable typography</h3>
      {field("Style",<select aria-label="Brand text style" value={typeId} onChange={e=>{setTypeId(e.target.value);setTypeName(kit.types.find(t=>t.id===e.target.value)?.name??"Heading");}}><option value="">New style</option>{kit.types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>)}
      {field("Name",<input aria-label="Text style name" maxLength={80} value={typeName} onChange={e=>setTypeName(e.target.value)}/>)}
      <div className="campaign-row"><button type="button" disabled={!textOnly||layers.length!==1||!typeName.trim()} onClick={()=>execute({kind:"type-save",id:typeId||undefined,name:typeName.trim(),layerId:layers[0].id})}>{typeId?"Update style":"Capture style"}</button><button type="button" disabled={!textOnly||!typeId} onClick={()=>execute({kind:"type-link",id:typeId,layerIds:selectedIds})}>Link selected</button></div>
      <small>Font, size, tracking, paragraph spacing, axes and OpenType settings. Character overrides remain editable.</small>
      <button type="button" disabled={!textOnly} onClick={onOpenType}>Type, appearance & 3D…</button>
      <button type="button" disabled={!unlocked||!kit.links.some(l=>selectedIds.includes(l.layerId))} onClick={()=>execute({kind:"unlink",layerIds:selectedIds})}>Detach selected design links</button>
    </>}
    {tab==="Layout"&&<>
      <h3>One design, multiple formats</h3>
      {field("Master",<select aria-label="Master artboard" value={boardId} onChange={e=>setBoardId(e.target.value)}><option value="">Current canvas</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>)}
      <div className="campaign-formats">{CAMPAIGN_FORMATS.map(f=><label key={f.id}><input type="checkbox" checked={formats.includes(f.id)} onChange={e=>setFormats(e.target.checked?[...formats,f.id]:formats.filter(id=>id!==f.id))}/><span>{f.name}<small>{f.width} × {f.height}</small></span></label>)}</div>
      <button type="button" title={formatRefusal??undefined} disabled={!unlocked||!formats.length||!!formatRefusal} onClick={()=>execute({kind:"format",formats,layerIds:selectedIds,sourceBoardId:boardId||undefined})}>Create linked formats</button>
      {formatRefusal&&<small>{formatRefusal}</small>}
      <small>Layers and complete groups stay editable, including clipping and masks. Canvas expands. Clear selections and detach embedded sources first.</small>
      <h3>Layout constraints</h3>
      {field("Horizontal origin",<select value={anchorX} onChange={e=>setAnchorX(e.target.value as typeof anchorX)}>{["scale","left","center","right"].map(v=><option key={v}>{v}</option>)}</select>)}
      {field("Vertical origin",<select value={anchorY} onChange={e=>setAnchorY(e.target.value as typeof anchorY)}>{["scale","top","center","bottom"].map(v=><option key={v}>{v}</option>)}</select>)}
      <button type="button" disabled={!unlocked} onClick={()=>execute({kind:"anchors",layerIds:selectedIds,x:anchorX,y:anchorY})}>Set selected origins</button>
      <label><input type="checkbox" checked={replaceContent} onChange={e=>setReplaceContent(e.target.checked)}/> Replace local content & appearance</label>
      <button type="button" disabled={!kit.links.some(l=>l.sourceId)} onClick={()=>execute({kind:"sync",replaceContent})}>{replaceContent?"Replace linked content & reflow":"Update linked text & layout"}</button>
      <small>{replaceContent?"Replaces component contents, nested groups, clipping, masks, appearance and brand bindings. Adds/removes master children. Local overrides are replaced; Undo restores them. Embedded sources must be detached first.":"Copies use contain scaling. Text and layout sync; local appearance and masks stay independent. Use replacement for hierarchy changes."}</small>
      <h3>Arrange within artboard</h3>
      {field("Artboard",<select aria-label="Arrange artboard" value={selectedBoard?.id??""} onChange={e=>setBoardId(e.target.value)}>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>)}
      {field("Direction",<select value={direction} onChange={e=>setDirection(e.target.value as typeof direction)}><option value="column">Column</option><option value="row">Row</option></select>)}
      {field("Alignment",<select aria-label="Layout alignment" value={align} onChange={e=>setAlign(e.target.value as typeof align)}><option value="start">Start</option><option value="center">Center</option><option value="end">End</option></select>)}
      <label><input type="checkbox" checked={wrap} onChange={e=>setWrap(e.target.checked)}/> Wrap objects onto new lines</label>
      {field("Inset / gap",<div className="campaign-row"><input aria-label="Layout inset" type="number" min={0} max={1000} value={padding} onChange={e=>setPadding(e.target.valueAsNumber)}/><input aria-label="Layout gap" type="number" min={0} max={1000} value={gap} onChange={e=>setGap(e.target.valueAsNumber)}/></div>)}
      <button type="button" disabled={!unlocked||!selectedBoard||!Number.isFinite(padding)||!Number.isFinite(gap)} onClick={()=>execute({kind:"flow",layerIds:selectedIds,boardId:selectedBoard!.id,direction,padding,gap,wrap,align})}>Arrange & save layout</button>
      <small>Reflow uses the canvas renderer’s shaped text bounds after fonts load. Layer effects and 3D shadows may extend beyond the measured ink.</small>
      <div className="campaign-row"><button type="button" disabled={!kit.layouts?.length} onClick={()=>execute({kind:"reflow"})}>Reflow saved layouts</button><button type="button" disabled={!kit.layouts?.some(l=>l.boardId===selectedBoard?.id)} onClick={()=>execute({kind:"layout-remove",boardId:selectedBoard!.id})}>Detach layout</button></div>
      <details><summary>Resize selected artboard</summary>
      {field("Width / height",<div className="campaign-row"><input aria-label="Artboard width" type="number" min={1} value={boardWidth} onChange={e=>setBoardWidth(e.target.valueAsNumber)}/><input aria-label="Artboard height" type="number" min={1} value={boardHeight} onChange={e=>setBoardHeight(e.target.valueAsNumber)}/></div>)}
      <button type="button" disabled={!selectedBoard||![boardWidth,boardHeight].every(n=>Number.isSafeInteger(n)&&n>0)} onClick={()=>execute({kind:"board-resize",boardId:selectedBoard!.id,width:boardWidth,height:boardHeight})}>Resize & reflow</button><small>Must fit inside the current canvas. Linked layers use their origin constraints; saved layouts are reapplied.</small></details>
      <h3>Grid & margins</h3>
      {field("Columns / rows",<div className="campaign-row"><input aria-label="Grid columns" type="number" min={1} max={24} value={columns} onChange={e=>setColumns(e.target.valueAsNumber)}/><input aria-label="Grid rows" type="number" min={1} max={24} value={rows} onChange={e=>setRows(e.target.valueAsNumber)}/></div>)}
      <button type="button" disabled={![columns,rows,padding,gap].every(Number.isFinite)} onClick={()=>execute({kind:"grid",boardId:boardId||undefined,columns,rows,margin:padding,gutter:gap})}>Add grid guides</button>
      <small>Uses the Master choice and inset/gap above. Existing guides are preserved; enable Guides and Snap in the canvas controls.</small>
    </>}
    {tab==="Variants"&&<>
      <h3>Explore directions safely</h3>
      {field("Name",<input aria-label="Design variant name" maxLength={80} value={variantName} onChange={e=>setVariantName(e.target.value)}/>)}
      <button type="button" disabled={!variantName.trim()||(doc.designSnapshots?.length??0)>=6} onClick={()=>void snapshot({kind:"capture",name:variantName.trim()})}>Capture full variant</button>
      <small>Includes pixels, masks, geometry, text, 3D and document settings. Apply replaces the document state and is undoable. Up to six variants / 128 MiB of archives; capture and restore also require available working memory.</small>
      {!doc.designSnapshots?.length&&<p>No full variants yet.</p>}
      {doc.designSnapshots?.map(v=><div className="campaign-variant" key={v.id}><span>{v.name}<small>{(v.bytes.byteLength/1024/1024).toFixed(1)} MiB · full document</small></span><button type="button" aria-label={`Apply full variant ${v.name}`} onClick={()=>void snapshot({kind:"apply",id:v.id})}>Apply</button><button type="button" aria-label={`Delete full variant ${v.name}`} onClick={()=>void snapshot({kind:"delete",id:v.id})}>×</button></div>)}
      <details><summary>Lightweight style variants</summary>
      <button type="button" disabled={!variantName.trim()||kit.variants.length>=12} onClick={()=>execute({kind:"variant-save",name:variantName.trim()})}>Capture style variant</button>
      <small>Only layout, visibility, opacity, linked colors and text. Excludes pixels, geometry and masks.</small>
      {kit.variants.map(v=><div className="campaign-variant" key={v.id}><span>{v.name}<small>{v.layers.length} layers</small></span><button type="button" aria-label={`Apply ${v.name}`} onClick={()=>execute({kind:"variant-apply",id:v.id})}>Apply</button><button type="button" aria-label={`Delete ${v.name}`} onClick={()=>execute({kind:"variant-delete",id:v.id})}>×</button></div>)}
      </details>
    </>}
    {tab==="Deliver"&&<>
      <button type="button" disabled={!onPrint} onClick={onPrint}>CMYK print proof…</button>
      <small>{onPrint?"Exports the whole document through the native ICC pipeline with your printer profile. Flattened proof PDF, not certified PDF/X. Printer preflight and proof approval remain required.":"CMYK proof export requires the desktop edition and your printer's ICC profile."}</small>
      <h3>Delivery preflight</h3><p>{boards.length} artboards · flattened PNG + manifest</p>
      <ul className="campaign-issues">{issues.map((issue,i)=><li key={i} data-severity={issue.severity}>{issue.severity==="error"?"Fix: ":"Check: "}{issue.message}</li>)}</ul>
      <small>Up to 12 artboards, 4 MP each, within available memory. Save the editable .luma master separately. Not a print certification.</small>
      <button type="button" disabled={issues.some(i=>i.severity==="error")} onClick={async()=>{
        const controller=new AbortController();abort.current=controller;setBusy(true);setMessage("Preparing artboards…");
        try{const blob=await studio.exportCampaign(controller.signal);if(controller.signal.aborted)return;const saved=await onSave(blob,"luma-campaign.zip");if(saved!==false){setMessage("Campaign package exported");onNotify("Campaign package exported");}}
        catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Delivery failed");}
        finally{if(abort.current===controller){abort.current=null;setBusy(false);}}
      }}>Export campaign ZIP</button>
    </>}
    </fieldset>
    {busy&&<button type="button" onClick={()=>{abort.current?.abort();setMessage("Cancelling after current operation…");}}>Cancel operation</button>}
    {message&&<p role="status" className="campaign-message">{message}</p>}
  </section>;
}
