import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { openCutoutProject, saveCutoutProject } from "../app/engine/cutout-project";

const project = {name:"Soft edges",width:2,height:1,feather:2.5,rgba:new Uint8ClampedArray([255,0,0,128,0,255,0,255]),mask:new Uint8ClampedArray([0,180])};
test("Cutout project preserves source alpha, editable mask and feather", async()=>{
 const blob=await saveCutoutProject(project);
 assert.deepEqual(await openCutoutProject(await blob.arrayBuffer()),project);
});
test("invalid dimensions and mask lengths fail before export", async()=>{
 await assert.rejects(saveCutoutProject({...project,width:10000}),/dimensions/);
 await assert.rejects(saveCutoutProject({...project,mask:new Uint8ClampedArray(1)}),/pixels/);
});
test("bounded archive reader rejects extra entries, unsupported versions and inflated assets", async()=>{
 const zip=await JSZip.loadAsync(await (await saveCutoutProject(project)).arrayBuffer());
 zip.file("extra","unexpected");
 await assert.rejects(openCutoutProject(await zip.generateAsync({type:"arraybuffer"})),/archive/);
 zip.remove("extra"); zip.file("mask.alpha",new Uint8Array(10000));
 await assert.rejects(openCutoutProject(await zip.generateAsync({type:"arraybuffer",compression:"DEFLATE"})),/admitted size/);
 zip.file("manifest.json",JSON.stringify({type:"luma-cutout",version:5}));
 await assert.rejects(openCutoutProject(await zip.generateAsync({type:"arraybuffer"})),/supported/);
});
