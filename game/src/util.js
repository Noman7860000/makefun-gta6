// SUNSET BAY — util.js
// Small shared helpers: a seeded random generator so the city layout is
// deterministic for a given ?seed=, plus angle and formatting helpers.
// No game logic lives here, only pure functions every other file can use.
(function () {
  'use strict';

  // mulberry32: a tiny fast seeded PRNG. seed is any integer.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A small RNG object with the helpers the world builder wants.
  function RNG(seed) {
    var next = mulberry32(seed);
    return {
      next: next,
      range: function (lo, hi) { return lo + next() * (hi - lo); },
      int: function (lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Shortest signed angle from a to b, in (-PI, PI].
  function angleDiff(a, b) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Ease an angle toward a target at a limited turn rate (radians per second).
  function turnToward(current, target, maxStep) {
    var d = angleDiff(current, target);
    if (d > maxStep) return current + maxStep;
    if (d < -maxStep) return current - maxStep;
    return target;
  }

  function dist2d(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function fmtMoney(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // Seconds -> "M:SS".
  function fmtClock(totalSeconds) {
    var s = Math.max(0, Math.ceil(totalSeconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Expose one namespace object for the other classic scripts to use.
  window.SB = window.SB || {};
  window.SB.util = {
    mulberry32: mulberry32,
    RNG: RNG,
    clamp: clamp,
    lerp: lerp,
    angleDiff: angleDiff,
    turnToward: turnToward,
    dist2d: dist2d,
    fmtMoney: fmtMoney,
    fmtClock: fmtClock,
  };
})();
