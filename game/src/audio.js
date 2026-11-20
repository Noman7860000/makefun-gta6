// SUNSET BAY — tiny WebAudio synth: engine hum, siren, punch, cash,
// mission jingles. Everything is guarded: no context, no sound, no crash.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 420;
      this.engineOsc.connect(filt);
      filt.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engineOsc.start();
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.ctx.destination);
      this.sirenOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.engineGain) this.engineGain.gain.value = 0;
    if (this.sirenGain) this.sirenGain.gain.value = 0;
  }

  // Called every frame while playing.
  update(dt, speed01, inCar, wanted) {
    if (!this.ctx || this.muted) return;
    try {
      if (this.engineGain) {
        this.engineGain.gain.value = inCar ? 0.015 + speed01 * 0.045 : 0;
        if (this.engineOsc) this.engineOsc.frequency.value = 55 + speed01 * 110;
      }
      if (this.sirenGain && this.sirenOsc) {
        if (wanted > 0) {
          this.sirenTimer += dt;
          const hi = Math.floor(this.sirenTimer * 2) % 2 === 0;
          this.sirenOsc.frequency.value = hi ? 880 : 620;
          this.sirenGain.gain.value = 0.012;
        } else {
          this.sirenGain.gain.value = 0;
        }
      }
    } catch {
      // Audio is cosmetic; never let it break the game.
    }
  }

  blip(freq, dur, vol, type = 'sine') {
    if (!this.ctx || this.muted) return;
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      o.stop(this.ctx.currentTime + dur);
    } catch {
      // ignore
    }
  }

  punch() {
    this.blip(90, 0.12, 0.12, 'square');
  }

  cash() {
    this.blip(880, 0.1, 0.08);
    setTimeout(() => this.blip(1320, 0.16, 0.08), 90);
  }

  missionStart() {
    this.blip(523, 0.12, 0.07);
    setTimeout(() => this.blip(659, 0.12, 0.07), 110);
  }

  missionComplete() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.18, 0.08), i * 110));
  }

  fail() {
    this.blip(220, 0.3, 0.08, 'sawtooth');
  }
}
