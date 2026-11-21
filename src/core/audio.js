/* ============================================================
   XADREZ ROYALE — Áudio Tátil Sintetizado + Rádio Procedural (4 Estações)
   Zero arquivos externos; efeitos táteis + 4 trilhas Web Audio API.
   ============================================================ */

export const MUSIC_STATIONS = [
  { id: 'imperial', name: '🏛️ Imperial',    desc: 'Pad clássico suave de salão real' },
  { id: 'vice',     name: '🌴 Vice 80s',    desc: 'Synthwave GTA VI com arpejo neon' },
  { id: 'lofi',     name: '☕ Lo-Fi Club',   desc: 'Acordes jazzísticos relaxantes' },
  { id: 'tension',  name: '⚔️ Tensão GM',   desc: 'Pulso cinematográfico de torneio' },
  { id: 'gotham',   name: '🦇 Gotham Noir', desc: 'Suspense sombrio com eco cinematográfico' },
  { id: 'heroes',   name: '⚡ Heróis',       desc: 'Marcha épica heroica com metais synth' }
];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicEnabled = true;
    this.musicStyle = 'imperial';
    this.musicPlaying = false;
    this._musicTimer = null;
    this._musicMaster = null;
    this._stepIdx = 0;
  }

  _ensure() {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  _tone(freq, dur, type = 'triangle', vol = 0.14, endFreq = null) {
    const ctx = this._ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  startMusic() {
    if (this.muted || !this.musicEnabled || this.musicPlaying) return;
    const ctx = this._ensure();
    if (!ctx) return;

    this.musicPlaying = true;
    this._stepIdx = 0;
    this._musicMaster = ctx.createGain();
    this._musicMaster.gain.setValueAtTime(0.001, ctx.currentTime);
    this._musicMaster.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 1.2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = this.musicStyle === 'vice' || this.musicStyle === 'heroes' ? 1550 : (this.musicStyle === 'gotham' ? 860 : 1120);
    filter.frequency.setValueAtTime(cutoff, ctx.currentTime);

    /* Barramento de Eco / Delay Estéreo para ambiência cinematográfica */
    const delay = ctx.createDelay(1.0);
    delay.delayTime.setValueAtTime(this.musicStyle === 'gotham' ? 0.44 : 0.34, ctx.currentTime);
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(this.musicStyle === 'gotham' ? 0.36 : 0.26, ctx.currentTime);
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(0.32, ctx.currentTime);

    this._musicMaster.connect(filter);
    filter.connect(ctx.destination);
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(ctx.destination);

    const playNote = (freq, dur, type, amp, attack = 0.04) => {
      if (!this.musicPlaying || !this._musicMaster) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(amp, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g);
      g.connect(this._musicMaster);
      osc.start(now);
      osc.stop(now + dur + 0.04);
    };

    if (this.musicStyle === 'vice') {
      const bassLine = [110, 110, 130.81, 146.83, 164.81, 146.83, 130.81, 98.0];
      const pads = [
        [220.0, 261.63, 329.63],
        [174.61, 220.0, 261.63],
        [196.0, 246.94, 293.66],
        [164.81, 207.65, 246.94]
      ];
      const step = () => {
        if (!this.musicPlaying || this.muted || !this.musicEnabled) return;
        const i = this._stepIdx++;
        const bFreq = bassLine[i % bassLine.length];
        playNote(bFreq, 0.36, 'sawtooth', 0.22, 0.015);
        if (i % 2 === 0) playNote(bFreq * 0.5, 0.42, 'sine', 0.26, 0.01);
        if (i % 8 === 0) {
          const ch = pads[Math.floor(i / 8) % pads.length];
          ch.forEach(f => playNote(f, 3.2, 'triangle', 0.12, 0.4));
        }
      };
      step();
      this._musicTimer = setInterval(step, 380);
    } else if (this.musicStyle === 'gotham') {
      /* Sombras de Gotham (Suspense Noir em Dó Menor) */
      const steps = [
        { bass: 65.41, pad: [130.81, 155.56, 196.0], lead: 392.0 },
        {},
        { lead: 311.13 },
        {},
        { bass: 103.83, pad: [155.56, 207.65, 261.63], lead: 415.3 },
        {},
        { lead: 392.0 },
        {},
        { bass: 87.31, pad: [130.81, 174.61, 207.65], lead: 349.23 },
        {},
        { lead: 311.13 },
        {},
        { bass: 98.0, pad: [146.83, 196.0, 246.94], lead: 293.66 },
        { lead: 311.13 },
        { lead: 293.66 },
        {}
      ];
      const step = () => {
        if (!this.musicPlaying || this.muted || !this.musicEnabled) return;
        const st = steps[this._stepIdx++ % steps.length];
        if (st.bass) playNote(st.bass, 1.8, 'triangle', 0.28, 0.06);
        if (st.pad) st.pad.forEach(f => playNote(f, 2.2, 'sine', 0.11, 0.35));
        if (st.lead) playNote(st.lead, 0.9, 'sine', 0.15, 0.04);
      };
      step();
      this._musicTimer = setInterval(step, 520);
    } else if (this.musicStyle === 'heroes') {
      /* Marcha dos Heróis (Épico em Ré Menor) */
      const steps = [
        { bass: 73.42, lead: 293.66, pad: [146.83, 220.0] },
        { bass: 73.42 },
        { bass: 73.42, lead: 440.0 },
        { bass: 110.0, lead: 392.0 },
        { bass: 116.54, lead: 349.23, pad: [116.54, 174.61, 233.08] },
        { bass: 116.54 },
        { bass: 130.81, lead: 392.0, pad: [130.81, 196.0, 261.63] },
        { lead: 440.0 },
        { bass: 73.42, lead: 587.33, pad: [146.83, 220.0] },
        { bass: 73.42 },
        { bass: 73.42, lead: 523.25 },
        { lead: 440.0 },
        { bass: 103.83, lead: 392.0, pad: [130.81, 196.0] },
        { lead: 349.23 },
        { bass: 110.0, lead: 329.63, pad: [110.0, 164.81, 220.0] },
        { lead: 392.0 }
      ];
      const step = () => {
        if (!this.musicPlaying || this.muted || !this.musicEnabled) return;
        const st = steps[this._stepIdx++ % steps.length];
        if (st.bass) playNote(st.bass, 0.35, 'sawtooth', 0.24, 0.015);
        if (st.pad) st.pad.forEach(f => playNote(f, 1.4, 'triangle', 0.12, 0.18));
        if (st.lead) playNote(st.lead, 0.55, 'sawtooth', 0.14, 0.02);
      };
      step();
      this._musicTimer = setInterval(step, 350);
    } else if (this.musicStyle === 'lofi') {
      const chords = [
        [146.83, 220.0, 261.63, 329.63],
        [196.0, 246.94, 329.63, 392.0],
        [130.81, 196.0, 246.94, 293.66],
        [110.0, 164.81, 220.0, 261.63]
      ];
      const melody = [523.25, 493.88, 440.0, 392.0, 329.63, 392.0, 440.0, 0];
      const step = () => {
        if (!this.musicPlaying || this.muted || !this.musicEnabled) return;
        const i = this._stepIdx++;
        if (i % 4 === 0) {
          const ch = chords[Math.floor(i / 4) % chords.length];
          ch.forEach((f, idx) => playNote(f, 2.7, idx === 0 ? 'triangle' : 'sine', idx === 0 ? 0.28 : 0.14, 0.18));
        }
        const m = melody[i % melody.length];
        if (m > 0) playNote(m, 0.55, 'sine', 0.10, 0.03);
      };
      step();
      this._musicTimer = setInterval(step, 680);
    } else if (this.musicStyle === 'tension') {
      const pulse = [73.42, 73.42, 87.31, 73.42, 82.41, 73.42, 98.0, 65.41];
      const step = () => {
        if (!this.musicPlaying || this.muted || !this.musicEnabled) return;
        const i = this._stepIdx++;
        const p = pulse[i % pulse.length];
        playNote(p, 0.5, 'triangle', 0.30, 0.02);
        if (i % 4 === 0) playNote(p * 3, 1.4, 'sine', 0.10, 0.25);
        if (i % 6 === 3) playNote(p * 4, 0.35, 'sine', 0.08, 0.02);
      };
      step();
      this._musicTimer = setInterval(step, 520);
    } else {
      const chords = [
        [146.83, 261.63, 329.63, 440.00],
        [98.00,  246.94, 329.63, 392.00],
        [130.81, 246.94, 293.66, 392.00],
        [110.00, 220.00, 293.66, 392.00]
      ];
      const step = () => {
        if (!this.musicPlaying || this.muted || !this.musicEnabled) return;
        const notes = chords[this._stepIdx % chords.length];
        this._stepIdx++;
        notes.forEach((freq, idx) => {
          playNote(freq, 3.4, idx === 0 ? 'triangle' : 'sine', idx === 0 ? 0.34 : 0.18, 0.8);
        });
      };
      step();
      this._musicTimer = setInterval(step, 3100);
    }
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    if (this._musicMaster) {
      try { this._musicMaster.disconnect(); } catch { /* noop */ }
      this._musicMaster = null;
    }
  }

  setMusic(on) {
    this.musicEnabled = !!on;
    if (!this.musicEnabled || this.muted) this.stopMusic();
    else this.startMusic();
  }

  setMusicStyle(styleId) {
    const valid = MUSIC_STATIONS.some(s => s.id === styleId) ? styleId : 'imperial';
    if (this.musicStyle === valid && this.musicPlaying) return;
    this.musicStyle = valid;
    if (this.musicPlaying) {
      this.stopMusic();
      this.startMusic();
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) this.stopMusic();
    else if (this.musicEnabled) this.startMusic();
  }

  select() { this._tone(520, 0.045, 'sine', 0.06, 660); }
  move() { this._tone(190, 0.075, 'triangle', 0.18, 95); }
  capture() {
    this._tone(150, 0.11, 'sawtooth', 0.14, 58);
    setTimeout(() => this._tone(240, 0.06, 'triangle', 0.12, 90), 25);
  }
  castle() {
    this.move();
    setTimeout(() => this.move(), 95);
  }
  check() {
    this._tone(680, 0.12, 'triangle', 0.15, 880);
    setTimeout(() => this._tone(880, 0.16, 'sine', 0.12, 990), 80);
  }
  promote() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.14, 'triangle', 0.12), i * 55));
  }
  win() {
    [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this._tone(f, 0.24, 'triangle', 0.13), i * 85));
  }
  defeat() {
    [392, 349, 311, 261].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 'triangle', 0.12), i * 95));
  }
  draw() {
    [440, 392, 440].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 'sine', 0.10), i * 90));
  }
  premove() {
    this._tone(420, 0.04, 'sine', 0.07, 580);
    setTimeout(() => this._tone(580, 0.035, 'sine', 0.04), 35);
  }
  arrow() {
    this._tone(340, 0.03, 'sine', 0.035, 420);
  }
  hint() {
    [587, 880].forEach((f, i) => setTimeout(() => this._tone(f, 0.14, 'sine', 0.08), i * 65));
  }
  chat() {
    this._tone(620, 0.06, 'sine', 0.06, 780);
  }
  tick() { this._tone(960, 0.03, 'sine', 0.04); }
  error() { this._tone(160, 0.1, 'sawtooth', 0.08, 120); }
}
