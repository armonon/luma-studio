export const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
export function mixGains(state){const solo=state.solo.some(Boolean),x=clamp(state.cross,0,100)/100;return state.levels.map((v,i)=>(solo&&!state.solo[i]?0:clamp(v,0,100)/100)*(i%2?Math.sin(x*Math.PI/2):Math.cos(x*Math.PI/2))*.55)}
export function cutAt(order,lengths,time){let start=0;for(let i=0;i<order.length;i++){const duration=lengths[i];if(time<start+duration||i===order.length-1)return {clip:order[i],index:i,time:clamp(time-start,0,duration),duration};start+=duration}return {clip:order[0],index:0,time:0,duration:lengths[0]}}
export const ranges={twist:['Twist',-120,150,65,1,'°'],sculpt:['Relief',0,3,0,.1,' mm'],array:['Repeats',1,7,5,1,''],relief:['Light angle',-100,100,35,1,'°'],terrain:['Displacement',0,3,.8,.1,' mm'],dimensions:['Width',36,80,55,1,' mm'],history:['Build stage',0,3,3,1,''],challenge:['Width',36,80,55,1,' mm'],materials:['Roughness',5,95,30,1,'%'],handoff:['Width',36,80,55,1,' mm']};
export function patternPoints(piece,amount){const width=Number(amount)/100;return piece.points.map(p=>({x:p.x*width,y:p.y}))}
export function posterAspect(format){return format==='story'?[9,16]:format==='square'?[1,1]:[2,3]}
export function safeKey(value){return /^(form|luma|stemdeck|scenepilot):[a-z-]+$/.test(value)?value:null}
