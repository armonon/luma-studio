// Run against a production build or deployment; requires Playwright with Chrome.
const {chromium}=await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? 'playwright');
import {PDFDocument,rgb} from 'pdf-lib';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const pdf=await PDFDocument.create();const page=pdf.addPage([300,200]);page.drawText('PDF import check',{x:20,y:120,size:22});page.drawRectangle({x:20,y:30,width:80,height:60,color:rgb(1,0,0)});const bytes=Buffer.from(await pdf.save());
const base=process.env.LUMA_RELEASE_URL??'http://localhost:4212';
const browser=await chromium.launch({channel:'chrome'});const results=[];
try {for(const [route,width] of [['/studio',1440],['/iphone',390]]){
 const ctx=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});await ctx.addInitScript(()=>localStorage.setItem('luma.scripting','on'));const p=await ctx.newPage();p.setDefaultTimeout(60000);const errors=[];p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(base+route);await p.waitForFunction(()=>Boolean(window.luma?.studio));
 await p.locator('input[type=file][accept*=".pdf"]').setInputFiles({name:'pdf-check.pdf',mimeType:'application/pdf',buffer:bytes});
 await p.getByRole('dialog').waitFor();assert.equal(await p.getByLabel('Import as').inputValue(),'raster');await p.getByRole('button',{name:'Import page',exact:true}).click();
 await p.waitForFunction(()=>window.luma.studio.activeDocumentState().name.includes('pdf-check'));
 const rendered=await p.evaluate(()=>{const doc=window.luma.studio.doc,layer=doc.layers[0];const data=layer.bitmap.getContext('2d').getImageData(0,0,doc.width,doc.height).data;let black=0,red=0;for(let i=0;i<data.length;i+=4){if(data[i]<40&&data[i+1]<40&&data[i+2]<40)black++;if(data[i]>220&&data[i+1]<40&&data[i+2]<40)red++;}return {width:doc.width,height:doc.height,kind:layer.kind,black,red};});
 assert.equal(rendered.width,625);assert.equal(rendered.height,417);assert.equal(rendered.kind,'raster');assert.ok(rendered.black>100);assert.ok(rendered.red>10000);
 const exported=await p.evaluate(async()=>{const blob=await window.luma.export('image/png');const bitmap=await createImageBitmap(blob);return {type:blob.type,width:bitmap.width,height:bitmap.height};});assert.deepEqual(exported,{type:'image/png',width:625,height:417});assert.deepEqual(errors,[]);
 results.push({route,width,rendered,exported,errors});await ctx.close();console.log('PASS',route,width);
}}finally{await browser.close();}
await writeFile(process.env.LUMA_PDF_REPORT ?? '/tmp/luma-pdf-browser-results.json',JSON.stringify({base,results},null,2));
