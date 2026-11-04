import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser=await chromium.launch({channel:'chrome'}),results=[];
try {
 for(const width of [1440,1024]) {
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(process.env.LUMA_DESKTOP_URL ?? 'http://localhost:4198/',{waitUntil:'domcontentloaded'});
  await page.locator('.spatial-export:not(:disabled)').waitFor();
  const header=await page.locator('.studio-titlebar').boundingBox(), actions=await page.locator('.spatial-share-actions').boundingBox();
  assert.ok(actions.y>=header.y && actions.y+actions.height<=header.y+header.height);
  assert.ok(actions.x+actions.width<=width);
  await page.getByRole('group',{name:'Choose a workspace'}).getByRole('button',{name:'Photo',exact:true}).click();
  await page.locator('#studio-canvas[aria-label*="tone"]').waitFor();
  await page.getByRole('button',{name:'Switch to light appearance'}).click();
  await page.getByRole('button',{name:'Switch to dark appearance'}).click();
  await page.waitForTimeout(250);
  await page.screenshot({path:`reports/creatingco-ui/native-${width}.png`});
  assert.deepEqual(errors,[]);results.push({width,headerFits:true,workspaceActivation:true,appearanceToggle:true,errors});await page.close();
 }
 await writeFile('reports/creatingco-ui/native-smoke.json',JSON.stringify(results,null,2));
} finally {await browser.close();}
