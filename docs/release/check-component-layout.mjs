// Run against the isolated desktop Vite dev server. Uses real Chromium canvas
// metrics: @napi-rs/canvas 1.0.3 reports ~100000px RTL left bounds, so RTL
// measurement must not be "verified" by that headless backend.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browsers=await import(process.env.LUMA_PLAYWRIGHT_MODULE||"playwright");
const browser=await browsers[process.env.LUMA_UI_BROWSER||"chromium"].launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on("pageerror",error=>errors.push(error.message));
await page.addInitScript(()=>localStorage.setItem("luma.scripting","on"));
try{
 await page.goto(process.env.LUMA_UI_URL||"http://127.0.0.1:4179/");
 await page.waitForFunction(()=>window.luma?.studio,{timeout:60000});
 const result=await page.evaluate(async(root)=>{
  const {createTextLayer,drawLayerContent}=await import(`${root}/app/engine/document.ts`);
  const {layerBox}=await import(`${root}/app/engine/campaign.ts`);
  const {pendingDocumentFonts}=await import(`${root}/app/engine/text-font-resources.ts`);
  const {encodeLumaProject,decodeLumaProject}=await import(`${root}/app/engine/project.ts`);
  const cases=[
   ["Arabic joining/bidi",{text:"سلام 123 مرحبا",font:'40px "Noto Sans Arabic"',direction:"auto",align:"right"}],
   ["Hebrew/Latin",{text:"אבג ABC 123",font:'40px "Noto Sans Hebrew"',direction:"rtl",runs:[{start:4,end:7,style:{fontFamily:"Lato",fontSize:52}}]}],
   ["Ligatures/combining",{text:"office e\u0301 ﬁ ffi",font:'40px "Lato"',tracking:30}],
   ["Baseline/decoration",{text:"Design type",font:'35px "Lato"',runs:[{start:0,end:6,style:{fontSize:60,baselineShift:12,decoration:"underline"}}]}],
   ["Wrapped RTL",{text:"مرحبا بكم في لوما مرحبا بكم",font:'32px "Noto Sans Arabic"',direction:"rtl",layout:"paragraph",boxWidth:180,boxHeight:300,align:"right"}],
   ["Vertical graphemes",{text:"e\u0301AB",font:'35px "Lato"',layout:"vertical",runs:[{start:0,end:2,style:{color:"#ff0000"}}]}],
   ["Mixed font paragraph",{text:"Hello שלום مرحبا 123",font:'32px "Lato"',layout:"paragraph",boxWidth:220,boxHeight:300,runs:[{start:6,end:10,style:{fontFamily:"Noto Sans Hebrew"}},{start:11,end:16,style:{fontFamily:"Noto Sans Arabic",fontSize:40}}]}],
   ["Paragraph overrides",{text:"First\nSecond paragraph",font:'30px "Lato"',layout:"paragraph",boxWidth:180,boxHeight:300,paragraphs:[{start:0,end:5,style:{spaceBefore:8,spaceAfter:20,startIndent:10,firstLineIndent:5}},{start:6,end:22,style:{lineHeight:1.5,startIndent:25}}]}],
  ];
  const inkBox=canvas=>{const data=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;for(let row=0;row<canvas.height;row++)for(let col=0;col<canvas.width;col++)if(data[(row*canvas.width+col)*4+3]>0){x=Math.min(x,col);y=Math.min(y,row);r=Math.max(r,col+1);b=Math.max(b,row+1);}return{x,y,width:r-x,height:b-y};};
  const results=[];
  for(const[name,style]of cases){
   const layer=createTextLayer(name,{text:"",font:"40px sans-serif",align:"left",lineHeight:1.2,x:380,y:100,color:"#fff",...style});
   await pendingDocumentFonts({layers:[layer]});
   const canvas=document.createElement("canvas");canvas.width=900;canvas.height=700;drawLayerContent(canvas.getContext("2d"),layer);
   const ink=inkBox(canvas),bounds=layerBox(layer);
   // Compare the independent full-canvas raster to the bounded ink pass.
   const edges=box=>[box.x,box.y,box.x+box.width,box.y+box.height];
   if(edges(ink).some((value,index)=>Math.abs(value-edges(bounds)[index])>1))throw new Error(`${name}: ink ${JSON.stringify(ink)}, measured ${JSON.stringify(bounds)}`);
   const s=window.luma.studio;s.resetDocument(900,900,name);s.doc.layers=[layer];const shape=s.addShapeLayer({x:0,y:0,w:40,h:30}),board=s.createArtboard("Type");
   const before={...layer.transform};await s.executeCampaignReady({kind:"flow",boardId:board.id,layerIds:[layer.id,shape.id],direction:"column",padding:20,gap:12});
   const placed=layerBox(s.findLayer(layer.id)),next=layerBox(s.findLayer(shape.id));
   if(Math.abs(placed.x-20)>.001||Math.abs(placed.y-20)>.001||Math.abs(next.y-placed.y-placed.height-12)>.001)throw new Error(`${name}: wrong arrangement`);
   s.undo();if(JSON.stringify(s.findLayer(layer.id).transform)!==JSON.stringify(before))throw new Error(`${name}: undo changed original transform`);s.redo();
   const reopened=await decodeLumaProject(await encodeLumaProject(s.doc,[],name));
   if(JSON.stringify(layerBox(reopened.doc.layers.find(l=>l.id===layer.id)))!==JSON.stringify(placed))throw new Error(`${name}: reopen changed measurement`);
   results.push({name,ink,bounds});
  }
  return results;
 },`/@fs${process.cwd()}`);
 console.log(JSON.stringify(result,null,2));
 // Pause a real font request. Cancellation must finish promptly, and a
 // different document must never receive the delayed arrange operation.
 for(const mode of["cancel","switch"]){
  const family=mode==="cancel"?"Lobster":"Pacifico";let release,finished;
  const handled=new Promise(resolve=>finished=resolve);
  await page.route(`**/fonts/${family}-Regular.ttf`,async route=>{await new Promise(resolve=>release=resolve);try{await route.continue();}finally{finished();}});
  await page.evaluate(({family,mode})=>{
   const s=window.luma.studio;s.resetDocument(800,800,mode);const layer=s.addTextLayer("Waiting for font",{font:`30px "${family}"`}),board=s.createArtboard("Pending");
   const owner=s.doc,node=s.historyState().currentId,controller=new AbortController();
   window.campaignFontController=controller;
   window.campaignFontResult=s.executeCampaignReady({kind:"flow",boardId:board.id,layerIds:[layer.id],direction:"column",padding:20,gap:12},controller.signal).then(()=>({error:"Unexpected success"}),error=>({error:error.message,unchanged:s.doc===owner&&s.historyState().currentId===node}));
  },{family,mode});
  const deadline=Date.now()+10000;while(!release&&Date.now()<deadline)await page.waitForTimeout(25);assert.ok(release,"font request intercepted");
  if(mode==="cancel"){
   await page.evaluate(()=>window.campaignFontController.abort());const outcome=await page.evaluate(()=>window.campaignFontResult);assert.match(outcome.error,/cancelled/);assert.equal(outcome.unchanged,true);release();
  }else{
   await page.evaluate(()=>window.luma.studio.resetDocument(64,64,"Other document"));release();const outcome=await page.evaluate(()=>window.campaignFontResult);assert.match(outcome.error,/changed/);assert.equal(await page.evaluate(()=>window.luma.studio.doc.campaign),undefined);
  }
  await handled;await page.unroute(`**/fonts/${family}-Regular.ttf`);
 }
 await page.evaluate(async()=>{
  const s=window.luma.studio;s.resetDocument(900,900,"Complex type layout");
  const heading=s.addTextLayer("Type, precisely.",{font:'56px "Lato"',color:"#20344a"});
  const arabic=s.addTextLayer("مرحبا بكم في لوما",{font:'46px "Noto Sans Arabic"',direction:"rtl",color:"#2961aa"});
  const hebrew=s.addTextLayer("שלום · Luma Studio",{font:'38px "Noto Sans Hebrew"',direction:"auto",color:"#20344a"});
  const board=s.createArtboard("Mixed scripts");await s.executeCampaignReady({kind:"flow",boardId:board.id,layerIds:[heading.id,arabic.id,hebrew.id],direction:"column",padding:48,gap:30});
 });
 await page.keyboard.press("v");await page.keyboard.press("Meta+Alt+k");const panel=page.getByRole("region",{name:"Campaign workspace"});await panel.waitFor();await panel.getByRole("button",{name:"Layout",exact:true}).click();
 await mkdir("/tmp/luma-component-layout",{recursive:true});
 for(const[width,height]of[[1280,800],[1440,900],[1920,1080]]){await page.setViewportSize({width,height});await page.screenshot({path:`/tmp/luma-component-layout/${process.env.LUMA_UI_BROWSER||"chromium"}-type-${width}.png`});assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);}
 assert.deepEqual(errors,[]);console.log("PASS: browser shaped-ink metrics, complex text arrangement, undo/reopen, font-load cancellation/document ownership, panel at three sizes.");
}finally{await browser.close();}
