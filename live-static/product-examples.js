/* Interactive examples are separate from the opt-in, unmodified live applications. */
(() => {
  'use strict';
  const save = (blob, name) => {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const saveJSON = (value, name) => save(new Blob([JSON.stringify(value, null, 2)], {type:'application/json'}), name);
  const fetchOK = async url => { const r = await fetch(url); if (!r.ok) throw Error('The example asset could not be loaded. Please try again.'); return r; };
  const audioContext = () => { const C = window.AudioContext || window.webkitAudioContext; if (!C) throw Error('Audio processing is unavailable in this browser. Try the full app.'); return new C(); };
  const makeWAV = buffer => {
    const n = buffer.length, channels = 2, bytes = new ArrayBuffer(44 + n * channels * 2), view = new DataView(bytes);
    const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0,'RIFF'); view.setUint32(4,36+n*4,true); text(8,'WAVE'); text(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,2,true);
    view.setUint32(24,buffer.sampleRate,true); view.setUint32(28,buffer.sampleRate*4,true);
    view.setUint16(32,4,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,n*4,true);
    let peak = 0;
    for (let c=0;c<2;c++) for (const sample of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(sample));
    const scale = peak > .97 ? .97 / peak : 1;
    for (let i=0;i<n;i++) for (let c=0;c<2;c++) {
      const sample = Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]*scale));
      view.setInt16(44+(i*2+c)*2,sample<0?sample*32768:sample*32767,true);
    }
    return new Blob([bytes], {type:'audio/wav'});
  };

  for (const root of document.querySelectorAll('[data-product-examples]')) {
    const q = selector => root.querySelector(selector), all = selector => [...root.querySelectorAll(selector)];
    const announce = (selector, text) => { const el=q(selector); if(el) el.textContent=text; };

    const comparison=q('[data-px-compare]');
    if(comparison) comparison.addEventListener('input',()=>q('.px-image-pair').style.setProperty('--split',comparison.value+'%'));

    const canvas=q('[data-px-poster]');
    if(canvas) {
      const image=new Image(), context=canvas.getContext('2d'); let ready=false;
      const draw=()=>{
        if(!ready)return;
        context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,1024,1536);
        context.fillStyle=q('[data-px-color]').value; context.textAlign='center'; context.textBaseline='middle';
        const title=q('[data-px-title]').value.trim().toUpperCase(), subtitle=q('[data-px-subtitle]').value.trim().toUpperCase();
        let size=106; context.font=`800 ${size}px Arial, sans-serif`;
        while(context.measureText(title).width>884 && size>32){size-=2;context.font=`800 ${size}px Arial, sans-serif`;}
        context.fillText(title,512,165); let small=29;context.font=`600 ${small}px Arial, sans-serif`;
        while(context.measureText(subtitle).width>860 && small>14){small--;context.font=`600 ${small}px Arial, sans-serif`;}
        context.fillText(subtitle,512,255);
        canvas.setAttribute('aria-label',`Poster sketch: ${title}. ${subtitle}.`);
      };
      image.onload=()=>{ready=true;draw();q('[data-px-poster-export]').disabled=false;announce('[data-px-poster-status]','Your poster sketch is ready. Change the type or color.');};
      image.onerror=()=>announce('[data-px-poster-status]','The artwork could not be loaded. Reload to try again, or use the original Luma project below.');
      image.src='/assets/examples/poster-source.png';
      for(const el of all('[data-px-title],[data-px-subtitle],[data-px-color]'))el.addEventListener('input',draw);
      q('[data-px-poster-export]').addEventListener('click',()=>canvas.toBlob(blob=>{
        if(!blob){announce('[data-px-poster-status]','PNG export failed. Please try again.');return;}
        save(blob,'my-invitation.png');announce('[data-px-poster-status]','Your 1024 × 1536 PNG was downloaded.');
      },'image/png'));
    }

    for(const button of all('[data-px-clip]'))button.addEventListener('click',()=>{
      all('[data-px-clip]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));
      const video=q('[data-px-video]');video.pause();video.src=button.dataset.pxClip;video.load();
    });

    const hashButton=q('[data-px-hash]');
    if(hashButton){
      let report;
      hashButton.addEventListener('click',async()=>{
        hashButton.disabled=true;announce('[data-px-hash-status]','Comparing the original sample contents…');
        try{
          if(!window.crypto?.subtle)throw Error('Secure content comparison is unavailable in this browser. Use the full app.');
          const samples=await (await fetchOK('/assets/examples/sample-files.json')).json(), rows=[];
          for(const [path,content] of Object.entries(samples)){
            const data=new TextEncoder().encode(content), digest=await crypto.subtle.digest('SHA-256',data);
            rows.push({path,bytes:data.length,sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')});
          }
          const counts=new Map();rows.forEach(row=>counts.set(row.sha256,(counts.get(row.sha256)||0)+1));
          const body=q('[data-px-file-rows]');body.replaceChildren();
          for(const row of rows){
            row.result=counts.get(row.sha256)>1?'Identical pair':'Unique contents';
            const tr=document.createElement('tr');if(counts.get(row.sha256)>1)tr.className='px-duplicate';
            for(const [index,value] of [row.path,String(row.bytes),row.sha256.slice(0,16)+'…',row.result].entries()){
              const td=document.createElement('td');td.textContent=value;
              if(index===2){td.title=row.sha256;td.setAttribute('aria-label',row.sha256);}
              tr.append(td);
            }
            body.append(tr);
          }
          report={kind:'Reclaim sample comparison',algorithm:'SHA-256',readOnly:true,files:rows};
          q('[data-px-report]').disabled=false;
          announce('[data-px-hash-status]','1 identical pair found. The two notes.txt files have different contents. No files were changed.');
        }catch(error){announce('[data-px-hash-status]',error.message);}finally{hashButton.disabled=false;}
      });
      q('[data-px-report]').addEventListener('click',()=>{if(report)saveJSON(report,'reclaim-example-report.json');});
    }

    const loadMix=q('[data-px-mix-load]');
    if(loadMix){
      let context, buffers=[], nodes=[], playing=false;
      const levels=all('[data-px-level]'), cross=q('[data-px-cross]'), play=q('[data-px-mix-play]'), render=q('[data-px-mix-export]');
      const weight=i=>{const angle=(Number(cross.value)/100+1)*Math.PI/4;return Number(levels[i].value)/100*(i<2?Math.cos(angle):Math.sin(angle))*.35;};
      const stop=()=>{for(const n of nodes){try{n.source.stop();}catch{}n.source.disconnect();n.gain.disconnect();}nodes=[];playing=false;play.textContent='Play mix';play.setAttribute('aria-pressed','false');};
      loadMix.addEventListener('click',async()=>{
        loadMix.disabled=true;announce('[data-px-mix-status]','Loading four original recordings…');
        try{
          context??=audioContext();await context.resume();
          buffers=await Promise.all(['percussion','bass','harmony','melody'].map(async name=>context.decodeAudioData(await (await fetchOK(`/assets/examples/${name}.wav`)).arrayBuffer())));
          play.disabled=false;render.disabled=false;loadMix.textContent='Four parts loaded';announce('[data-px-mix-status]','Ready. Press Play mix to start all four parts together.');
        }catch(error){announce('[data-px-mix-status]',error.message);loadMix.disabled=false;}
      });
      play.addEventListener('click',async()=>{
        if(playing){stop();announce('[data-px-mix-status]','Mix stopped. Your levels are kept.');return;}
        try{
          await context.resume();const when=context.currentTime+.04;
          nodes=buffers.map((buffer,i)=>{const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=weight(i);source.connect(gain);gain.connect(context.destination);source.start(when);return {source,gain};});
          playing=true;play.textContent='Stop mix';play.setAttribute('aria-pressed','true');announce('[data-px-mix-status]','Playing all four parts. Move the levels or crossfader to hear the change.');
        }catch(error){stop();announce('[data-px-mix-status]',error.message);}
      });
      const update=()=>{levels.forEach((el,i)=>{el.parentElement.querySelector('output').textContent=el.value+'%';if(nodes[i])nodes[i].gain.gain.setTargetAtTime(weight(i),context.currentTime,.025);});};
      [...levels,cross].forEach(el=>el.addEventListener('input',update));
      render.addEventListener('click',async()=>{
        render.disabled=true;announce('[data-px-mix-status]','Rendering a ten-second stereo WAV from the current settings…');
        try{
          const offline=new OfflineAudioContext(2,441000,44100);
          buffers.forEach((buffer,i)=>{const source=offline.createBufferSource(),gain=offline.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=weight(i);source.connect(gain);gain.connect(offline.destination);source.start();});
          save(makeWAV(await offline.startRendering()),'my-ten-second-mix.wav');announce('[data-px-mix-status]','Your ten-second stereo WAV was downloaded.');
        }catch(error){announce('[data-px-mix-status]',error.message);}finally{render.disabled=false;}
      });
      window.addEventListener('pagehide',stop);
    }

    const eqPlay=q('[data-px-eq-play]');
    if(eqPlay){
      const media=q('[data-px-eq-audio]'), controls=all('[data-px-eq]');let context,filters=[];
      const prepare=()=>{
        if(context)return;
        context=audioContext();const source=context.createMediaElementSource(media);
        filters=['lowshelf','peaking','highshelf'].map((type,i)=>{const node=context.createBiquadFilter();node.type=type;node.frequency.value=[200,1000,4000][i];node.Q.value=.8;node.gain.value=Number(controls[i].value);return node;});
        const gain=context.createGain(), limiter=context.createDynamicsCompressor();gain.gain.value=.5;
        limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.2;
        source.connect(filters[0]);filters[0].connect(filters[1]);filters[1].connect(filters[2]);filters[2].connect(gain);gain.connect(limiter);limiter.connect(context.destination);
      };
      const update=()=>controls.forEach((el,i)=>{el.parentElement.querySelector('output').textContent=(Number(el.value)>0?'+':'')+el.value+' dB';if(filters[i])filters[i].gain.setTargetAtTime(Number(el.value),context.currentTime,.025);});
      controls.forEach(el=>el.addEventListener('input',update));
      q('[data-px-eq-reset]').addEventListener('click',()=>{controls.forEach(el=>el.value='0');update();announce('[data-px-eq-status]','All three bands are back at 0 dB.');});
      eqPlay.addEventListener('click',async()=>{
        if(!media.paused){media.pause();eqPlay.textContent='Play example';eqPlay.setAttribute('aria-pressed','false');return;}
        eqPlay.disabled=true;
        try{prepare();await context.resume();await media.play();eqPlay.textContent='Pause example';eqPlay.setAttribute('aria-pressed','true');announce('[data-px-eq-status]','Playing the original evening mix through your three-band EQ settings.');}
        catch(error){announce('[data-px-eq-status]','Playback could not start. Please try again or use the full app.');}
        finally{eqPlay.disabled=false;}
      });
      media.addEventListener('ended',()=>{eqPlay.textContent='Play example';eqPlay.setAttribute('aria-pressed','false');announce('[data-px-eq-status]','The example has finished. Play again to compare another setting.');});
      window.addEventListener('pagehide',()=>media.pause());
    }

    const chainList=q('[data-px-chain-list]');
    if(chainList){
      const presets={
        vocal:[['Clean','Review noise and cleanup before the rest of the chain.'],['De-Ess','Control distracting sibilance without dulling every phrase.'],['Comp','Shape the dynamic range of the performance.'],['EQ','Make deliberate tonal changes.'],['Double','Add width and character when the arrangement needs it.'],['Space','Place the vocal in an intentional acoustic space.']],
        mix:[['Clean','Start with a clear source and inspect restoration choices.'],['EQ','Address tonal balance before making further decisions.'],['Comp','Shape dynamics in context.'],['Image','Review stereo placement and width.'],['Peak','Inspect peak control without assuming louder is better.'],['Meter','Check the result against the original at comparable level.']],
        create:[['Echo','Establish the repeating rhythmic idea.'],['Heat','Add character and saturation deliberately.'],['Morph','Explore movement and transformation.'],['Shimmer','Add an elevated ambient layer where appropriate.'],['Space','Set the scale and distance of the sound.'],['Meter','Compare the result and keep useful headroom.']]
      };let current='vocal',stages=[];
      const draw=()=>{
        chainList.replaceChildren();
        stages.forEach(([name,description],index)=>{
          const item=document.createElement('li'),title=document.createElement('strong'),p=document.createElement('p'),actions=document.createElement('div');
          title.textContent=`${index+1}. ${name}`;p.textContent=description;actions.className='px-choice';
          for(const direction of [-1,1]){
            const button=document.createElement('button');button.type='button';button.className='px-button px-secondary';button.textContent=direction<0?'Move earlier':'Move later';
            button.setAttribute('aria-label',`${button.textContent}: ${name}`);button.disabled=index+direction<0||index+direction>=stages.length;
            button.addEventListener('click',()=>{const target=index+direction;[stages[index],stages[target]]=[stages[target],stages[index]];draw();const moved=chainList.children[target];moved.querySelector('strong').tabIndex=-1;moved.querySelector('strong').focus();announce('[data-px-chain-status]',`${name} moved to stage ${target+1}. This changes the plan only.`);});actions.append(button);
          }
          item.append(title,p,actions);chainList.append(item);
        });
      };
      all('[data-px-chain]').forEach(button=>button.addEventListener('click',()=>{current=button.dataset.pxChain;stages=presets[current].map(x=>[...x]);all('[data-px-chain]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));draw();announce('[data-px-chain-status]',`${button.textContent} plan selected. Choose the order that serves the sound.`);}));
      stages=presets.vocal.map(x=>[...x]);draw();
      q('[data-px-chain-export]').addEventListener('click',()=>saveJSON({kind:'Sattari reference chain plan',notNativePreset:true,purpose:current,stages:stages.map(([processor,purpose],i)=>({position:i+1,processor,purpose}))},'sattari-chain-plan.json'));
    }

    const launch=q('[data-px-launch]');
    if(launch){
      let frame;const wrap=q('[data-px-frame-wrap]');
      launch.addEventListener('click',()=>{
        if(frame){wrap.hidden=!wrap.hidden;launch.textContent=wrap.hidden?'Show live workspace':'Minimize live workspace';launch.setAttribute('aria-expanded',String(!wrap.hidden));return;}
        frame=document.createElement('iframe');frame.title=`Live ${root.dataset.pxName} web workspace`;
        frame.referrerPolicy='strict-origin-when-cross-origin';frame.src=root.dataset.pxApp;
        frame.setAttribute('allow','fullscreen');wrap.append(frame);wrap.hidden=false;
        launch.textContent='Minimize live workspace';launch.setAttribute('aria-expanded','true');
        announce('[data-px-session-status]','Opening the actual app below. The new-tab link is also available if your browser cannot display it here.');
      });
    }
  }
})();
