// WebAudio로 즉석 합성하는 효과음 (외부 파일 없음)
class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise(2);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  makeNoise(sec) {
    const len = this.ctx.sampleRate * sec;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // brown noise
      d[i] = last * 3.5;
    }
    return buf;
  }

  noise({ dur = 0.3, freq = 800, q = 1, type = 'lowpass', vol = 0.5, pan = 0, attack = 0.005 } = {}) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, to = null, dur = 0.2, type = 'sine', vol = 0.3, pan = 0, attack = 0.01 } = {}) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  startAmbient() {
    if (!this.ensure() || this.ambient) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380;
    const g = this.ctx.createGain(); g.gain.value = 0.18;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.1;
    lfo.connect(lfoG).connect(g.gain);
    const drone = this.ctx.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 41;
    const df = this.ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 120;
    const dg = this.ctx.createGain(); dg.gain.value = 0.07;
    src.connect(f).connect(g).connect(this.master);
    drone.connect(df).connect(dg).connect(this.master);
    src.start(t); lfo.start(t); drone.start(t);
    this.ambient = { src, lfo, drone, g, dg };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const { src, lfo, drone } = this.ambient;
    [src, lfo, drone].forEach((n) => { try { n.stop(); } catch { /* 이미 멈춤 */ } });
    this.ambient = null;
  }

  siren(seconds = 3) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.8;
    const lg = this.ctx.createGain(); lg.gain.value = 220;
    o.frequency.value = 680;
    lfo.connect(lg).connect(o.frequency);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.3);
    g.gain.setValueAtTime(0.22, t + seconds - 0.6);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); lfo.start(t); o.stop(t + seconds + 0.1); lfo.stop(t + seconds + 0.1);
  }

  groan(vol = 0.25, pan = 0) {
    if (!this.ensure()) return;
    const base = 70 + Math.random() * 50;
    this.tone({ freq: base * 1.4, to: base, dur: 0.9 + Math.random() * 0.6, type: 'sawtooth', vol: vol * 0.35, pan, attack: 0.15 });
    this.noise({ dur: 0.8, freq: 420 + Math.random() * 200, q: 6, type: 'bandpass', vol: vol * 0.9, pan, attack: 0.12 });
  }

  door(vol = 0.4, pan = 0) {
    this.noise({ dur: 0.35, freq: 300, vol, pan });
    this.tone({ freq: 110, to: 55, dur: 0.25, type: 'square', vol: vol * 0.25, pan });
  }
  slam() { this.noise({ dur: 0.6, freq: 200, vol: 0.8 }); this.tone({ freq: 80, to: 30, dur: 0.5, type: 'sine', vol: 0.6 }); }
  lock(v = 1) { this.tone({ freq: 1400, dur: 0.05, type: 'square', vol: 0.15 * v }); setTimeout(() => this.tone({ freq: 900, dur: 0.08, type: 'square', vol: 0.15 * v }), 70); }
  pickup() { this.tone({ freq: 880, to: 1760, dur: 0.25, type: 'triangle', vol: 0.3 }); setTimeout(() => this.tone({ freq: 1320, dur: 0.4, type: 'sine', vol: 0.2 }), 90); }
  beep() { this.tone({ freq: 660, dur: 0.12, type: 'square', vol: 0.12 }); }
  go() { this.tone({ freq: 220, to: 110, dur: 0.8, type: 'sawtooth', vol: 0.3 }); this.noise({ dur: 0.8, freq: 600, vol: 0.4 }); }
  heartbeat(vol = 0.5) { this.tone({ freq: 60, to: 40, dur: 0.15, vol }); setTimeout(() => this.tone({ freq: 55, to: 38, dur: 0.18, vol: vol * 0.8 }), 180); }
  arrest() { this.tone({ freq: 300, dur: 0.4, type: 'square', vol: 0.2 }); setTimeout(() => this.tone({ freq: 240, dur: 0.5, type: 'square', vol: 0.2 }), 220); }
  caught() { this.noise({ dur: 1.2, freq: 1200, q: 2, type: 'bandpass', vol: 0.8, attack: 0.02 }); this.tone({ freq: 400, to: 90, dur: 1.2, type: 'sawtooth', vol: 0.3 }); }
  gate() { this.tone({ freq: 90, to: 60, dur: 2, type: 'sawtooth', vol: 0.25, attack: 0.4 }); this.noise({ dur: 2, freq: 500, q: 3, type: 'bandpass', vol: 0.4, attack: 0.5 }); }
  type() { this.tone({ freq: 1800 + Math.random() * 400, dur: 0.02, type: 'square', vol: 0.04 }); }
}

export const sfx = new Sfx();
