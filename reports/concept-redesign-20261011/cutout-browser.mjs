import {chromium} from '/Users/lillypad/Projects/scene-account-20261010/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.LUMA_RELEASE_URL;assert.ok(base);
const browser=await chromium.launch({channel:'chrome'}),results=[];
try{for(const width of [1440,390]){
const page=await browser.newPage({viewport:{width,height:900},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(45000);await page.goto(base+'/cutout');await page.getByRole('heading',{name:'Cutout',exact:true}).waitFor();
const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle='#df2045';x.fillRect(0,0,160,120);return c.toDataURL().split(',')[1]});
await page.locator('input[type=file]').first().setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
const canvas=page.getByLabel('Cutout mask editor',{exact:true});await canvas.waitFor();await page.getByRole('button',{name:'Erase',exact:true}).click();await canvas.click({position:{x:40,y:40}});await page.getByRole('button',{name:'Undo mask edit',exact:true}).waitFor({state:'visible'});
const pixels=()=>canvas.evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let transparent=0;for(let i=3;i<a.length;i+=4)if(a[i]<255)transparent++;return transparent});
// Preview uses a checkerboard; verify exported alpha independently instead.
async function pngAlpha(){const event=page.waitForEvent('download');await page.getByRole('button',{name:'PNG',exact:true}).click();const f=await event;const b=await readFile(await f.path());return page.evaluate(async s=>{const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);const a=x.getImageData(0,0,c.width,c.height).data;let transparent=0;for(let n=3;n<a.length;n+=4)if(a[n]<255)transparent++;return {width:c.width,height:c.height,transparent}},b.toString('base64'));}
const erased=await pngAlpha();assert.ok(erased.transparent>0);await page.getByRole('button',{name:'Undo mask edit',exact:true}).click();assert.equal((await pngAlpha()).transparent,0);
await canvas.click({position:{x:40,y:40}});const saved=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).click();const project=await saved,bytes=await readFile(await project.path());
await page.getByLabel('Open Cutout project',{exact:true}).setInputFiles({name:'roundtrip.cutout',mimeType:'application/octet-stream',buffer:bytes});assert.deepEqual(await pngAlpha(),erased);assert.deepEqual(errors,[]);await page.screenshot({path:`/Users/lillypad/Projects/luma-integration-20261009/reports/concept-redesign-20261011/cutout-${width}.png`});results.push({width,maskUndoSaveReopenExport:true,erased});await page.close();console.log('CUTOUT_PASS',width);
}await writeFile('/Users/lillypad/Projects/luma-integration-20261009/reports/concept-redesign-20261011/cutout-browser.json',JSON.stringify({base,results},null,2));}finally{await browser.close()}
