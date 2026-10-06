// Project and preview crops use the unchanged supplied originals.
export const suppliedRoot='/assets/luma-workshops/supplied/';
export const sourceAssets={
 'recolor-man.png':{file:'cinema-board-1.png',crop:[827,28,176,240]},
 'shirt.png':{file:'milk-room-shirts.png',crop:[65,35,650,590]},
 'motif.png':{file:'yellow-fabric.png',crop:[205,45,580,1000],paper:true},
 'film-wave.jpg':{file:'travel-photo-grid.png',crop:[282,5,242,254]},
 'film-sun.jpg':{file:'travel-photo-grid.png',crop:[282,308,242,317]},
 'film-mountain.jpg':{file:'travel-photo-grid.png',crop:[282,672,242,317]},
 'film-lake.jpg':{file:'travel-photo-grid.png',crop:[5,309,236,316]},
 'model.png':{file:'fashion-model.png',matte:20,repair:true},
 'cinema-background.png':{file:'cinema-board-2.png',crop:[1117,18,465,416]},
 'cinema-figure.png':{file:'cinema-board-1.png',crop:[827,28,176,386],darkLegs:true,outline:[[0.5511, 0.057], [0.6364, 0.0725], [0.6818, 0.1192], [0.642, 0.1684], [0.8011, 0.1891], [0.8693, 0.2254], [0.9318, 0.3109], [0.9034, 0.3964], [0.8011, 0.4534], [0.7727, 0.4922], [0.7216, 0.5699], [0.6989, 0.6477], [0.7045, 0.7254], [0.767, 0.8031], [0.7898, 0.8808], [0.7955, 0.9404], [0.7727, 0.9741], [0.733, 0.9845], [0.6534, 0.9585], [0.625, 0.9067], [0.5909, 0.8031], [0.5568, 0.7254], [0.5284, 0.6477], [0.5, 0.5933], [0.4545, 0.6373], [0.4318, 0.7228], [0.3977, 0.8031], [0.3693, 0.8808], [0.3409, 0.9197], [0.2841, 0.9508], [0.1875, 0.9793], [0.1193, 0.9819], [0.0909, 0.9637], [0.125, 0.9352], [0.2045, 0.9041], [0.2557, 0.8161], [0.2273, 0.7513], [0.2443, 0.6477], [0.267, 0.5699], [0.3125, 0.4922], [0.1648, 0.4456], [0.1023, 0.3938], [0.0795, 0.3161], [0.125, 0.2306], [0.2159, 0.1917], [0.4261, 0.171], [0.4545, 0.1218], [0.4489, 0.0829]]},
 'collage-statue.png':{file:'blue-pink-collage.png'}
};
export const workshopSources={weave:['fashion-model.png'],identity:['yellow-fabric.png'],grade:['travel-photo-grid.png'],rescue:['travel-photo-grid.png'],stickers:['yellow-fabric.png'],recolor:['cinema-board-1.png'],compose:['cinema-board-1.png','cinema-board-2.png','blue-pink-collage.png','yellow-fabric.png'],effects:['cinema-board-1.png','cinema-board-2.png','blue-pink-collage.png','yellow-fabric.png'],drop:['milk-room-shirts.png','yellow-fabric.png'],zine:['travel-photo-grid.png'],print:['yellow-fabric.png'],campaign:['fashion-model.png','yellow-fabric.png'],cinema:['cinema-board-1.png','cinema-board-2.png'],poster:['blue-pink-collage.png']};
export const sourceLabels={'milk-room-shirts.png':'Milk Room T-shirt collection','travel-photo-grid.png':'Travel and portrait photo grid','yellow-fabric.png':'Yellow illustrated fabric','fashion-model.png':'Graphic outfit photograph','cinema-board-1.png':'Cinematic character board','cinema-board-2.png':'Cinematic atmosphere board','blue-pink-collage.png':'Blue-and-pink original collage'};
export function prepareSource(image,spec,make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c}){
 const [x,y,w,h]=spec.crop||[0,0,image.width,image.height],canvas=make(w,h),ctx=canvas.getContext('2d');
 ctx.save();if(spec.outline){ctx.beginPath();spec.outline.forEach(([px,py],i)=>i?ctx.lineTo(px*w,py*h):ctx.moveTo(px*w,py*h));ctx.closePath();ctx.clip()}
 ctx.drawImage(image,x,y,w,h,0,0,w,h);ctx.restore();
 if(spec.paper){const pixels=ctx.getImageData(0,0,w,h);for(let i=0;i<pixels.data.length;i+=4){const a=Math.max(0,Math.min(1,(205-Math.min(pixels.data[i],pixels.data[i+1]))/95));pixels.data[i+3]=Math.round(pixels.data[i+3]*a);pixels.data[i]=30;pixels.data[i+1]=51;pixels.data[i+2]=46}ctx.putImageData(pixels,0,0)}
 if(spec.darkLegs){const pixels=ctx.getImageData(0,0,w,h);for(let row=215;row<h;row++)for(let col=0;col<w;col++){const n=(row*w+col)*4;if(pixels.data[n]>82&&pixels.data[n+1]>76&&pixels.data[n+2]>62)pixels.data[n+3]=0}ctx.putImageData(pixels,0,0)}
 if(spec.matte){
  const original=make(w,h),oc=original.getContext('2d');oc.drawImage(image,x,y,w,h,0,0,w,h);const raw=oc.getImageData(0,0,w,h).data,pixels=ctx.getImageData(0,0,w,h),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let read=0,write=0;
  const edge=(row,col,c)=>{let sum=0;for(let k=0;k<4;k++)sum+=raw[(row*w+(col===0?k:w-1-k))*4+c];return sum/4};
  const left=Array.from({length:h},(_,row)=>[0,1,2].map(c=>edge(row,0,c))),right=Array.from({length:h},(_,row)=>[0,1,2].map(c=>edge(row,w-1,c)));
  const visit=i=>{if(i<0||i>=w*h||seen[i])return;seen[i]=1;const row=Math.floor(i/w),col=i%w,t=col/(w-1);if([0,1,2].every(c=>Math.abs(raw[i*4+c]-(left[row][c]*(1-t)+right[row][c]*t))<=spec.matte)){queue[write++]=i;pixels.data[i*4+3]=0}};
  for(let row=0;row<h;row++){visit(row*w);visit(row*w+w-1)}for(let col=0;col<w;col++){visit(col);visit((h-1)*w+col)}
  while(read<write){const i=queue[read++];if(i%w)visit(i-1);if(i%w<w-1)visit(i+1);visit(i-w);visit(i+w)}
  if(spec.repair){
   // Keep the light garment interior: its gray folds overlap the background color.
   const bounds=[];for(let row=0;row<850;row++){let lo=w,hi=-1;for(let col=0;col<w;col++)if(pixels.data[(row*w+col)*4+3]){lo=Math.min(lo,col);hi=col}bounds.push([lo,hi])}
   for(let row=0;row<850;row++){const near=bounds.slice(Math.max(0,row-3),Math.min(850,row+4)),median=index=>near.map(b=>b[index]).sort((a,b)=>a-b)[Math.floor(near.length/2)],lo=median(0),hi=median(1);for(let col=0;col<w;col++)pixels.data[(row*w+col)*4+3]=col>=lo&&col<=hi?255:0}
   const foot=make(w,h),fc=foot.getContext('2d'),outline=[[116,850],[120,886],[119,913],[125,934],[141,946],[184,946],[190,929],[185,900],[218,873],[262,878],[274,901],[279,932],[304,946],[335,943],[342,922],[341,897],[356,850]];fc.beginPath();outline.forEach(([px,py],i)=>i?fc.lineTo(px,py):fc.moveTo(px,py));fc.closePath();fc.fill();const fm=fc.getImageData(0,0,w,h).data;for(let row=850;row<h;row++)for(let col=0;col<w;col++){const n=(row*w+col)*4;pixels.data[n+3]=fm[n+3]}
  }
  ctx.putImageData(pixels,0,0);
 }
 return canvas;
}
