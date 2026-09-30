import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lumaSharedFields,applyLumaSharedFields} from '../app/studio/collaboration';
import type {Studio} from '../app/engine/studio';
test('Luma schema excludes locked opacity and applies only supported properties',()=>{
  const layers=[{id:'a',name:'Art',visible:true,opacity:1},{id:'b',name:'Locked',visible:true,opacity:1}];
  const calls:unknown[][]=[];
  const studio={doc:{layers},isLayerLocked:(id:string)=>id==='b',setLayerProp:(...args:unknown[])=>calls.push(args)} as unknown as Studio;
  const fields=lumaSharedFields(studio);assert.equal(fields.length,5);assert.ok(!fields.some(f=>f.id==='b:opacity'));
  applyLumaSharedFields(studio,{'a:name':'Cover','a:opacity':0.5,'a:unknown':2});
  assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.slice(0,3)),[['a','name','Cover'],['a','opacity',0.5]]);
});
