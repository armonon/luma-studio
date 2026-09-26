// Real desktop-shell controls in isolated WebKit; NOT installed-app qualification.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";
const { webkit } = await import(process.env.LUMA_PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LUMA_UI_URL ?? "http://127.0.0.1:4183/";
assert.equal(new URL(base).hostname,"127.0.0.1");
const sourceSha256 = releaseSourceId(), release = acquireQualificationLock("Vector delivery UI");
const output = await mkdtemp(resolve("artifacts/vector-delivery-ui-"));
const context = await webkit.launchPersistentContext(join(output,"profile"),{headless:true,viewport:{width:1440,height:900},acceptDownloads:true});
const page = await context.newPage(), errors=[], checks=[];
const report={sourceSha256,scope:"Synthetic grouped design, WebKit desktop shell, real SVG/PDF downloads; not installed macOS or professional-project qualification",pass:false,checks,errors};
page.on("pageerror",error=>errors.push(error.message));page.setDefaultTimeout(30000);
const watchdog=setTimeout(()=>void context.close(),180000);
const open=async format=>{
  await page.getByRole("button",{name:"Export",exact:true}).click();
  await page.getByRole("button",{name:format==="svg"?"Export SVG":"Export vector PDF",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:`Review ${format.toUpperCase()} delivery`});await dialog.waitFor();return dialog;
};
try{
  await page.addInitScript(()=>localStorage.setItem("luma.scripting","on"));
  await page.route("**/*",route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  await page.goto(base);await page.waitForFunction(()=>window.luma?.studio.doc.layers.length>0);
  await page.getByRole("status",{name:"Restoring workspace"}).waitFor({state:"hidden"});
  await page.evaluate(()=>{
    const s=window.luma.studio;s.resetDocument(320,240,"Grouped brand proof");
    const a=s.addShapeLayer({kind:"rect",x:30,y:30,w:180,h:130,fill:"#ed7542",stroke:"none",strokeWidth:0,radius:0});
    const b=s.addShapeLayer({kind:"ellipse",x:110,y:70,w:140,h:120,fill:"#2876cc",stroke:"none",strokeWidth:0,radius:0});
    const group=s.groupLayers([a.id,b.id]);s.setLayerProp(group.id,"opacity",.65);
  });
  for(const [width,height]of [[1280,800],[1440,900],[1920,1080]]){
    await page.setViewportSize({width,height});const dialog=await open("svg");
    await dialog.getByText("Fully editable",{exact:true}).waitFor();
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    for(let i=0;i<4;i++){await page.keyboard.press("Tab");assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
    await page.screenshot({path:join(output,`ready-${width}x${height}.png`)});
    await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
  }
  checks.push("Ready preflight at three sizes; focus trap and Escape");
  for(const format of ["svg","pdf"]){
    const dialog=await open(format), downloadPromise=page.waitForEvent("download");
    await dialog.getByRole("button",{name:`Export ${format.toUpperCase()} copy`}).click();
    const download=await downloadPromise;await download.saveAs(join(output,`grouped-brand.${format}`));
    await dialog.waitFor({state:"hidden"});assert.equal(await download.failure(),null);
  }
  const svg=await readFile(join(output,"grouped-brand.svg"),"utf8");assert.match(svg,/opacity="0.65"/);assert.doesNotMatch(svg,/<image/);
  checks.push("Grouped SVG and PDF downloaded through actual export controls");
  if(process.env.LUMA_DELIVERY_FIXTURE_DIR){
    const bytes=await readFile(join(process.env.LUMA_DELIVERY_FIXTURE_DIR,"svg-group-sparse.luma"));
    await page.evaluate(async encoded=>{const blob=new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]);await window.luma.studio.importProject(blob);},bytes.toString("base64"));
    for(const format of ["svg","pdf"]){
      const dialog=await open(format);await dialog.getByText("Fully editable",{exact:true}).waitFor();
      await page.screenshot({path:join(output,`soft-mask-${format}-preflight.png`)});
      const promise=page.waitForEvent("download");await dialog.getByRole("button",{name:`Export ${format.toUpperCase()} copy`}).click();
      const download=await promise;await download.saveAs(join(output,`masked-group.${format}`));assert.equal(await download.failure(),null);await dialog.waitFor({state:"hidden"});
    }
    const maskedSvg=await readFile(join(output,"masked-group.svg"),"utf8");assert.match(maskedSvg,/<mask /);assert.match(maskedSvg,/<image /);assert.match(maskedSvg,/<path /);
    checks.push("Saved soft-mask project reopened, approved and exported via real SVG/PDF controls; geometry and mask retained");
    report.maskProjectSha256=createHash("sha256").update(bytes).digest("hex");
  }
  let dialog=await open("svg");
  await page.evaluate(()=>{const s=window.luma.studio;s.setLayerProp(s.doc.layers[0].id,"opacity",.5);});
  await dialog.getByRole("button",{name:"Export SVG copy"}).click();await dialog.getByRole("alert").filter({hasText:"changed"}).waitFor();
  await dialog.getByRole("button",{name:"Keep editing"}).click();checks.push("Revision change rejected after preflight");
  const blockedId=await page.evaluate(()=>{const s=window.luma.studio;return s.addBlankRaster("Photo requiring conversion").id;});
  dialog=await open("svg");await dialog.getByText("Export blocked",{exact:true}).waitFor();
  assert.equal(await dialog.getByRole("button",{name:"Export SVG copy"}).count(),0);
  await page.screenshot({path:join(output,"blocked.png")});
  await dialog.getByRole("button",{name:"Show Photo requiring conversion"}).click();await dialog.waitFor({state:"hidden"});
  assert.ok(await page.evaluate(id=>window.luma.studio.doc.layers.some(l=>l.id===id),blockedId));
  checks.push("Unsupported raster blocked with object-specific route back to editing");
  assert.deepEqual(errors,[]);report.pass=true;
}catch(error){report.error=String(error);await page.screenshot({path:join(output,"failure.png")}).catch(()=>{});process.exitCode=1;}
finally{
  clearTimeout(watchdog);await context.close();report.unchanged=releaseSourceId()===sourceSha256;
  report.harnessSha256=createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
  if(!report.unchanged) {report.pass=false;process.exitCode=1;}
  await writeFile(join(output,"report.json"),JSON.stringify(report,null,2));release();console.log(JSON.stringify({output,...report},null,2));
}
