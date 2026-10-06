import {$,$$,clone} from './shared.js';
import {mount as meshMount} from './form-mesh.js';
import {starting} from './form-projects.js';
import {parseProject} from './form-codec.js';
export async function mount(root,api){
 root.innerHTML='<div class="fm-labs" role="group" aria-label="Choose a design workspace"><button type="button" data-lab="mesh" aria-pressed="true">Object studio <span>7 sculptural projects</span></button><button type="button" data-lab="basics" aria-pressed="false">Precision basics <span>3 sketch-based starters</span></button></div><div data-mesh-lab></div><div data-basics-lab hidden></div>';
 let lab='mesh',activeLesson=null;const modules={mesh:await meshMount($(root,'[data-mesh-lab]'),api)};
 async function choose(next){if(!modules[next])modules.basics=await(await import('./form-basics.js')).mount($(root,'[data-basics-lab]'),api);lab=next;$(root,'[data-mesh-lab]').hidden=lab!=='mesh';$(root,'[data-basics-lab]').hidden=lab!=='basics';for(const b of $$(root,'[data-lab]'))b.setAttribute('aria-pressed',String(b.dataset.lab===lab));window.dispatchEvent(new Event('resize'));}
 for(const b of $$(root,'[data-lab]'))b.addEventListener('click',async()=>{try{await choose(b.dataset.lab);api.changed();}catch(e){api.say(e.message,true);}});
 async function restore(state){activeLesson=state.lessonId||null;const next=state.lab==='mesh'?'mesh':'basics';await choose(next);await modules[lab].restore(state.lab?state.value:state);}
 return {state:()=>({lab,lessonId:activeLesson,value:clone(modules[lab].state())}),matchesLesson:lesson=>activeLesson===lesson.id||(!activeLesson&&lab===lesson.workspace&&(lab==='basics'||modules[lab].state().project===lesson.starter)),restore,reset:()=>modules[lab].reset(),project:()=>modules[lab].project(),files:()=>modules[lab].files(),target:a=>modules[lab].target(a),tour:()=>modules[lab].tour(),open:async file=>{const p=parseProject(await file.text()),s=p.extensions?.['momentium-learning']?.state;if(!s)throw Error('Choose a project saved by these lessons. Use the full app to open other Form projects.');await restore(s);},startLesson:async lesson=>{activeLesson=lesson.id;await choose(lesson.workspace||'basics');if(lab==='mesh')await modules.mesh.restore({...starting(lesson.starter),...lesson.settings});else await modules.basics.reset();}};
}
