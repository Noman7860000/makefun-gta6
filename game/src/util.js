// SUNSET BAY — utilities: seeded RNG, math helpers, tiny event helpers.
// Written fresh for the gta6-01 entry. Classic script, no modules.

(function (global) {
  'use strict';

  // mulberry32 — small, fast, deterministic. Same seed => same city every run.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const next = mulberry32(seed);
    return {
      next: next,
      range: function (min, max) { return min + next() * (max - min); },
      int: function (min, max) { return Math.floor(min + next() * (max - min + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(current, target, lambda, dt) {
    // Frame-rate independent exponential approach.
    return lerp(target, current, Math.exp(-lambda * dt));
  }
  // Shortest signed angle difference, radians.
  function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function angleLerp(a, b, t) { return a + angleDiff(a, b) * t; }
  function dist2(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }
  function dist(ax, az, bx, bz) { return Math.sqrt(dist2(ax, az, bx, bz)); }

  // Format helpers for the HUD.
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  global.SBUtil = {
    makeRng: makeRng,
    clamp: clamp,
    lerp: lerp,
    damp: damp,
    angleDiff: angleDiff,
    angleLerp: angleLerp,
    dist: dist,
    dist2: dist2,
    fmtMoney: fmtMoney,
    fmtTime: fmtTime,
  };
})(window);
