// Run with tsx, LUMA_UI_URL (local desktop:dev), LUMA_PLAYWRIGHT_MODULE, and
// optionally LUMA_CHROMIUM_EXECUTABLE. No private images or production writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { matrixTrcIcc } from '../tests/icc-fixture.ts';

const { chromium } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.LUMA_UI_URL ?? 'http://127.0.0.1:4187';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Qualification is local only');
const output = resolve(process.env.LUMA_COLOR_OUTPUT ?? 'artifacts/raster-color');
await mkdir(output, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const report = {
  source_sha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  source_status: execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).trim(),
  diff_sha256: hash(execFileSync('git', ['diff'])),
  harness_sha256: hash(await readFile(new URL(import.meta.url))),
  observed_at: new Date().toISOString(), node: process.version, checks: [], pass: false,
  reference: 'Independent browser decode to an sRGB canvas; RGB tolerance 2, alpha exact. PNGs also compared with independent native canvas decode. Invisible RGB is canonicalized by canvas, not claimed preserved.',
  scope: 'Actual file-input import, PNG download twice, .luma save/download/confirm, actual close/reopen and PNG download. Synthetic opaque, partial-alpha, transparent and embedded matrix/TRC ICC images. CPU desktop shell in a local browser; not native, OS color calibration, every ICC profile or deployment qualification.',
};
function fixture(width, height, mode) {
  const c = createCanvas(width, height), ctx = c.getContext('2d'), p = ctx.createImageData(width, height);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const i=(y*width+x)*4, border=x===0||y===0||x===width-1||y===height-1;
    p.data[i]=border?((x+y)%2?255:0):Math.floor(x*255/(width-1));
    p.data[i+1]=Math.floor(y*255/(height-1)); p.data[i+2]=(x+y)%256;
    const circle=Math.hypot(x-width*.5,y-height*.5)-height*.22;
    p.data[i+3]=mode==='opaque'?255:mode==='alpha'&&x<20?0:circle<-.5?160:circle<.5?Math.round(160+95*(circle+.5)):255;
  }
  ctx.putImageData(p,0,0); return c.toBuffer('image/png');
}
function withIcc(png) {
  const type=Buffer.from('iCCP'), data=Buffer.concat([Buffer.from('Synthetic sRGB matrix profile\0'),Buffer.from([0]),deflateSync(matrixTrcIcc())]);
  const chunk=Buffer.alloc(12+data.length);chunk.writeUInt32BE(data.length);type.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE(crc32(Buffer.concat([type,data])),8+data.length);
  return Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]); // after IHDR, before IDAT
}
const fixtures = [
  {name:'retained-gradient',width:2048,height:1536,bytes:fixture(2048,1536,'partial')},
  {name:'opaque-icc',width:513,height:257,bytes:withIcc(fixture(513,257,'opaque'))},
  {name:'transparent-alpha',width:515,height:259,bytes:fixture(515,259,'alpha')},
];
const decode=async file=>{const image=await loadImage(await readFile(file));const c=createCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);return {width:image.width,height:image.height,data:c.getContext('2d').getImageData(0,0,image.width,image.height).data};};
const compare=async(a,b)=>{const x=await decode(a),y=await decode(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);let maxRGB=0,maxAlpha=0,changed=0;for(let i=0;i<x.data.length;i++){const d=Math.abs(x.data[i]-y.data[i]);if(i%4===3)maxAlpha=Math.max(maxAlpha,d);else maxRGB=Math.max(maxRGB,d);if(d)changed++;}return {maxRGB,maxAlpha,changedChannels:changed};};
const check=(name,data)=>{const entry={name,...data,status:'PASS'};if(data?.metrics&&(data.metrics.maxRGB>2||data.metrics.maxAlpha!==0))entry.status='FAIL';report.checks.push(entry);console.log(JSON.stringify(entry));assert.equal(entry.status,'PASS',name);};
const browser=await chromium.launch({headless:true,...(process.env.LUMA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LUMA_CHROMIUM_EXECUTABLE}:{})});
report.browser=await browser.version();const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const watchdog=setTimeout(()=>void browser.close(),600000);
const exportPng=async file=>{await page.getByRole('button',{name:'Export',exact:true}).click();const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export PNG',exact:true}).click()]);await d.saveAs(file);assert.equal(await d.failure(),null);if(await page.getByRole('button',{name:'Close export menu'}).isVisible())await page.getByRole('button',{name:'Close export menu'}).click();};
try {
  await page.addInitScript(()=>localStorage.setItem('luma.scripting','on'));
  await page.route('**/*',route=>/^(blob:|data:)/.test(route.request().url())||new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.luma?.studio?.doc?.layers.length>0);await page.getByRole('status',{name:'Restoring workspace'}).waitFor({state:'hidden'});
  for(const f of fixtures) {
    const path=join(output,`${f.name}.png`), reference=join(output,`${f.name}-reference.png`);await writeFile(path,f.bytes);
    const independent=await page.evaluate(async bytes=>{const b=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),v=>v.charCodeAt(0))],{type:'image/png'}));const c=document.createElement('canvas');c.width=b.width;c.height=b.height;c.getContext('2d',{colorSpace:'srgb'}).drawImage(b,0,0);b.close();return c.toDataURL('image/png').split(',')[1];},f.bytes.toString('base64'));
    await writeFile(reference,Buffer.from(independent,'base64'));
    await page.getByLabel('Open a file',{exact:true}).setInputFiles(path);await page.waitForFunction(({width,height})=>window.luma.studio.doc.width===width&&window.luma.studio.doc.height===height,f);
    const imported=await page.evaluate(()=>{const s=window.luma.studio,l=s.doc.layers[0];return {useGL:s.useGL,bitmap:l.bitmap.toDataURL('image/png').split(',')[1],profile:l.source?.colorProfile??null};});assert.equal(imported.useGL,false);if(f.name==='opaque-icc'){assert.equal(imported.profile?.name,'Synthetic sRGB matrix profile');assert.equal(imported.profile?.browserDecoded,true);check('Embedded ICC recognized before comparison',{profile:imported.profile});}
    const bitmap=join(output,`${f.name}-bitmap.png`);await writeFile(bitmap,Buffer.from(imported.bitmap,'base64'));
    check(`${f.name}: independent decode versus imported bitmap`,{metrics:await compare(reference,bitmap),fixture_sha256:hash(f.bytes)});
    const exported=join(output,`${f.name}-export.png`);await exportPng(exported);check(`${f.name}: first CPU PNG`,{metrics:await compare(reference,exported)});
    const repeated=join(output,`${f.name}-repeat.png`);await exportPng(repeated);check(`${f.name}: repeat CPU PNG`,{metrics:await compare(reference,repeated)});assert.equal((await compare(exported,repeated)).maxRGB,0);
    const downloadProject = async file => {
      await page.getByLabel('More application actions').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button',{name:/^Save project(?:\s|$)/}).click(),
      ]);
      await download.saveAs(file); assert.equal(await download.failure(),null);
      assert.ok((await readFile(file)).length>100);
      // The busy overlay must not intercept the required confirmation buttons.
      await page.getByRole('alertdialog',{name:'Saving project',exact:true}).waitFor({state:'hidden'});
    };
    if(f.name==='retained-gradient') {
      await downloadProject(join(output,'unconfirmed.luma'));
      await page.waitForFunction(()=>document.activeElement?.textContent==='Keep document unsaved');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'I verified the saved file');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Keep document unsaved');
      await page.keyboard.press('Enter');
      await page.getByRole('dialog',{name:'Check your downloaded project',exact:true}).waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>window.luma.studio.activeDocumentState().dirty),true);
      check('Keyboard Tab/Shift+Tab/Enter decline preserves dirty state and permits retry');
    }
    if(f.name==='opaque-icc') {
      await downloadProject(join(output,'escape-unconfirmed.luma'));
      await page.keyboard.press('Escape');
      await page.getByRole('dialog',{name:'Check your downloaded project',exact:true}).waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>window.luma.studio.activeDocumentState().dirty),true);
      check('Escape declines confirmation without marking the document saved');
    }
    const project=join(output,`${f.name}.luma`);
    await downloadProject(project);
    await page.getByRole('button',{name:'I verified the saved file',exact:true}).click();
    await page.waitForFunction(()=>!window.luma.studio.activeDocumentState().dirty);
    const state=await page.evaluate(()=>window.luma.studio.activeDocumentState());await page.getByRole('button',{name:`Close ${state.name}`,exact:true}).click();await page.waitForFunction(id=>!window.luma.studio.listDocuments().some(d=>d.id===id),state.id);
    await page.getByLabel('Open a Luma project',{exact:true}).setInputFiles(project);await page.waitForFunction(({width,height})=>window.luma.studio.doc.width===width&&window.luma.studio.doc.height===height,f);
    const reopened=join(output,`${f.name}-reopened.png`);await exportPng(reopened);check(`${f.name}: saved/closed/reopened CPU PNG`,{metrics:await compare(reference,reopened),archive_sha256:hash(await readFile(project))});assert.equal((await compare(exported,reopened)).maxRGB,0);
  }
  assert.deepEqual(errors,[]);report.pass=true;
} catch(error) {report.error=String(error);report.stack=error.stack;report.body=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally {clearTimeout(watchdog);report.errors=errors;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,error:report.error,checks:report.checks.length}));}
