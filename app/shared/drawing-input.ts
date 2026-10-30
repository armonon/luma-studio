/** Shared pointer routing. Touch never inherits a stale desktop hand modifier. */
export function canvasPointerIntent(button:number,pointerType:string,spaceHeld:boolean):"edit"|"pan"|"ignore" {
 if(pointerType==="touch")return button===0?"edit":"ignore";
 return button===1||(button===0&&spaceHeld)?"pan":button===0?"edit":"ignore";
}
export type PointerSample = {clientX:number;clientY:number;pressure?:number;pointerId?:number;pointerType?:string;timeStamp?:number;tiltX?:number;tiltY?:number;azimuthAngle?:number};
/** Browser batches can omit the dispatch endpoint. Keep that endpoint exactly once,
 * retain stationary pressure changes, and tolerate unsupported/throwing APIs. */
export function pointerSamples<T extends PointerSample>(event:T&{getCoalescedEvents?:()=>T[]}):T[]{
 let samples:T[]=[];try{samples=event.getCoalescedEvents?.()??[];}catch{/* ordinary event fallback */}
 samples=samples.filter(p=>Number.isFinite(p.clientX)&&Number.isFinite(p.clientY)&&(p.pointerId===undefined||event.pointerId===undefined||p.pointerId===event.pointerId));
 const last=samples.at(-1);
 if(!last||['clientX','clientY','pressure','timeStamp'].some(key=>last[key as keyof T]!==event[key as keyof T]))samples.push(event);
 return samples;
}
/** Keep all admitted stroke samples while publishing one immutable preview per frame. */
export class FrameStrokeBuffer<T>{
 private points:T[]|null=null;private pointer:number|null=null;private frame:number|null=null;
 private schedule:(run:()=>void)=>number;private cancelFrame:(id:number)=>void;private publish:(points:T[])=>void;private accept:(previous:T,next:T)=>boolean;private limit:number;
 constructor(schedule:(run:()=>void)=>number,cancelFrame:(id:number)=>void,publish:(points:T[])=>void,accept:(previous:T,next:T)=>boolean=()=>true,limit=65536){this.schedule=schedule;this.cancelFrame=cancelFrame;this.publish=publish;this.accept=accept;this.limit=limit;}
 get pointerId(){return this.pointer;}
 snapshot(){return this.points?.slice()??null;}
 begin(pointer:number,point:T){this.cancel();this.pointer=pointer;this.points=[point];this.publish([point]);}
 append(pointer:number,samples:T[]){if(this.pointer!==pointer||!this.points)return;for(const point of samples){if(!this.accept(this.points.at(-1)!,point))continue;if(this.points.length>=this.limit){this.cancel();throw new Error("Stroke sample limit reached; split the stroke before continuing");}this.points.push(point);}if(this.frame===null)this.frame=this.schedule(()=>{this.frame=null;if(this.points)this.publish(this.points.slice());});}
 finish(pointer:number,endpoint?:T){if(this.pointer!==pointer||!this.points)return null;if(this.frame!==null)this.cancelFrame(this.frame);this.frame=null;const points=this.points;if(endpoint)points.push(endpoint);this.points=null;this.pointer=null;return points;}
 cancel(){if(this.frame!==null)this.cancelFrame(this.frame);this.frame=null;this.points=null;this.pointer=null;}
}

/** Wheel line/page units are normalized before zooming; precise trackpad scroll
 * remains available unless the zoom modifier is held. */
export function wheelZoomFactor(deltaY:number,deltaMode=0,pageHeight=800){const pixels=deltaY*(deltaMode===1?16:deltaMode===2?pageHeight:1);return Math.exp(Math.max(-2.3,Math.min(2.3,-pixels*.002)));}
