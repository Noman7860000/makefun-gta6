// SUNSET BAY game: the state machine, the loop, driving, on-foot movement,
// police and wanted, respray, combat, save/load, HUD, minimap and the
// ?shot= staging modes. Rendering is three.js; all simulation is plain
// numbers so the harnesses can drive it through window.SUNSET.
import { World } from './world.js';
import { Car, Person, randomCarColor, randomShirt } from './actors.js';
import { AudioEngine } from './audio.js';
import { MissionSystem, MISSION_DEFS } from './missions.js';
import { GRID, clamp, lerp, dist, makeRng, nearestGridCoord } from './util.js';

const THREE = window.THREE;
const SAVE_KEY = 'sunset-bay-save-v1';

const PARKED_SPOTS = [
  { x: 4, z: 0, h: Math.PI / 2 }, { x: -8, z: 0, h: -Math.PI / 2 },
  { x: 10, z: -52, h: 0 }, { x: -4, z: -52, h: Math.PI },
  { x: 14, z: 52, h: Math.PI / 2 }, { x: -16, z: 104, h: 0 },
  { x: 52, z: 4, h: Math.PI / 2 }, { x: 0, z: 52, h: 0 },
  { x: -52, z: -8, h: Math.PI }, { x: 104, z: 0, h: Math.PI / 2 },
  { x: -104, z: 52, h: 0 }, { x: 52, z: -104, h: -Math.PI / 2 },
];

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.seed = opts.seed ?? 1337;
    this.lowfx = !!opts.lowfx;
    this.shotMode = opts.shot || null;
    this.rng = makeRng(this.seed);
    this.state = 'menu';
    this.cash = 250;
    this.wanted = 0;
    this.health = 100;
    this.completed = [];
    this.inCar = false;
    this.playerCar = null;
    this.markedCar = null;
    this.cars = [];
    this.peds = [];
    this.policeCars = [];
    this.footPolice = [];
    this.enemies = []; // casino guards
    this.crew = [];
    this.camYaw = 0;
    this.keys = {};
    this.punchCooldown = 0;
    this.bustTimer = 0;
    this.wantedTimer = 0;
    this.resprayCooldown = 0;
    this.redLightCooldown = 0;
    this.policeSpawnTimer = 0;
    this.lastDamageAt = -99;
    this.time = 0;
    this.frameCount = 0;
    this.audio = new AudioEngine();
    this.missions = new MissionSystem(this);

    // --- renderer / scene -----------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowfx });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);
    this.renderer.shadowMap.enabled = !this.lowfx;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70, (canvas.clientWidth || 1280) / (canvas.clientHeight || 720), 0.1, 900,
    );
    this.camera.position.set(40, 45, 90);
    this.camera.lookAt(0, 0, 0);

    this.world = new World(this.scene, this.seed, this.lowfx);

    // --- actors ----------------------------------------------------------
    // In lowfx mode the actors are single merged meshes (one draw call
    // each) so the game stays fast under software rendering.
    this.player = new Person(this.scene, 0, 10, 0x2a5ac8, 'player', this.lowfx);
    this.player.heading = 0;

    for (const s of PARKED_SPOTS) {
      const car = new Car(this.scene, s.x, s.z, s.h, 'parked', randomCarColor(this.rng), false, this.lowfx);
      this.cars.push(car);
    }
    for (let i = 0; i < 10; i++) {
      const car = this._spawnTrafficCar();
      if (car) this.cars.push(car);
    }
    for (let i = 0; i < 14; i++) {
      const c = this.rng.pick(GRID);
      const ped = new Person(
        this.scene,
        this.rng.chance(0.5) ? this.rng.range(-200, 200) : c + (this.rng.chance(0.5) ? 7.5 : -7.5),
        this.rng.chance(0.5) ? c + (this.rng.chance(0.5) ? 7.5 : -7.5) : this.rng.range(-200, 200),
        randomShirt(this.rng), 'ped', this.lowfx,
      );
      this.peds.push(ped);
    }

    this._buildMissionList();
    this._wireButtons();
    this._wireInput();
    this._updateSaveButton();
    this._updateHud();

    // --- shot staging -----------------------------------------------------
    if (this.shotMode === 'start') {
      this.camera.position.set(70, 55, 130);
      this.camera.lookAt(0, 0, 0);
    } else if (this.shotMode === 'drive') {
      this._startPlaying();
      const car = this.cars[0];
      this._enterCar(car);
      car.x = 0; car.z = -40; car.heading = 0; car.speed = 16;
      this.camYaw = 0;
    } else if (this.shotMode === 'chase') {
      this._startPlaying();
      const car = this.cars[0];
      this._enterCar(car);
      car.x = 0; car.z = -20; car.heading = 0; car.speed = 14;
      this.setWanted(3);
      this._spawnPoliceCar(18, -30);
      this._spawnPoliceCar(-18, -10);
      this.camYaw = 0;
    } else if (this.shotMode === 'mission') {
      this._startPlaying();
      const car = this.cars[0];
      this._enterCar(car);
      car.x = 0; car.z = 60; car.heading = Math.PI; car.speed = 12;
      this.missions.start('m1');
      this.missions.step = 1;
      this.missions.objective = 'Take the car to the Sunset Garage';
      this.setWanted(1);
      this.camYaw = Math.PI;
    }

    this._last = performance.now();
    const loop = (now) => {
      const dt = clamp((now - this._last) / 1000, 0, 1 / 30);
      this._last = now;
      // One bad frame must never kill the loop: catch it, log it, keep going.
      try {
        if (this.state === 'playing') this.update(dt);
        this._render();
      } catch (e) {
        console.error('SUNSET BAY frame error:', e);
      }
      this.frameCount++;
      if (this.shotMode && !window.__shotReady && this.frameCount >= 12) {
        window.__shotReady = true;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ getters ---
  get carHp() { return this.playerCar ? this.playerCar.hp : 100; }
  get crewInCar() { return this.crew.filter(c => c.state === 'board').length; }
  get enemiesDown() { return this.enemies.filter(e => e.state === 'down').length; }
  get inMarkedCar() { return !!(this.playerCar && this.markedCar && this.playerCar === this.markedCar); }
  get police() { return this.policeCars.length; }

  getState() {
    return {
      state: this.state,
      player: { x: this.player.x, z: this.player.z },
      inCar: this.inCar,
      mission: this.missions.active,
      missionStep: this.missions.active ? this.missions.step : -1,
      objective: this.missions.objective,
      wanted: this.wanted,
      cash: this.cash,
      completed: [...this.completed],
      health: Math.round(this.health),
      carHp: Math.round(this.carHp),
      enemies: this.enemies.filter(e => e.state !== 'down').length,
      enemiesDown: this.enemiesDown,
      police: this.policeCars.length,
      footPolice: this.footPolice.length,
      crewInCar: this.crewInCar,
      inMarkedCar: this.inMarkedCar,
    };
  }

  // ------------------------------------------------------------ spawning --
  _spawnTrafficCar() {
    for (let tries = 0; tries < 20; tries++) {
      const c = this.rng.pick(GRID);
      const along = this.rng.range(-200, 200);
      const x = this.rng.chance(0.5) ? c : along;
      const z = this.rng.chance(0.5) ? along : c;
      if (dist(x, z, 0, 10) < 25) continue;
      const car = new Car(this.scene, x, z, this.rng.range(0, Math.PI * 2), 'traffic', randomCarColor(this.rng), false, this.lowfx);
      return car;
    }
    return null;
  }

  _spawnPoliceCar(x, z) {
    const car = new Car(this.scene, x, z, Math.atan2(this.player.x - x, this.player.z - z), 'police', 0x1a1a22, true, this.lowfx);
    car.hp = 100;
    this.cars.push(car);
    this.policeCars.push(car);
    return car;
  }

  _spawnFootPolice(x, z) {
    const p = new Person(this.scene, x, z, 0x1a2a4a, 'footpolice', this.lowfx);
    p.speed = 0;
    this.footPolice.push(p);
    return p;
  }

  spawnGuards(x, z) {
    const g1 = new Person(this.scene, x, z, 0x3a3a3a, 'guard', this.lowfx);
    const g2 = new Person(this.scene, x + 4, z + 3, 0x3a3a3a, 'guard', this.lowfx);
    this.enemies.push(g1, g2);
  }

  spawnCrew(x, z) {
    const c1 = new Person(this.scene, x - 6, z - 4, 0xd8a03a, 'crew', this.lowfx);
    const c2 = new Person(this.scene, x + 5, z - 6, 0x4ad88a, 'crew', this.lowfx);
    c1.state = 'wait'; c2.state = 'wait';
    this.crew.push(c1, c2);
  }

  spawnMarkedCar(x, z) {
    const car = new Car(this.scene, x, z, 0, 'gold', 0xd8b13a, false, this.lowfx);
    this.cars.push(car);
    this.markedCar = car;
  }

  clearMissionActors() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
    for (const c of this.crew) c.dispose(this.scene);
    this.crew = [];
    // The gold car stays in the world if the player is driving it; if the
    // mission was cancelled while it sat unused, remove it.
    if (this.markedCar && this.playerCar !== this.markedCar) {
      const i = this.cars.indexOf(this.markedCar);
      if (i >= 0) { this.cars.splice(i, 1); this.markedCar.dispose(this.scene); }
    }
    this.markedCar = null;
  }

  // -------------------------------------------------------------- input ---
  _wireInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyP' && (this.state === 'playing' || this.state === 'paused')) this._togglePause();
      if (e.code === 'KeyT' && this.state === 'playing') {
        this.world.setTimeOfDay(this.world.timeOfDay + 0.25);
        this.toast('Time of day changed');
      }
      if (e.code === 'KeyM' && this.state === 'playing') this._toggleMissions();
      if (e.code === 'KeyE' && this.state === 'playing') this._toggleEnterCar();
      if (e.code === 'KeyF' && this.state === 'playing') this._punch();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    // drag to look around on foot
    let dragging = false;
    let lastX = 0;
    this.canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging || this.inCar) return;
      this.camYaw += (e.clientX - lastX) * 0.004;
      lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
  }

  _wireButtons() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { this.audio.unlock(); fn(); });
    };
    on('btn-start', () => this._startPlaying());
    on('btn-continue', () => this._loadSave());
    on('btn-respawn', () => this.respawn());
    on('btn-resume', () => this._togglePause());
    on('btn-restart', () => this.respawn());
  }

  _buildMissionList() {
    const list = document.getElementById('missions-list');
    if (!list) return;
    list.innerHTML = '';
    for (const m of MISSION_DEFS) {
      const div = document.createElement('div');
      div.className = 'mission-item';
      div.dataset.id = m.id;
      const done = this.completed.includes(m.id);
      div.innerHTML = `<b>${done ? '✓ ' : ''}${m.name}</b> — $${m.payout}<br><span>${m.desc}</span>`;
      div.addEventListener('click', () => {
        if (this.state !== 'playing') return;
        this.missions.start(m.id);
        this.audio.click();
        this._toggleMissions();
        this._buildMissionList();
      });
      list.appendChild(div);
    }
  }

  _toggleMissions() {
    const el = document.getElementById('missions');
    if (!el) return;
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
    this._buildMissionList();
  }

  _togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      document.getElementById('pause-overlay').style.display = 'flex';
    } else if (this.state === 'paused') {
      this.state = 'playing';
      document.getElementById('pause-overlay').style.display = 'none';
    }
  }

  _startPlaying() {
    this.state = 'playing';
    document.getElementById('menu').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    this.audio.unlock();
  }

  respawn() {
    const fine = Math.min(100, this.cash);
    this.cash -= fine;
    this.health = 100;
    this.wanted = 0;
    this.bustTimer = 0;
    for (const p of this.policeCars) {
      const i = this.cars.indexOf(p);
      if (i >= 0) this.cars.splice(i, 1);
      p.dispose(this.scene);
    }
    this.policeCars = [];
    for (const f of this.footPolice) f.dispose(this.scene);
    this.footPolice = [];
    if (this.inCar && this.playerCar) this._exitCar();
    this.player.x = 150; this.player.z = 150;
    this.player.heading = Math.PI;
    this.camYaw = Math.PI;
    this.state = 'playing';
    document.getElementById('busted-overlay').style.display = 'none';
    document.getElementById('wasted-overlay').style.display = 'none';
    this.toast(fine > 0 ? `Released on bail — fine $${fine}.` : 'Released on bail.');
    this._save();
  }

  // -------------------------------------------------------------- actions --
  setWanted(n) {
    this.wanted = clamp(Math.round(n), 0, 5);
  }

  giveCash(n) {
    this.cash += n;
  }

  teleport(x, z) {
    if (this.inCar && this.playerCar) {
      this.playerCar.x = x; this.playerCar.z = z;
      this.playerCar.speed = 0;
      this.player.x = x; this.player.z = z;
    } else {
      this.player.x = x; this.player.z = z;
    }
  }

  startMission(id) {
    if (this.state === 'menu') this._startPlaying();
    return this.missions.start(id);
  }

  toast(msg) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    box.appendChild(div);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 4000);
  }

  _nearestCar(maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of this.cars) {
      if (car.dead) continue;
      const d = dist(this.player.x, this.player.z, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  _enterCar(car) {
    this.inCar = true;
    this.playerCar = car;
    car.playerOwned = true; // a stolen car stays put when the player gets out
    this.player.mesh.visible = false;
    this.player.x = car.x; this.player.z = car.z;
    this.missions.onEnterCar(car);
    this.setWanted(Math.max(this.wanted, car.kind === 'police' ? 2 : 1));
    this.audio.click();
  }

  _exitCar() {
    if (!this.playerCar) return;
    const car = this.playerCar;
    this.player.x = car.x - Math.sin(car.heading) * 3;
    this.player.z = car.z - Math.cos(car.heading) * 3;
    this.player.heading = car.heading;
    this.player.mesh.visible = true;
    this.inCar = false;
    this.playerCar = null;
    car.speed = 0;
    this.audio.click();
  }

  _toggleEnterCar() {
    if (this.inCar) { this._exitCar(); return; }
    const car = this._nearestCar(4.5);
    if (car) this._enterCar(car);
  }

  _punch() {
    if (this.punchCooldown > 0 || this.inCar) return;
    this.punchCooldown = 0.2;
    this.audio.punch();
    const fx = Math.sin(this.player.heading);
    const fz = Math.cos(this.player.heading);
    let hitAny = false;
    for (const target of [...this.enemies, ...this.peds]) {
      if (target.state === 'down') continue;
      const dx = target.x - this.player.x;
      const dz = target.z - this.player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 2.6) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < 0.3) continue;
      target.hp -= 34;
      hitAny = true;
      if (target.hp <= 0) {
        target.knockDown();
        if (target.role === 'ped') {
          this.setWanted(Math.max(this.wanted, 1));
          this.toast('You knocked out a pedestrian — the cops noticed!');
        }
      } else {
        target.state = 'flee';
        target.target = { x: target.x + dx * 3, z: target.z + dz * 3 };
        if (target.role === 'ped') this.setWanted(Math.max(this.wanted, 1));
      }
      break; // one target per punch
    }
    if (!hitAny) this.audio.hit();
  }

  // -------------------------------------------------------------- update --
  update(dt) {
    this.time += dt;
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.resprayCooldown = Math.max(0, this.resprayCooldown - dt);
    this.redLightCooldown = Math.max(0, this.redLightCooldown - dt);
    this.world.update(dt);
    for (const c of this.cars) c.hitCooldown = Math.max(0, c.hitCooldown - dt);

    // camera yaw keys on foot
    if (!this.inCar) {
      if (this.keys['ArrowLeft']) this.camYaw -= 2.2 * dt;
      if (this.keys['ArrowRight']) this.camYaw += 2.2 * dt;
    }

    if (this.inCar) this._updateDriving(dt);
    else this._updateOnFoot(dt);

    this._updateTraffic(dt);
    this._updatePeds(dt);
    this._updateGuards(dt);
    this._updateCrew(dt);
    this._updatePolice(dt);
    this._updateWanted(dt);
    this._checkRespray();
    this.missions.update(dt);

    // health regen after 5 s without damage
    if (this.time - this.lastDamageAt > 5 && this.health < 100) {
      this.health = Math.min(100, this.health + 2 * dt);
    }
    if (this.health <= 0 && this.state === 'playing') {
      this.state = 'wasted';
      document.getElementById('wasted-overlay').style.display = 'flex';
      this.audio.fail();
    }

    // engine hum
    this.audio.setEngine(this.playerCar ? this.playerCar.speed : 0, this.inCar);
    this._updateHud();
  }

  _updateOnFoot(dt) {
    const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed = sprint ? 8 : 5;
    const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const r = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
    let mx = 0;
    let mz = 0;
    if (this.keys['KeyW']) { mx += f.x; mz += f.z; }
    if (this.keys['KeyS']) { mx -= f.x; mz -= f.z; }
    if (this.keys['KeyD']) { mx += r.x; mz += r.z; }
    if (this.keys['KeyA']) { mx -= r.x; mz -= r.z; }
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) {
      mx /= len; mz /= len;
      this.player.heading = Math.atan2(mx, mz);
      this.player.speed = speed;
      this.player.walkPhase += dt * speed * 1.6;
      this.player.x += mx * speed * dt;
      this.player.z += mz * speed * dt;
    } else {
      this.player.speed = 0;
    }
    this.world.resolveCircle(this.player, 0.8);
    // Don't walk through cars — except police cars: a cop next to the
    // player is making an arrest (the busted timer), so it must be allowed
    // to stand close instead of shoving the player away every frame.
    for (const car of this.cars) {
      if (car.kind === 'police') continue;
      const d = dist(this.player.x, this.player.z, car.x, car.z);
      if (d < 2.6 && d > 0.01) {
        const push = 2.6 - d;
        this.player.x += (this.player.x - car.x) / d * push;
        this.player.z += (this.player.z - car.z) / d * push;
      }
    }
    this.player.syncMesh(dt);
  }

  _updateDriving(dt) {
    const car = this.playerCar;
    if (!car) { this.inCar = false; return; }
    const fwd = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    // A turns left, D turns right: with forward = (sin h, cos h), a left
    // turn increases the heading (positive rotation about Y).
    const steer = (this.keys['KeyA'] ? 1 : 0) - (this.keys['KeyD'] ? 1 : 0);
    // Slow down for a turn: a U-turn at full speed is wider than the road
    // and runs the car into the blocks, where it wedges against a building
    // and gets rammed to pieces. Capping the speed while the wheel is
    // turned keeps the turn on the asphalt. 12 m/s is the fastest a
    // U-turn can be taken on a 10 m road (radius 3.75 m, so the sweep
    // stays inside the carriageway) and keeps the car moving briskly
    // through the gentle corrections a driver makes all the time.
    const topSpeed = steer !== 0 ? 12 : 24;
    if (fwd > 0) car.speed = Math.min(topSpeed, car.speed + 22 * dt);
    else if (fwd < 0) car.speed = Math.max(-8, car.speed - 22 * dt);
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 5 * dt);
    // Brake HARD for the turn: arriving at a corner at 24 m/s and only
    // easing down to the turn cap overshoots the junction by a car
    // length or more and puts the car in the blocks east of the road,
    // wedged against a building. Shedding the speed first keeps the
    // turn on the asphalt.
    if (car.speed > topSpeed) car.speed = Math.max(topSpeed, car.speed - 45 * dt);
    // Turn authority at crawling speed: a car doing a U-turn in a tight
    // spot has to be able to swing the wheel while barely moving, or it
    // never commits to the turn and dithers on the spot. A fully stopped
    // car still cannot turn.
    const speedAbs = Math.abs(car.speed);
    const turnFactor = speedAbs < 0.1 ? 0 : clamp(0.3 + speedAbs / 5, 0, 1);
    const turn = steer * 3.2 * dt * turnFactor * Math.sign(car.speed || 1);
    car.heading += turn;
    const px = car.x;
    const pz = car.z;
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    // buildings
    const hitWall = this.world.resolveCircle(car, 2.2);
    if (hitWall && Math.abs(car.speed) > 8) {
      this._damageCar(car, (Math.abs(car.speed) - 8) * 0.7);
      car.speed *= 0.25;
      this.audio.crash();
    } else if (hitWall) {
      // Brushing a wall at town speed is a scrape, not a stop: keep
      // most of the speed so the car slides along the face and gets
      // clear instead of grinding to a halt against it.
      car.speed *= 0.9;
    }
    // other cars
    for (const o of this.cars) {
      if (o === car || o.dead) continue;
      const d = dist(car.x, car.z, o.x, o.z);
      if (d < 4.4 && d > 0.01) {
        const push = (4.4 - d) / 2;
        const nx = (car.x - o.x) / d;
        const nz = (car.z - o.z) / d;
        car.x += nx * push; car.z += nz * push;
        o.x -= nx * push; o.z -= nz * push;
        const rel = Math.abs(car.speed - o.speed);
        // One impact, one bill: without a cooldown a cop leaning on the
        // player's car grinds it to scrap a frame at a time. A fresh hit
        // still hurts; sustained contact does not keep charging. The
        // cooldown is a full second and the bill is light — a chase
        // should threaten the car, not delete it in one pass.
        if (rel > 6 && car.hitCooldown <= 0 && o.hitCooldown <= 0) {
          this._damageCar(car, (rel - 6) * 0.15);
          o.hp -= (rel - 6) * 0.15;
          if (o.hp <= 0) o.dead = true;
          car.hitCooldown = 1.2; o.hitCooldown = 1.2;
          car.speed *= 0.5;
          this.audio.crash();
        }
      }
    }
    // pedestrians
    for (const ped of this.peds) {
      if (ped.state === 'down') continue;
      const d = dist(car.x, car.z, ped.x, ped.z);
      if (d < 2.4 && Math.abs(car.speed) > 3) {
        ped.knockDown();
        this.setWanted(Math.max(this.wanted, 1));
        car.speed *= 0.8;
        this.audio.crash();
        this.toast('You hit a pedestrian!');
      }
    }
    // red light
    this._checkRedLight(car);
    // camera follows the car
    this.camYaw = lerp(this.camYaw, car.heading, 1 - Math.pow(0.001, dt));
    this.player.x = car.x; this.player.z = car.z;
    car.syncMesh();
    if (car.hp <= 0) {
      car.dead = true;
      this.toast('Your car is wrecked!');
      this._exitCar();
    }
  }

  _damageCar(car, dmg) {
    car.hp -= dmg;
    if (car === this.playerCar) {
      this.health -= dmg * 0.4;
      this.lastDamageAt = this.time;
    }
  }

  _checkRedLight(car) {
    if (this.redLightCooldown > 0 || Math.abs(car.speed) < 5) return;
    // nearest junction
    const jx = nearestGridCoord(car.x);
    const jz = nearestGridCoord(car.z);
    if (Math.abs(car.x - jx) > 7 || Math.abs(car.z - jz) > 7) return;
    const alongX = Math.abs(Math.sin(car.heading)) > Math.abs(Math.cos(car.heading));
    const st = this.world.lightStateAt(car.x, car.z, alongX);
    if (st === 'red') {
      this.setWanted(this.wanted + 1);
      this.toast('You ran a red light! +1 star');
      this.audio.siren();
      this.redLightCooldown = 6;
    }
  }

  _checkRespray() {
    if (this.resprayCooldown > 0 || this.wanted === 0 || this.cash < 150) return;
    const gx = this.world.landmarks.garage.x;
    const gz = this.world.landmarks.garage.z;
    const at = this.inCar && this.playerCar
      ? dist(this.playerCar.x, this.playerCar.z, gx, gz) < 14
      : dist(this.player.x, this.player.z, gx, gz) < 14;
    if (!at) return;
    // A respray is a deliberate pull-in, not a drive-through: it fires when
    // the car is slow (or the player is on foot), or when the garage is the
    // mission destination (m1/m4 arrival). It never fires mid-mission on
    // m2 — the crew run passes the garage junction and the $150 must not
    // come out of that job's payout.
    const speed = this.inCar && this.playerCar ? Math.abs(this.playerCar.speed) : 0;
    const isGarageJob = (this.missions.active === 'm1' || this.missions.active === 'm4')
      && this.missions.step === 1;
    if (this.missions.active === 'm2') return;
    if (speed >= 5 && !isGarageJob) return;
    this.cash -= 150;
    this.wanted = 0;
    this.resprayCooldown = 3;
    this.toast('Resprayed — heat gone (-$150)');
    this.audio.cash();
    this._save();
  }

  _updateTraffic(dt) {
    for (const car of this.cars) {
      if (car.kind !== 'traffic' || car.dead) continue;
      if (this.playerCar === car || car.playerOwned) continue;
      car.updateTraffic(dt, this.world, this.rng, this.cars);
      this.world.resolveCircle(car, 2.2);
      // traffic cars can knock peds down (no wanted for the player)
      for (const ped of this.peds) {
        if (ped.state === 'down') continue;
        if (dist(car.x, car.z, ped.x, ped.z) < 2.4 && Math.abs(car.speed) > 3) ped.knockDown();
      }
    }
    // respawn traffic that drove too far off or died, to keep the city alive
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.kind === 'traffic' && (car.dead || dist(car.x, car.z, this.player.x, this.player.z) > 320)) {
        car.dispose(this.scene);
        this.cars.splice(i, 1);
        const fresh = this._spawnTrafficCar();
        if (fresh) this.cars.push(fresh);
      }
    }
  }

  _updatePeds(dt) {
    const danger = this.inCar && this.playerCar && Math.abs(this.playerCar.speed) > 6
      ? { x: this.playerCar.x, z: this.playerCar.z }
      : null;
    for (const ped of this.peds) ped.updatePed(dt, this.world, this.rng, danger);
  }

  _updateGuards(dt) {
    for (const g of this.enemies) {
      const dealt = g.updateGuard(dt, this.world, this.player.x, this.player.z, this.state === 'playing');
      if (dealt > 0) {
        this.health -= dealt;
        this.lastDamageAt = this.time;
        this.audio.hit();
      }
    }
  }

  _updateCrew(dt) {
    if (this.missions.active !== 'm2' || this.missions.step !== 0) return;
    if (!this.inCar || !this.playerCar) return;
    const car = this.playerCar;
    const docks = this.world.landmarks.docks;
    if (dist(car.x, car.z, docks.x, docks.z) > 25) return;
    for (const c of this.crew) {
      if (c.state === 'board') continue;
      c.updateCrew(dt, this.world, car);
      if (c.state === 'board') {
        this.toast('Crew member got in!');
        this.audio.pickup();
      }
    }
  }

  _updatePolice(dt) {
    // Spawn to match the wanted level, one per frame until the target is
    // reached — the heat has to arrive fast (a 2 s trickle is slower than
    // the verification waits and feels dead in play, too).
    const target = this.wanted === 0 ? 0 : Math.min(2 + this.wanted, 6);
    if (this.wanted > 0 && this.policeCars.length < target) {
      // spawn on a road 45-60 m from the player
      const ang = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(45, 60);
      let x = this.player.x + Math.sin(ang) * d;
      let z = this.player.z + Math.cos(ang) * d;
      const gx = nearestGridCoord(x);
      const gz = nearestGridCoord(z);
      if (Math.abs(x - gx) < Math.abs(z - gz)) x = gx + (this.rng.chance(0.5) ? 2 : -2);
      else z = gz + (this.rng.chance(0.5) ? 2 : -2);
      x = clamp(x, -230, 230); z = clamp(z, -230, 230);
      this._spawnPoliceCar(x, z);
      if (this.policeCars.length === 1) this.audio.siren();
    }
    if (this.wanted === 0 && this.policeCars.length > 0) {
      for (const p of this.policeCars) {
        const i = this.cars.indexOf(p);
        if (i >= 0) this.cars.splice(i, 1);
        p.dispose(this.scene);
      }
      this.policeCars = [];
      for (const f of this.footPolice) f.dispose(this.scene);
      this.footPolice = [];
    }
    // foot police at wanted 3+
    const footTarget = this.wanted >= 3 ? 2 : 0;
    if (this.footPolice.length < footTarget) {
      const ang = this.rng.range(0, Math.PI * 2);
      this._spawnFootPolice(
        this.player.x + Math.sin(ang) * 18,
        this.player.z + Math.cos(ang) * 18,
      );
    }
    // chase
    for (const p of this.policeCars) {
      p.updatePolice(dt, this.world, this.player.x, this.player.z, 7);
      this.world.resolveCircle(p, 2.2);
      // ramming: a police car touching the player's car damages it —
      // a nudge, not a battering ram; the crash itself already bills.
      if (this.inCar && this.playerCar) {
        const d = dist(p.x, p.z, this.playerCar.x, this.playerCar.z);
        if (d < 4.6 && Math.abs(p.speed) > 2) {
          this._damageCar(this.playerCar, 2 * dt);
        }
      }
    }
    for (const f of this.footPolice) {
      if (f.state === 'down') { f.syncMesh(dt); continue; }
      f.walkToward(dt, this.player.x, this.player.z, 6.0);
      this.world.resolveCircle(f, 0.8);
      f.syncMesh(dt);
    }
    // busted?
    let pinned = false;
    for (const p of this.policeCars) {
      if (!this.inCar && dist(p.x, p.z, this.player.x, this.player.z) < 2.5) pinned = true;
      if (this.inCar && this.playerCar && dist(p.x, p.z, this.playerCar.x, this.playerCar.z) < 3 && Math.abs(this.playerCar.speed) < 1) pinned = true;
    }
    for (const f of this.footPolice) {
      // A foot cop can only make the arrest on foot, or against a car
      // that has actually stopped — not by jogging alongside one that
      // is still rolling at town speed.
      const carStopped = this.inCar && this.playerCar && Math.abs(this.playerCar.speed) < 1;
      if (f.state !== 'down' && dist(f.x, f.z, this.player.x, this.player.z) < 1.8 && (!this.inCar || carStopped)) pinned = true;
    }
    if (pinned && this.state === 'playing') {
      this.bustTimer += dt;
      // Three seconds of a cop standing on the car, not two: a pickup
      // or a tight manoeuvre should not end the run before the player
      // can react, and the crew needs a moment to get in.
      if (this.bustTimer > 3) {
        this.state = 'busted';
        document.getElementById('busted-overlay').style.display = 'flex';
        this.audio.fail();
      }
    } else {
      this.bustTimer = 0;
    }
  }

  _updateWanted(dt) {
    if (this.wanted === 0) return;
    let policeNear = false;
    for (const p of this.policeCars) {
      if (dist(p.x, p.z, this.player.x, this.player.z) < 40) { policeNear = true; break; }
    }
    if (!policeNear) {
      for (const f of this.footPolice) {
        if (dist(f.x, f.z, this.player.x, this.player.z) < 25) { policeNear = true; break; }
      }
    }
    if (policeNear) { this.wantedTimer = 0; return; }
    this.wantedTimer += dt;
    if (this.wantedTimer > 15) {
      this.wantedTimer = 0;
      this.wanted = Math.max(0, this.wanted - 1);
      if (this.wanted === 0) this.toast('You lost the cops.');
    }
  }

  // -------------------------------------------------------------- save ----
  _save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: this.cash,
        completed: this.completed,
        health: this.health,
        x: this.player.x,
        z: this.player.z,
        timeOfDay: this.world.timeOfDay,
      }));
    } catch (e) { /* storage may be unavailable */ }
  }

  _loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      this.cash = s.cash;
      this.completed = s.completed || [];
      this.health = s.health ?? 100;
      this.player.x = s.x ?? 0;
      this.player.z = s.z ?? 10;
      if (typeof s.timeOfDay === 'number') this.world.setTimeOfDay(s.timeOfDay);
      this._buildMissionList();
      this._startPlaying();
      this.toast('Save loaded. Welcome back, Cole.');
    } catch (e) { /* corrupted save */ }
  }

  _updateSaveButton() {
    try {
      const btn = document.getElementById('btn-continue');
      if (btn) btn.style.display = localStorage.getItem(SAVE_KEY) ? 'block' : 'none';
    } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------- render --
  _render() {
    // camera
    if (this.shotMode === 'start') {
      this.camera.position.set(70, 55, 130);
      this.camera.lookAt(0, 0, 0);
    } else {
      const target = this.inCar && this.playerCar
        ? { x: this.playerCar.x, z: this.playerCar.z }
        : { x: this.player.x, z: this.player.z };
      const distBack = this.inCar ? 11 : 7;
      const height = this.inCar ? 5 : 3.2;
      const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
      this.camera.position.set(
        target.x - f.x * distBack,
        height,
        target.z - f.z * distBack,
      );
      this.camera.lookAt(target.x + f.x * 4, 1, target.z + f.z * 4);
    }
    if (this.world.sun) {
      this.world.sunTarget.position.set(this.player.x, 0, this.player.z);
      this.world.sun.position.set(
        this.player.x + Math.cos((this.world.timeOfDay - 0.25) * Math.PI * 2) * 160,
        Math.max(20, (Math.sin((this.world.timeOfDay - 0.25) * Math.PI * 2) * 0.9 + 0.25) * 180),
        this.player.z + Math.sin((this.world.timeOfDay - 0.25) * Math.PI * 2) * 120,
      );
    }
    this.renderer.render(this.scene, this.camera);
    this._drawMinimap();
  }

  _drawMinimap() {
    const cv = document.getElementById('minimap');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const S = cv.width / 520; // world -260..260 -> canvas
    const mx = (x) => (x + 260) * S;
    const mz = (z) => (z + 260) * S;
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // roads
    ctx.strokeStyle = '#4a4a55';
    ctx.lineWidth = Math.max(2, 10 * S);
    for (const c of GRID) {
      ctx.beginPath(); ctx.moveTo(mx(-234), mz(c)); ctx.lineTo(mx(234), mz(c)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx(c), mz(-234)); ctx.lineTo(mx(c), mz(234)); ctx.stroke();
    }
    // buildings
    ctx.fillStyle = '#5a5a6a';
    for (const b of this.world.buildings) {
      ctx.fillRect(mx(b.x - b.hw), mz(b.z - b.hd), b.hw * 2 * S, b.hd * 2 * S);
    }
    // landmarks
    const lm = this.world.landmarks;
    const dots = [
      [lm.garage, '#ffb347'], [lm.docks, '#7ad0ff'], [lm.safehouse, '#9dff8a'],
      [lm.mall, '#ff7ad0'], [lm.casino, '#ff5a8a'],
    ];
    for (const [p, col] of dots) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(mx(p.x), mz(p.z), 4, 0, Math.PI * 2); ctx.fill();
    }
    // mission target
    const tgt = this._missionTarget();
    if (tgt) {
      ctx.strokeStyle = '#ffe14a';
      ctx.lineWidth = 2;
      const r = 7 + Math.sin(this.time * 4) * 2;
      ctx.beginPath(); ctx.arc(mx(tgt.x), mz(tgt.z), r, 0, Math.PI * 2); ctx.stroke();
    }
    // cars
    ctx.fillStyle = '#d8d8d8';
    for (const car of this.cars) {
      if (car.kind === 'police') continue;
      ctx.fillRect(mx(car.x) - 1.5, mz(car.z) - 1.5, 3, 3);
    }
    // police
    ctx.fillStyle = '#4a90ff';
    for (const p of this.policeCars) {
      ctx.beginPath(); ctx.arc(mx(p.x), mz(p.z), 3, 0, Math.PI * 2); ctx.fill();
    }
    // player arrow
    const px = mx(this.player.x);
    const pz = mz(this.player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.PI - this.player.heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _missionTarget() {
    const m = this.missions;
    if (!m.active) return null;
    const lm = this.world.landmarks;
    if (m.active === 'm1') return m.step === 1 ? lm.garage : null;
    if (m.active === 'm2') return m.step === 0 ? lm.docks : lm.safehouse;
    if (m.active === 'm3') return m.step === 0 ? lm.docks : lm.mall;
    if (m.active === 'm4') return m.step === 0 ? lm.casino : lm.garage;
    if (m.active === 'm5') return m.step === 0 ? lm.casino : lm.safehouse;
    return null;
  }

  _updateHud() {
    const set = (id, txt) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== txt) el.textContent = txt;
    };
    set('hud-cash', `$${this.cash}`);
    set('hud-wanted', '★'.repeat(this.wanted) + '☆'.repeat(5 - this.wanted));
    set('hud-health', `HP ${Math.max(0, Math.round(this.health))}`);
    set('hud-speed', this.inCar && this.playerCar ? `${Math.round(Math.abs(this.playerCar.speed) * 3.6)} km/h` : '');
    set('hud-mission', this.missions.active
      ? `${this.missions.current.name}: ${this.missions.objective}`
      : 'No mission — press M for jobs');
    const timer = document.getElementById('timer');
    if (timer) {
      if (this.missions.active === 'm3' && this.missions.step === 1) {
        timer.style.display = 'block';
        const t = Math.max(0, Math.ceil(this.missions.timer));
        set('timer', `⏱ ${t}s`);
      } else {
        timer.style.display = 'none';
      }
    }
  }
}
