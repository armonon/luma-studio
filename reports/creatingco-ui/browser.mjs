const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome'}), results=[];
try {
 for (const width of [1440,1280,1024,390]) {
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  await context.addInitScript(()=>localStorage.setItem('luma.scripting','on'));
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(120000);
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://localhost:4197'+(width<700?'/iphone':'/studio'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.luma?.studio.doc.layers.length>0);
  await page.getByRole('status',{name:'Restoring workspace'}).waitFor({state:'hidden'});
  page.setDefaultTimeout(45000);
  if(width>=700) {
   const spaces=page.getByRole('group',{name:'Choose a workspace'});
   const header=await page.locator('.studio-titlebar').boundingBox();
   const actions=await page.locator('.spatial-share-actions').boundingBox();
   assert.ok(actions.y>=header.y && actions.y+actions.height<=header.y+header.height);
   assert.ok(actions.x+actions.width<=width);
   const identity=await page.evaluate(()=>({id:window.luma.studio.doc.id,layers:window.luma.layers().map(l=>l.id),history:window.luma.history()}));
   await spaces.getByRole('button',{name:'Photo',exact:true}).click();
   await page.locator('.creatingco-space-menu summary').click();
   await page.getByRole('button',{name:'Retouch',exact:true}).click();
   await page.locator('.primary-tool-categories button.active[aria-label*="Healing"]').waitFor();
   const photoPanels=await page.locator('.dock-tabs [role="tab"][aria-selected="true"]').allTextContents();
   await spaces.getByRole('button',{name:'Design',exact:true}).click();
   await page.locator('.creatingco-space-menu summary').click();
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('.creatingco-space-menu').getAttribute('open'),null);
   assert.equal(await page.locator('.creatingco-space-menu summary').evaluate(e=>e===document.activeElement),true);
   await spaces.getByRole('button',{name:'Photo',exact:true}).click();
   await page.locator('.primary-tool-categories button.active[aria-label*="Healing"]').waitFor();
   await spaces.getByRole('button',{name:'Photo',exact:true}).click();
   await page.locator('.primary-tool-categories button.active[aria-label*="Healing"]').waitFor();
   assert.deepEqual(await page.locator('.dock-tabs [role="tab"][aria-selected="true"]').allTextContents(),photoPanels);
   assert.deepEqual(await page.evaluate(()=>({id:window.luma.studio.doc.id,layers:window.luma.layers().map(l=>l.id),history:window.luma.history()})),identity);
   await page.getByRole('button',{name:'Open version history',exact:true}).click();
   await page.locator('.spatial-command[aria-label="Version history"]').waitFor();
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Switch to light appearance'}).click();
   assert.equal(await page.locator('[data-app-shell]').getAttribute('data-appearance'),'light');
   await page.waitForTimeout(250);
  await page.screenshot({path:`reports/creatingco-ui/light-${width}.png`});
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Switch to dark appearance'}).waitFor();
   await page.getByRole('status',{name:'Restoring workspace'}).waitFor({state:'hidden'});
   assert.equal(await page.locator('[data-app-shell]').getAttribute('data-appearance'),'light');
   await page.getByRole('button',{name:'Switch to dark appearance'}).click();
  }
  if(width===1440) {
   await page.getByRole('group',{name:'Choose a workspace'}).getByRole('button',{name:'Create',exact:true}).click();
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=160;const x=c.getContext('2d');x.fillStyle='#d0a060';x.fillRect(0,0,240,160);return c.toDataURL().split(',')[1]});
   await page.getByLabel('Open a file',{exact:true}).setInputFiles({name:'ui-smoke.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await page.waitForFunction(()=>window.luma.studio.doc.width===240);
   await page.locator('#studio-canvas[aria-label*="brush"]').waitFor();
   const image=page.locator('#studio-canvas canvas').first(), box=await image.boundingBox();
   const before=await page.evaluate(()=>window.luma.history().operations);
   await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();
   await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:12});await page.mouse.up();
   await page.waitForFunction(n=>window.luma.history().operations>n,before);
   await page.locator('.spatial-share-actions').getByRole('button',{name:'Undo',exact:true}).click();
   assert.ok(await page.evaluate(()=>window.luma.studio.canRedo()));
   await page.locator('.spatial-share-actions').getByRole('button',{name:'Redo',exact:true}).click();
   await page.getByRole('button',{name:'Export',exact:true}).click();
   await page.getByRole('combobox',{name:'Raster export format'}).selectOption('png');
   const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
   const download=await exported;await download.saveAs('reports/creatingco-ui/edited-export.png');
   await page.keyboard.press('Escape');
  }
  await page.locator('.spatial-export:not(:disabled)').waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false);
  await page.waitForTimeout(250);
  await page.screenshot({path:`reports/creatingco-ui/dark-${width}.png`});
  assert.deepEqual(errors,[]);
  results.push({width,overflow,errors});console.log('PASS',width);await context.close();
 }
 await writeFile('reports/creatingco-ui/browser.json',JSON.stringify(results,null,2));
} finally {await browser.close();}
