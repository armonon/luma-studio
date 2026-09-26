"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pipette, Plus, RotateCcw, X } from "lucide-react";
import { DEFAULT_RECOLOR, recolorPixels, validateRecolor, type RecolorParams } from "../engine/recolor";
import type { RecolorOutput, RecolorSession, RecolorProgress } from "../engine/recolor-target";
import type { SelectionMode } from "../engine/selection";

type Preset = { name: string; params: RecolorParams };
const PRESETS_KEY="luma.recolor.presets.v1";
function readPresets(): Preset[] {
  try {
    const data: unknown=JSON.parse(localStorage.getItem(PRESETS_KEY)??"[]");
    if(!Array.isArray(data))return [];
    return data.slice(0,12).filter(p=>p && typeof p.name==="string" && p.name.length<=40).map(p=>({name:p.name,params:validateRecolor(p.params)}));
  } catch {return [];}
}
function Slider({label,value,min=0,max=100,onChange}:{label:string;value:number;min?:number;max?:number;onChange:(value:number)=>void}) {
  return <label className="recolor-slider"><span>{label}</span><input type="range" aria-label={label} min={min} max={max} step="1" value={Math.round(value)} onChange={e=>onChange(Number(e.target.value))}/><output>{Math.round(value)}</output></label>;
}

export default function RecolorDialog({session,onApply:applyOutput,onClose}:{session:RecolorSession;onApply:(params:RecolorParams,output:RecolorOutput,selectionMode:SelectionMode,progress:RecolorProgress)=>Promise<void>;onClose:()=>void}) {
  const [params,setParams]=useState<RecolorParams>(()=>validateRecolor(DEFAULT_RECOLOR));
  const [view,setView]=useState<"result"|"original"|"mask">("result");
  const [sample,setSample]=useState<"target"|"protect">("target");
  const [color,setColor]=useState("#ff0000");
  const [output,setOutput]=useState<RecolorOutput>("copy");
  const [selectionMode,setSelectionMode]=useState<SelectionMode>("replace");
  const [result,setResult]=useState<ReturnType<typeof recolorPixels>>();
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [previewBusy,setPreviewBusy]=useState(false);
  const [percent,setPercent]=useState(0), abort=useRef<AbortController|null>(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const onApply=(params:RecolorParams,output:RecolorOutput,mode:SelectionMode)=>{
    abort.current=new AbortController();setPercent(0);
    return applyOutput(params,output,mode,{signal:abort.current.signal,onProgress:fraction=>setPercent(Math.round(fraction*100))});
  };
  const [presets,setPresets]=useState(readPresets);const [presetName,setPresetName]=useState("");
  const root=useRef<HTMLElement>(null), canvas=useRef<HTMLCanvasElement>(null);
  const patch=(value:Partial<RecolorParams>)=>setParams(current=>({...current,...value}));
  const addColor=(value:string)=>{
    const key=sample==="target"?"colors":"protectedColors",limit=sample==="target"?16:8;
    setColor(value);
    setParams(p=>p[key].includes(value)||p[key].length>=limit?p:{...p,[key]:[...p[key],value]});
  };
  const palette=useMemo(()=>{
    const buckets=new Map<string,{color:string;count:number}>(); const data=session.preview.data;
    for(let i=0;i<data.length;i+=16){if(data[i+3]<128)continue;const key=[data[i]>>4,data[i+1]>>4,data[i+2]>>4].join(":");
      const hit=buckets.get(key);if(hit)hit.count++;else buckets.set(key,{color:"#"+[data[i],data[i+1],data[i+2]].map(v=>v.toString(16).padStart(2,"0")).join(""),count:1});}
    return [...buckets.values()].sort((a,b)=>b.count-a.count).slice(0,8);
  },[session]);
  useEffect(()=>{
    const previous=document.activeElement;root.current?.focus();
    return ()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    let cancelled=false,worker:Worker|undefined;
    const timer=setTimeout(()=>{
      setPreviewBusy(true);setError("");
      const done=(value:ReturnType<typeof recolorPixels>)=>{if(!cancelled){setResult(value);setPreviewBusy(false);}};
      try {
        if(typeof Worker==="undefined"){done(recolorPixels(session.preview.data,params,session.selection));return;}
        worker=new Worker(new URL("./recolor.worker.ts",import.meta.url),{type:"module"});
        worker.onmessage=event=>{if(cancelled)return;if(event.data.error){setError(event.data.error);setPreviewBusy(false);}else done(event.data);worker?.terminate();};
        worker.onerror=()=>{if(!cancelled){setError("Recolor preview could not be computed");setPreviewBusy(false);}worker?.terminate();};
        worker.postMessage({pixels:session.preview.data,params,selection:session.selection});
      }catch(reason){if(!cancelled){setError(reason instanceof Error?reason.message:"Preview failed");setPreviewBusy(false);}}
    },80);
    return ()=>{cancelled=true;clearTimeout(timer);worker?.terminate();};
  },[params,session]);
  useEffect(()=>{
    const target=canvas.current;if(!target)return;
    target.width=session.preview.width;target.height=session.preview.height;
    const ctx=target.getContext("2d",{colorSpace:"srgb"})!,image=ctx.createImageData(target.width,target.height);
    image.data.set(view==="original"||!result?session.preview.data:result.pixels);
    if(view==="mask"&&result)for(let i=0;i<result.mask.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=result.mask[i];image.data[i*4+3]=255;}
    ctx.putImageData(image,0,0);
  },[session,result,view]);
  const reset=()=>{setParams(validateRecolor(DEFAULT_RECOLOR));setView("result");setError("");};
  const matched=result?Math.round(result.mask.reduce((sum,v)=>sum+v,0)/result.mask.length/255*100):0;
  return <div className="recolor-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section ref={root} tabIndex={-1} className="recolor-dialog" role="dialog" aria-modal="true" aria-labelledby="recolor-title" onKeyDown={event=>{
      event.stopPropagation();if(event.key==="Escape"&&!busy){event.preventDefault();onClose();}
      if(event.key==="Tab") {const items=[...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(item=>item.getClientRects().length>0);
        if(event.shiftKey&&(document.activeElement===items[0]||document.activeElement===root.current)){event.preventDefault();items.at(-1)?.focus();}
        if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
    }}>
      <header><div><span className="recolor-eyebrow">COLOR STUDIO</span><h2 id="recolor-title">Recolor</h2><p>{session.name}</p></div><div className="recolor-header-actions"><button disabled={busy} onClick={reset} title="Reset recolor" aria-label="Reset recolor"><RotateCcw size={16}/></button><button disabled={busy} onClick={onClose} aria-label="Close Recolor"><X size={18}/></button></div></header>
      <div className="recolor-body"><div className="recolor-preview-column">
        <div className="recolor-preview-tabs" role="group" aria-label="Recolor preview mode">{(["result","original","mask"] as const).map(id=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{id==="result"?"Result":id==="original"?"Original":"Selection mask"}</button>)}</div>
        <div className="recolor-preview-stage"><canvas ref={canvas} aria-label="Recolor image preview; click to sample an original color" onPointerDown={event=>{
          if(busy)return;const rect=event.currentTarget.getBoundingClientRect();const x=Math.min(session.preview.width-1,Math.max(0,Math.floor((event.clientX-rect.left)/rect.width*session.preview.width))),y=Math.min(session.preview.height-1,Math.max(0,Math.floor((event.clientY-rect.top)/rect.height*session.preview.height)));
          const at=(y*session.preview.width+x)*4;if(!session.preview.data[at+3])return;
          addColor("#"+Array.from(session.preview.data.slice(at,at+3)).map(n=>n.toString(16).padStart(2,"0")).join(""));
        }}/></div>
        <div className="recolor-preview-meta"><span><Pipette size={13}/> Click image to {sample==="target"?"target":"protect"} a color</span><span aria-live="polite">{previewBusy?"Updating…":`≈ ${matched}% matched`}</span></div>
        <div className="recolor-palette"><span>Image palette</span>{palette.map(item=><button key={item.color} aria-label={`Sample ${item.color}`} title={item.color} style={{background:item.color}} disabled={busy} onClick={()=>addColor(item.color)}/>)}</div>
        <p className="recolor-note">Source-layer preview · {session.width} × {session.height}. Matching uses original pixels, not the recolored result. Masks, effects and transforms stay with the layer.</p>
      </div><fieldset className="recolor-controls" disabled={busy}>
        <div className="recolor-section"><h3>Target colors</h3><div className="recolor-sample-row"><select aria-label="Sample destination" value={sample} onChange={e=>setSample(e.target.value as typeof sample)}><option value="target">Add target</option><option value="protect">Protect color</option></select><input type="color" aria-label="Sample color" value={color} onChange={e=>setColor(e.target.value)}/><button title="Add sample color" aria-label="Add sample color" onClick={()=>addColor(color)}><Plus size={15}/></button></div>
          {(["colors","protectedColors"] as const).map(key=><div key={key} className="recolor-swatch-set"><span>{key==="colors"?"Target":"Protect"}</span>{params[key].map((value,i)=><button key={`${value}-${i}`} className="recolor-chip" style={{"--swatch":value} as React.CSSProperties} title={`Remove ${value}`} aria-label={`Remove ${key==="colors"?"target":"protected"} ${value}`} disabled={key==="colors"&&params.colors.length===1} onClick={()=>patch({[key]:params[key].filter((_,index)=>index!==i)})}><i/>{value}<X size={10}/></button>)}</div>)}
          <label className="recolor-row">Match by<select value={params.match} onChange={e=>patch({match:e.target.value as RecolorParams["match"]})}><option value="perceptual">Perceptual color</option><option value="hue">Hue family</option></select></label>
          <Slider label="Tolerance" value={params.tolerance*100} onChange={n=>patch({tolerance:n/100})}/><Slider label="Soft transition" value={params.softness*100} onChange={n=>patch({softness:n/100})}/>
          <label className="recolor-check"><input type="checkbox" checked={params.invert} onChange={e=>patch({invert:e.target.checked})}/> Match everything else</label>
          <label className="recolor-check"><input type="checkbox" checked={params.respectSelection} disabled={!session.selection} onChange={e=>patch({respectSelection:e.target.checked})}/> Limit to current selection</label>
        </div>
        <div className="recolor-section"><h3>Change</h3><label className="recolor-row">Operation<select value={params.mode} onChange={e=>patch({mode:e.target.value as RecolorParams["mode"]})}><option value="replace">Replace color</option><option value="shift">Shift hue / saturation / lightness</option><option value="desaturate">Desaturate colors</option><option value="remove">Remove colors → transparent</option><option value="isolate">Keep only these colors</option></select></label>
          {params.mode==="replace"&&<><label className="recolor-row">New color<input type="color" aria-label="Replacement color" value={params.replacement} onChange={e=>patch({replacement:e.target.value})}/><code>{params.replacement}</code></label><label className="recolor-check"><input type="checkbox" checked={params.preserveLightness} onChange={e=>patch({preserveLightness:e.target.checked})}/> Preserve lightness & shading</label></>}
          {params.mode==="shift"&&<><Slider label="Hue shift" value={params.hue} min={-180} max={180} onChange={hue=>patch({hue})}/><Slider label="Saturation shift" value={params.saturation*100} min={-100} max={100} onChange={n=>patch({saturation:n/100})}/><Slider label="Lightness shift" value={params.lightness*100} min={-100} max={100} onChange={n=>patch({lightness:n/100})}/></>}
          <Slider label="Strength" value={params.amount*100} onChange={n=>patch({amount:n/100})}/>
        </div>
        <details className="recolor-section"><summary>Advanced range limits</summary><Slider label="Minimum saturation" value={params.saturationMin*100} max={params.saturationMax*100} onChange={n=>patch({saturationMin:n/100})}/><Slider label="Maximum saturation" value={params.saturationMax*100} min={params.saturationMin*100} onChange={n=>patch({saturationMax:n/100})}/><Slider label="Minimum lightness" value={params.lightnessMin*100} max={params.lightnessMax*100} onChange={n=>patch({lightnessMin:n/100})}/><Slider label="Maximum lightness" value={params.lightnessMax*100} min={params.lightnessMin*100} onChange={n=>patch({lightnessMax:n/100})}/></details>
        <details className="recolor-section"><summary>Presets</summary><div className="recolor-preset-buttons">{["White background","Black background","Red to blue"].map((name,i)=><button key={name} onClick={()=>setParams({...DEFAULT_RECOLOR,colors:[i===0?"#ffffff":i===1?"#000000":"#ff0000"],protectedColors:[],mode:i<2?"remove":"replace",tolerance:i<2?.06:.12,softness:.04})}>{name}</button>)}</div>
          {presets.length>0&&<select aria-label="Saved recolor preset" value="" onChange={e=>{const preset=presets[Number(e.target.value)];if(preset)setParams(validateRecolor(preset.params));}}><option value="">Load saved preset…</option>{presets.map((p,i)=><option key={i} value={i}>{p.name}</option>)}</select>}
          <div className="recolor-sample-row"><input aria-label="Recolor preset name" placeholder="Preset name" maxLength={40} value={presetName} onChange={e=>setPresetName(e.target.value)}/><button disabled={!presetName.trim()} onClick={()=>{try{const next=[...presets.filter(p=>p.name!==presetName.trim()),{name:presetName.trim(),params:validateRecolor(params)}].slice(-12);localStorage.setItem(PRESETS_KEY,JSON.stringify(next));setPresets(next);setPresetName("");}catch{setError("Preset could not be saved on this device");}}}>Save</button></div>
        </details>
      </fieldset></div>
      {busy&&<div className="recolor-progress" role="status"><progress aria-label="Recolor progress" value={percent} max={100}/><span>{percent}% · processing tiles</span><button onClick={()=>abort.current?.abort()}>Cancel operation</button></div>}
      {error&&<p className="recolor-error" role="alert">{error}</p>}
      <footer><div><label>Output<select aria-label="Recolor output" disabled={busy} value={output} onChange={e=>setOutput(e.target.value as RecolorOutput)}><option value="copy">Recolored copy · preserve original</option><option value="pixels">Apply to layer pixels</option><option value="selection">Select matching colors</option><option value="mask-keep">Mask · keep matching colors</option><option value="mask-remove">Mask · remove matching colors</option></select></label>{output==="selection"&&<select aria-label="Recolor selection mode" value={selectionMode} onChange={e=>setSelectionMode(e.target.value as SelectionMode)}><option value="replace">Replace selection</option><option value="add">Add to selection</option><option value="subtract">Subtract from selection</option><option value="intersect">Intersect selection</option></select>}<small>{output==="copy"?"Original is hidden, not deleted. One undo restores both layers.":output==="pixels"?"Changes source pixels; undo is available.":"Uses the matching range, independent of operation and strength."}</small></div><button disabled={busy} onClick={onClose}>Cancel</button><button className="recolor-apply" disabled={busy||previewBusy||!result} onClick={()=>{setBusy(true);setError("");void onApply(validateRecolor(params),output,selectionMode).catch(reason=>setError(reason instanceof Error?reason.message:"Recolor failed")).finally(()=>setBusy(false));}}>{busy?"Applying…":"Apply"}</button></footer>
    </section>
  </div>;
}
