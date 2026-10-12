import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMockupStates, readMockupProject } from '../app/engine/mockup-project';
test('project preserves every scene setting independently',()=>{
 const states=initialMockupStates();states.tshirt.placement.rotation=47;states.hoodie.color='#abcdef';states.tote.ink=.72;
 const p={format:'luma-mockups',version:1,scene:'tote',states,artwork:'data:image/png;base64,aGVsbG8='};
 assert.deepEqual(readMockupProject(JSON.parse(JSON.stringify(p))),{scene:'tote',states,artwork:p.artwork});
});
test('reject unknown project formats and unsafe artwork sources',()=>{
 const p={format:'luma-mockups',version:1,states:initialMockupStates(),artwork:'data:image/png;base64,aA=='};
 for(const patch of [{version:2},{artwork:'https://example.com/a.png'},{artwork:'data:image/svg+xml,<svg/>'},{states:{}},{states:{...p.states,tshirt:{color:'red',ink:NaN,placement:{}}}}]) assert.throws(()=>readMockupProject({...p,...patch}));
});
test('normalize imported placement and ink to supported bounds',()=>{
 const states=initialMockupStates();states.tshirt.placement.scale=999;states.tshirt.ink=-1;
 const p=readMockupProject({format:'luma-mockups',version:1,states,artwork:'data:image/png;base64,aA=='});
 assert.equal(p.states.tshirt.placement.scale,3);assert.equal(p.states.tshirt.ink,.5);
 assert.equal(initialMockupStates().tshirt.placement.scale,.9);
});
