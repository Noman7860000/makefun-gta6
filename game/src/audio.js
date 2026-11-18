// SUNSET BAY — synthesized audio. Everything is WebAudio oscillators and noise;
// no audio files, no network. Classic script, no modules.

(function (global) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.volume = 0.7;
    this.musicOn = true;
    this._engine = null;      // { osc, sub, filter, gain }
    this._siren = null;       // { osc, gain, phase, timer }
    this._skid = null;        // { src, filter, gain }
    this._musicTimer = null;
    this._step = 0;
    this._nextNoteTime = 0;
  }

  AudioEngine.prototype.init = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    this._startEngineLoop();
    this._startSirenLoop();
    this._startSkidLoop();
    if (this.musicOn) this.startMusic();
  };

  AudioEngine.prototype.setVolume = function (v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  };
  AudioEngine.prototype.setMusic = function (on) {
    this.musicOn = !!on;
    if (on) this.startMusic(); else this.stopMusic();
  };

  AudioEngine.prototype._noiseBuffer = function () {
    if (this._nb) return this._nb;
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._nb = buf;
    return buf;
  };

  // ---- continuous voices -------------------------------------------------
  AudioEngine.prototype._startEngineLoop = function () {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 28;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 320; filter.Q.value = 2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(this.sfxGain);
    osc.start(); sub.start();
    this._engine = { osc: osc, sub: sub, filter: filter, gain: gain };
  };
  // rpm 0..1, on = engine audible (in a car). Call every frame.
  AudioEngine.prototype.engine = function (rpm, on) {
    if (!this._engine) return;
    const t = this.ctx.currentTime;
    const target = on ? 0.05 + rpm * 0.075 : 0;
    this._engine.gain.gain.setTargetAtTime(target, t, 0.08);
    this._engine.osc.frequency.setTargetAtTime(52 + rpm * 165, t, 0.05);
    this._engine.sub.frequency.setTargetAtTime(26 + rpm * 55, t, 0.05);
    this._engine.filter.frequency.setTargetAtTime(300 + rpm * 1600, t, 0.1);
  };

  AudioEngine.prototype._startSirenLoop = function () {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 750;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(gain); gain.connect(this.sfxGain);
    osc.start();
    this._siren = { osc: osc, gain: gain, hi: false, timer: 0 };
  };
  // on = any police close; dist = metres to nearest police (for volume).
  AudioEngine.prototype.siren = function (on, dist) {
    if (!this._siren) return;
    const t = this.ctx.currentTime;
    if (on) {
      const vol = Math.max(0, 0.16 * (1 - (dist || 0) / 120));
      this._siren.gain.gain.setTargetAtTime(vol, t, 0.2);
      this._siren.timer += 1 / 60;
      if (this._siren.timer > 0.38) {
        this._siren.timer = 0;
        this._siren.hi = !this._siren.hi;
        this._siren.osc.frequency.setTargetAtTime(this._siren.hi ? 960 : 690, t, 0.02);
      }
    } else {
      this._siren.gain.gain.setTargetAtTime(0, t, 0.2);
    }
  };

  AudioEngine.prototype._startSkidLoop = function () {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(); src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 900; filter.Q.value = 1.2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter); filter.connect(gain); gain.connect(this.sfxGain);
    src.start();
    this._skid = { gain: gain };
  };
  AudioEngine.prototype.skid = function (on) {
    if (!this._skid) return;
    this._skid.gain.gain.setTargetAtTime(on ? 0.07 : 0, this.ctx.currentTime, 0.06);
  };

  // ---- one-shot effects --------------------------------------------------
  AudioEngine.prototype._blip = function (freq, dur, type, vol, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  };
  AudioEngine.prototype._noiseHit = function (dur, filterFreq, vol, type) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuffer();
    const f = this.ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  };

  AudioEngine.prototype.click = function () { this._blip(880, 0.07, 'square', 0.08); };
  AudioEngine.prototype.punch = function () { this._noiseHit(0.12, 500, 0.5); this._blip(140, 0.1, 'sine', 0.35, 60); };
  AudioEngine.prototype.hurt = function () { this._blip(220, 0.18, 'sawtooth', 0.18, 90); };
  AudioEngine.prototype.crash = function (intensity) {
    const k = Math.max(0.2, Math.min(1, intensity || 0.5));
    this._noiseHit(0.35, 900, 0.55 * k);
    this._blip(90, 0.25, 'sine', 0.4 * k, 40);
  };
  AudioEngine.prototype.horn = function () { this._blip(370, 0.28, 'square', 0.12); this._blip(466, 0.28, 'square', 0.08); };
  AudioEngine.prototype.chime = function () { this._blip(1320, 0.12, 'sine', 0.18); setTimeout(() => this._blip(1760, 0.2, 'sine', 0.18), 90); };
  AudioEngine.prototype.jingle = function () {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => setTimeout(() => this._blip(n, 0.22, 'triangle', 0.2), i * 110));
  };
  AudioEngine.prototype.sting = function () {
    const notes = [392, 330, 262, 196];
    notes.forEach((n, i) => setTimeout(() => this._blip(n, 0.3, 'sawtooth', 0.14), i * 160));
  };
  AudioEngine.prototype.gunshot = function () { this._noiseHit(0.09, 2400, 0.5, 'highpass'); this._blip(180, 0.08, 'square', 0.25, 60); };

  // ---- music: moody synthwave loop, 100 BPM, Am – F – C – G -------------
  AudioEngine.prototype.startMusic = function () {
    if (!this.ctx || this._musicTimer) return;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    const self = this;
    this._musicTimer = setInterval(function () { self._scheduleMusic(); }, 40);
  };
  AudioEngine.prototype.stopMusic = function () {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  };
  AudioEngine.prototype._scheduleMusic = function () {
    if (!this.ctx) return;
    const spb = 60 / 100 / 2; // 8th notes at 100 BPM
    while (this._nextNoteTime < this.ctx.currentTime + 0.18) {
      this._playStep(this._step, this._nextNoteTime, spb);
      this._step = (this._step + 1) % 64;
      this._nextNoteTime += spb;
    }
  };
  AudioEngine.prototype._note = function (freq, time, dur, type, vol, dest) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g); g.connect(dest || this.musicGain);
    o.start(time); o.stop(time + dur + 0.05);
  };
  AudioEngine.prototype._playStep = function (step, time, spb) {
    // Chords: Am, F, C, G — one bar (16 steps) each.
    const roots = [55.0, 43.65, 65.41, 49.0]; // A1 F1 C2 G1
    const bar = Math.floor(step / 16);
    const root = roots[bar];
    const s = step % 16;
    // Kick on quarters.
    if (s % 4 === 0) this._note(120, time, 0.16, 'sine', 0.5);
    // Hat on off-beats (quiet noise via short high blip).
    if (s % 2 === 1) this._note(6000, time, 0.03, 'square', 0.02);
    // Bass: root on 0, 3, 6, 10, 12 with octave hops.
    const bassSteps = { 0: 1, 3: 1, 6: 2, 10: 1, 12: 2, 14: 1.5 };
    if (bassSteps[s]) this._note(root * bassSteps[s], time, spb * 1.8, 'sawtooth', 0.16);
    // Pad chord at bar start.
    if (s === 0) {
      const third = bar === 1 ? 1.189 : 1.26; // F major third vs minor
      [1, third, 1.498].forEach((m) => this._note(root * 4 * m, time, spb * 15, 'triangle', 0.045));
    }
    // Sparse lead pluck on some bars.
    if (bar === 3 && (s === 4 || s === 11)) this._note(880 * (s === 4 ? 1 : 1.122), time, spb * 2, 'sine', 0.08);
  };

  global.SBAudio = new AudioEngine();
})(window);
