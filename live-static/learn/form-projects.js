import {defaultMeshFeature,defaultModifier,rebuildMeshFeature,DEFAULT_BRUSH,exportMesh} from './form-mesh-core.js';
export const projects=[
 {id:'ripple-vessel',name:'Ripple vessel',label:'Twist + taper',kind:'generated',color:'#687ddb',description:'Start with a scalloped vessel. Twist its profile, taper the opening and keep both decisions editable.',preset:{twist:65,taper:.2}},
 {id:'lumen-lamp',name:'Lumen shade',label:'Profile + light',kind:'generated',color:'#d79762',description:'A fluted, open shade for exploring proportion, silhouette and the way a surface catches light.',preset:{twist:24,taper:-.18}},
 {id:'arch-array',name:'Ribbon pavilion',label:'Array + spacing',kind:'generated',color:'#b47bb5',description:'One arched rib becomes a repeating architectural study. Change the count and spacing independently.',preset:{count:5,gap:1.25}},
 {id:'equine-reverie',name:'Equine Reverie',label:'Sculpt + undo',kind:'supplied',description:'Reshape a small region of the supplied equestrian sculpture. Each brush stroke remains a replayable edit.',preset:{}},
 {id:'circle-of-anarchy',name:'Circle of Anarchy',label:'Relief + depth',kind:'supplied',description:'Explore the circular relief from the front, then rotate to read its shallow depth and repeating figures.',preset:{}},
 {id:'wwspc',name:'Birds in Orbit',label:'Detail + finish',kind:'supplied',description:'Look closely at the feather edges and overlapping frame of the supplied bird-and-cross relief.',preset:{}},
 {id:'forest-landscape',name:'Terrain study',label:'Displace + surface',kind:'supplied',description:'Reshape the terrain with a reversible displacement modifier. This study contains geometry without the source texture cards.',preset:{relief:.8}}
];
export const defaults={project:'ripple-vessel',size:100,twist:65,taper:.2,count:1,gap:1.25,relief:0,material:'ceramic',roughness:.3,light:35,history:3,yaw:-.4,pitch:.22,zoom:1,wire:false,brush:'orbit',radius:8,strength:.3,strokes:[]};
export const finishes={ceramic:{name:'Blue ceramic',color:'#7d98df',metalness:.12,roughness:.3},brass:{name:'Warm brass',color:'#d4a463',metalness:.88,roughness:.24},clay:{name:'Rose clay',color:'#d69691',metalness:0,roughness:.8},glass:{name:'Ice glaze',color:'#b7e3ec',metalness:0,roughness:.08}};
export function generated(id){const positions=[],faces=[];const add=(x,y,z)=>(positions.push([x,y,z]),positions.length-1);
 if(id==='arch-array'){
  const n=48,w=30,h=50,thick=2.5,depth=5;
  for(let i=0;i<=n;i++){const a=i/n*Math.PI;for(const [r,y] of [[0,-depth/2],[thick,-depth/2],[0,depth/2],[thick,depth/2]])add((w-r)*Math.cos(a),y,2+(h-r)*Math.sin(a));}
  for(let i=0;i<n;i++){const a=i*4,b=a+4;faces.push([a,b,b+1,a+1],[a+2,a+3,b+3,b+2],[a,a+2,b+2,b],[a+1,b+1,b+3,a+3]);}faces.push([0,1,3,2]);const q=n*4;faces.push([q,q+2,q+3,q+1]);
 }else{
  const lamp=id==='lumen-lamp',rings=36,segments=72,height=lamp?82:100;
  // Two connected surfaces and an annular rim keep the open design a closed mesh.
  for(let side=0;side<2;side++)for(let j=0;j<=rings;j++)for(let i=0;i<segments;i++){
   const t=j/rings,a=i/segments*Math.PI*2;const r=lamp?25+13*Math.sin(Math.PI*t*.8):23+8*Math.sin(Math.PI*t)+4*t;
   const wave=(lamp?2.8:2)*Math.cos(a*(lamp?18:9));add((r+wave-side*2)*Math.cos(a),(r+wave-side*2)*Math.sin(a),lamp||side===0?t*height:2+t*(height-2));
  }
  const stride=(rings+1)*segments;
  for(let side=0;side<2;side++)for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){const a=side*stride+j*segments+i,b=side*stride+j*segments+(i+1)%segments,c=b+segments,d=a+segments;faces.push(side?[d,c,b,a]:[a,b,c,d]);}
  for(let i=0;i<segments;i++){const k=(i+1)%segments,a=rings*segments+i,b=rings*segments+k;faces.push([a,b,b+stride,a+stride]);if(lamp)faces.push([i,i+stride,k+stride,k]);}
  if(!lamp){const bottom=add(0,0,0),floor=add(0,0,2);for(let i=0;i<segments;i++){const k=(i+1)%segments;faces.push([bottom,k,i],[floor,i+stride,k+stride]);}}
 }
 return {positions,faces};
}
export function starting(id){const item=projects.find(p=>p.id===id)||projects[0];return {...structuredClone(defaults),project:item.id,twist:0,taper:0,count:1,relief:0,pitch:id==='forest-landscape'?.7:.22,...item.preset};}
export function validate(s){if(!s||!projects.some(p=>p.id===s.project))throw Error('Choose a saved Form object-studio lesson.');const x={...structuredClone(defaults),...s};const limits={size:[60,140],twist:[-150,150],taper:[-.5,.65],count:[1,7],gap:[1.05,2.5],relief:[0,3],roughness:[.05,.95],light:[-100,100],history:[0,3],yaw:[-100,100],pitch:[-1.5,1.5],zoom:[.7,1.8],radius:[3,20],strength:[.05,.8]};for(const [k,[a,b]] of Object.entries(limits))x[k]=Math.min(b,Math.max(a,Number(x[k])||0));x.count=Math.round(x.count);x.history=Math.round(x.history);if(!finishes[x.material])x.material='ceramic';if(!['orbit','inflate','smooth'].includes(x.brush))x.brush='orbit';x.wire=!!x.wire;
 if(!Array.isArray(x.strokes)||x.strokes.length>30)throw Error('This lesson supports up to 30 recorded strokes.');for(const stroke of x.strokes){if(!stroke?.brush||!['inflate','smooth'].includes(stroke.brush.kind)||!Array.isArray(stroke.samples)||stroke.samples.length>60)throw Error('Invalid brush stroke.');if(!stroke.samples.every(a=>[a.point,a.normal].every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e5))))throw Error('Invalid brush coordinates.');stroke.samples=stroke.samples.map(a=>({point:a.point,normal:a.normal,pressure:1}));stroke.brush={...DEFAULT_BRUSH,kind:stroke.brush.kind,radius:Math.max(1,Math.min(64,+stroke.brush.radius||8)),strength:Math.max(.05,Math.min(.8,+stroke.brush.strength||.3)),detail:0,symmetry:[]};}
 return x;
}
export function feature(s,mesh,phase=s.history){const id='lesson-'+s.project,scale=s.size/100,f=defaultMeshFeature(id,projects.find(p=>p.id===s.project).name);f.primitive={kind:'mesh',positions:mesh.positions.map(p=>p.map(n=>n*scale)),faces:mesh.faces};f.modifiers=[];f.edits=s.strokes.map((stroke,i)=>({id:id+'-stroke-'+i,op:'sculpt',brush:stroke.brush,samples:stroke.samples}));f.rollback=phase===0?0:f.edits.length;
 const modifier=(kind,values)=>({...defaultModifier(kind,id+'-'+kind),...values,enabled:phase>=2});
 if(s.twist)f.modifiers.push(modifier('twist',{angle:s.twist}));if(s.taper)f.modifiers.push(modifier('taper',{amount:s.taper}));if(s.relief)f.modifiers.push(modifier('displace',{amount:s.relief,frequency:.085,seed:7}));if(s.count>1)f.modifiers.push(modifier('array',{count:s.count,offset:s.project==='arch-array'?[0,s.gap*3,0]:[s.gap,0,0],relative:true}));return f;
}
export function build(s,mesh,phase=s.history){const f=feature(s,mesh,phase),result=rebuildMeshFeature(f);const failed=result.skipped.filter(v=>v.reason!=='switched off');if(failed.length)throw Error(failed[0].reason);return {feature:f,mesh:result.surface};}
export function stl(mesh,name){return new Blob([exportMesh(mesh,'stl',name).text],{type:'model/stl'});}
export {DEFAULT_BRUSH};

// Native project data and lesson controls share the same source mesh and operations.
export async function nativeProject(template,s,mesh){
 const {cadProjectChecksum,formProjectChecksum,parseProject}=await import('./form-codec.js');
 const p=structuredClone(template),d=p.workspaces.cad.data,f=feature(s,mesh),finish=finishes[s.material];
 p.projectId='momentium-'+s.project;p.revisionId='lesson-'+Date.now();p.name=projects.find(x=>x.id===s.project).name+' — my edition';p.updatedAt=Date.now();
 d.meshFeatures=[f];d.entities=[];d.features=[];d.rollbackIndex=0;
 d.sceneNodes=[{id:f.id,name:f.name,parentId:null,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},content:{kind:'sculpt',id:f.id},visible:true}];
 d.appearance={...d.appearance,baseColor:finish.color,metalness:finish.metalness,roughness:s.roughness};d.checksum=cadProjectChecksum(d);
 p.workspaces.cad.objectIds=[f.id];p.workspaces.cad.updatedAt=p.updatedAt;
 p.extensions={'momentium-learning':{product:'form',state:{lab:'mesh',value:structuredClone(s)}}};p.checksum=formProjectChecksum(p);
 parseProject(JSON.stringify(p));return p;
}
