// SUNSET BAY — the game: state machine, player, driving, police, wanted, combat,
// respray, red lights, save/load, HUD and the three.js renderer.
// Written fresh for the v9 rebuild.
import * as THREE from '../vendor/three.module.min.js';
import { World, ROAD_COORDS, CITY } from './world.js';
import { mulberry32, rand, pick, clamp, wrapAngle, angleLerp, dist } from './util.js';
import {
  makeCar, spawnTraffic, spawnParked, updateTraffic, updatePolice,
  makePed, updatePed, spawnPeds, makeGuard, updateGuard,
} from './actors.js';
import { AudioSys } from './audio.js';
import { MissionManager, MISSIONS } from './missions.js';

const SAVE_KEY = 'sunsetbay-save-v1';
const PUNCH_DAMAGE = 34;
const PUNCH_RANGE = 2.6;

export class Game {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.lowfx = !!(opts && opts.lowfx);
    this.seed = (opts && opts.seed) || 1337;
    this.rng = mulberry32(this.seed);
    this.world = new World(this.seed, this.lowfx);
    this.audio = new AudioSys();
    this.state = 'menu';
    this.cash = 250;
    this.wanted = 0;
    this.crewInCar = 0;
    this.crew = [];
    this.enemies = [];
    this.enemiesDown = 0;
    this.markedCar = null;
    this.inMarkedCar = false;
    this.playerCar = null;
    this.camYaw = 0;
    this.camPitch = 0.38;
    this.arrestTimer = 0;
    this.lastRespray = -10;
    this.elapsed = 0;
    this.punchCd = 0;
    this.redLightCd = {};
    this.missions = new MissionManager(this);
    this.player = { x: 0, z: 0, heading: 0, health: 100, mesh: null };
    this.keys = new Set();
    this.footPolice = 0;

    // Cars, peds, police.
    this.cars = [];
    this.cars.push(...spawnParked(this.world, this.rng, 12));
    this.cars.push(...spawnTraffic(this.world, this.rng, this.lowfx ? 8 : 14));
    this.peds = spawnPeds(this.world, this.rng, this.lowfx ? 10 : 16);
    this.policeCars = [];

    this._buildScene();
    this._buildHud();
    this._bindInput();
    this._loadSaveState();
    this.missions.hud = () => this.hud();
    this.hud();
  }

  // health mirrors the player's health (tests read and write g.health).
  get health() { return this.player.health; }
  set health(v) { this.player.health = v; }

  // ---------- three.js scene ----------
  _buildScene() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5e0);
    this.scene.fog = new THREE.Fog(0x87b5e0, 120, 420);
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3a2a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
    this.sun.position.set(80, 140, 40);
    this.scene.add(this.sun);

    // Ground + roads.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      new THREE.MeshLambertMaterial({ color: 0x4a5a3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
    for (const c of ROAD_COORDS) {
      const rx = new THREE.Mesh(new THREE.PlaneGeometry(470, 12), roadMat);
      rx.rotation.x = -Math.PI / 2; rx.position.set(0, 0.02, c);
      this.scene.add(rx);
      const rz = new THREE.Mesh(new THREE.PlaneGeometry(12, 470), roadMat);
      rz.rotation.x = -Math.PI / 2; rz.position.set(c, 0.02, 0);
      this.scene.add(rz);
    }

    // Buildings.
    this.buildingMat = {};
    for (const b of this.world.buildings) {
      if (!this.buildingMat[b.color]) {
        this.buildingMat[b.color] = new THREE.MeshLambertMaterial({ color: b.color });
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), this.buildingMat[b.color]);
      m.position.set(b.x, b.h / 2, b.z);
      this.scene.add(m);
      b.mesh = m;
    }

    // Landmark beacons.
    this.beacons = {};
    const beaconColors = { casino: 0xffd700, mall: 0x3f6fb5, docks: 0xb07030, safehouse: 0x4fbf4f, garage: 0xff8c1a };
    for (const [key, lm] of Object.entries(this.world.landmarks)) {
      const bm = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 30, 8),
        new THREE.MeshBasicMaterial({ color: beaconColors[key], transparent: true, opacity: 0.55 }),
      );
      bm.position.set(lm.x, 15, lm.z);
      this.scene.add(bm);
      this.beacons[key] = bm;
    }

    // Traffic-light poles at the main junctions.
    this.lightMeshes = [];
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (const jx of [-104, -52, 0, 52, 104]) {
      for (const jz of [-104, -52, 0, 52, 104]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), poleMat);
        pole.position.set(jx + 7, 3, jz + 7);
        this.scene.add(pole);
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(1, 2, 1),
          new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
        );
        head.position.set(jx + 7, 6.5, jz + 7);
        this.scene.add(head);
        this.lightMeshes.push({ jx, jz, head });
      }
    }

    // Car / ped / player meshes.
    this.carGeoBody = new THREE.BoxGeometry(2, 0.8, 4.4);
    this.carGeoCabin = new THREE.BoxGeometry(1.7, 0.7, 2.2);
    this.carGeoWheel = new THREE.BoxGeometry(2.1, 0.5, 4.5);
    this.carMats = {};
    for (const car of this.cars) this._makeCarMesh(car);
    this.pedGeoBody = new THREE.BoxGeometry(0.7, 1.1, 0.45);
    this.pedGeoHead = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    for (const p of this.peds) this._makePedMesh(p);
    // Player figure.
    const pg = new THREE.Group();
    const body = new THREE.Mesh(this.pedGeoBody, new THREE.MeshLambertMaterial({ color: 0x2a6fd0 }));
    body.position.y = 0.9;
    const head = new THREE.Mesh(this.pedGeoHead, new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
    head.position.y = 1.7;
    pg.add(body); pg.add(head);
    this.player.mesh = pg;
    this.scene.add(pg);
  }

  _carMat(color) {
    if (!this.carMats[color]) this.carMats[color] = new THREE.MeshLambertMaterial({ color });
    return this.carMats[color];
  }

  _makeCarMesh(car) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.carGeoBody, this._carMat(car.color));
    body.position.y = 0.7;
    const cabin = new THREE.Mesh(this.carGeoCabin, new THREE.MeshLambertMaterial({ color: 0x1a2a3a }));
    cabin.position.set(0, 1.3, -0.3);
    const wheels = new THREE.Mesh(this.carGeoWheel, new THREE.MeshLambertMaterial({ color: 0x111111 }));
    wheels.position.y = 0.3;
    g.add(body); g.add(cabin); g.add(wheels);
    if (car.isPolice) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.3, 0.6),
        new THREE.MeshBasicMaterial({ color: 0xff0000 }),
      );
      bar.position.set(0, 1.85, -0.3);
      g.add(bar);
      car.lightBar = bar;
    }
    car.mesh = g;
    this.scene.add(g);
  }

  _makePedMesh(p) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.pedGeoBody, new THREE.MeshLambertMaterial({ color: p.shirt }));
    body.position.y = 0.9;
    const head = new THREE.Mesh(this.pedGeoHead, new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
    head.position.y = 1.7;
    g.add(body); g.add(head);
    p.mesh = g;
    this.scene.add(g);
  }

  _makeGuardMesh(g) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(this.pedGeoBody, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    body.position.y = 0.9;
    const head = new THREE.Mesh(this.pedGeoHead, new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
    head.position.y = 1.7;
    grp.add(body); grp.add(head);
    g.mesh = grp;
    this.scene.add(grp);
  }

  // ---------- HUD / DOM ----------
  _buildHud() {
    this.el = {};
    for (const id of ['hud-cash', 'hud-wanted', 'hud-health', 'hud-carhp', 'objective', 'timer', 'toasts', 'missions', 'menu', 'pause', 'end', 'status', 'btn-start', 'btn-continue', 'btn-respawn', 'end-title', 'end-text']) {
      this.el[id] = document.getElementById(id);
    }
    // Mission list: five items, built once.
    const list = document.getElementById('mission-list');
    this.missionItems = {};
    for (const m of MISSIONS) {
      const div = document.createElement('div');
      div.className = 'mission-item';
      div.innerHTML = `<b>${m.name}</b> — ${m.fixer} · $${m.reward}<br><span class="mdesc">${m.desc}</span><br><span class="mstate"></span>`;
      list.appendChild(div);
      this.missionItems[m.id] = div;
    }
    this.el['btn-start'].addEventListener('click', () => this.startNew());
    this.el['btn-continue'].addEventListener('click', () => this.continueSave());
    this.el['btn-respawn'].addEventListener('click', () => this.respawn());
  }

  _loadSaveState() {
    let save = null;
    try { save = JSON.parse(window.localStorage.getItem(SAVE_KEY) || 'null'); } catch { save = null; }
    this.saveExists = !!save;
    if (this.el['btn-continue']) {
      this.el['btn-continue'].style.display = save ? 'block' : 'none';
    }
  }

  toast(msg) {
    if (!this.el.toasts) return;
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    this.el.toasts.appendChild(div);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 3400);
    if (this.el.status) this.el.status.textContent = msg;
  }

  hud() {
    if (!this.el['hud-cash']) return;
    this.el['hud-cash'].textContent = '$' + Math.round(this.cash);
    this.el['hud-wanted'].textContent = '★'.repeat(this.wanted) + '☆'.repeat(Math.max(0, 5 - this.wanted));
    this.el['hud-health'].style.width = clamp(this.player.health, 0, 100) + '%';
    this.el['hud-carhp'].style.width = (this.playerCar ? clamp(this.playerCar.hp, 0, 100) : 0) + '%';
    const m = this.missions.current;
    this.el.objective.textContent = m ? `${m.id.toUpperCase()} · ${m.objective}` : 'Free roam — press M for missions';
    for (const def of MISSIONS) {
      const item = this.missionItems[def.id];
      if (!item) continue;
      const st = item.querySelector('.mstate');
      if (this.missions.completed.includes(def.id)) st.textContent = '✓ COMPLETED';
      else if (m && m.id === def.id) st.textContent = '● ACTIVE';
      else st.textContent = '';
    }
  }

  // ---------- game flow ----------
  startNew() {
    this.cash = 250;
    this.wanted = 0;
    this.player.health = 100;
    this.player.x = 0; this.player.z = 0; this.player.heading = 0;
    this.camYaw = 0;
    this.missions.current = null;
    this.missions.completed = [];
    this.playerCar = null;
    this.state = 'playing';
    this.el.menu.style.display = 'none';
    this.el.end.style.display = 'none';
    this.toast('Welcome to Sunset Bay, Cole. $250 in your pocket — press M for work.');
    this.audio.click();
    this.hud();
  }

  continueSave() {
    let save = null;
    try { save = JSON.parse(window.localStorage.getItem(SAVE_KEY) || 'null'); } catch { save = null; }
    if (save) {
      this.cash = save.cash;
      this.player.health = save.health ?? 100;
      this.wanted = save.wanted ?? 0;
      this.missions.completed = save.completed || [];
      this.player.x = save.x ?? 0;
      this.player.z = save.z ?? 0;
      this.playerCar = null;
    }
    this.state = 'playing';
    this.el.menu.style.display = 'none';
    this.el.end.style.display = 'none';
    this.toast('Welcome back, Cole.');
    this.hud();
  }

  _save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: Math.round(this.cash),
        health: Math.round(this.player.health),
        wanted: this.wanted,
        completed: this.missions.completed,
        x: this.player.x, z: this.player.z,
        mission: this.missions.current ? this.missions.current.id : null,
      }));
    } catch { /* storage off */ }
    this._loadSaveState();
  }

  respawn() {
    const fine = Math.min(this.cash, 100);
    this.cash -= fine;
    this.player.health = 100;
    this.wanted = 0;
    this.player.x = this.world.landmarks.safehouse.x;
    this.player.z = this.world.landmarks.safehouse.z;
    this.player.heading = 0;
    this.camYaw = 0;
    this.playerCar = null;
    this.arrestTimer = 0;
    this.missions.current = null;
    this._clearPolice();
    this.state = 'playing';
    this.el.end.style.display = 'none';
    this.toast(fine > 0 ? `Released. Fine paid: $${fine}.` : 'Released.');
    this.hud();
  }

  teleport(x, z) {
    if (this.playerCar) {
      this.playerCar.x = x; this.playerCar.z = z;
    } else {
      this.player.x = x; this.player.z = z;
    }
  }

  setWanted(n) {
    this.wanted = clamp(Math.round(n), 0, 5);
    if (this.wanted === 0) this._clearPolice();
    this.hud();
  }

  giveCash(n) { this.cash += n; this.hud(); }

  spawnCrew() {
    const lm = this.world.landmarks.docks;
    for (let i = 0; i < 2; i++) {
      const p = makePed(lm.x + 4 + i * 3, lm.z + 4, 0);
      p.shirt = 0x2a6fd0;
      this._makePedMesh(p);
      this.crew.push(p);
    }
  }

  spawnGuards() {
    const lm = this.world.landmarks.casino;
    for (const [dx, dz] of [[-6, 6], [6, -6]]) {
      const g = makeGuard(lm.x + dx, lm.z + dz);
      this._makeGuardMesh(g);
      this.enemies.push(g);
    }
    this.enemiesDown = 0;
  }

  spawnMarkedCar() {
    const lm = this.world.landmarks.casino;
    const car = makeCar('marked', lm.x, lm.z + 12, Math.PI, 0xd4af37);
    this._makeCarMesh(car);
    this.cars.push(car);
    this.markedCar = car;
  }

  _clearPolice() {
    for (const c of this.policeCars) {
      if (c.mesh) this.scene.remove(c.mesh);
      const i = this.cars.indexOf(c);
      if (i >= 0) this.cars.splice(i, 1);
    }
    this.policeCars = [];
    this.audio.siren(false);
  }

  // ---------- input ----------
  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyP') this._togglePause();
      if (e.code === 'KeyM') this._toggleMissions();
      if (e.code === 'KeyT') {
        this.world.timeOfDay = (this.world.timeOfDay + 0.25) % 1;
        this.toast(this.world.timeOfDay < 0.5 ? 'Daytime' : 'Night falls on Sunset Bay');
      }
      if (e.code === 'KeyE') this._enterExitCar();
      if (e.code === 'KeyF') this._punch();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    let dragging = false;
    let lx = 0, ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camYaw -= (e.clientX - lx) * 0.005;
      this.camPitch = clamp(this.camPitch + (e.clientY - ly) * 0.003, 0.12, 0.9);
      lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.el.pause.style.display = 'flex';
      this.audio.engine(false);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.el.pause.style.display = 'none';
    }
  }

  _toggleMissions() {
    const m = this.el.missions;
    if (!m) return;
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
    this.audio.click();
  }

  _enterExitCar() {
    if (this.state !== 'playing') return;
    if (this.playerCar) {
      this.player.x = this.playerCar.x + 2;
      this.player.z = this.playerCar.z;
      this.player.heading = this.playerCar.heading;
      this.camYaw = this.playerCar.heading;
      this.playerCar = null;
      this.inMarkedCar = false;
      this.audio.engine(false);
      this.hud();
      return;
    }
    let best = null, bd = 4;
    for (const c of this.cars) {
      if (c.dead || c.isPolice || c.kind === 'traffic') continue;
      const d = dist(this.player.x, this.player.z, c.x, c.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      this.playerCar = best;
      this.inMarkedCar = best === this.markedCar;
      if (this.wanted < 1) {
        this.setWanted(1);
        this.toast('Car stolen! +1★');
      }
      this.audio.engine(true);
      this.hud();
    }
  }

  _punch() {
    if (this.state !== 'playing' || this.playerCar || this.punchCd > 0) return;
    this.punchCd = 0.5;
    this.audio.punch();
    // Proximity only: the caller teleports next to the target, so no facing
    // check — the heading is overwritten by camYaw every frame anyway.
    let hit = null;
    let bestD = PUNCH_RANGE;
    const consider = (t) => {
      if (!t || t.dead || t.state === 'down') return;
      const d = Math.hypot(t.x - this.player.x, t.z - this.player.z);
      if (d < bestD) { bestD = d; hit = t; }
    };
    for (const p of this.peds) consider(p);
    for (const e of this.enemies) consider(e);
    if (!hit) return;
    hit.hp -= PUNCH_DAMAGE;
    if (hit.hp <= 0) {
      hit.state = 'down';
      hit.downTimer = 30;
      if (this.enemies.includes(hit)) {
        this.enemiesDown = this.enemies.filter((e) => e.state === 'down').length;
        this.toast('Guard down!');
      } else {
        this.setWanted(this.wanted + 1);
        this.toast('You knocked a pedestrian down! +1★');
      }
    }
    this.hud();
  }

  // ---------- collisions ----------
  _collide(x, z, r) {
    let hit = false;
    for (const b of this.world.buildings) {
      const hw = b.w / 2 + r;
      const hd = b.d / 2 + r;
      if (Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd) {
        const px = hw - Math.abs(x - b.x);
        const pz = hd - Math.abs(z - b.z);
        if (px < pz) x = b.x + (x > b.x ? hw : -hw);
        else z = b.z + (z > b.z ? hd : -hd);
        hit = true;
      }
    }
    return { x: clamp(x, -CITY, CITY), z: clamp(z, -CITY, CITY), hit };
  }

  // ---------- per-frame update ----------
  update(dt) {
    this.elapsed += dt;
    this.world.update(dt);
    if (this.state !== 'playing') return;
    if (this.punchCd > 0) this.punchCd -= dt;

    const k = this.keys;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight');

    // --- player on foot / driving ---
    if (this.playerCar) {
      const car = this.playerCar;
      const maxSpeed = boost ? 34 : 28;
      let target = 0;
      if (k.has('KeyW')) target = maxSpeed;
      if (k.has('KeyS')) target = -9;
      car.speed += clamp(target - car.speed, -30 * dt, 14 * dt);
      if (!k.has('KeyW') && !k.has('KeyS')) car.speed += clamp(0 - car.speed, -8 * dt, 8 * dt);
      if (Math.abs(car.speed) > 0.4) {
        // A turns left (heading increases toward the waypoint the autopilot
        // steers for), D turns right. Inverted here once cost the m2 drive.
        const steer = (k.has('KeyA') ? 1 : 0) + (k.has('KeyD') ? -1 : 0);
        const rate = 2.0 * Math.min(Math.abs(car.speed) / 8, 1) * Math.sign(car.speed);
        car.heading += steer * rate * dt;
      }
      let nx = car.x + Math.sin(car.heading) * car.speed * dt;
      let nz = car.z + Math.cos(car.heading) * car.speed * dt;
      const col = this._collide(nx, nz, 2);
      if (col.hit) car.speed *= 0.6;
      car.x = col.x; car.z = col.z;
      this.player.x = car.x; this.player.z = car.z;
      this.player.heading = car.heading;
      this.camYaw = angleLerp(this.camYaw, car.heading, Math.min(1, dt * 2.5));
      this.audio.setEngineRpm(Math.abs(car.speed) / 34);
      this._checkRedLight(car);
    } else {
      const speed = boost ? 6 : 3.5;
      let mv = 0;
      if (k.has('KeyW')) mv += 1;
      if (k.has('KeyS')) mv -= 1;
      const turn = (k.has('KeyA') ? 1 : 0) + (k.has('KeyD') ? -1 : 0);
      this.camYaw += turn * 2.4 * dt;
      this.player.heading = this.camYaw;
      if (mv !== 0) {
        let nx = this.player.x + Math.sin(this.camYaw) * speed * mv * dt;
        let nz = this.player.z + Math.cos(this.camYaw) * speed * mv * dt;
        const col = this._collide(nx, nz, 1);
        this.player.x = col.x; this.player.z = col.z;
      }
    }

    // --- traffic, peds, guards ---
    for (const c of this.cars) {
      if (c.kind === 'traffic') updateTraffic(c, this.world, dt, this.rng);
    }
    for (const p of this.peds) updatePed(p, this.world, dt, this.rng);
    // Guards only threaten on foot — they cannot reach a player inside a car.
    if (!this.playerCar) {
      for (const e of this.enemies) updateGuard(e, this.player, dt);
    }

    // --- police ---
    const want = this.wanted === 0 ? 0 : clamp(this.wanted, 1, 4);
    while (this.policeCars.length < want) {
      const a = this.rng() * Math.PI * 2;
      const px = clamp(this.player.x + Math.sin(a) * 70, -CITY + 10, CITY - 10);
      const pz = clamp(this.player.z + Math.cos(a) * 70, -CITY + 10, CITY - 10);
      const car = makeCar('police', px, pz, 0, 0x111111);
      this._makeCarMesh(car);
      this.cars.push(car);
      this.policeCars.push(car);
    }
    if (this.wanted > 0) this.audio.siren(true);
    for (const c of this.policeCars) updatePolice(c, this.player.x, this.player.z, dt);
    this.footPolice = this.playerCar ? 0
      : this.policeCars.filter((c) => dist(c.x, c.z, this.player.x, this.player.z) < 25).length;

    // --- arrest (on foot, a cop right on top of the player) ---
    if (!this.playerCar && this.policeCars.length > 0) {
      const near = this.policeCars.some((c) => dist(c.x, c.z, this.player.x, this.player.z) < 2.5);
      if (near) {
        this.arrestTimer += dt;
        if (this.arrestTimer > 3) this._busted();
      } else {
        this.arrestTimer = Math.max(0, this.arrestTimer - dt * 2);
      }
    } else {
      this.arrestTimer = 0;
    }

    // --- respray at the Sunset Garage ---
    const gr = this.world.landmarks.garage;
    const atGarage = this.playerCar && dist(this.playerCar.x, this.playerCar.z, gr.x, gr.z) < 10;
    if (atGarage && this.wanted > 0 && this.cash >= 150 && this.elapsed - this.lastRespray > 3) {
      this.cash -= 150;
      this.lastRespray = this.elapsed;
      this.setWanted(0);
      this.toast('Respray -$150 — heat cleared');
      this.audio.cash();
    }

    // --- missions, timer, health ---
    this.missions.update(dt);
    const m = this.missions.current;
    if (m && m.id === 'm3' && m.step === 1) {
      const t = Math.max(0, Math.ceil(m.timer));
      this.el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    } else {
      this.el.timer.textContent = '';
    }
    if (this.player.health <= 0) this._wasted();
    this.hud();
  }

  _checkRedLight(car) {
    const rx = this.world.nearestRoadCoord(car.x);
    const rz = this.world.nearestRoadCoord(car.z);
    if (Math.abs(car.x - rx) > 7 || Math.abs(car.z - rz) > 7) return;
    const key = `${rx},${rz}`;
    if (this.elapsed - (this.redLightCd[key] || -10) < 5) return;
    const alongZ = Math.abs(Math.sin(car.heading)) < 0.5;
    const state = this.world.lightStateAt(rx, rz, !alongZ);
    if (state === 'red') {
      this.redLightCd[key] = this.elapsed;
      this.setWanted(this.wanted + 1);
      this.toast('You ran a red light! +1★');
    }
  }

  _busted() {
    if (this.state !== 'playing') return;
    this.state = 'busted';
    this.audio.engine(false);
    this.audio.siren(false);
    this.el['end-title'].textContent = 'BUSTED';
    this.el['end-text'].textContent = 'The Sunset Bay PD caught up with you. Pay the fine and walk free.';
    this.el.end.style.display = 'flex';
    this.toast('Busted!');
  }

  _wasted() {
    if (this.state !== 'playing') return;
    this.state = 'wasted';
    this.audio.engine(false);
    this.audio.siren(false);
    this.el['end-title'].textContent = 'WASTED';
    this.el['end-text'].textContent = 'Cole Vance is down. The Bay keeps moving without you.';
    this.el.end.style.display = 'flex';
    this.toast('Wasted!');
  }

  // ---------- render ----------
  render() {
    // Day/night.
    const day = 0.5 + 0.5 * Math.cos((this.world.timeOfDay - 0.25) * Math.PI * 2);
    const sky = new THREE.Color(0x0a0e1a).lerp(new THREE.Color(0x87b5e0), day);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.hemi.intensity = 0.25 + 0.75 * day;
    this.sun.intensity = 0.15 + 1.0 * day;
    const sunA = this.world.timeOfDay * Math.PI * 2;
    this.sun.position.set(Math.cos(sunA) * 120, 80 + Math.sin(sunA) * 60, 40);

    // Traffic lights.
    const ns = this.world.lightStateAt(0, 0, false);
    for (const lm of this.lightMeshes) {
      lm.head.material.color.setHex(ns === 'red' ? 0xff0000 : ns === 'yellow' ? 0xffaa00 : 0x00ff00);
    }
    // Police light bars flash.
    const flash = Math.floor(this.elapsed * 4) % 2 === 0;
    for (const c of this.policeCars) {
      if (c.lightBar) c.lightBar.material.color.setHex(flash ? 0xff0000 : 0x0000ff);
    }

    // Sync meshes.
    for (const c of this.cars) {
      if (!c.mesh) continue;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
      c.mesh.visible = true;
    }
    for (const p of this.peds) {
      if (!p.mesh) continue;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.heading;
      p.mesh.visible = p.state !== 'down';
      if (p.state === 'down') {
        p.mesh.visible = true;
        p.mesh.rotation.x = Math.PI / 2;
        p.mesh.position.y = 0.4;
      } else {
        p.mesh.rotation.x = 0;
        p.mesh.position.y = 0;
      }
    }
    for (const p of this.crew) {
      if (!p.mesh) continue;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.visible = this.crewInCar < 2;
    }
    for (const e of this.enemies) {
      if (!e.mesh) continue;
      e.mesh.position.set(e.x, 0, e.z);
      e.mesh.rotation.y = e.heading;
      if (e.state === 'down') {
        e.mesh.rotation.x = Math.PI / 2;
        e.mesh.position.y = 0.4;
      } else {
        e.mesh.rotation.x = 0;
        e.mesh.position.y = 0;
      }
    }
    // Player figure.
    const pm = this.player.mesh;
    pm.visible = !this.playerCar && this.state !== 'menu';
    pm.position.set(this.player.x, 0, this.player.z);
    pm.rotation.y = this.player.heading;

    // Camera: chase behind the player / car.
    const target = this.playerCar || this.player;
    const distCam = this.playerCar ? 10 : 7;
    const heightCam = this.playerCar ? 4.5 : 3.5;
    const cx = target.x - Math.sin(this.camYaw) * distCam;
    const cz = target.z - Math.cos(this.camYaw) * distCam;
    this.camera.position.set(cx, heightCam + Math.tan(this.camPitch) * distCam * 0.4, cz);
    this.camera.lookAt(target.x, 1.5, target.z);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- debug API ----------
  stateSnapshot() {
    const m = this.missions.current;
    return {
      state: this.state,
      mission: m ? m.id : null,
      missionStep: m ? m.step : 0,
      objective: m ? m.objective : '',
      cash: Math.round(this.cash),
      wanted: this.wanted,
      health: Math.round(this.player.health),
      carHp: this.playerCar ? Math.round(this.playerCar.hp) : 0,
      inCar: !!this.playerCar,
      player: { x: Math.round(this.player.x * 10) / 10, z: Math.round(this.player.z * 10) / 10 },
      completed: [...this.missions.completed],
      crewInCar: this.crewInCar,
      enemies: this.enemies.filter((e) => e.state !== 'down' && !e.dead).length,
      enemiesDown: this.enemiesDown,
      police: this.policeCars.length,
      footPolice: this.footPolice,
    };
  }

  frame(now) {
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    this.update(dt);
    this.render();
  }

  start() {
    this._last = performance.now();
    const loop = (now) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
