import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoutSize, paintCutoutMask } from "../app/engine/cutout";
import { mattingModelInputs } from "../app/engine/neural";
test("MODNet receives its named ONNX input without changing other models",()=>{
  const tensor={data:new Float32Array([1]),dims:[1,1]},inputs={pixel_values:tensor};
  assert.equal(mattingModelInputs(inputs,"Xenova/modnet").input,tensor);
  assert.equal(mattingModelInputs(inputs,"other/model"),inputs);
});
test("cutout bounds image memory without upscaling", () => {
  assert.deepEqual(cutoutSize(8000,4000),{width:2048,height:1024});
  assert.deepEqual(cutoutSize(200,100),{width:200,height:100});
  assert.throws(()=>cutoutSize(NaN,30));
});
test("erase/restore strokes remain continuous and bounded", () => {
  const mask=new Uint8ClampedArray(100*100).fill(255);
  paintCutoutMask(mask,100,100,{x:10,y:50},{x:90,y:50},5,false);
  assert.equal(mask[50*100+50],0);assert.equal(mask[0],255);
  paintCutoutMask(mask,100,100,{x:50,y:50},{x:50,y:50},5,true);
  assert.equal(mask[50*100+50],255);assert.equal(mask[50*100+20],0);
  paintCutoutMask(mask,100,100,{x:0,y:0},{x:0,y:0},5,false);
  assert.equal(mask.length,10000);assert.throws(()=>paintCutoutMask(mask,3,3,{x:0,y:0},{x:1,y:1},2,false));
});
