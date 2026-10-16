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

  // ---------------------------------------------------------------- 배경음악(으스스한 BGM)
  // 불협화음 저음 드론 + 고장 난 오르골 멜로디 + 가끔 현을 긁는 소리. 리버브로 넓은 공간감.
  // mode: 'lobby'(잔잔) | 'game'(긴장, 감염 단계에 따라 빨라짐)
  get musicOn() { try { return localStorage.getItem('zpb_bgm') !== '0'; } catch { return true; } }

  setMusicOn(on) {
    try { localStorage.setItem('zpb_bgm', on ? '1' : '0'); } catch { /* 무시 */ }
    if (!on) this.stopMusic();
    else if (this.musicMode) { const m = this.musicMode; this.musicMode = null; this.startMusic(m); }
  }

  makeReverb() {
    const c = this.ctx, len = c.sampleRate * 3.5;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = c.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  startMusic(mode = 'lobby') {
    if (this.music && this.musicMode === mode) return;
    this.musicMode = mode;
    if (!this.musicOn || !this.ensure()) return;
    this.stopMusic(true);
    const c = this.ctx, t = c.currentTime;
    const bus = c.createGain();
    bus.gain.setValueAtTime(0, t);
    bus.gain.linearRampToValueAtTime(mode === 'game' ? 0.5 : 0.6, t + 4);
    bus.connect(this.master);
    const rev = this.makeReverb();
    const wet = c.createGain(); wet.gain.value = 0.55;
    rev.connect(wet).connect(bus);

    // 1) 드론: A1 과 Bb1(단2도) — 귀에 거슬리는 맥놀이
    const nodes = [];
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 4;
    const lpLfo = c.createOscillator(); lpLfo.frequency.value = 0.05;
    const lpLfoG = c.createGain(); lpLfoG.gain.value = 140;
    lpLfo.connect(lpLfoG).connect(lp.frequency);
    const droneG = c.createGain(); droneG.gain.value = mode === 'game' ? 0.16 : 0.12;
    for (const [f, type] of [[55, 'sawtooth'], [58.27, 'sawtooth'], [27.5, 'sine'], [82.4, 'triangle']]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = Math.random() * 8 - 4;
      o.connect(lp); o.start(t); nodes.push(o);
    }
    lp.connect(droneG); droneG.connect(bus); droneG.connect(rev);
    lpLfo.start(t); nodes.push(lpLfo);

    this.music = { bus, rev, nodes, timers: [], intensity: 0, droneG };
    this.scheduleMusicBox();
    this.scheduleScrape();
  }

  /** 고장 난 오르골: 프리지안/감음계 음을 띄엄띄엄, 살짝 음이 나간 채로 */
  scheduleMusicBox() {
    const m = this.music;
    if (!m) return;
    const scale = [0, 1, 3, 6, 7, 8, 11]; // 반음 간격 — 불안한 음계
    const base = 440 * Math.pow(2, 3 / 12); // C5
    let step = 0;
    const play = () => {
      if (this.music !== m) return;
      const c = this.ctx, t = c.currentTime;
      const notes = 1 + (Math.random() < 0.3 ? 1 : 0);
      for (let n = 0; n < notes; n++) {
        const semi = scale[(step + n * 2 + Math.floor(Math.random() * 3)) % scale.length] - (Math.random() < 0.3 ? 12 : 0);
        const f = base * Math.pow(2, semi / 12) * (1 + (Math.random() - 0.5) * 0.012); // 살짝 음이 나감
        for (const [mul, vol] of [[1, 0.09], [2.01, 0.03], [3.98, 0.012]]) {
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
          const g = c.createGain();
          const st = t + n * 0.18;
          g.gain.setValueAtTime(0, st);
          g.gain.linearRampToValueAtTime(vol, st + 0.005);
          g.gain.exponentialRampToValueAtTime(0.0005, st + 2.2);
          o.connect(g); g.connect(m.rev); g.connect(m.bus);
          o.start(st); o.stop(st + 2.3);
        }
      }
      step = (step + 1 + Math.floor(Math.random() * 2)) % scale.length;
      // 오르골 태엽이 풀리듯 박자가 들쭉날쭉. 감염 단계가 오르면 빨라진다.
      const gap = (m.intensity >= 2 ? 0.55 : m.intensity === 1 ? 0.9 : 1.5) * (0.7 + Math.random() * 1.1);
      const pause = Math.random() < 0.12 ? 3 + Math.random() * 4 : 0;
      m.timers.push(setTimeout(play, (gap + pause) * 1000));
    };
    m.timers.push(setTimeout(play, 1500));
  }

  /** 가끔 들리는 현 긁는 소리 / 금속 울림 */
  scheduleScrape() {
    const m = this.music;
    if (!m) return;
    const go = () => {
      if (this.music !== m) return;
      const c = this.ctx, t = c.currentTime;
      if (Math.random() < 0.6) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        const f0 = 900 + Math.random() * 700;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.linearRampToValueAtTime(f0 * (Math.random() < 0.5 ? 0.94 : 1.06), t + 5);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f0; bp.Q.value = 12;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05 + m.intensity * 0.015, t + 2.5);
        g.gain.linearRampToValueAtTime(0, t + 5.5);
        o.connect(bp).connect(g); g.connect(m.rev); g.connect(m.bus);
        o.start(t); o.stop(t + 5.6);
      } else {
        // 먼 곳의 쇠문 울림
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(42, t + 3);
        const g = c.createGain();
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 3);
        o.connect(g); g.connect(m.rev);
        o.start(t); o.stop(t + 3.1);
      }
      const gap = (m.intensity >= 2 ? 6 : 11) + Math.random() * 10;
      m.timers.push(setTimeout(go, gap * 1000));
    };
    m.timers.push(setTimeout(go, 5000 + Math.random() * 5000));
  }

  /** 감염 단계(0~2)에 따라 BGM 긴장도 */
  setMusicIntensity(i) {
    if (!this.music) return;
    this.music.intensity = i;
    const t = this.ctx.currentTime;
    this.music.droneG.gain.linearRampToValueAtTime(0.16 + i * 0.05, t + 3);
  }

  stopMusic(keepMode = false) {
    if (!keepMode) this.musicMode = null;
    const m = this.music;
    if (!m) return;
    this.music = null;
    m.timers.forEach(clearTimeout);
    const t = this.ctx.currentTime;
    m.bus.gain.cancelScheduledValues(t);
    m.bus.gain.setValueAtTime(m.bus.gain.value, t);
    m.bus.gain.linearRampToValueAtTime(0, t + 1.2);
    setTimeout(() => {
      m.nodes.forEach((n) => { try { n.stop(); } catch { /* 이미 멈춤 */ } });
      m.bus.disconnect();
    }, 1400);
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

  // ---------------------------------------------------------------- 상황별 효과음
  /** 발소리: 콘크리트 바닥 / 운동장 풀밭 */
  footstep({ run = false, crouch = false, grass = false } = {}) {
    const vol = crouch ? 0.05 : run ? 0.2 : 0.11;
    if (grass) this.noise({ dur: 0.09, freq: 2600, q: 0.8, type: 'highpass', vol: vol * 0.7, pan: Math.random() * 0.2 - 0.1 });
    else {
      this.noise({ dur: 0.07, freq: 380 + Math.random() * 120, q: 1.5, type: 'bandpass', vol, pan: Math.random() * 0.2 - 0.1 });
      this.tone({ freq: 95, to: 60, dur: 0.06, type: 'sine', vol: vol * 0.6 });
    }
  }
  /** 숨이 찬 헐떡임(스태미나 바닥) */
  pant() {
    for (let i = 0; i < 3; i++) setTimeout(() => this.noise({ dur: 0.28, freq: 1400, q: 1.2, type: 'bandpass', vol: 0.12, attack: 0.08 }), i * 380);
  }
  /** 멀리서 들리는 비명(동료가 물렸을 때) */
  scream(pan = 0) {
    this.tone({ freq: 720, to: 380, dur: 1.1, type: 'sawtooth', vol: 0.09, pan, attack: 0.05 });
    this.tone({ freq: 760, to: 400, dur: 1.0, type: 'sawtooth', vol: 0.06, pan, attack: 0.05 });
    this.noise({ dur: 1.0, freq: 1600, q: 3, type: 'bandpass', vol: 0.18, pan, attack: 0.05 });
  }
  /** 누군가 탈출: 먼 정문 + 희망의 종소리 */
  escapeChime() {
    this.gate();
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 1.4, type: 'sine', vol: 0.12 }), 500 + i * 160));
  }
  /** 환풍구에서 좀비가 기어 나옴: 금속 덜컹 + 긁힘 */
  ventCrawl(vol = 0.3, pan = 0) {
    this.noise({ dur: 0.5, freq: 1800, q: 6, type: 'bandpass', vol: vol * 0.6, pan, attack: 0.05 });
    setTimeout(() => this.tone({ freq: 160, to: 90, dur: 0.18, type: 'square', vol: vol * 0.3, pan }), 200);
    setTimeout(() => this.noise({ dur: 0.2, freq: 500, vol: vol * 0.5, pan }), 380);
  }
  /** 거대 좀비의 쿵쿵 발걸음 */
  bruteStep(vol = 0.3, pan = 0) { this.tone({ freq: 55, to: 30, dur: 0.35, type: 'sine', vol, pan }); this.noise({ dur: 0.2, freq: 150, vol: vol * 0.6, pan }); }
  /** 열쇠 떨어뜨림 */
  keyDrop() { [1600, 1250, 1450].forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 0.12, type: 'triangle', vol: 0.12 }), i * 90)); }
  /** 사물함 삐걱 */
  creak() { this.tone({ freq: 340, to: 260, dur: 0.45, type: 'sawtooth', vol: 0.05, attack: 0.05 }); this.door(0.2); }
  /** 사물함 안에서 시간이 다 돼 감 */
  tick() { this.tone({ freq: 2000, dur: 0.03, type: 'square', vol: 0.05 }); }
  /** 승리/패배 스팅어 */
  win() { [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 1.6 - i * 0.2, type: 'triangle', vol: 0.16 }), i * 140)); }
  lose() {
    [233, 220, 196].forEach((f, i) => setTimeout(() => this.tone({ freq: f, to: f * 0.97, dur: 1.2, type: 'sawtooth', vol: 0.1 }), i * 380));
    setTimeout(() => this.tone({ freq: 55, to: 35, dur: 2.5, type: 'sine', vol: 0.35 }), 1100);
  }
  /** 로비: 버튼 클릭 / 누가 들어옴 / 누가 나감 */
  click() { this.tone({ freq: 180, to: 120, dur: 0.06, type: 'square', vol: 0.06 }); this.noise({ dur: 0.05, freq: 900, vol: 0.08 }); }
  joinChime() { this.tone({ freq: 330, dur: 0.5, type: 'sine', vol: 0.12 }); setTimeout(() => this.tone({ freq: 311, dur: 0.9, type: 'sine', vol: 0.1 }), 180); }
  leaveChime() { this.tone({ freq: 311, to: 200, dur: 0.6, type: 'triangle', vol: 0.1 }); }
  /** 문이 잠겨 막힘 */
  rattle() { for (let i = 0; i < 3; i++) setTimeout(() => this.noise({ dur: 0.06, freq: 1200, q: 4, type: 'bandpass', vol: 0.15 }), i * 70); }
}

export const sfx = new Sfx();
