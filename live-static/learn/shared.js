export const $=(root,s)=>root.querySelector(s);
export const $$=(root,s)=>[...root.querySelectorAll(s)];
export const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)||0));
export const clone=v=>structuredClone(v);
export const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function fetchAsset(url){const r=await fetch(url);if(!r.ok)throw Error('A starter asset could not be loaded. Please retry.');return r;}
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export const jsonBlob=v=>new Blob([JSON.stringify(v,null,2)],{type:'application/json'});
export const canvasBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('The image could not be exported.')),'image/png'));
let database;
function db(){return database??=new Promise((resolve,reject)=>{const req=indexedDB.open('momentium-learning-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('work');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('Browser storage is unavailable. Download a lesson backup to keep your work.'));});}
export async function stored(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('work','readonly'),r=t.objectStore('work').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function store(key,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('work','readwrite');t.objectStore('work').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
export async function remove(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('work','readwrite');t.objectStore('work').delete(key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
export function control(label,id,min,max,value,step=1,suffix=''){return `<label class="sl-control" for="${id}" data-control="${id}">${label}<output id="${id}-out">${value}${suffix}</output><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" aria-describedby="${id}-out"></label>`;}
export function select(label,id,options,value){return `<label class="sl-control" data-control="${id}">${label}<select id="${id}">${options.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;}
export function encodeWav(buffer){const frames=buffer.length,channels=buffer.numberOfChannels,b=new ArrayBuffer(44+frames*channels*2),v=new DataView(b),str=(p,s)=>[...s].forEach((x,i)=>v.setUint8(p+i,x.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,b.byteLength-44,true);for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const n=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));v.setInt16(44+(i*channels+c)*2,n*(n<0?32768:32767),true);}return new Blob([b],{type:'audio/wav'});}
export function audioContext(){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw Error('This browser does not support the audio workspace.');return new C();}
export async function zip(files){if(!window.JSZip)throw Error('Project tools are still loading. Please retry.');const z=new window.JSZip();for(const [name,blob] of Object.entries(files))z.file(name,blob);return z.generateAsync({type:'blob',compression:'DEFLATE'});}
export function validateLesson(value,key){if(value?.format!=='momentium-lesson'||value.version!==1||value.product!==key||!value.state||typeof value.state!=='object')throw Error('Choose a saved '+key+' lesson.');return value.state;}
