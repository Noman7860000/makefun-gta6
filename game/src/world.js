// SUNSET BAY city: roads, blocks, buildings, landmarks, traffic lights,
// street lamps, palms, sky and day/night. Also owns the collision boxes
// (buildings) and the traffic-light cycle the red-light rule reads.
import { GRID, ROAD_HALF, CITY_HALF, makeRng, clamp, lerp, mergeGeos, scaleBoxUVs } from './util.js';

const THREE = window.THREE;

// Light cycle: 24 s loop. NS green 0-10, yellow 10-12, red 12-22, yellow 22-24.
// EW is the opposite phase.
const LIGHT_PERIOD = 24;
const NS_GREEN_END = 10;
const NS_YELLOW_END = 12;
const NS_RED_END = 22;

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2f36'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#26272d';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  // edge lines
  g.fillStyle = '#d8d8d0'; g.fillRect(0, 2, 64, 2); g.fillRect(0, 60, 64, 2);
  // dashed centre line, running along the canvas width (u) so it lies
  // along the road whichever way the strip is laid
  g.fillStyle = '#e8c33a'; g.fillRect(4, 30, 20, 4); g.fillRect(36, 30, 20, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#20242e'; g.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 248; y += 18) {
    for (let x = 8; x < 120; x += 16) {
      const lit = Math.random() < 0.45;
      g.fillStyle = lit ? '#ffd98a' : '#3a4a66';
      g.fillRect(x, y, 10, 12);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

const PALETTE = [
  0xe8b48a, 0xd98f6a, 0xc9d6dd, 0xb7c4a8, 0xe3d3a7, 0x9fb8c8,
  0xd9a0a0, 0xa8b8d8, 0xe0cfa0, 0x8fb8a8, 0xd8b8d0, 0xc8c8c8,
];

export class World {
  constructor(scene, seed, lowfx) {
    this.scene = scene;
    this.lowfx = lowfx;
    this.rng = makeRng(seed);
    this.timeOfDay = 0.35; // morning: 0 night, 0.25 dawn, 0.5 noon, 0.75 dusk
    this.lightClock = 3; // seconds into the light cycle
    this.buildings = []; // {x, z, hw, hd, h} collision boxes
    this._buildingParts = []; // merged window-textured boxes
    this._plainParts = []; // merged plain-colour boxes (roof caps, containers)
    this.landmarks = {
      garage: { x: -156, z: 104 },
      docks: { x: -156, z: -156 },
      safehouse: { x: 156, z: 156 },
      mall: { x: -104, z: 0 },
      casino: { x: 104, z: 104 },
    };
    this._buildSky();
    this._buildGround();
    this._buildRoads();
    this._buildBlocks();
    this._buildLandmarks();
    this._flushMerged();
    this._buildLights();
    this._buildLampsAndPalms();
    this.updateSun();
  }

  _buildSky() {
    this.scene.background = new THREE.Color(0x87b5e0);
    this.scene.fog = new THREE.Fog(0x9db8d2, 180, 520);
    this.sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
    this.sun.castShadow = !this.lowfx;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -90; this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90; this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a5a, 0.9);
    this.scene.add(this.hemi);
  }

  _buildGround() {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_HALF * 2 + 80, CITY_HALF * 2 + 80),
      new THREE.MeshLambertMaterial({ color: 0x7d9b6a }),
    );
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.scene.add(g);
  }

  _buildRoads() {
    // All road strips and sidewalks merge into two meshes (one draw call
    // each) instead of one mesh per strip.
    const tex = roadTexture();
    const roadParts = [];
    const walkParts = [];
    const white = new THREE.Color(0xffffff);
    const walkCol = new THREE.Color(0x9a9a92);
    const L = CITY_HALF * 2 + 20;
    for (const c of GRID) {
      // road along X at z = c
      const rxGeo = new THREE.PlaneGeometry(L, ROAD_HALF * 2);
      const rxM = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, 0.02, c);
      roadParts.push({ geo: rxGeo, matrix: rxM, color: white, uvScale: [L / 16, 1] });
      // road along Z at x = c (plane rotated so its length lies along Z)
      const rzGeo = new THREE.PlaneGeometry(L, ROAD_HALF * 2);
      rzGeo.rotateZ(Math.PI / 2);
      const rzM = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(c, 0.02, 0);
      roadParts.push({ geo: rzGeo, matrix: rzM, color: white, uvScale: [L / 16, 1] });
      // sidewalks: 2.5 m strips on both sides of each road
      for (const s of [-1, 1]) {
        const sxGeo = new THREE.PlaneGeometry(L, 2.5);
        const sxM = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, 0.03, c + s * (ROAD_HALF + 1.25));
        walkParts.push({ geo: sxGeo, matrix: sxM, color: walkCol });
        const szGeo = new THREE.PlaneGeometry(2.5, L);
        const szM = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(c + s * (ROAD_HALF + 1.25), 0.03, 0);
        walkParts.push({ geo: szGeo, matrix: szM, color: walkCol });
      }
    }
    const roadMesh = new THREE.Mesh(
      mergeGeos(roadParts),
      new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }),
    );
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);
    const walkMesh = new THREE.Mesh(
      mergeGeos(walkParts),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    walkMesh.receiveShadow = true;
    this.scene.add(walkMesh);
  }

  // Turn the collected building / plain parts into two merged meshes.
  _flushMerged() {
    if (this._buildingParts.length) {
      const mesh = new THREE.Mesh(
        mergeGeos(this._buildingParts),
        new THREE.MeshLambertMaterial({ map: World._winTex, vertexColors: true }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    if (this._plainParts.length) {
      const mesh = new THREE.Mesh(
        mergeGeos(this._plainParts),
        new THREE.MeshLambertMaterial({ vertexColors: true }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  _addBuilding(x, z, w, d, h, color) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, 8);
    this._buildingParts.push({
      geo,
      matrix: new THREE.Matrix4().makeTranslation(x, h / 2, z),
      color: new THREE.Color(color),
    });
    this._plainParts.push({
      geo: new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
      matrix: new THREE.Matrix4().makeTranslation(x, h + 0.25, z),
      color: new THREE.Color(0x5a5148),
    });
    this.buildings.push({ x, z, hw: w / 2, hd: d / 2, h });
  }

  _buildBlocks() {
    World._winTex = World._winTex || windowTexture();
    const rng = this.rng;
    const lm = this.landmarks;
    const isLandmarkBlock = (cx, cz) => {
      for (const k of Object.keys(lm)) {
        if (Math.abs(lm[k].x - cx) < 30 && Math.abs(lm[k].z - cz) < 30) return true;
      }
      return false;
    };
    for (let gx = 0; gx < GRID.length - 1; gx++) {
      for (let gz = 0; gz < GRID.length - 1; gz++) {
        const x0 = GRID[gx] + ROAD_HALF + 2.5;
        const x1 = GRID[gx + 1] - ROAD_HALF - 2.5;
        const z0 = GRID[gz] + ROAD_HALF + 2.5;
        const z1 = GRID[gz + 1] - ROAD_HALF - 2.5;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        const w = x1 - x0;
        const d = z1 - z0;
        if (isLandmarkBlock(cx, cz)) continue; // landmarks build their own block
        const centreBoost = 1 - (Math.abs(cx) + Math.abs(cz)) / 500;
        if (rng.chance(0.55)) {
          const bw = w * rng.range(0.55, 0.8);
          const bd = d * rng.range(0.55, 0.8);
          const h = rng.range(10, 18 + 26 * centreBoost);
          this._addBuilding(cx + rng.range(-3, 3), cz + rng.range(-3, 3), bw, bd, h, rng.pick(PALETTE));
        } else {
          for (let i = 0; i < 2; i++) {
            const bw = w * rng.range(0.3, 0.42);
            const bd = d * rng.range(0.3, 0.42);
            const h = rng.range(7, 12 + 20 * centreBoost);
            const px = cx + (i === 0 ? -w / 4 : w / 4);
            const pz = cz + rng.range(-d / 5, d / 5);
            this._addBuilding(px, pz, bw, bd, h, rng.pick(PALETTE));
          }
        }
      }
    }
  }

  _sign(text, x, y, z, color, w = 14, ry = 0) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#14101c'; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(4, 4, 504, 88);
    g.fillStyle = color; g.font = 'bold 52px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 96 / 512),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.scene.add(m);
    return m;
  }

  _buildLandmarks() {
    // Landmark buildings sit INSIDE the blocks next to their junction, so
    // the junction itself (the mission destination) stays open road.
    const lm = this.landmarks;
    // Garage: workshop in the block south-east of the junction (-156, 104)
    this._addBuilding(-130, 130, 30, 14, 7, 0xb8b0a0);
    this._sign('SUNSET GARAGE', -145.5, 5, 130, '#ffb347', 14, -Math.PI / 2);
    // Casino: tall tower in the block north-west of the junction (104, 104)
    this._addBuilding(78, 78, 34, 30, 38, 0x7a2a4a);
    this._sign('PALM CASINO', 78, 20, 93.5, '#ff5a8a', 20);
    // Mall: wide low block north-east of the junction (-104, 0)
    this._addBuilding(-78, 26, 36, 26, 10, 0x4a7a9a);
    this._sign('BAY MALL', -96.5, 6, 26, '#7ad0ff', 16, -Math.PI / 2);
    // Safehouse: a house with a yard north-west of the junction (156, 156).
    // It sits north-east in its block, off the diagonal from the casino, so
    // a runner from the vault does not get wedged on its corner.
    this._addBuilding(140, 120, 16, 14, 8, 0xe8d8b0);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(12, 5, 4),
      new THREE.MeshLambertMaterial({ color: 0xa04a3a }),
    );
    roof.position.set(140, 10.5, 120);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.scene.add(roof);
    this._sign('SAFEHOUSE', 131.5, 5, 120, '#9dff8a', 12, -Math.PI / 2);
    // Docks: container yard south-east of the junction (-156, -156)
    const rng = this.rng;
    const contColors = [0xc84a3a, 0x3a7ac8, 0x4a9a5a, 0xd8a03a, 0x8a5ac8];
    for (let i = 0; i < 8; i++) {
      const cx = -144 + (i % 4) * 9;
      const cz = -144 + Math.floor(i / 4) * 9;
      const rotated = rng.chance(0.5);
      this._plainParts.push({
        geo: new THREE.BoxGeometry(8, 3, 3),
        matrix: new THREE.Matrix4().makeRotationY(rotated ? Math.PI / 2 : 0).setPosition(cx, 1.5, cz),
        color: new THREE.Color(rng.pick(contColors)),
      });
      this.buildings.push({ x: cx, z: cz, hw: rotated ? 1.6 : 4, hd: rotated ? 4 : 1.6, h: 3 });
    }
    this._sign('DOCKS', -156, 7, -144, '#ffb347', 12);
  }

  _buildLights() {
    // One traffic light per junction inside the core grid; instanced so it
    // costs 3 draw calls. The lamp colour follows the NS phase.
    const spots = [];
    for (const x of GRID) {
      for (const z of GRID) {
        if (Math.abs(x) > 208 || Math.abs(z) > 208) continue;
        spots.push([x + 6.5, z + 6.5]);
      }
    }
    this.lightSpots = spots;
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 5.4, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
    const headGeo = new THREE.BoxGeometry(0.7, 1.6, 0.7);
    const headMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
    const lampGeo = new THREE.SphereGeometry(0.28, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      m4.makeTranslation(x, 2.7, z); poles.setMatrixAt(i, m4);
      m4.makeTranslation(x, 5.6, z); heads.setMatrixAt(i, m4);
      m4.makeTranslation(x, 5.9, z); lamps.setMatrixAt(i, m4);
    });
    this.scene.add(poles); this.scene.add(heads); this.scene.add(lamps);
    this.lightLamps = lamps;
  }

  _buildLampsAndPalms() {
    const rng = this.rng;
    const lampSpots = [];
    for (const c of GRID) {
      for (let v = -195; v <= 195; v += 26) {
        lampSpots.push([c + 7.5, v]);
        lampSpots.push([v, c + 7.5]);
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6);
    const poles = new THREE.InstancedMesh(
      poleGeo, new THREE.MeshLambertMaterial({ color: 0x444444 }), lampSpots.length,
    );
    const bulbGeo = new THREE.SphereGeometry(0.22, 8, 6);
    this.lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.lampBulbMat, lampSpots.length);
    const m4 = new THREE.Matrix4();
    lampSpots.forEach(([x, z], i) => {
      m4.makeTranslation(x, 2.3, z); poles.setMatrixAt(i, m4);
      m4.makeTranslation(x, 4.7, z); bulbs.setMatrixAt(i, m4);
    });
    this.scene.add(poles); this.scene.add(bulbs);
    // palms on the sidewalks
    const palmSpots = [];
    for (let i = 0; i < 42; i++) {
      const c = rng.pick(GRID);
      const along = rng.range(-200, 200);
      palmSpots.push(rng.chance(0.5) ? [c + 7.5, along] : [along, c + 7.5]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 4.5, 6);
    const trunks = new THREE.InstancedMesh(
      trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a3a }), palmSpots.length,
    );
    const leafGeo = new THREE.ConeGeometry(2.2, 3.2, 7);
    const leaves = new THREE.InstancedMesh(
      leafGeo, new THREE.MeshLambertMaterial({ color: 0x3f8a4a }), palmSpots.length,
    );
    palmSpots.forEach(([x, z], i) => {
      m4.makeTranslation(x, 2.25, z); trunks.setMatrixAt(i, m4);
      m4.makeTranslation(x, 5.6, z); leaves.setMatrixAt(i, m4);
    });
    this.scene.add(trunks); this.scene.add(leaves);
  }

  // Traffic-light state at a point. ns=false reads the Z-road (north-south)
  // light, ns=true the X-road light. Returns 'red' | 'yellow' | 'green'.
  lightStateAt(x, z, ns) {
    const t = ((this.lightClock % LIGHT_PERIOD) + LIGHT_PERIOD) % LIGHT_PERIOD;
    let nsState;
    if (t < NS_GREEN_END) nsState = 'green';
    else if (t < NS_YELLOW_END) nsState = 'yellow';
    else if (t < NS_RED_END) nsState = 'red';
    else nsState = 'yellow';
    if (ns === false) return nsState;
    if (nsState === 'green') return 'red';
    if (nsState === 'red') return 'green';
    return 'yellow';
  }

  // Push a circle (x, z, radius r) out of every building AABB and the city
  // bounds. Returns true if it hit anything.
  resolveCircle(p, r) {
    let hit = false;
    for (const b of this.buildings) {
      const nx = clamp(p.x, b.x - b.hw, b.x + b.hw);
      const nz = clamp(p.z, b.z - b.hd, b.z + b.hd);
      const dx = p.x - nx;
      const dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * r;
        p.z = nz + (dz / d) * r;
      } else {
        const px = Math.min(p.x - (b.x - b.hw), (b.x + b.hw) - p.x);
        const pz = Math.min(p.z - (b.z - b.hd), (b.z + b.hd) - p.z);
        if (px < pz) p.x = p.x < b.x ? b.x - b.hw - r : b.x + b.hw + r;
        else p.z = p.z < b.z ? b.z - b.hd - r : b.z + b.hd + r;
      }
    }
    if (p.x < -CITY_HALF) { p.x = -CITY_HALF; hit = true; }
    if (p.x > CITY_HALF) { p.x = CITY_HALF; hit = true; }
    if (p.z < -CITY_HALF) { p.z = -CITY_HALF; hit = true; }
    if (p.z > CITY_HALF) { p.z = CITY_HALF; hit = true; }
    return hit;
  }

  updateSun() {
    const t = this.timeOfDay; // 0 night, 0.25 dawn, 0.5 noon, 0.75 dusk
    const day = clamp(Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5, 0, 1);
    const dusk = clamp(1 - Math.abs(t - 0.75) * 6, 0, 1) + clamp(1 - Math.abs(t - 0.25) * 6, 0, 1);
    const ang = (t - 0.25) * Math.PI * 2;
    const el = Math.sin(ang) * 0.9 + 0.25;
    this.sun.position.set(Math.cos(ang) * 160, Math.max(20, el * 180), Math.sin(ang) * 120);
    this.sun.intensity = 0.25 + day * 2.0;
    this.sun.color.setHSL(0.09, 0.55, lerp(0.55, 0.72, day));
    this.hemi.intensity = 0.25 + day * 0.7;
    const sky = new THREE.Color();
    if (day > 0.6) sky.set(0x87b5e0);
    else if (dusk > 0.3) sky.set(0xe88a4a);
    else sky.set(0x1a2340);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    const night = 1 - day;
    if (this.lightLamps) {
      const c = new THREE.Color();
      const st = this.lightStateAt(0, 0, false);
      c.set(st === 'red' ? 0xff2a2a : st === 'yellow' ? 0xffc02a : 0x2aff5a);
      for (let i = 0; i < this.lightSpots.length; i++) this.lightLamps.setColorAt(i, c);
      this.lightLamps.instanceColor.needsUpdate = true;
    }
    if (this.lampBulbMat) this.lampBulbMat.color.set(night > 0.4 ? 0xffe9a8 : 0x8a8a8a);
    this._night = night;
  }

  update(dt) {
    this.lightClock += dt;
    this.updateSun();
  }

  setTimeOfDay(t) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this.updateSun();
  }
}
