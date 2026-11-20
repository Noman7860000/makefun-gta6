// SUNSET BAY — the city: a 9x9 street grid, landmarks, buildings,
// traffic lights and the day/night clock. Pure data + rules, no rendering.
import { mulberry32, clamp, pick } from './util.js';

export const ROAD_COORDS = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
export const GRID_MIN = -208;
export const GRID_MAX = 208;
export const HALF = 260; // ground plane half-size (water strip on the west edge)

export const LANDMARK_DEFS = {
  casino: { x: 104, z: 104, name: 'Palm Casino' },
  mall: { x: -104, z: 0, name: 'Bay Mall' },
  docks: { x: -156, z: -156, name: 'The Docks' },
  safehouse: { x: 156, z: 156, name: 'Safehouse' },
  garage: { x: -156, z: 104, name: 'Sunset Garage' },
};

// One traffic-light cycle, in game seconds: 7s green for the z-road,
// then 7s green for the x-road.
export const LIGHT_PERIOD = 14;
export const LIGHT_GREEN = 7;

const BUILDING_COLORS = [0x8a7f70, 0x6e7f8a, 0x9a8a6a, 0x7a6a7f, 0x5f6e5a, 0x8a6a5f, 0x6a6a72, 0xa08a70];

export function nearestRoadCoord(v) {
  let best = ROAD_COORDS[0];
  let bd = Infinity;
  for (const c of ROAD_COORDS) {
    const d = Math.abs(v - c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function createWorld(seed) {
  const rng = mulberry32(seed);
  const landmarks = {};
  for (const [key, def] of Object.entries(LANDMARK_DEFS)) {
    landmarks[key] = { ...def };
  }

  // Buildings live inside blocks (between roads), never on a road or a pad.
  const buildings = [];
  const blockCenters = [-182, -130, -78, -26, 26, 78, 130, 182];
  // Landmark buildings sit in the block next to their pad, clear of the pad.
  const landmarkBuildings = [
    { key: 'casino', bx: 130, bz: 130, w: 34, d: 26, h: 30, color: 0xc9a227, label: 'PALM CASINO' },
    { key: 'mall', bx: -78, bz: 26, w: 38, d: 22, h: 15, color: 0x3f6fb5, label: 'BAY MALL' },
    { key: 'docks', bx: -130, bz: -130, w: 30, d: 22, h: 12, color: 0x4a6a72, label: 'DOCKS' },
    { key: 'safehouse', bx: 182, bz: 182, w: 16, d: 13, h: 9, color: 0xb5763f, label: 'SAFEHOUSE' },
    { key: 'garage', bx: -130, bz: 130, w: 26, d: 18, h: 11, color: 0xb5483f, label: 'SUNSET GARAGE' },
  ];
  const reserved = new Set(landmarkBuildings.map((b) => b.bx + ',' + b.bz));
  for (const lb of landmarkBuildings) {
    buildings.push({ x: lb.bx, z: lb.bz, w: lb.w, d: lb.d, h: lb.h, color: lb.color, label: lb.label, landmark: lb.key });
  }
  for (const bx of blockCenters) {
    for (const bz of blockCenters) {
      if (reserved.has(bx + ',' + bz)) continue;
      const count = rng() < 0.45 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const ox = count === 1 ? 0 : i === 0 ? -11 : 11;
        const oz = count === 1 ? 0 : i === 0 ? -11 : 11;
        const distC = Math.hypot(bx, bz);
        const tall = clamp(1.15 - distC / 320, 0.35, 1.15);
        const w = 13 + rng() * 10;
        const d = 13 + rng() * 10;
        const h = Math.round((8 + rng() * 22) * tall);
        buildings.push({
          x: bx + ox + (rng() - 0.5) * 4,
          z: bz + oz + (rng() - 0.5) * 4,
          w, d, h,
          color: pick(rng, BUILDING_COLORS),
          label: null, landmark: null,
        });
      }
    }
  }

  // Street lamps at every other junction, on the corner.
  const lamps = [];
  for (let ix = 0; ix < ROAD_COORDS.length; ix += 1) {
    for (let iz = 0; iz < ROAD_COORDS.length; iz += 1) {
      if ((ix + iz) % 2 === 0) lamps.push({ x: ROAD_COORDS[ix] + 7, z: ROAD_COORDS[iz] + 7 });
    }
  }

  const world = {
    seed,
    time: 0,
    timeOfDay: 0.35, // 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk
    landmarks,
    buildings,
    lamps,
    roads: ROAD_COORDS,

    // Advance the clock. A full day is 240 game-seconds.
    step(dt) {
      this.time += dt;
      this.timeOfDay = (this.timeOfDay + dt / 240) % 1;
    },

    advanceTime(amount) {
      this.timeOfDay = (this.timeOfDay + amount) % 1;
    },

    // 'green' | 'red' for traffic on the road through (x, z).
    // forXRoad=true: the light governing traffic moving along x.
    // forXRoad=false: the light governing traffic moving along z.
    lightStateAt(x, z, forXRoad) {
      const jx = nearestRoadCoord(x);
      const jz = nearestRoadCoord(z);
      if (Math.abs(x - jx) > 16 || Math.abs(z - jz) > 16) return 'green';
      const ix = ROAD_COORDS.indexOf(jx);
      const iz = ROAD_COORDS.indexOf(jz);
      const offset = (ix * 7 + iz * 3) % LIGHT_PERIOD;
      const phase = (this.time + offset) % LIGHT_PERIOD;
      const zGreen = phase < LIGHT_GREEN;
      if (forXRoad) return zGreen ? 'red' : 'green';
      return zGreen ? 'green' : 'red';
    },

    // 0..1 daylight factor from the time of day.
    daylight() {
      const t = this.timeOfDay;
      const sun = Math.sin((t - 0.25) * Math.PI * 2); // 1 at noon, -1 at midnight
      return clamp(0.15 + 0.85 * Math.max(0, sun), 0.12, 1);
    },
  };
  return world;
}
