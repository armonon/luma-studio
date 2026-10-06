// Each box mounts the same native editor used by the full workshop.
const boxes = [...document.querySelectorAll('[data-lg-editor]')];
let expanded = null;
const previousFocus = new WeakMap();
const pendingGuides = new WeakSet();
let background = [];
const continuations=new Map();
function continueBox(box,link){
 const frame=box.querySelector('iframe');if(!box.classList.contains('is-ready')||!frame)return false;
 const request=crypto.randomUUID();const label=link.textContent;link.textContent='Keeping your edits…';link.setAttribute('aria-disabled','true');
 const timer=setTimeout(()=>{continuations.delete(request);link.textContent=label;link.removeAttribute('aria-disabled');box.querySelector('[data-lg-status]').textContent='Continuation took too long. Try again or save your .luma file.';box.querySelector('[data-lg-feedback]').hidden=false;box.querySelector('[data-lg-feedback]').textContent=box.querySelector('[data-lg-status]').textContent;},60000);
 continuations.set(request,{box,link,label,timer});frame.contentWindow.postMessage({type:'luma-box:continue',request},location.origin);return true;
}
const sendGuide = box => box.querySelector('iframe')?.contentWindow?.postMessage({type:'luma-box:guide'}, location.origin);
function load(box) {
  if (box.querySelector('iframe')) return;
  const frame = document.createElement('iframe');
  const title = box.closest('article').querySelector('h3').textContent;
  frame.title = 'Luma Studio — ' + title;
  frame.src = '/learn/luma/workshops/?workshop=' + encodeURIComponent(box.dataset.lgEditor) + '&embed=box&ui=mobile-session-1';
  frame.allow = 'fullscreen';
  box.querySelector('[data-lg-status]').textContent = 'Opening your Luma project…';
  box.querySelector('[data-lg-load]').hidden = true;
  box.querySelector('.lg-editor-stage').append(frame);
}
function collapse() {
  if (!expanded) return;
  const box = expanded;
  box.classList.remove('is-expanded');
  box.removeAttribute('role');
  box.removeAttribute('aria-modal');
  box.querySelector('[data-lg-expand]').textContent = 'Expand editor ↗';
  box.querySelector('[data-lg-expand]').setAttribute('aria-expanded','false');
  document.body.classList.remove('lg-editor-expanded');
  background.forEach(([node, wasInert]) => { node.inert = wasInert; });
  background = [];
  expanded = null;
  previousFocus.get(box)?.focus();
}
function expand(box) {
  if (expanded === box) { collapse(); return; }
  collapse();
  previousFocus.set(box, document.activeElement);
  expanded = box;
  box.classList.add('is-expanded');
  box.setAttribute('role','dialog');
  box.setAttribute('aria-modal','true');
  box.setAttribute('aria-label','Expanded Luma editor');
  box.querySelector('[data-lg-expand]').textContent = 'Close expanded view ×';
  box.querySelector('[data-lg-expand]').setAttribute('aria-expanded','true');
  document.body.classList.add('lg-editor-expanded');
  for(let branch=box;branch.parentElement;branch=branch.parentElement){
    for(const sibling of branch.parentElement.children){
      if(sibling!==branch){background.push([sibling,sibling.inert]);sibling.inert=true;}
    }
    if(branch.parentElement===document.body)break;
  }
  load(box);
  box.querySelector('[data-lg-expand]').focus();
}
const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) {load(entry.target);observer.unobserve(entry.target);} });
}, {rootMargin:'100px'}) : null;
boxes.forEach(box => {
  box.querySelector('[data-lg-load]').addEventListener('click',()=>load(box));
  box.querySelector('[data-lg-expand]').addEventListener('click',()=>expand(box));
  box.closest('article').querySelector('[data-lg-guide]')?.addEventListener('click',()=>{
    pendingGuides.add(box);load(box);sendGuide(box);
    box.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  box.closest('article').querySelectorAll('a[data-lg-continue]').forEach(link=>link.addEventListener('click',event=>{if(link.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}if(continueBox(box,link))event.preventDefault();}));
  observer?.observe(box);
});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  const box=boxes.find(candidate=>candidate.querySelector('iframe')?.contentWindow===event.source);
  if(!box)return;
  if(event.data?.type==='luma-box:ready'){
    box.classList.add('is-ready');
    box.closest('article').querySelectorAll('a[data-lg-continue]').forEach(link=>link.textContent='Continue this exact version ↗');
    box.querySelector('.lg-editor-poster').hidden=true;
    if(pendingGuides.has(box)){sendGuide(box);pendingGuides.delete(box);}
    const frame=box.querySelector('iframe');
    try { if(!frame.dataset.keysBound){
      frame.dataset.keysBound='true';
      frame.contentDocument.addEventListener('keydown',e=>{
        if(expanded!==box)return;
        if(e.key==='Escape'&&!frame.contentDocument.querySelector('[role="dialog"],[role="alertdialog"]'))collapse();
        if(e.key==='Tab'){
          const focusable=[...frame.contentDocument.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[hidden],[inert]'));
          const end=e.shiftKey?focusable[0]:focusable.at(-1);
          if(frame.contentDocument.activeElement===end){e.preventDefault();box.querySelector('[data-lg-expand]').focus();}
        }
      });
    }} catch {}
  }
  if(event.data?.type==='luma-box:continued'){
    const pending=continuations.get(event.data.request);if(event.data.request&&pending?.box!==box)return;
    try{const url=new URL(event.data.url);if(url.origin!==location.origin||url.pathname!=='/learn/luma/workshops/'||!/^[a-f0-9-]{36}$/.test(url.searchParams.get('continue')??''))return;
      if(pending)clearTimeout(pending.timer);location.assign(url.href);
    }catch{}return;
  }
  if(event.data?.type==='luma-box:continue-error'){
    const pending=continuations.get(event.data.request);if(pending?.box!==box)return;
    clearTimeout(pending.timer);continuations.delete(event.data.request);pending.link.textContent=pending.label;pending.link.removeAttribute('aria-disabled');
    box.querySelector('[data-lg-status]').textContent=event.data.message||'Save your .luma file to keep this version.';box.querySelector('[data-lg-feedback]').hidden=false;box.querySelector('[data-lg-feedback]').textContent=box.querySelector('[data-lg-status]').textContent;
  }
  if(event.data?.type==='luma-box:error'){
    box.querySelector('[data-lg-status]').textContent='The editor couldn’t open. Try the full lesson below.';
    box.querySelector('.lg-editor-poster').hidden=false;
  }
});
document.addEventListener('keydown',event=>{
  if(!expanded)return;
  if(event.key==='Escape'){event.preventDefault();collapse();}
  if(event.key==='Tab'){
    const first=expanded.querySelector('[data-lg-expand]');
    const frame=expanded.querySelector('iframe');
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();frame?.focus();}
    else if(!event.shiftKey&&document.activeElement===frame){event.preventDefault();first.focus();}
  }
});
