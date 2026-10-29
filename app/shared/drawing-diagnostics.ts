/** Opt-in local test instrumentation. Measures browser frame intervals during real
 * canvas gestures, not physical pen-to-photon latency or field INP. No telemetry. */
export function mountDrawingDiagnostics(doc:Document,selector:string){
 const win=doc.defaultView!;const output=doc.createElement('output');output.setAttribute('aria-label','Drawing frame diagnostics');output.style.cssText='position:fixed;left:8px;bottom:36px;z-index:99999;max-width:80vw;background:#111;color:#fff;padding:6px;font:11px monospace;pointer-events:none';doc.body.appendChild(output);
 let frames:number[]=[],last=0,frame=0,events=0,active:number|null=null,gestures=0,total=0;
 const report=()=>{const sorted=[...frames].sort((a,b)=>a-b),q=(p:number)=>Number((sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??0).toFixed(2));output.textContent=JSON.stringify({gestures,events,frames:frames.length,frameP50Ms:q(.5),frameP95Ms:q(.95),maxFrameMs:q(1),framesOver17ms:frames.filter(n=>n>17).length,framesOver8_8ms:frames.filter(n=>n>8.8).length,gestureWallMs:Math.round(total),width:win.innerWidth,height:win.innerHeight,dpr:win.devicePixelRatio,visibility:doc.visibilityState});};
 const tick=(time:number)=>{if(active===null)return;if(last)frames.push(time-last);last=time;frame=win.requestAnimationFrame(tick);};
 let start=0;
 const down=(e:PointerEvent)=>{if(!(e.target instanceof win.Element)||!e.target.matches(selector)||active!==null)return;active=e.pointerId;frames=[];events=0;total=0;start=win.performance.now();last=0;gestures++;frame=win.requestAnimationFrame(tick);};
 const move=(e:PointerEvent)=>{if(active===e.pointerId)events++;};
 const up=(e:PointerEvent)=>{if(active!==e.pointerId)return;total+=win.performance.now()-start;active=null;win.cancelAnimationFrame(frame);report();};
 doc.addEventListener('pointerdown',down,true);doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',up,true);report();
 return()=>{win.cancelAnimationFrame(frame);output.remove();doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',up,true);};
}
