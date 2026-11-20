// Shared helpers for SUNSET BAY: deterministic RNG, math, and the city grid.
// Every module in game/src imports from here; nothing here touches the DOM.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Shortest signed angle from a to b, in (-PI, PI].
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// The road grid: roads run along x = c and z = c for every c in GRID.
export const GRID = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
export const ROAD_HALF = 5; // roads are 10 m wide
export const CITY_HALF = 234; // playable bounds (half-extent)

export function nearestGridCoord(v) {
  let best = GRID[0];
  let bd = Infinity;
  for (const c of GRID) {
    const d = Math.abs(v - c);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// Is the point on a road (within the asphalt of some grid road)?
export function onRoad(x, z) {
  for (const c of GRID) {
    if (Math.abs(x - c) <= ROAD_HALF + 0.5) return true;
    if (Math.abs(z - c) <= ROAD_HALF + 0.5) return true;
  }
  return false;
}

// Snap a point to the nearest road centre line (used for spawning cars).
export function snapToRoad(x, z) {
  const cx = nearestGridCoord(x);
  const cz = nearestGridCoord(z);
  if (Math.abs(x - cx) <= Math.abs(z - cz)) return { x: cx, z, alongX: false };
  return { x, z: cz, alongX: true };
}

// --- geometry merging (keeps the draw-call count low under swiftshader) --
// Merge a list of parts into one BufferGeometry with per-vertex colours.
// Each part: { geo, matrix, color (THREE.Color), uvScale: [su, sv] }.
// The merged mesh renders in a single draw call with a vertex-colour material.
export function mergeGeos(parts) {
  const THREE = window.THREE;
  const pos = [];
  const norm = [];
  const uv = [];
  const col = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    nm.getNormalMatrix(part.matrix);
    const su = part.uvScale ? part.uvScale[0] : 1;
    const sv = part.uvScale ? part.uvScale[1] : 1;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(part.matrix);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      norm.push(v.x, v.y, v.z);
      if (u) uv.push(u.getX(i) * su, u.getY(i) * sv);
      else uv.push(0, 0);
      col.push(part.color.r, part.color.g, part.color.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// Scale a BoxGeometry's per-face UVs so a texture tiles every `tile` metres.
// BoxGeometry faces come in order +x, -x, +y, -y, +z, -z (4 verts each).
export function scaleBoxUVs(geo, w, h, d, tile = 8) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * dims[f][0] / tile, uv.getY(idx) * dims[f][1] / tile);
    }
  }
}
