// The eight images are individual layers rendered by the real Luma engine.
export async function sequencePreview(a,id,image,data){
 const {ctx,base,buttons,range,action,drag,say}=a;
 if(id==='recolor'){
  const [before,after]=await Promise.all(['recolor-before.png','recolor-example.jpg'].map(n=>image('/assets/luma-workshops/'+n)));
  let selected=false,amount=0;const set=buttons([['original','Original'],['blue','Blue shirt']],v=>{if(v==='blue'&&!selected){set('original');say('Select the shirt first.');return;}amount=v==='blue'?1:0;say('The source photo and recolored result come from the real Luma project.');});set('original');
  action('Select the shirt',()=>{selected=true;say('Shirt selected. Choose Blue shirt, then open the lesson to draw and refine your own selection.');a.render();});
  a.setDraw(()=>{base('#e8eef9');ctx.drawImage(before,153,0,294,400);ctx.globalAlpha=amount;ctx.drawImage(after,153,0,294,400);ctx.globalAlpha=1;if(selected){ctx.save();ctx.translate(153,0);ctx.scale(294/176,400/240);ctx.beginPath();[[38,89],[64,77],[73,74],[88,85],[108,72],[140,82],[151,89],[164,115],[142,126],[132,142],[130,158],[133,173],[92,184],[62,177],[64,155],[57,125],[32,116]].forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.strokeStyle='#67ecff';ctx.lineWidth=1;ctx.setLineDash([3,2]);ctx.stroke();ctx.restore();}});
  say('Select the shirt, then try the recolored version.');a.setReset(()=>{selected=false;amount=0;set('original');say('Select the shirt, then try the recolored version.');});return;
 }
 const spec=await data('/assets/luma-workshops/stack-preview.json');const images=Object.fromEntries(await Promise.all(spec.layers.map(async l=>[l.id,await image(l.src)])));
 let order=spec.layers.map(l=>l.id),target=id==='effects'?'stack-halo':'stack-headline',mode='source-over',opacity=1,offsets={},shadow=false;
 const select=document.createElement('select');select.setAttribute('aria-label','Preview layer');select.className='lp-layer-select';for(const layer of spec.layers){const option=document.createElement('option');option.value=layer.id;option.textContent=layer.name;select.append(option);}select.value=target;select.addEventListener('change',()=>{target=select.value;say('Selected '+spec.layers.find(l=>l.id===target).name+'. Drag the preview to move it.');a.render();});a.tools.append(select);
 a.setDraw(()=>{base('#e8eef9');ctx.save();ctx.beginPath();ctx.rect(136,0,328,400);ctx.clip();for(const layerId of [...order].reverse()){ctx.save();if(id==='effects'&&layerId===target){ctx.globalCompositeOperation=mode;ctx.globalAlpha=opacity;if(shadow){ctx.shadowColor='#16234b';ctx.shadowBlur=7;ctx.shadowOffsetX=5;ctx.shadowOffsetY=6;}}const p=offsets[layerId]??{x:0,y:0};ctx.drawImage(images[layerId],136+p.x,0+p.y,328,400);ctx.restore();}ctx.restore();});
 let resetMode,resetOpacity;
 if(id==='compose'){
  const reorder=delta=>{const index=order.indexOf(target),next=Math.max(0,Math.min(order.length-1,index+delta));order.splice(index,1);order.splice(next,0,target);say('Layer '+(next+1)+' of 8 from the front.');a.render();};action('Bring forward',()=>reorder(-1));action('Send backward',()=>reorder(1));say('Choose a layer. Change its order or drag it into place.');
 }else{
  resetMode=buttons([['source-over','Normal'],['multiply','Multiply'],['screen','Screen'],['soft-light','Soft Light']],v=>mode=v);resetMode(mode);
  resetOpacity=range('Preview opacity',0,100,100,5,'%',v=>opacity=v/100);action('Toggle shadow',()=>{shadow=!shadow;say(shadow?'Shadow on the selected layer.':'Shadow off.');a.render();});say('Compare a few blends here. The full lesson offers every native effect and blend mode.');
 }
 drag((dx,dy)=>{const p=offsets[target]??{x:0,y:0};offsets[target]={x:Math.max(-270,Math.min(270,p.x+dx*600)),y:Math.max(-350,Math.min(350,p.y+dy*400))};});
 a.setReset(()=>{order=spec.layers.map(l=>l.id);target=id==='effects'?'stack-halo':'stack-headline';select.value=target;mode='source-over';opacity=1;offsets={};shadow=false;resetMode?.(mode);resetOpacity?.(100);});
}
