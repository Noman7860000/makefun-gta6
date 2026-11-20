// SUNSET BAY — the city: a 9x9 road grid, landmarks, buildings, traffic lights,
// and the day/night clock. Written fresh for the v9 rebuild.
import { mulberry32, rand, pick } from './util.js';

export const ROAD_COORDS = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
export const CITY = 232; // half-extent of the drivable city

const BUILDING_COLORS = [0x8a7f72, 0x6b7c8c, 0x9c8a6b, 0x7a6b7f, 0x5f6e5a, 0x8c6f5a, 0x74808c, 0x9b8f7a];

export class World {
  constructor(seed, lowfx) {
    this.rng = mulberry32(seed);
    this.lowfx = !!lowfx;
    // timeOfDay: 0..1. 0.3 is late morning. T advances it by a quarter day.
    this.timeOfDay = 0.3;
    this.lightPhase = 0; // seconds into the 20 s traffic-light cycle
    this.landmarks = {
      casino: { x: 104, z: 104, name: 'Palm Casino' },
      mall: { x: -104, z: 0, name: 'Bay Mall' },
      docks: { x: -156, z: -156, name: 'The Docks' },
      safehouse: { x: 156, z: 156, name: 'Safehouse' },
      garage: { x: -156, z: 104, name: 'Sunset Garage' },
    };
    this.buildings = [];
    this._genBuildings();
  }

  _genBuildings() {
    const rng = this.rng;
    // Block centres sit between neighbouring road lines.
    const centres = [];
    for (let i = 0; i < ROAD_COORDS.length - 1; i++) {
      centres.push((ROAD_COORDS[i] + ROAD_COORDS[i + 1]) / 2);
    }
    for (const bx of centres) {
      for (const bz of centres) {
        if (this.lowfx && rng() < 0.4) continue;
        const w = rand(rng, 16, 30);
        const d = rand(rng, 16, 30);
        const h = rand(rng, 8, this.lowfx ? 26 : 42);
        this.buildings.push({
          x: bx + rand(rng, -4, 4), z: bz + rand(rng, -4, 4),
          w, d, h, color: pick(rng, BUILDING_COLORS),
        });
      }
    }
    // Landmark towers, one block in from their intersection.
    const towers = [
      { x: 130, z: 130, w: 26, d: 26, h: 55, color: 0xc9a227, name: 'casino' },
      { x: -78, z: 26, w: 30, d: 22, h: 20, color: 0x3f6fb5, name: 'mall' },
      { x: -130, z: -130, w: 30, d: 20, h: 16, color: 0x7a5a3a, name: 'docks' },
      { x: 130, z: 182, w: 22, d: 18, h: 18, color: 0x4f8f4f, name: 'safehouse' },
      { x: -130, z: 130, w: 24, d: 20, h: 14, color: 0xd07a2a, name: 'garage' },
    ];
    for (const t of towers) this.buildings.push(t);
  }

  nearestRoadCoord(v) {
    let best = ROAD_COORDS[0];
    let bd = Infinity;
    for (const c of ROAD_COORDS) {
      const d = Math.abs(v - c);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // Traffic light at a junction. eastWest=false is the north-south road
  // (the Z road). 20 s cycle: green 0-9, yellow 9-10, red 10-19, yellow 19-20.
  lightStateAt(x, z, eastWest) {
    const ph = this.lightPhase % 20;
    const ns = ph < 9 ? 'green' : ph < 10 ? 'yellow' : ph < 19 ? 'red' : 'yellow';
    if (eastWest) return ns === 'red' ? 'green' : ns === 'green' ? 'red' : 'yellow';
    return ns;
  }

  update(dt) {
    this.lightPhase += dt;
    this.timeOfDay = (this.timeOfDay + dt / 600) % 1;
  }
}
