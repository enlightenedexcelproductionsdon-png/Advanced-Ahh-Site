// AdvancedAhhSite.js - Effect definitions and presets
// Each effect must provide:
// - id: unique id
// - name: display name
// - description
// - defaultParams: object { paramKey: {value, min, max, step, label} }
// - create: function(audioContext, params) => { input, output, nodes..., cleanup }
//   - It should return an object with .input and .output AudioNodes to wire into the chain
//   - Optionally return an `update(params)` method to update parameters

const AdvancedAhhSite = (function(){
  const createReverbBuffer = (ctx, seconds=2, decay=2.0) => {
    const rate = ctx.sampleRate;
    const length = rate * seconds;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch=0; ch<2; ch++){
      const imp = impulse.getChannelData(ch);
      for (let i=0; i<length; i++){
        imp[i] = (Math.random()*2 -1) * Math.pow(1 - i/length, decay);
      }
    }
    return impulse;
  };

  return {
    effects: [
      {
        id:'lowquality',
        name:'Low Quality (lowpass + bit depth)',
        description:'Applies a lowpass and mild bit reduction for lo-fi sound.',
        defaultParams:{
          cutoff:{value:800, min:100, max:10000, step:1, label:'Cutoff Hz'},
          bits:{value:8, min:1, max:16, step:1, label:'Bits'}
        },
        create(ctx, params){
          const low = ctx.createBiquadFilter();
          low.type = 'lowpass';
          low.frequency.value = params.cutoff || 800;
          // bitcrusher using ScriptProcessor
          const crusher = ctx.createScriptProcessor(4096,1,1);
          const bits = params.bits || 8;
          crusher.onaudioprocess = function(e){
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            const step = Math.pow(0.5, bits);
            for(let i=0;i<input.length;i++){
              output[i] = Math.round(input[i]/step)*step;
            }
          };
          return {
            input: low,
            output: crusher,
            nodes: [low, crusher],
            update(updated){
              if(updated.cutoff) low.frequency.value = updated.cutoff;
              if(updated.bits) {/* recreate not implemented for simplicity */}
            },
            cleanup(){ crusher.disconnect(); low.disconnect(); }
          };
        }
      },
      {
        id:'delay',
        name:'Delay',
        description:'Delay with feedback and wet/dry.',
        defaultParams:{
          time:{value:0.3, min:0, max:2, step:0.01, label:'Time (s)'},
          feedback:{value:0.4, min:0, max:0.95, step:0.01, label:'Feedback'},
          wet:{value:0.5, min:0, max:1, step:0.01, label:'Wet'}
        },
        create(ctx, params){
          const delay = ctx.createDelay(5.0);
          delay.delayTime.value = params.time || 0.3;
          const fb = ctx.createGain(); fb.gain.value = params.feedback || 0.4;
          const wet = ctx.createGain(); wet.gain.value = params.wet ?? 0.5;
          const dry = ctx.createGain(); dry.gain.value = 1 - (params.wet ?? 0.5);

          // routing: in -> delay -> wet -> out ; delay -> fb -> delay (feedback)
          return {
            input: { connect: (target)=>{ /* placeholder, will be wired differently */ } },
            output: { connect: (target)=>{/* placeholder */} },
            // We'll supply nodes so chain builder can wire: nodes[0] is pre, nodes[-1] etc.
            nodes: [delay, fb, wet, dry],
            customWire(source, destination){
              // source -> dry -> destination
              source.connect(dry); dry.connect(destination);
              // source -> delay -> wet -> destination
              source.connect(delay);
              delay.connect(wet); wet.connect(destination);
              // feedback
              delay.connect(fb); fb.connect(delay);
            },
            update(updated){
              if(updated.time !== undefined) delay.delayTime.value = updated.time;
              if(updated.feedback !== undefined) fb.gain.value = updated.feedback;
              if(updated.wet !== undefined) { wet.gain.value = updated.wet; dry.gain.value = 1-updated.wet; }
            },
            cleanup(){ delay.disconnect(); fb.disconnect(); wet.disconnect(); dry.disconnect(); }
          };
        }
      },
      {
        id:'pitch',
        name:'Pitch Shift (playbackRate)',
        description:'Simple pitch shift by changing playbackRate (affects tempo).',
        defaultParams:{
          semitones:{value:0, min:-12, max:12, step:1, label:'Semitones'}
        },
        create(ctx, params){
          // This effect is implemented at source level: return marker to inform engine
          return {
            isSourceLevel: true,
            applyToSource(sourceNode, buffer, params) {
              const semi = params.semitones || 0;
              const rate = Math.pow(2, semi/12);
              sourceNode.playbackRate.value = rate;
            },
            update(updated){ /* nothing to do here */ },
            cleanup(){ }
          };
        }
      },
      {
        id:'reverb',
        name:'Reverb',
        description:'Convolver reverb with generated impulse response.',
        defaultParams:{
          seconds:{value:2.5, min:0.1, max:10, step:0.1, label:'Seconds'},
          decay:{value:2.0, min:0.1, max:10, step:0.1, label:'Decay'},
          wet:{value:0.5, min:0, max:1, step:0.01, label:'Wet'}
        },
        create(ctx, params){
          const convolver = ctx.createConvolver();
          convolver.buffer = createReverbBuffer(ctx, params.seconds || 2.5, params.decay || 2.0);
          const wet = ctx.createGain(); wet.gain.value = params.wet ?? 0.5;
          const dry = ctx.createGain(); dry.gain.value = 1 - (params.wet ?? 0.5);
          return {
            nodes:[convolver, wet, dry],
            customWire(source, destination){
              source.connect(dry); dry.connect(destination);
              source.connect(convolver); convolver.connect(wet); wet.connect(destination);
            },
            update(updated){
              if(updated.seconds || updated.decay){
                convolver.buffer = createReverbBuffer(ctx, updated.seconds || params.seconds, updated.decay || params.decay);
              }
              if(updated.wet !== undefined) { wet.gain.value = updated.wet; dry.gain.value = 1-updated.wet; }
            },
            cleanup(){ convolver.disconnect(); wet.disconnect(); dry.disconnect(); }
          };
        }
      },
      {
        id:'ringmod',
        name:'Ring Modulator',
        description:'Multiplicative ring modulation with sine LFO.',
        defaultParams:{
          freq:{value:30, min:0.1, max:2000, step:0.1, label:'LFO Freq'},
          depth:{value:0.8, min:0, max:1, step:0.01, label:'Depth'}
        },
        create(ctx, params){
          const carrier = ctx.createGain();
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          lfo.type = 'sine';
          lfo.frequency.value = params.freq || 30;
          lfoGain.gain.value = params.depth || 0.8;
          lfo.connect(lfoGain); lfoGain.connect(carrier.gain);
          lfo.start();
          return {
            nodes:[carrier, lfo, lfoGain],
            customWire(source, destination){
              source.connect(carrier); carrier.connect(destination);
            },
            update(updated){
              if(updated.freq !== undefined) lfo.frequency.value = updated.freq;
              if(updated.depth !== undefined) lfoGain.gain.value = updated.depth;
            },
            cleanup(){ lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); carrier.disconnect(); }
          };
        }
      },
      {
        id:'distortion',
        name:'Distortion',
        description:'WaveShaper distortion.',
        defaultParams:{
          amount:{value:20, min:0, max:100, step:1, label:'Amount'},
          wet:{value:0.8, min:0, max:1, step:0.01, label:'Wet'}
        },
        create(ctx, params){
          const shaper = ctx.createWaveShaper();
          function makeCurve(amount){
            const k = typeof amount === 'number' ? amount : 50;
            const n = 44100;
            const curve = new Float32Array(n);
            const deg = Math.PI/180;
            for (let i=0;i<n;i++){
              const x = i*2/n -1;
              curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
            }
            return curve;
          }
          shaper.curve = makeCurve(params.amount || 20);
          const wet = ctx.createGain(); wet.gain.value = params.wet ?? 0.8;
          const dry = ctx.createGain(); dry.gain.value = 1 - (params.wet ?? 0.8);
          return {
            nodes:[shaper, wet, dry],
            customWire(source, destination){
              source.connect(dry); dry.connect(destination);
              source.connect(shaper); shaper.connect(wet); wet.connect(destination);
            },
            update(updated){
              if(updated.amount !== undefined) shaper.curve = makeCurve(updated.amount);
              if(updated.wet !== undefined){ wet.gain.value = updated.wet; dry.gain.value = 1-updated.wet; }
            },
            cleanup(){ shaper.disconnect(); wet.disconnect(); dry.disconnect(); }
          };
        }
      },
      {
        id:'vibrato',
        name:'Vibrato',
        description:'Small pitch modulation via playbackRate modulation (approximation).',
        defaultParams:{
          rate:{value:5, min:0.1, max:20, step:0.1, label:'Rate Hz'},
          depth:{value:0.005, min:0.0005, max:0.05, step:0.0005, label:'Depth'}
        },
        create(ctx, params){
          // Vibrato implemented by modulating source.playbackRate — flagged as source-level
          return {
            isSourceLevel: true,
            applyToSource(sourceNode, buffer, params){
              // Must ensure sourceNode.playbackRate is automatable
              const lfo = ctx.createOscillator();
              const lfoGain = ctx.createGain();
              lfo.type = 'sine';
              lfo.frequency.value = params.rate || 5;
              lfoGain.gain.value = params.depth || 0.005;
              lfo.connect(lfoGain);
              // connect lfoGain to playbackRate
              lfoGain.connect(sourceNode.playbackRate);
              lfo.start();
              // attach for cleanup
              sourceNode._vibrato = {lfo, lfoGain};
            },
            update(updated){
              // Not implemented live; requires re-binding
            },
            cleanup(){}
          };
        }
      },
      {
        id:'reverse',
        name:'Reverse',
        description:'Reverse the audio buffer.',
        defaultParams:{},
        create(ctx, params){
          // Source-level: reverse buffer data
          return {
            isSourceLevel: true,
            applyToSource(sourceNode, buffer, params){
              for(let i=0;i<buffer.numberOfChannels;i++){
                Array.prototype.reverse.call(buffer.getChannelData(i));
              }
            },
            update(){},
            cleanup(){}
          };
        }
      },
      {
        id:'chorus',
        name:'Chorus',
        description:'Multi-voice modulated short delays (chorus).',
        defaultParams:{
          rate:{value:0.8, min:0.01, max:8, step:0.01, label:'LFO Rate'},
          depth:{value:0.006, min:0.001, max:0.05, step:0.001, label:'Depth'},
          wet:{value:0.6, min:0, max:1, step:0.01, label:'Wet'}
        },
        create(ctx, params){
          const output = ctx.createGain();
          const dry = ctx.createGain(); dry.gain.value = 1 - (params.wet ?? 0.6);
          const wet = ctx.createGain(); wet.gain.value = params.wet ?? 0.6;
          const delays = [];
          const lfos = [];
          const voices = 3;
          for(let v=0; v<voices; v++){
            const d = ctx.createDelay(0.03);
            d.delayTime.value = 0.01 + v*0.003;
            const l = ctx.createOscillator();
            const g = ctx.createGain(); g.gain.value = params.depth || 0.006;
            l.type = 'sine'; l.frequency.value = params.rate || 0.8 + v*0.1;
            l.connect(g); g.connect(d.delayTime);
            l.start();
            delays.push(d); lfos.push({l,g});
          }
          return {
            nodes: [dry, wet, output, ...delays],
            customWire(source, destination){
              source.connect(dry); dry.connect(destination);
              delays.forEach(d=>{
                source.connect(d); d.connect(wet); wet.connect(destination);
              });
            },
            update(updated){
              // update LFOs and wet
            },
            cleanup(){ delays.forEach(d=>d.disconnect()); lfos.forEach(o=>{o.l.stop(); o.l.disconnect(); o.g.disconnect();}); wet.disconnect(); dry.disconnect();}
          };
        }
      },
      {
        id:'flanger',
        name:'Flanger',
        description:'Short delay with LFO (flanger).',
        defaultParams:{rate:{value:0.25,min:0.01,max:5,step:0.01,label:'Rate'}, depth:{value:0.002,min:0.0001,max:0.01,step:0.0001,label:'Depth'}, feedback:{value:0.4,min:0,max:0.95,step:0.01,label:'Feedback'}, wet:{value:0.7,min:0,max:1,step:0.01,label:'Wet'}},
        create(ctx, params){
          const delay = ctx.createDelay(0.03);
          delay.delayTime.value = 0.005;
          const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value = params.rate || 0.25;
          const lfoGain = ctx.createGain(); lfoGain.gain.value = params.depth || 0.002;
          lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
          const feedback = ctx.createGain(); feedback.gain.value = params.feedback || 0.4;
          const wet = ctx.createGain(); wet.gain.value = params.wet || 0.7;
          const dry = ctx.createGain(); dry.gain.value = 1-(params.wet||0.7);
          return {
            nodes:[delay, lfo, lfoGain, feedback, wet, dry],
            customWire(source, destination){
              source.connect(dry); dry.connect(destination);
              source.connect(delay); delay.connect(wet); wet.connect(destination);
              delay.connect(feedback); feedback.connect(delay);
            },
            update(updated){
              if(updated.rate!==undefined) lfo.frequency.value = updated.rate;
              if(updated.depth!==undefined) lfoGain.gain.value = updated.depth;
              if(updated.feedback!==undefined) feedback.gain.value = updated.feedback;
              if(updated.wet!==undefined){ wet.gain.value = updated.wet; dry.gain.value = 1-updated.wet; }
            },
            cleanup(){ lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); delay.disconnect(); feedback.disconnect(); wet.disconnect(); dry.disconnect(); }
          };
        }
      },
      {
        id:'phaser',
        name:'Phaser',
        description:'Phaser using multiple allpass filters modulated by an LFO (approx).',
        defaultParams:{rate:{value:0.5,min:0.01,max:5,step:0.01,label:'Rate'}, depth:{value:0.6,min:0,max:1,step:0.01,label:'Depth'}},
        create(ctx, params){
          const allpasses = [];
          const stages = 4;
          for(let i=0;i<stages;i++){
            const ap = ctx.createBiquadFilter();
            ap.type = 'allpass';
            ap.frequency.value = 700 + i*200;
            allpasses.push(ap);
          }
          const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value = params.rate || 0.5;
          const lfoGain = ctx.createGain(); lfoGain.gain.value = params.depth ? params.depth*400 : 200;
          lfo.connect(lfoGain);
          // apply lfoGain to frequency automation of filters
          allpasses.forEach((ap, idx)=>{
            lfoGain.connect(ap.frequency);
          });
          lfo.start();
          const wet = ctx.createGain(); wet.gain.value = 0.6;
          const dry = ctx.createGain(); dry.gain.value = 0.4;
          return {
            nodes:[...allpasses, lfo, lfoGain, wet, dry],
            customWire(source, destination){
              source.connect(dry); dry.connect(destination);
              // chain allpasses
              let prev = source;
              allpasses.forEach(ap=>{
                prev.connect(ap);
                prev = ap;
              });
              prev.connect(wet); wet.connect(destination);
            },
            update(updated){
              if(updated.rate!==undefined) lfo.frequency.value = updated.rate;
              if(updated.depth!==undefined) lfoGain.gain.value = updated.depth*400;
            },
            cleanup(){ allpasses.forEach(a=>a.disconnect()); lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); wet.disconnect(); dry.disconnect(); }
          };
        }
      },
      {
        id:'bitcrusher',
        name:'Bitcrusher',
        description:'Reduces bit depth & sample rate (approx) via ScriptProcessor.',
        defaultParams:{bits:{value:8,min:1,max:16,step:1,label:'Bits'}, normFreq:{value:0.5,min:0.01,max:1,step:0.01,label:'Sample Rate'}},
        create(ctx, params){
          const proc = ctx.createScriptProcessor(4096,1,1);
          const bits = params.bits || 8;
          const normFreq = params.normFreq || 0.5;
          proc.onaudioprocess = (e)=>{
            const inp = e.inputBuffer.getChannelData(0);
            const out = e.outputBuffer.getChannelData(0);
            const step = Math.pow(0.5, bits);
            for(let i=0;i<inp.length;i++){
              // downsample
              if(Math.random() < normFreq){
                out[i] = Math.round(inp[i]/step)*step;
              } else {
                out[i] = inp[i];
              }
            }
          };
          return { input: proc, output: proc, nodes:[proc], update(){}, cleanup(){ proc.disconnect(); } };
        }
      },
      {
        id:'lofi_vinyl',
        name:'Lo-fi / Vinyl',
        description:'Adds noise, subtle warble (wiggle), and EQ to mimic vinyl/lofi.',
        defaultParams:{noise:{value:0.04,min:0,max:0.5,step:0.01,label:'Noise'}, wiggle:{value:0.002,min:0,max:0.01,step:0.0001,label:'Wiggle'}},
        create(ctx, params){
          const gainNoise = ctx.createGain();
          gainNoise.gain.value = params.noise || 0.04;
          // noise source using ScriptProcessor
          const noiseProc = ctx.createScriptProcessor(4096,1,1);
          noiseProc.onaudioprocess = (e)=>{
            const out = e.outputBuffer.getChannelData(0);
            for(let i=0;i<out.length;i++) out[i] = (Math.random()*2-1) * (params.noise||0.04);
          };
          noiseProc.connect(gainNoise);

          // wiggle: small delay modulated
          const delay = ctx.createDelay(0.05);
          delay.delayTime.value = params.wiggle || 0.002;
          const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value = 0.3;
          const lfoGain = ctx.createGain(); lfoGain.gain.value = params.wiggle || 0.002;
          lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
          const wet = ctx.createGain(); wet.gain.value = 0.6;
          const dry = ctx.createGain(); dry.gain.value = 0.8;
          return {
            nodes:[noiseProc, gainNoise, delay, lfo, lfoGain, wet, dry],
            customWire(source, destination){
              source.connect(dry); dry.connect(destination);
              source.connect(delay); delay.connect(wet); wet.connect(destination);
              gainNoise.connect(destination);
            },
            update(updated){},
            cleanup(){ noiseProc.disconnect(); gainNoise.disconnect(); delay.disconnect(); lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); wet.disconnect(); dry.disconnect(); }
          };
        }
      },
      {
        id:'amplitude_mod',
        name:'Amplitude Modulation',
        description:'Modulate amplitude by an LFO (tremolo / AM).',
        defaultParams:{rate:{value:4,min:0.1,max:20,step:0.1,label:'Rate'}, depth:{value:1,min:0,max:1,step:0.01,label:'Depth'}},
        create(ctx, params){
          const gain = ctx.createGain(); gain.gain.value = 1;
          const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value = params.rate || 4;
          const lfoGain = ctx.createGain(); lfoGain.gain.value = params.depth || 1;
          lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
          return { nodes:[gain, lfo, lfoGain], customWire(source, destination){ source.connect(gain); gain.connect(destination); }, update(updated){ if(updated.rate!==undefined) lfo.frequency.value = updated.rate; if(updated.depth!==undefined) lfoGain.gain.value = updated.depth; }, cleanup(){ lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); gain.disconnect(); } };
        }
      },
      {
        id:'noise',
        name:'Noise',
        description:'Insert noise into the signal.',
        defaultParams:{level:{value:0.04,min:0,max:1,step:0.01,label:'Level'}},
        create(ctx, params){
          const noiseProc = ctx.createScriptProcessor(4096,1,1);
          noiseProc.onaudioprocess = (e)=>{
            const out = e.outputBuffer.getChannelData(0);
            const level = params.level || 0.04;
            for(let i=0;i<out.length;i++) out[i] = (Math.random()*2-1) * level;
          };
          const gain = ctx.createGain(); gain.gain.value = params.level || 0.04;
          noiseProc.connect(gain);
          return { nodes:[noiseProc,gain], customWire(source, destination){ source.connect(destination); gain.connect(destination); }, update(updated){ if(updated.level!==undefined) gain.gain.value = updated.level; }, cleanup(){ noiseProc.disconnect(); gain.disconnect(); } };
        }
      },
      {
        id:'wiggle',
        name:'Wiggle (parameter-only)',
        description:'Adds an LFO to wiggle some parameter — parameter-only effect for UI demos.',
        defaultParams:{amount:{value:0.02,min:0,max:0.2,step:0.001,label:'Amount'}, rate:{value:0.5,min:0.01,max:5,step:0.01,label:'Rate'}},
        create(ctx, params){
          // parameter-only; return stub that the engine will interpret
          return {
            parameterOnly: true,
            params: params,
            update(updated){ this.params = {...this.params, ...updated}; },
            cleanup(){}
          };
        }
      }
    ]
  };
})();