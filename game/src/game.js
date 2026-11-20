// SUNSET BAY — the game: state machine, player, cars, wanted, combat,
// respray, save/load and the state() API the tests read.
import { mulberry32, clamp, dist2d } from './util.js';
import { createWorld, nearestRoadCoord, GRID_MIN, GRID_MAX } from './world.js';
import {
  spawnParkedCars, spawnTraffic, spawnPeds, updateTraffic, updatePeds,
  updatePolice, updateGuards, resolveCarCollisions, spawnPoliceCar,
  knockPedDown, makeFootCop,
} from './actors.js';
import { startMission, updateMissions, onEnterCar, abortMission } from './missions.js';
import { AudioEngine } from './audio.js';

const SAVE_KEY = 'sunset-bay-save-v1';
const START_CASH = 250;
const RESPRAY_COST = 150;

export function createGame(seed, opts = {}) {
  const rng = mulberry32(seed);
  const world = createWorld(seed);
  const audio = new AudioEngine();

  const game = {
    seed,
    rng,
    world,
    audio,
    state: 'menu',
    time: 0,
    player: { x: 156, z: 156, heading: Math.PI, speed: 0 },
    playerCar: null,
    cars: [],
    peds: [],
    policeCars: [],
    footPolice: [],
    enemies: [],
    wanted: 0,
    cash: START_CASH,
    health: 100,
    completed: [],
    mission: null,
    missionStep: 0,
    objective: '',
    missionTimer: 0,
    crewInCar: 0,
    crewTimer: 0,
    enemiesDown: 0,
    markedCar: null,
    inMarkedCar: false,
    m5Hold: 0,
    camYaw: Math.PI,
    camPitch: 0.32,
    lastCrime: -999,
    lastViolence: -999,
    lastDamage: -999,
    bustedTimer: 0,
    resprayCooldown: 0,
    punchCooldown: 0,
    redLightAt: {},
    prevCarPos: null,
    input: { keys: new Set() },
    onToast: () => {},
    toast(text) {
      this.onToast(text);
    },
    autosave() {
      this._save();
    },
  };

  // ---- population -------------------------------------------------------
  spawnParkedCars(game);
  spawnTraffic(game, 10);
  spawnPeds(game, 24);

  // ---- helpers ----------------------------------------------------------
  game.addWanted = function (n, reason) {
    if (n <= 0) return;
    this.wanted = Math.min(5, this.wanted + n);
    this.lastCrime = this.time;
    this.syncPolice();
    void reason;
  };

  game.setWanted = function (n) {
    this.wanted = clamp(Math.round(n), 0, 5);
    if (this.wanted > 0) this.lastCrime = this.time;
    this.syncPolice();
  };

  game.giveCash = function (n) {
    this.cash += n;
  };

  game.syncPolice = function () {
    const wantCars = this.wanted;
    while (this.policeCars.length < wantCars) {
      if (!spawnPoliceCar(this)) break;
    }
    while (this.policeCars.length > wantCars) {
      const cop = this.policeCars.pop();
      const i = this.cars.indexOf(cop);
      if (i >= 0) this.cars.splice(i, 1);
    }
    const wantFoot = this.wanted >= 2 ? this.wanted - 1 : 0;
    while (this.footPolice.length < wantFoot) {
      const a = this.rng() * Math.PI * 2;
      const d = 25 + this.rng() * 10;
      this.footPolice.push(makeFootCop(
        clamp(this.player.x + Math.sin(a) * d, GRID_MIN, GRID_MAX),
        clamp(this.player.z + Math.cos(a) * d, GRID_MIN, GRID_MAX)));
    }
    while (this.footPolice.length > wantFoot) this.footPolice.pop();
  };

  game.damagePlayer = function (n) {
    if (this.state !== 'playing') return;
    this.health -= n;
    this.lastDamage = this.time;
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'wasted';
      this.cash = Math.max(0, this.cash - 100);
      abortMission(this, 'You got wasted.');
      this.audio.fail();
      this.toast('WASTED — you lost $100.');
      this.onEnd('wasted');
    }
  };

  game.damageCar = function (car, n) {
    if (!car || car.dead) return;
    car.hp -= n;
    if (car.hp <= 0) {
      car.hp = 0;
      car.dead = true;
      car.speed = 0;
      if (car === this.playerCar) {
        this.toast('Your car is wrecked!');
        this.exitCar(true);
      }
    }
  };

  game.teleport = function (x, z) {
    if (this.playerCar) {
      this.playerCar.x = x;
      this.playerCar.z = z;
      this.playerCar.speed = 0;
    }
    this.player.x = x;
    this.player.z = z;
  };

  game.startMission = function (id) {
    if (this.state !== 'playing') return false;
    return startMission(this, id);
  };

  // ---- entering / exiting cars ------------------------------------------
  game.tryEnterExit = function () {
    if (this.state !== 'playing') return;
    if (this.playerCar) {
      this.exitCar(false);
      return;
    }
    let best = null;
    let bd = 4.5;
    for (const car of this.cars) {
      if (car.dead || car.kind === 'police' || car.kind === 'traffic') continue;
      const d = dist2d(this.player.x, this.player.z, car.x, car.z);
      if (d < bd) {
        bd = d;
        best = car;
      }
    }
    if (!best) return;
    this.playerCar = best;
    this.player.x = best.x;
    this.player.z = best.z;
    this.player.heading = best.heading;
    this.camYaw = best.heading;
    if (!best.playerOwned) {
      best.playerOwned = true;
      this.addWanted(1, 'steal');
      this.toast('Stolen! The cops noticed.');
    }
    onEnterCar(this, best);
    this.audio.ensure();
  };

  game.exitCar = function (wrecked) {
    if (!this.playerCar) return;
    const car = this.playerCar;
    this.playerCar = null;
    const side = wrecked ? 0 : 1;
    this.player.x = car.x + Math.cos(car.heading) * 2.5 * side + (wrecked ? 2 : 0);
    this.player.z = car.z - Math.sin(car.heading) * 2.5 * side;
    this.player.heading = car.heading;
    this.camYaw = car.heading;
    this.player.speed = 0;
  };

  // ---- combat ------------------------------------------------------------
  game.punch = function () {
    if (this.state !== 'playing' || this.playerCar || this.punchCooldown > 0) return;
    this.punchCooldown = 0.4;
    // Guards first (mission targets), then pedestrians.
    let best = null;
    let bd = 2.6;
    for (const g of this.enemies) {
      if (g.state === 'down' || g.dead) continue;
      const d = dist2d(this.player.x, this.player.z, g.x, g.z);
      if (d < bd) {
        const ang = Math.abs(((Math.atan2(g.x - this.player.x, g.z - this.player.z) - this.player.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (ang < 1.3) {
          bd = d;
          best = g;
        }
      }
    }
    if (!best) {
      for (const p of this.peds) {
        if (p.state === 'down') continue;
        const d = dist2d(this.player.x, this.player.z, p.x, p.z);
        if (d < bd) {
          const ang = Math.abs(((Math.atan2(p.x - this.player.x, p.z - this.player.z) - this.player.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (ang < 1.3) {
            bd = d;
            best = p;
          }
        }
      }
    }
    if (!best) return;
    this.audio.punch();
    this.lastViolence = this.time;
    best.hp -= 34;
    const push = Math.atan2(best.x - this.player.x, best.z - this.player.z);
    best.x += Math.sin(push) * 0.5;
    best.z += Math.cos(push) * 0.5;
    if (best.hp <= 0) {
      if (best.state !== undefined && this.enemies.includes(best)) {
        best.state = 'down';
        this.enemiesDown = this.enemies.filter((e) => e.state === 'down').length;
      } else {
        knockPedDown(this, best);
      }
    } else if (!this.enemies.includes(best) && !best.assaulted) {
      best.assaulted = true;
      this.addWanted(1, 'assault');
    }
  };

  // ---- save / load -------------------------------------------------------
  game._save = function () {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: this.cash,
        health: this.health,
        completed: this.completed,
        x: this.player.x,
        z: this.player.z,
        version: 1,
      }));
    } catch {
      // Storage can be off; the run just is not saved.
    }
  };

  game.loadSave = function () {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  game.loadFromSave = function (data) {
    if (!data) return false;
    this.cash = data.cash;
    this.health = data.health;
    this.completed = Array.isArray(data.completed) ? data.completed : [];
    this.player.x = data.x;
    this.player.z = data.z;
    this.playerCar = null;
    this.state = 'playing';
    return true;
  };

  // ---- flow --------------------------------------------------------------
  game.startGame = function () {
    this.cash = START_CASH;
    this.health = 100;
    this.wanted = 0;
    this.completed = [];
    abortMission(this);
    this.player.x = 156;
    this.player.z = 156;
    this.player.heading = Math.PI;
    this.camYaw = Math.PI;
    this.playerCar = null;
    this.syncPolice();
    this.state = 'playing';
    this.audio.ensure();
  };

  game.respawn = function () {
    abortMission(this);
    this.enemies = [];
    this.health = 100;
    this.wanted = 0;
    this.bustedTimer = 0;
    this.playerCar = null;
    this.player.x = 156;
    this.player.z = 156;
    this.player.heading = Math.PI;
    this.camYaw = Math.PI;
    this.syncPolice();
    this.state = 'playing';
  };

  game.setPaused = function (paused) {
    if (paused && this.state === 'playing') this.state = 'paused';
    else if (!paused && this.state === 'paused') this.state = 'playing';
  };

  game.onEnd = function () {
    // Overridden by main.js to show the end screen.
  };

  // ---- per-frame ---------------------------------------------------------
  game.update = function (dt) {
    this.time += dt;
    this.world.step(dt);
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.resprayCooldown = Math.max(0, this.resprayCooldown - dt);
    updateTraffic(this, dt);
    updatePeds(this, dt);
    if (this.state === 'menu') return;
    if (this.state !== 'playing') return;

    updatePolice(this, dt);
    updateGuards(this, dt);
    resolveCarCollisions(this, dt);

    // --- player movement ---
    const keys = this.input.keys;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (this.playerCar) {
      const car = this.playerCar;
      const boosting = sprint;
      const maxFwd = boosting ? 38 : 28;
      if (keys.has('KeyW')) car.speed = Math.min(maxFwd, car.speed + (boosting ? 20 : 16) * dt);
      else if (keys.has('KeyS')) {
        if (car.speed > 0.5) car.speed = Math.max(0, car.speed - 22 * dt);
        else car.speed = Math.max(-10, car.speed - 10 * dt);
      } else {
        car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 3 * dt);
        if (Math.abs(car.speed) < 0.2) car.speed = 0;
      }
      const steer = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
      // Tight low-speed turning: a U-turn has to fit on a 12 m road.
      const turnAuthority = clamp(Math.abs(car.speed) / 3, 0.2, 1);
      car.heading += steer * 2.8 * turnAuthority * dt * Math.sign(car.speed || 1);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      car.x = clamp(car.x, -250, 250);
      car.z = clamp(car.z, -250, 250);
      // Lane keeping: a small heading error walks a car off a 12 m road over
      // a long straight leg, so gently spring the car back to the road centre
      // while it is moving along a road. (Arcade handling; no pull while
      // turning at a junction, standing still, or steering around a car.)
      if (Math.abs(car.speed) > 2) {
        let blockedAhead = false;
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        for (const other of this.cars) {
          if (other === car || other.dead) continue;
          const dx = other.x - car.x;
          const dz = other.z - car.z;
          const fwd = dx * fx + dz * fz;
          const side = Math.abs(dx * fz - dz * fx);
          if (fwd > 0 && fwd < 14 && side < 5) { blockedAhead = true; break; }
        }
        if (!blockedAhead) {
          const alongX = Math.abs(Math.sin(car.heading)) > 0.7;
          const alongZ = Math.abs(Math.cos(car.heading)) > 0.7;
          if (alongX) {
            const rz = nearestRoadCoord(car.z);
            const off = car.z - rz;
            if (Math.abs(off) < 8) car.z -= clamp(off * 2.0 * dt, -8 * dt, 8 * dt);
          } else if (alongZ) {
            const rx = nearestRoadCoord(car.x);
            const off = car.x - rx;
            if (Math.abs(off) < 8) car.x -= clamp(off * 2.0 * dt, -8 * dt, 8 * dt);
          }
        }
      }
      this.player.x = car.x;
      this.player.z = car.z;
      this.player.heading = car.heading;
      // Camera follows the car.
      this.camYaw += ((car.heading - this.camYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 2.5);
    } else {
      const walkSpeed = sprint ? 7.5 : 4;
      let mx = 0;
      let mz = 0;
      const fx = Math.sin(this.camYaw);
      const fz = Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      if (keys.has('KeyW')) { mx += fx; mz += fz; }
      if (keys.has('KeyS')) { mx -= fx; mz -= fz; }
      if (keys.has('KeyA')) { mx -= rx; mz -= rz; }
      if (keys.has('KeyD')) { mx += rx; mz += rz; }
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        this.player.x += (mx / len) * walkSpeed * dt;
        this.player.z += (mz / len) * walkSpeed * dt;
        this.player.heading = this.camYaw;
      }
      this.player.x = clamp(this.player.x, -250, 250);
      this.player.z = clamp(this.player.z, -250, 250);
    }

    // --- respray at the garage ---
    if (this.playerCar && this.wanted > 0 && this.cash >= RESPRAY_COST && this.resprayCooldown <= 0) {
      const gr = this.world.landmarks.garage;
      if (dist2d(this.playerCar.x, this.playerCar.z, gr.x, gr.z) < 12) {
        this.cash -= RESPRAY_COST;
        this.wanted = 0;
        this.syncPolice();
        this.resprayCooldown = 5;
        this.audio.cash();
        this.toast('Respray — $150. Heat cleared.');
      }
    }

    // --- red-light violations ---
    this.checkRedLight();

    // --- missions ---
    updateMissions(this, dt);

    // --- wanted decay ---
    if (this.wanted > 0 && this.time - this.lastCrime > 45) {
      const near = this.policeCars.some((c) => dist2d(c.x, c.z, this.player.x, this.player.z) < 25);
      if (!near) {
        this.wanted -= 1;
        this.lastCrime = this.time;
        this.syncPolice();
      }
    }

    // --- busted: cops close in on foot ---
    if (!this.playerCar) {
      let close = false;
      for (const cop of this.policeCars) {
        if (dist2d(cop.x, cop.z, this.player.x, this.player.z) < 2.5) { close = true; break; }
      }
      if (!close) {
        for (const fp of this.footPolice) {
          if (dist2d(fp.x, fp.z, this.player.x, this.player.z) < 2) { close = true; break; }
        }
      }
      if (close) {
        this.bustedTimer += dt;
        if (this.bustedTimer >= 1.5) {
          this.bustedTimer = 0;
          this.state = 'busted';
          this.cash = Math.max(0, this.cash - 200);
          abortMission(this, 'Busted! The cops took $200.');
          this.audio.fail();
          this.toast('BUSTED — you lost $200.');
          this.onEnd('busted');
        }
      } else {
        this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2);
      }
    } else {
      this.bustedTimer = 0;
    }

    // --- health regen ---
    if (this.health < 100 && this.time - this.lastDamage > 5) {
      this.health = Math.min(100, this.health + 2 * dt);
    }

    // --- audio ---
    const speed01 = this.playerCar ? clamp(Math.abs(this.playerCar.speed) / 38, 0, 1) : 0;
    this.audio.update(dt, speed01, !!this.playerCar, this.wanted);
  };

  game.checkRedLight = function () {
    const car = this.playerCar;
    if (!car || Math.abs(car.speed) < 3) {
      this.prevCarPos = car ? { x: car.x, z: car.z } : null;
      return;
    }
    const prev = this.prevCarPos;
    this.prevCarPos = { x: car.x, z: car.z };
    if (!prev) return;
    const jx = Math.round(car.x / 52) * 52;
    const jz = Math.round(car.z / 52) * 52;
    if (Math.abs(jx) > 208 || Math.abs(jz) > 208) return;
    const wasIn = Math.abs(prev.x - jx) < 6 && Math.abs(prev.z - jz) < 6;
    const isIn = Math.abs(car.x - jx) < 6 && Math.abs(car.z - jz) < 6;
    if (isIn && !wasIn) {
      const movingAlongX = Math.abs(car.x - prev.x) > Math.abs(car.z - prev.z);
      const light = this.world.lightStateAt(jx, jz, movingAlongX);
      const key = jx + ',' + jz;
      if (light === 'red' && (this.redLightAt[key] || 0) < this.time - 5) {
        this.redLightAt[key] = this.time;
        this.addWanted(1, 'red light');
        this.toast('Ran a red light! +1 wanted');
      }
    }
  };

  // ---- state API ----------------------------------------------------------
  game.getState = function () {
    return {
      state: this.state,
      player: { x: Math.round(this.player.x * 10) / 10, z: Math.round(this.player.z * 10) / 10 },
      inCar: !!this.playerCar,
      mission: this.mission,
      missionStep: this.missionStep,
      objective: this.objective,
      wanted: this.wanted,
      cash: this.cash,
      completed: [...this.completed],
      enemies: this.enemies.filter((e) => e.state !== 'down' && !e.dead).length,
      health: Math.round(this.health),
      carHp: this.playerCar ? Math.round(this.playerCar.hp) : 100,
      police: this.policeCars.length,
      footPolice: this.footPolice.length,
      crewInCar: this.crewInCar,
    };
  };

  return game;
}
