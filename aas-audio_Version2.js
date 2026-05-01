// aas-audio.js - Core audio engine: loading, playback, chain management, trimming, and export (WAV).
class AASAudioEngine {
  constructor(){
    this.ctx = null;
    this.buffer = null; // AudioBuffer
    this.source = null; // current AudioBufferSourceNode
    this.activeEffects = []; // [{def, params, instance}]
    this.effectDefs = (window.AdvancedAhhSite && AdvancedAhhSite.effects) || [];
    this.isPlaying = false;
    this.masterGain = null;
    this.destination = null;
  }

  async ensureContext(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
      this.destination = this.masterGain;
    }
  }

  async loadFile(file){
    await this.ensureContext();
    const array = await file.arrayBuffer();
    // If it's video, extract audio by decoding the file bytes — browser decodes audio track only
    try {
      const buf = await this.ctx.decodeAudioData(array.slice(0));
      this.buffer = buf;
      return buf;
    } catch(err){
      // fallback: try creating blob URL and using <audio> capture? For demo, rethrow
      throw err;
    }
  }

  setEffectsList(effectsArray){
    // effectsArray is array of {id, params}
    this.activeEffects = effectsArray.map(e=>{
      const def = this.effectDefs.find(d=>d.id === e.id);
      return { def, params: Object.assign({}, def.defaultParams ? this._valuesFromDefaults(def.defaultParams) : {}, e.params||{}) , instance: null };
    });
  }

  _valuesFromDefaults(defs){
    const out = {};
    for(const k in defs) out[k] = defs[k].value;
    return out;
  }

  addEffectById(id){
    const def = this.effectDefs.find(d=>d.id===id);
    if(!def) return;
    const params = this._valuesFromDefaults(def.defaultParams || {});
    this.activeEffects.push({def, params, instance:null});
  }

  removeEffectById(id){
    const idx = this.activeEffects.findIndex(e=>e.def.id===id);
    if(idx>=0){
      const eff = this.activeEffects[idx];
      if(eff.instance && eff.instance.cleanup) eff.instance.cleanup();
      this.activeEffects.splice(idx,1);
    }
  }

  async play(from=0){
    if(!this.buffer) return;
    await this.ensureContext();
    if(this.isPlaying) this.stop();
    // create a new source with buffer
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = false;

    // Check for source-level effects (e.g., pitch shift, vibrato, reverse)
    // Apply source-level effects before wiring
    for(const eff of this.activeEffects){
      if(eff.def.create){
        const inst = eff.def.create(this.ctx, eff.params);
        eff.instance = inst;
      }
    }
    // Apply source-level transforms
    for(const eff of this.activeEffects){
      if(eff.instance && eff.instance.isSourceLevel && eff.instance.applyToSource){
        eff.instance.applyToSource(source, this.buffer, eff.params);
      }
    }

    // Build chain: we will wire source -> chain effects -> masterGain
    // For effects that supply customWire, use that; otherwise assume input->output nodes array
    let currentSource = source;
    // Some effects return nodes (input node to connect to, output node to connect from)
    for(const eff of this.activeEffects){
      const inst = eff.instance;
      if(!inst) continue;
      // parameter-only or source-only effects won't provide wiring
      if(inst.parameterOnly || inst.isSourceLevel) continue;
      // If customWire provided, call with currentSource and next destination (we'll use a passthrough node)
      if(inst.customWire){
        // create an intermediate destination node (a gain) to collect output of this effect and continue
        const passthrough = this.ctx.createGain();
        // instantiate wiring: source -> effect -> passthrough
        inst.customWire(currentSource, passthrough);
        currentSource = passthrough;
      } else if(inst.input && inst.output){
        // connect currentSource -> input, then output becomes currentSource
        currentSource.connect(inst.input);
        currentSource = inst.output;
      } else if(inst.input && !inst.output){
        currentSource.connect(inst.input);
        // assume input == output
        currentSource = inst.input;
      } else {
        // fallback: skip
      }
    }

    // connect last piece to destination
    currentSource.connect(this.destination);

    this.source = source;
    source.onended = ()=>{ this.isPlaying = false; };
    source.start(0, from);
    this.isPlaying = true;
  }

  pause(){
    if(this.ctx) this.ctx.suspend();
  }
  resume(){
    if(this.ctx) this.ctx.resume();
  }
  stop(){
    if(this.source){
      try{ this.source.stop(0); }catch(e){}
      this.source.disconnect();
      this.source = null;
      this.isPlaying = false;
    }
  }

  updateEffectParams(effectIndex, newParams){
    const eff = this.activeEffects[effectIndex];
    if(!eff) return;
    eff.params = {...eff.params, ...newParams};
    if(eff.instance && eff.instance.update) eff.instance.update(newParams);
  }

  trim(startSec, endSec){
    if(!this.buffer) return;
    startSec = Math.max(0, startSec);
    endSec = Math.min(this.buffer.duration, endSec || this.buffer.duration);
    if(endSec <= startSec) return;
    const sr = this.buffer.sampleRate;
    const ch = this.buffer.numberOfChannels;
    const newLength = Math.floor((endSec - startSec) * sr);
    const newBuf = this.ctx.createBuffer(ch, newLength, sr);
    for(let c=0;c<ch;c++){
      const old = this.buffer.getChannelData(c);
      const newd = newBuf.getChannelData(c);
      const startIdx = Math.floor(startSec * sr);
      for(let i=0;i<newLength;i++){
        newd[i] = old[i + startIdx];
      }
    }
    this.buffer = newBuf;
    return newBuf;
  }

  // Offline rendering and WAV export
  async renderToBuffer(){
    if(!this.buffer) throw new Error('No buffer loaded');
    // Use OfflineAudioContext to render the processed audio
    const length = Math.ceil(this.buffer.duration * (this.ctx ? this.ctx.sampleRate : 44100));
    const sampleRate = this.ctx ? this.ctx.sampleRate : 44100;
    // create offline context with same channels
    const offline = new OfflineAudioContext(this.buffer.numberOfChannels, Math.ceil(this.buffer.duration*sampleRate), sampleRate);

    // Create source
    const source = offline.createBufferSource();
    source.buffer = this.buffer;

    // Recreate effects chain on offline context by reusing effect definitions
    // Note: many live-only nodes (ScriptProcessor, Oscillator start timing) may not work in offline.
    // We'll best-effort create nodes supporting offline rendering (convolver, delay, waveshaper, filters).
    let current = source;
    for(const eff of this.activeEffects){
      const def = eff.def;
      const p = eff.params || {};
      // attempt to create effect in offline context
      if(def.create){
        try {
          const inst = def.create(offline, p);
          // if inst has customWire
          if(inst && inst.customWire){
            const passthrough = offline.createGain();
            inst.customWire(current, passthrough);
            current = passthrough;
          } else if(inst && inst.input && inst.output){
            current.connect(inst.input);
            current = inst.output;
          } else if(inst && inst.isSourceLevel && inst.applyToSource){
            // If it's a source-level pitch change, set playbackRate
            if(inst.applyToSource) inst.applyToSource(source, source.buffer, p);
          } else {
            // skip non-supported effect
          }
        } catch(e){
          console.warn('Effect not available in offline render:', def.id, e);
        }
      }
    }

    current.connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    return rendered;
  }

  // WAV encoder (simple PCM16)
  async exportWAV(){
    const rendered = await this.renderToBuffer();
    const interleaved = this._interleave(rendered);
    const wav = this._encodeWAV(interleaved, rendered.sampleRate, rendered.numberOfChannels);
    const blob = new Blob([wav], {type:'audio/wav'});
    return blob;
  }

  _interleave(inputBuffer){
    const numChannels = inputBuffer.numberOfChannels;
    const sampleRate = inputBuffer.sampleRate;
    const length = inputBuffer.length;
    // if stereo, interleave, else return single channel
    if(numChannels === 1){
      const ch0 = inputBuffer.getChannelData(0);
      return ch0;
    } else {
      const left = inputBuffer.getChannelData(0);
      const right = inputBuffer.getChannelData(1);
      const interleaved = new Float32Array(length * numChannels);
      let idx = 0;
      for(let i=0;i<length;i++){
        interleaved[idx++] = left[i];
        interleaved[idx++] = right[i];
      }
      return interleaved;
    }
  }

  _floatTo16BitPCM(output, offset, input){
    for (let i = 0; i < input.length; i++, offset+=2){
      let s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  }

  _writeString(view, offset, string){
    for (let i = 0; i < string.length; i++){
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  _encodeWAV(samples, sampleRate, numChannels){
    // samples: Float32Array either mono or interleaved stereo
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    /* RIFF identifier */
    this._writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    /* RIFF type */
    this._writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    this._writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, numChannels, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * blockAlign, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, blockAlign, true);
    /* bits per sample */
    view.setUint16(34, bytesPerSample * 8, true);
    /* data chunk identifier */
    this._writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * bytesPerSample, true);

    this._floatTo16BitPCM(view, 44, samples);
    return view;
  }
}

// Expose engine globally
window.AASAudioEngine = AASAudioEngine;