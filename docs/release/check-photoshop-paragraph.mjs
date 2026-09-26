// Independent, bounded Photoshop paragraph fixture. Only fresh private files
// and documents are created. This is not a real-project corpus qualification.
import "../../tests/canvas-harness.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { importPsd, exportPhotoshopDocument } from "../../app/engine/psd.ts";
import { readPsd } from "../../app/engine/ag-psd-io.ts";
import { encodeLumaProject, decodeLumaProject } from "../../app/engine/project.ts";
import { releaseSourceId } from "../../build/release-source-id.mjs";
import { acquireQualificationLock } from "../../build/qualification-lock.mjs";

const exec = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const folder = await mkdtemp(resolve("artifacts/photoshop-paragraph-"));
const sourceSha256 = releaseSourceId(), release = acquireQualificationLock("Independent Photoshop paragraph");
const apple = 'on run argv\ntell application "Adobe Photoshop 2026"\nwith timeout of 90 seconds\nreturn do javascript (item 1 of argv) with arguments {item 2 of argv,item 3 of argv}\nend timeout\nend tell\nend run';
const sourceScript = String.raw`(function(a){
  var file=new File(a[0]), png=new File(a[1]); if(file.exists||png.exists)throw Error('Refusing overwrite');
  var previous=app.documents.length?app.activeDocument:null, units=app.preferences.rulerUnits,dialogs=app.displayDialogs,doc=null;
  try{app.preferences.rulerUnits=Units.PIXELS;app.displayDialogs=DialogModes.NO;
    doc=app.documents.add(600,400,72,'Luma private paragraph fixture',NewDocumentMode.RGB,DocumentFill.TRANSPARENT);
    var layer=doc.artLayers.add();layer.kind=LayerKind.TEXT;layer.name='Editable paragraph';var t=layer.textItem;
    t.kind=TextType.PARAGRAPHTEXT;t.position=[UnitValue(40,'px'),UnitValue(40,'px')];t.width=UnitValue(300,'px');t.height=UnitValue(250,'px');
    t.font='ArialMT';if(t.font!=='ArialMT')throw Error('Exact font unavailable');t.size=UnitValue(24,'pt');t.useAutoLeading=false;t.leading=UnitValue(30,'pt');
    t.justification=Justification.LEFT;t.contents='Professional trust requires editable text, wrapping, and reliable delivery.\rSecond paragraph remains editable.';
    var color=new SolidColor();color.rgb.red=20;color.rgb.green=40;color.rgb.blue=60;t.color=color;
    doc.saveAs(file,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);doc.saveAs(png,new PNGSaveOptions(),true,Extension.LOWERCASE);
    return app.version;
  }finally{if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);app.preferences.rulerUnits=units;app.displayDialogs=dialogs;if(previous)try{app.activeDocument=previous;}catch(ignore){}}
})(arguments);`;
const reopenScript = String.raw`(function(a){
  var input=new File(a[0]),png=new File(a[1]);if(!input.exists||png.exists)throw Error('Unsafe private output');
  for(var i=0;i<app.documents.length;i++){try{if(app.documents[i].fullName.fsName===input.fsName)throw Error('LUMA_ALREADY_OPEN');}catch(e){if(String(e).indexOf('LUMA_ALREADY_OPEN')>=0)throw e;}}
  var previous=app.documents.length?app.activeDocument:null,units=app.preferences.rulerUnits,dialogs=app.displayDialogs,doc=null;
  try{app.preferences.rulerUnits=Units.PIXELS;app.displayDialogs=DialogModes.NO;doc=app.open(input);
    var t=doc.artLayers[0].textItem;if(t.kind!==TextType.PARAGRAPHTEXT)throw Error('Paragraph became point text');
    if(Math.abs(t.width.as('px')-300)>0.1||Math.abs(t.height.as('px')-250)>0.1)throw Error('Paragraph frame dimensions changed');
    if(t.contents.indexOf('Professional proof')!==0)throw Error('Edited story did not survive');
    t.contents=t.contents; // Force Photoshop to regenerate, not merely display a cached raster.
    doc.saveAs(png,new PNGSaveOptions(),true,Extension.LOWERCASE);
    return app.version+'|'+t.width.as('px')+'|'+t.height.as('px');
  }finally{if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);app.preferences.rulerUnits=units;app.displayDialogs=dialogs;if(previous)try{app.activeDocument=previous;}catch(ignore){}}
})(arguments);`;
const report = { scope: "One independently authored paragraph PSD; structural editability, not complete visual fidelity or production corpus", sourceSha256, generatedAt: new Date().toISOString(), pass: false };
try {
  const input = join(folder, "photoshop-source.psd");
  report.photoshop = (await exec("osascript", ["-e", apple, sourceScript, input, join(folder, "photoshop-source.png")], { timeout: 95000 })).stdout.trim();
  const bytes = await readFile(input), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  report.inputSha256 = hash(bytes);
  report.originalText = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true }).children.find(layer => layer.text)?.text;
  const doc = await importPsd(buffer), layer = doc.layers.find(layer => layer.text);
  assert.ok(layer); report.importedText = layer.text;
  assert.equal(layer.text.layout, "paragraph");
  assert.equal(layer.text.boxWidth, 300); assert.equal(layer.text.boxHeight, 250);
  layer.text.text = layer.text.text.replace("Professional trust", "Professional proof");
  const project = await encodeLumaProject(doc, [], "Paragraph trust");
  await writeFile(join(folder, "edited.luma"), new Uint8Array(await project.arrayBuffer()), { flag: "wx" });
  const restored = (await decodeLumaProject(project)).doc;
  const exported = exportPhotoshopDocument(restored);
  report.preflight = exported.report;
  const output = join(folder, "edited.psd");
  await writeFile(output, new Uint8Array(exported.buffer), { flag: "wx" });
  report.outputSha256 = hash(new Uint8Array(exported.buffer));
  report.externalReopen = (await exec("osascript", ["-e", apple, reopenScript, output, join(folder, "photoshop-reopened.png")], { timeout: 95000 })).stdout.trim();
  report.pass = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  report.unchanged = sourceSha256 === releaseSourceId();
  report.harnessSha256 = hash(await readFile(new URL(import.meta.url)));
  await writeFile(join(folder, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ folder, pass: report.pass, error: report.error })); release();
}
