// SUNSET BAY — synthesized audio: SFX and a quiet synthwave loop.
// No audio files, no network. Everything is guarded so a missing or
// suspended AudioContext can never break the game.
window.SB = window.SB || {};

(function () {
  'use strict';

  const AudioSys = {
    ctx: null,
    master: null,
    musicGain: null,
    sirenNodes: null,
    engineNodes: null,
    musicTimer: null,
    enabled: true,

    init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.14;
        this.musicGain.connect(this.master);
      } catch (e) { this.ctx = null; }
    },
    resume() {
      try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) {}
    },
    // One-shot tone: freq ramp, short envelope.
    blip(freq, dur, type, vol, slideTo) {
      if (!this.ctx || !this.enabled) return;
      try {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(vol || 0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) {}
    },
    click() { this.blip(880, 0.06, 'square', 0.08); },
    punch() { this.blip(140, 0.12, 'sawtooth', 0.25, 60); },
    pickup() { this.blip(520, 0.12, 'sine', 0.2, 780); },
    cash() {
      this.blip(660, 0.09, 'sine', 0.2);
      setTimeout(() => this.blip(990, 0.14, 'sine', 0.2), 90);
    },
    jingle() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'triangle', 0.2), i * 110));
    },
    fail() { this.blip(220, 0.3, 'sawtooth', 0.18, 110); },
    bust() {
      this.blip(330, 0.25, 'square', 0.15, 165);
      setTimeout(() => this.blip(220, 0.4, 'square', 0.15, 110), 200);
    },
    // Police siren: two alternating tones, looping while wanted > 0.
    siren(on) {
      if (!this.ctx) return;
      if (on && !this.sirenNodes) {
        try {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = 700;
          g.gain.value = 0.05;
          const lfo = this.ctx.createOscillator();
          lfo.frequency.value = 0.9;
          const lg = this.ctx.createGain();
          lg.gain.value = 260;
          lfo.connect(lg); lg.connect(o.frequency);
          o.connect(g); g.connect(this.master);
          o.start(); lfo.start();
          this.sirenNodes = { o, lfo, g };
        } catch (e) { this.sirenNodes = null; }
      } else if (!on && this.sirenNodes) {
        try {
          this.sirenNodes.o.stop();
          this.sirenNodes.lfo.stop();
        } catch (e) {}
        this.sirenNodes = null;
      }
    },
    // Engine hum whose pitch follows speed; called every frame while driving.
    engine(speed, maxSpeed) {
      if (!this.ctx) return;
      try {
        if (!this.engineNodes) {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.value = 50;
          g.gain.value = 0.0;
          const f = this.ctx.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = 400;
          o.connect(f); f.connect(g); g.connect(this.master);
          o.start();
          this.engineNodes = { o, g };
        }
        const n = this.engineNodes;
        const ratio = maxSpeed > 0 ? Math.abs(speed) / maxSpeed : 0;
        n.o.frequency.setTargetAtTime(50 + ratio * 140, this.ctx.currentTime, 0.05);
        n.g.gain.setTargetAtTime(speed !== 0 ? 0.05 : 0.0, this.ctx.currentTime, 0.1);
      } catch (e) {}
    },
    // Quiet synthwave bassline loop: A-minor, 8 steps, scheduled per bar.
    startMusic() {
      if (!this.ctx || this.musicTimer) return;
      const bass = [55, 55, 65.41, 49, 55, 55, 82.41, 73.42];
      let step = 0;
      const tick = () => {
        if (!this.ctx) return;
        try {
          const t = this.ctx.currentTime;
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.value = bass[step % bass.length];
          g.gain.setValueAtTime(0.16, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
          const f = this.ctx.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = 320;
          o.connect(f); f.connect(g); g.connect(this.musicGain);
          o.start(t); o.stop(t + 0.45);
          // Sparkle note on every other step.
          if (step % 2 === 0) {
            const o2 = this.ctx.createOscillator();
            const g2 = this.ctx.createGain();
            o2.type = 'sine';
            o2.frequency.value = bass[step % bass.length] * 4;
            g2.gain.setValueAtTime(0.05, t);
            g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            o2.connect(g2); g2.connect(this.musicGain);
            o2.start(t); o2.stop(t + 0.32);
          }
        } catch (e) {}
        step++;
      };
      this.musicTimer = setInterval(tick, 240);
    },
    stopMusic() {
      if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    },
  };

  window.SB.audio = AudioSys;
})();
