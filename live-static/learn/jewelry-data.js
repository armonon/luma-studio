export const sizes=[28,32,36],depths=[1.8,2.4,3.2];
export const variantId=(diameter,depth)=>`orbit-${diameter}-${String(depth).replace('.','p')}`;
export function design(diameter=32,depth=2.4){
 if(!sizes.includes(diameter)||!depths.includes(depth))throw Error('Choose one of the prepared pendant sizes.');
 const round=n=>Math.round(n*1000)/1000;
 const circles=[{id:'orbit-outline',name:'Pendant outline',x:0,y:0,r:diameter/2,layer:'pendant'},{id:'orbit-bail',name:'Chain loop',x:0,y:round(diameter*.49),r:round(diameter*.12),layer:'pendant'},{id:'orbit-window',name:'Offset window',x:round(diameter*.075),y:0,r:round(diameter*.28),layer:'cutouts'},{id:'orbit-chain',name:'Chain opening',x:0,y:round(diameter*.49),r:round(diameter*.052),layer:'cutouts'}];
 const entities=circles.map(c=>({id:c.id,type:'circle',a:{x:c.x,y:c.y},b:{x:round(c.x+c.r),y:c.y},rotation:0,layer:c.layer,constraints:[],sketchPlaneId:'world-xy'}));
 const profiles=circles.map(c=>({id:c.id,kind:'circle',origin:{x:c.x,y:c.y},radius:c.r,rotation:0}));
 const features=entities.map(e=>({id:'extrude-'+e.id,type:'Extrude',value:depth,unit:'mm',enabled:true,sourceEntityIds:[e.id]}));
 features.push({id:'join-chain-loop',type:'Fuse',value:0,unit:'mm',enabled:true,sourceEntityIds:[entities[0].id,entities[1].id]},{id:'cut-openings',type:'Cut',value:0,unit:'mm',enabled:true,sourceEntityIds:[entities[0].id,entities[2].id,entities[3].id]});
 return {id:variantId(diameter,depth),diameter,depth,circles,entities,profiles,features,height:round(circles[1].y+circles[1].r+diameter/2),chainDiameter:round(circles[3].r*2),windowDiameter:round(circles[2].r*2)};
}
export const toExact=features=>features.map(f=>({id:f.id,type:f.type,value:f.value,enabled:f.enabled,sourceIds:f.sourceEntityIds}));
export const finishes={gold:{label:'Warm gold',color:'#d5ad54',metalness:.86,roughness:.23},silver:{label:'Cool silver',color:'#b9c9d6',metalness:.92,roughness:.21},rose:{label:'Rose metal',color:'#cb9180',metalness:.8,roughness:.27}};
