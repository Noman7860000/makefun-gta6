// SUNSET BAY — shared utilities and world constants.
// Clean-room rewrite: every line written fresh for this entry.
window.SB = window.SB || {};

(function () {
  'use strict';

  // --- Deterministic RNG (mulberry32) -------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- Math helpers ---------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }
  // Smallest signed difference between two headings (radians).
  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  // Forward vector for a heading: heading 0 faces +z, PI/2 faces +x.
  function forwardOf(heading) { return { x: Math.sin(heading), z: Math.cos(heading) }; }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  // --- City layout ----------------------------------------------------------
  // Road centre-lines on a 52 m grid. Roads are 10 m wide; blocks are 42 m.
  const ROADS = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
  const WORLD_HALF = 232; // playable bounds
  const ROAD_WIDTH = 10;

  const LANDMARKS = {
    garage:    { x: -156, z: 104,  r: 12, label: 'Garage' },
    docks:     { x: -156, z: -156, r: 12, label: 'Docks' },
    mall:      { x: -104, z: 0,    r: 12, label: 'Mall' },
    casino:    { x: 104,  z: 104,  r: 12, label: 'Casino' },
    safehouse: { x: 156,  z: 156,  r: 12, label: 'Safehouse' },
  };

  function nearestRoadCoord(v) {
    let best = ROADS[0], bd = 1e9;
    for (const c of ROADS) {
      const d = Math.abs(v - c);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // Is a point on a road (within the road strip, plus a small margin)?
  function isOnRoad(x, z) {
    for (const c of ROADS) {
      if (Math.abs(x - c) <= ROAD_WIDTH / 2 + 1) return true;
      if (Math.abs(z - c) <= ROAD_WIDTH / 2 + 1) return true;
    }
    return false;
  }

  // --- DOM helper -----------------------------------------------------------
  function el(id) { return document.getElementById(id); }
  function show(node, on) { if (node) node.style.display = on ? 'flex' : 'none'; }

  window.SB.util = {
    mulberry32, clamp, lerp, dist2, angleDiff, forwardOf, pick,
    ROADS, WORLD_HALF, ROAD_WIDTH, LANDMARKS, nearestRoadCoord, isOnRoad,
    el, show,
  };
})();
