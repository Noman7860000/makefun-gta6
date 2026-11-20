// SUNSET BAY — tiny WebAudio synth for engine, punches, cash and sirens.
// Everything is guarded: no AudioContext, no sound, no crash. Written fresh.
export class AudioSys {
  constructor() {
    this.muted = false;
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
  }
  _ctx() {
    if (this.muted) return null;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  }
  _tone(freq, dur, type, vol, slideTo) {
    const ctx = this._ctx();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch { /* ignore */ }
  }
  click() { this._tone(660, 0.06, 'square', 0.04); }
  punch() { this._tone(120, 0.12, 'sine', 0.12, 60); }
  cash() { this._tone(880, 0.09, 'sine', 0.07); setTimeout(() => this._tone(1320, 0.14, 'sine', 0.07), 90); }
  mission() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 'triangle', 0.07), i * 110)); }
  fail() { this._tone(220, 0.25, 'sawtooth', 0.06, 110); }
  engine(on) {
    const ctx = this._ctx();
    if (!ctx) return;
    try {
      if (on && !this.engineOsc) {
        this.engineOsc = ctx.createOscillator();
        this.engineGain = ctx.createGain();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.setValueAtTime(55, ctx.currentTime);
        this.engineGain.gain.setValueAtTime(0.015, ctx.currentTime);
        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(ctx.destination);
        this.engineOsc.start();
      } else if (!on && this.engineOsc) {
        this.engineOsc.stop();
        this.engineOsc = null; this.engineGain = null;
      }
    } catch { /* ignore */ }
  }
  setEngineRpm(rpm) {
    if (this.engineOsc) {
      try { this.engineOsc.frequency.setValueAtTime(45 + rpm * 60, this.ctx.currentTime); } catch { /* ignore */ }
    }
  }
  siren(on) {
    const ctx = this._ctx();
    if (!ctx) return;
    try {
      if (on && !this.sirenOsc) {
        this.sirenOsc = ctx.createOscillator();
        this.sirenGain = ctx.createGain();
        this.sirenOsc.type = 'sine';
        this.sirenOsc.frequency.setValueAtTime(700, ctx.currentTime);
        this.sirenGain.gain.setValueAtTime(0.02, ctx.currentTime);
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.setValueAtTime(1.2, ctx.currentTime);
        lg.gain.setValueAtTime(250, ctx.currentTime);
        lfo.connect(lg); lg.connect(this.sirenOsc.frequency);
        this.sirenOsc.connect(this.sirenGain);
        this.sirenGain.connect(ctx.destination);
        this.sirenOsc.start(); lfo.start();
        this._sirenLfo = lfo;
      } else if (!on && this.sirenOsc) {
        this.sirenOsc.stop();
        if (this._sirenLfo) this._sirenLfo.stop();
        this.sirenOsc = null; this.sirenGain = null; this._sirenLfo = null;
      }
    } catch { /* ignore */ }
  }
}
