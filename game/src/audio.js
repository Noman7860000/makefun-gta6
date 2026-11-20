// SUNSET BAY sound: a tiny WebAudio synth. Everything is generated in
// code — no audio files, no network. The context is created lazily on the
// first user gesture (browsers block audio before that) and every call is
// guarded so a missing or blocked context can never crash the game.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.enabled = true;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
      this._startEngineHum();
    } catch (e) {
      this.ctx = null;
    }
  }

  _startEngineHum() {
    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      this.engineOsc.connect(lp);
      lp.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
    } catch (e) { /* hum is decorative */ }
  }

  setEngine(speed, inCar) {
    if (!this.ctx || !this.engineOsc) return;
    try {
      const t = this.ctx.currentTime;
      const target = inCar ? 0.05 + Math.min(0.09, Math.abs(speed) * 0.004) : 0;
      this.engineGain.gain.setTargetAtTime(target, t, 0.1);
      this.engineOsc.frequency.setTargetAtTime(50 + Math.abs(speed) * 3.2, t, 0.1);
    } catch (e) { /* ignore */ }
  }

  _tone(freq, dur, type = 'sine', vol = 0.25, slideTo = 0) {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) { /* ignore */ }
  }

  _noise(dur, vol = 0.3, freq = 800) {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t);
    } catch (e) { /* ignore */ }
  }

  punch() { this._noise(0.09, 0.35, 500); this._tone(120, 0.09, 'square', 0.2, 70); }
  hit() { this._noise(0.15, 0.3, 300); }
  crash() { this._noise(0.4, 0.5, 220); this._tone(70, 0.35, 'sawtooth', 0.25, 40); }
  siren() { this._tone(720, 0.5, 'sine', 0.12, 1080); }
  cash() { this._tone(880, 0.12, 'sine', 0.22); setTimeout(() => this._tone(1320, 0.2, 'sine', 0.22), 110); }
  success() {
    this._tone(523, 0.14, 'sine', 0.22);
    setTimeout(() => this._tone(659, 0.14, 'sine', 0.22), 130);
    setTimeout(() => this._tone(784, 0.26, 'sine', 0.24), 260);
  }
  fail() { this._tone(220, 0.4, 'sawtooth', 0.18, 110); }
  pickup() { this._tone(660, 0.1, 'triangle', 0.25, 990); }
  click() { this._tone(900, 0.05, 'square', 0.12); }
}
