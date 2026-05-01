// app.js - UI glue: wires the UI to the engine and effect definitions
(async function(){
  const engine = new AASAudioEngine();
  const effectsContainer = document.getElementById('effectsList');
  const activeChain = document.getElementById('activeChain');
  const template = document.getElementById('effect-template');
  const audioFileInput = document.getElementById('audioFile');
  const videoFileInput = document.getElementById('videoFile');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const exportBtn = document.getElementById('exportBtn');
  const exportFormat = document.getElementById('exportFormat');
  const trimStart = document.getElementById('trimStart');
  const trimEnd = document.getElementById('trimEnd');
  const trimBtn = document.getElementById('trimBtn');
  const openSlidersBtn = document.getElementById('openSlidersBtn');
  const aiGenerateBtn = document.getElementById('aiGenerateBtn');
  const aiDesc = document.getElementById('aiDescription');
  const aiTemp = document.getElementById('aiTemperature');
  const aiStatus = document.getElementById('aiStatus');

  // Populate effects UI
  const defs = window.AdvancedAhhSite.effects;
  defs.forEach(def=>{
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.effect-card');
    const name = node.querySelector('.effect-name');
    const desc = node.querySelector('.effect-desc');
    const toggle = node.querySelector('.toggle-effect');
    const paramsBtn = node.querySelector('.open-params');
    name.textContent = def.name;
    desc.textContent = def.description;
    toggle.addEventListener('click', ()=>{
      const existing = engine.activeEffects.find(e=>e.def.id===def.id);
      if(existing){
        engine.removeEffectById(def.id);
        toggle.textContent = 'Add';
        card.classList.remove('active');
      } else {
        engine.addEffectById(def.id);
        toggle.textContent = 'Remove';
        card.classList.add('active');
      }
      refreshActiveChain();
    });
    paramsBtn.addEventListener('click', ()=>{
      // show sliders modal for this effect with default params
      const defaults = def.defaultParams || {};
      const paramsForUI = {};
      for(const k in defaults) paramsForUI[k] = Object.assign({}, defaults[k]);
      window.SlidersUI.show(def.name, paramsForUI, (values)=>{
        // If effect already active, update its params, else add it with params
        const existing = engine.activeEffects.findIndex(e=>e.def.id===def.id);
        if(existing>=0){
          engine.updateEffectParams(existing, values);
        } else {
          engine.activeEffects.push({def, params:values, instance:null});
          // mark button as Remove
          uiSetToggleToRemove(def.id);
        }
        refreshActiveChain();
      });
    });

    effectsContainer.appendChild(node);
  });

  function uiSetToggleToRemove(id){
    const cards = effectsContainer.querySelectorAll('.effect-card');
    cards.forEach(card=>{
      const name = card.querySelector('.effect-name').textContent;
      const def = defs.find(d=>d.name === name);
      if(def && def.id===id){
        card.classList.add('active');
        card.querySelector('.toggle-effect').textContent = 'Remove';
      }
    });
  }

  function refreshActiveChain(){
    activeChain.innerHTML = '';
    engine.activeEffects.forEach((e, idx)=>{
      const li = document.createElement('li');
      li.textContent = `${e.def.name} — ${JSON.stringify(e.params)}`;
      activeChain.appendChild(li);
    });
  }

  // File inputs
  audioFileInput.addEventListener('change', async (ev)=>{
    const file = ev.target.files[0];
    if(!file) return;
    try{
      await engine.loadFile(file);
      trimEnd.value = engine.buffer.duration.toFixed(2);
      alert('Audio loaded: ' + (engine.buffer.duration.toFixed(2)) + 's');
    }catch(err){
      console.error(err);
      alert('Failed to load audio: ' + err.message);
    }
  });
  videoFileInput.addEventListener('change', async (ev)=>{
    const file = ev.target.files[0];
    if(!file) return;
    // Try to decode audio track from video by passing bytes to decodeAudioData
    try{
      await engine.loadFile(file);
      trimEnd.value = engine.buffer.duration.toFixed(2);
      alert('Video audio extracted: ' + (engine.buffer.duration.toFixed(2)) + 's');
    }catch(err){
      console.error(err);
      alert('Failed to extract audio from video: ' + err.message);
    }
  });

  // Playback controls
  playBtn.addEventListener('click', ()=>{ engine.play(parseFloat(trimStart.value) || 0); });
  pauseBtn.addEventListener('click', ()=>{ engine.pause(); });
  stopBtn.addEventListener('click', ()=>{ engine.stop(); });

  trimBtn.addEventListener('click', ()=>{
    const s = parseFloat(trimStart.value) || 0;
    const e = parseFloat(trimEnd.value) || engine.buffer.duration;
    engine.trim(s, e);
    alert('Trimmed audio to ' + (engine.buffer ? engine.buffer.duration.toFixed(2) : '0') + 's');
  });

  // Export
  exportBtn.addEventListener('click', async ()=>{
    const fmt = exportFormat.value;
    if(fmt === 'wav'){
      exportBtn.disabled = true; exportBtn.textContent = 'Rendering...';
      try{
        const blob = await engine.exportWAV();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'export.wav';
        a.click();
      }catch(err){ alert('Export failed: ' + err.message); }
      exportBtn.disabled = false; exportBtn.textContent = 'Export';
    } else {
      alert('For ' + fmt + ' export you must include an encoder library (examples: lamejs for MP3, libflac for FLAC). WAV export is supported natively in this demo.');
    }
  });

  // Sliders panel open
  openSlidersBtn.addEventListener('click', ()=>{
    // show a general param panel listing active effects
    const params = {};
    engine.activeEffects.forEach((e, idx)=>{ params[e.def.name] = e.params; });
    window.SlidersUI.show('Active Effects', params, (values)=>{
      // apply values back if keys match
      // This is generic — for demo we won't map back precisely
      alert('Parameters applied (demo). Use per-effect params buttons for precise control.');
    });
  });

  // AI effect stub
  aiGenerateBtn.addEventListener('click', ()=>{
    const desc = aiDesc.value.trim();
    const temp = parseFloat(aiTemp.value);
    aiStatus.textContent = 'Generating...';
    // Simulate network/AI with randomized mapping
    setTimeout(()=>{
      aiStatus.textContent = 'Applying AI effect (simulated)';
      // simple mapping: if description contains "monster" add monster chorus (chorus + heavy distortion)
      if(/monster|big|huge|epic/i.test(desc)){
        engine.addEffectById('chorus');
        engine.addEffectById('distortion');
      } else if(/space|ambient|reverb|pad/i.test(desc)){
        engine.addEffectById('reverb');
        engine.addEffectById('flanger');
      } else if(/lofi|vinyl|old|dusty/i.test(desc)){
        engine.addEffectById('lofi_vinyl');
        engine.addEffectById('lowquality');
      } else {
        // random effect based on temperature
        const idx = Math.floor(Math.random() * engine.effectDefs.length);
        engine.addEffectById(engine.effectDefs[idx].id);
      }
      refreshActiveChain();
      aiStatus.textContent = 'AI effect applied (demo).';
    }, 1000 + Math.floor(temp*2000));
  });

  // Initialize UI values
  refreshActiveChain();

  window.AAS = engine; // expose for debugging
})();
