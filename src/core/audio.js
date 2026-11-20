/* ============================================================
   XADREZ ROYALE — Áudio Tátil Sintetizado (Web Audio API)
   Zero arquivos externos; som de madeira, captura, xeque e mate.
   ============================================================ */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
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
  tick() { this._tone(960, 0.03, 'sine', 0.04); }
  error() { this._tone(160, 0.1, 'sawtooth', 0.08, 120); }
}
