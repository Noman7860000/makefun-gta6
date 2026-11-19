// SUNSET BAY — audio.js
// All sound is synthesised with WebAudio: no audio files are loaded. The
// context is created lazily on the first user gesture (the start button),
// and every call is guarded so the game still runs where audio is blocked.
(function () {
  'use strict';

  function AudioSys() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenTimer = null;
    this.sirenOn = false;
  }

  AudioSys.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      return true;
    } catch (e) {
      return false;
    }
  };

  AudioSys.prototype._tone = function (freq, dur, type, vol, slideTo) {
    if (!this.ensure()) return;
    try {
      var ctx = this.ctx;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol || 0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) { /* audio is best-effort */ }
  };

  AudioSys.prototype.blip = function () { this._tone(880, 0.12, 'sine', 0.12, 1320); };
  AudioSys.prototype.thud = function () { this._tone(90, 0.16, 'square', 0.16, 55); };
  AudioSys.prototype.cash = function () {
    this._tone(1320, 0.1, 'sine', 0.1);
    var self = this;
    setTimeout(function () { self._tone(1760, 0.18, 'sine', 0.1); }, 90);
  };
  AudioSys.prototype.sirenBlip = function () { this._tone(700, 0.3, 'sawtooth', 0.05, 950); };
  AudioSys.prototype.jingle = function () {
    var notes = [523, 659, 784, 1047];
    var self = this;
    notes.forEach(function (f, i) {
      setTimeout(function () { self._tone(f, 0.22, 'triangle', 0.12); }, i * 110);
    });
  };
  AudioSys.prototype.fail = function () { this._tone(220, 0.5, 'sawtooth', 0.1, 110); };

  // A low engine hum whose pitch follows the car's speed.
  AudioSys.prototype.setEngine = function (on, speedNorm) {
    if (!on) {
      if (this.engineOsc) {
        try { this.engineOsc.stop(); } catch (e) {}
        this.engineOsc = null;
        this.engineGain = null;
      }
      return;
    }
    if (!this.ensure()) return;
    try {
      if (!this.engineOsc) {
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0.03;
        var filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);
        this.engineOsc.start();
      }
      this.engineOsc.frequency.setValueAtTime(55 + (speedNorm || 0) * 90, this.ctx.currentTime);
    } catch (e) { /* best-effort */ }
  };

  // A two-tone police siren while the wanted level is up.
  AudioSys.prototype.setSiren = function (on) {
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (this.sirenTimer) { clearInterval(this.sirenTimer); this.sirenTimer = null; }
    if (!on) return;
    var high = false;
    var self = this;
    this.sirenTimer = setInterval(function () {
      high = !high;
      self._tone(high ? 950 : 700, 0.42, 'triangle', 0.035);
    }, 420);
  };

  window.SB.audio = { AudioSys: AudioSys };
})();
