import {chromium} from '/Users/lillypad/Projects/scene-account-20261010/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base=process.env.LUMA_RELEASE_URL??'http://localhost:4191';
const browser=await chromium.launch({channel:'chrome'}), results=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('luma.scripting','on'));
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base+(width<700?'/iphone':'/studio'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.luma?.studio.doc.layers.length>0);
  await page.getByRole('status',{name:'Restoring workspace'}).waitFor({state:'hidden'});
  console.log('READY',width);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='#ed2349';x.fillRect(0,0,64,48);x.fillStyle='#236bed';x.fillRect(0,0,16,48);return c.toDataURL('image/png').split(',')[1]});
  await page.getByLabel('Open a file',{exact:true}).setInputFiles({name:'integration-colors.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>window.luma.studio.doc.layers.some(l=>l.name?.includes('integration-colors')));
  console.log('IMPORTED',width);
  if(width>=700){
    const count=await page.evaluate(()=>window.luma.studio.doc.layers.length);
    await page.getByRole('button',{name:'Add paint layer',exact:true}).click();
    await page.waitForFunction(n=>window.luma.studio.doc.layers.length===n+1,count);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(n=>window.luma.studio.doc.layers.length===n,count);
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await page.waitForFunction(n=>window.luma.studio.doc.layers.length===n+1,count);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(n=>window.luma.studio.doc.layers.length===n,count);
    const blend=page.getByRole('combobox',{name:'Layer blend mode',exact:true});
    console.log('BLEND_FOUND'); await blend.selectOption('multiply'); console.log('BLEND_CHANGED');
    await page.waitForFunction(()=>document.querySelector('[aria-label="Layer blend mode"]')?.value==='multiply',{},{timeout:15000}).catch(async e=>{console.log('BLEND_STATE',await page.evaluate(()=>({value:document.querySelector('[aria-label="Layer blend mode"]')?.value,layers:window.luma.studio.doc.layers.map(l=>({id:l.id,locked:l.locked,blend:l.blend,stack:l.blendStack}))})));throw e});
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Layer blend mode"]')?.value==='source-over'); console.log('BLEND_UNDONE');
    await page.locator('.blend-stack-disclosure > summary').click();
    await page.getByRole('button',{name:'＋ Add blend mode',exact:true}).click();
    await page.getByRole('combobox',{name:'Blend mode for pass 2',exact:true}).waitFor();
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await blend.waitFor();
    await page.locator('.blend-stack-disclosure > summary').click();
    console.log('EDIT_UNDO_REDO_AND_BLENDING',width);
  }
  await page.screenshot({path:`/Users/lillypad/Projects/luma-integration-20261009/reports/concept-redesign-20261011/imported-${width}.png`});
  if(width>=700)await page.getByLabel('More application actions',{exact:true}).click();
  const saved=page.waitForEvent('download');await page.getByRole('button',{name:width<700?'Save project':/^Save project/,exact:width<700}).click();const project=await saved;const projectBytes=await readFile(await project.path());assert.ok(projectBytes.length>100);
  await page.getByRole('button',{name:'I verified the saved file',exact:true}).click();
  await page.getByLabel('Open a Luma project',{exact:true}).setInputFiles({name:'integration-reopened.luma',mimeType:'application/x-luma-project',buffer:projectBytes});
  await page.waitForFunction(()=>window.luma.studio.doc.layers.some(l=>l.name?.includes('integration-colors')));
  await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByRole('combobox',{name:'Raster export format'}).selectOption('png');
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const download=await exported,bytes=await readFile(await download.path());assert.equal(bytes.subarray(1,4).toString(),'PNG');
  const colors=await page.evaluate(async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let red=0,blue=0;for(let i=0;i<p.length;i+=4){if(p[i]>200&&p[i+1]<80&&p[i+2]<120)red++;if(p[i]<80&&p[i+1]<150&&p[i+2]>200)blue++;}return {width:c.width,height:c.height,red,blue}},bytes.toString('base64'));assert.ok(colors.red>100&&colors.blue>100,JSON.stringify(colors));
  await page.screenshot({path:`/Users/lillypad/Projects/luma-integration-20261009/reports/concept-redesign-20261011/editor-${width}.png`});assert.deepEqual(errors,[]);results.push({width,importSaveReopenExport:true,colors,pageErrors:errors});console.log('PASS',width,colors);await context.close();
 }
 await writeFile('/Users/lillypad/Projects/luma-integration-20261009/reports/concept-redesign-20261011/browser.json',JSON.stringify({base,results},null,2));
}finally{await browser.close()}
