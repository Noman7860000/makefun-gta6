// SUNSET BAY — the game: loop, input, camera, HUD, wanted system,
// economy, save/load, screens and the debug API the tests drive.
// Written fresh for this entry.
window.SB = window.SB || {};

(function () {
  'use strict';
  const U = window.SB.util;
  const SAVE_KEY = 'sunsetbay-save-v1';

  function Game(opts) {
    opts = opts || {};
    this.lowfx = !!opts.lowfx;
    this.seed = opts.seed || 1337;
    this.rng = U.mulberry32(this.seed);
    this.state = 'menu';
    this.cash = 250;
    this.completed = [];
    this.wanted = 0;
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.gameTime = 0;
    this.lastCrimeAt = -1e9;
    this.resprayCd = 0;
    this.lastJunction = null;
    this.junctionCd = {};
    this.keys = { w: false, a: false, s: false, d: false, shift: false };
    this.shotMode = opts.shot || null;
    this.shotFrames = 0;
    this.shotDrive = false;
    this._hudCache = {};
    this._minimapAt = 0;
    this._mouseDown = false;
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._camPos = new THREE.Vector3(0, 30, 80);

    // --- Renderer / scene ---------------------------------------------------
    const canvas = U.el('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowfx });
    this.renderer.setPixelRatio(this.lowfx ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (!this.lowfx) this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2438);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.copy(this._camPos);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.world = window.SB.createWorld(this.scene, this.rng, { lowfx: this.lowfx });
    this.actors = window.SB.createActors(this, this.world, this.rng, { lowfx: this.lowfx });
    this.missions = window.SB.createMissions(this, this.actors);

    this._wireInput();
    this._wireButtons();
    this.refreshMissionList();
    this._updateHud(true);
    this._applySaveVisibility();

    // Expose the debug API the verification harness drives.
    const self = this;
    window.SUNSET = {
      game: this,
      state: () => self.snapshot(),
      teleport: (x, z) => self.actors.teleport(x, z),
      startMission: (id) => self.missions.start(id),
      setWanted: (n) => self.setWanted(n),
      giveCash: (n) => { self.cash += n; },
    };
  }

  Game.prototype.snapshot = function () {
    const a = this.actors;
    return {
      state: this.state,
      inCar: !!a.playerCar,
      mission: this.missions.id,
      missionStep: this.missions.step,
      objective: this.missions.objective(),
      cash: this.cash,
      completed: this.completed.slice(),
      wanted: this.wanted,
      carHp: a.playerCar ? Math.round(a.playerCar.hp) : 0,
      health: Math.round(a.player.health),
      enemies: a.enemies.filter((e) => e.state !== 'down').length,
      player: { x: Math.round(a.player.x), z: Math.round(a.player.z) },
      police: a.policeCars.length,
      footPolice: this._footPoliceCount(),
    };
  };

  Game.prototype._footPoliceCount = function () {
    if (this.actors.playerCar) return 0;
    let n = 0;
    for (const c of this.actors.policeCars) {
      if (U.dist2(c.x, c.z, this.actors.player.x, this.actors.player.z) < 30) n++;
    }
    return n;
  };

  // --- Money / wanted ---------------------------------------------------------
  Game.prototype.addWanted = function (n) {
    if (this.state !== 'playing') return;
    this.wanted = U.clamp(this.wanted + n, 0, 5);
    this.lastCrimeAt = this.gameTime;
    this._syncPolice();
  };
  Game.prototype.setWanted = function (n) {
    this.wanted = U.clamp(n, 0, 5);
    if (n > 0) this.lastCrimeAt = this.gameTime;
    this._syncPolice();
  };
  Game.prototype._syncPolice = function () {
    const a = this.actors;
    if (this.wanted > 0) {
      a.spawnPolice(this.wanted);
      SB.audio.siren(true);
    } else {
      a.clearPolice();
      SB.audio.siren(false);
    }
  };

  // --- Screens ------------------------------------------------------------------
  Game.prototype._showOnly = function (id) {
    for (const s of ['screen-menu', 'screen-pause', 'screen-end']) {
      U.show(U.el(s), s === id);
    }
  };
  Game.prototype.startGame = function () {
    SB.audio.init();
    SB.audio.resume();
    SB.audio.startMusic();
    this.state = 'playing';
    this._showOnly(null);
    U.el('hud').style.display = 'block';
  };
  Game.prototype.continueGame = function () {
    const save = this._readSave();
    if (save) {
      this.cash = save.cash;
      this.completed = save.completed || [];
      if (save.timeOfDay !== undefined) this.world.setTimeOfDay(save.timeOfDay);
    }
    this.startGame();
  };
  Game.prototype.togglePause = function () {
    if (this.state === 'playing') {
      this.state = 'paused';
      this._showOnly('screen-pause');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this._showOnly(null);
    }
  };
  Game.prototype.onBusted = function () {
    if (this.state !== 'playing') return;
    this.state = 'busted';
    const fine = Math.min(this.cash, 100);
    this.cash -= fine;
    this.setWanted(0);
    U.el('end-title').textContent = 'BUSTED';
    U.el('end-sub').textContent = 'The Sunset Bay PD caught you. Fine paid: $' + fine + '.';
    this._showOnly('screen-end');
    SB.audio.bust();
    this.save();
  };
  Game.prototype.onWasted = function () {
    if (this.state !== 'playing') return;
    this.state = 'wasted';
    U.el('end-title').textContent = 'WASTED';
    U.el('end-sub').textContent = 'Cole Vance is down. The city keeps moving without you.';
    this._showOnly('screen-end');
    SB.audio.fail();
    this.save();
  };
  Game.prototype.onCarWrecked = function (car) {
    const a = this.actors;
    a.player.x = car.x + 2;
    a.player.z = car.z + 2;
    a.playerCar = null;
    a.inMarkedCar = false;
    car.kind = 'wreck';
    this.toast('Your car is wrecked');
    this.actors.damagePlayer(20);
  };
  Game.prototype.respawn = function () {
    this.actors.respawn();
    this.setWanted(0);
    this.state = 'playing';
    this._showOnly(null);
    this.save();
  };

  // --- Save / load ---------------------------------------------------------------
  Game.prototype._readSave = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  Game.prototype.save = function () { this._save(); };
  Game.prototype._save = function () {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: this.cash,
        completed: this.completed,
        timeOfDay: this.world.timeOfDay,
      }));
    } catch (e) {}
  };
  Game.prototype._applySaveVisibility = function () {
    U.el('btn-continue').style.display = this._readSave() ? 'inline-block' : 'none';
  };

  // --- Toasts / dialogue / mission list ----------------------------------------------
  Game.prototype.toast = function (msg) {
    const box = U.el('toasts');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    box.appendChild(div);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 4200);
  };
  Game.prototype.say = function (giver, text) {
    const box = U.el('dialogue');
    if (!box) return;
    box.innerHTML = '<b>' + giver + ':</b> ' + text.replace(/^[^:]+:\s*/, '');
    box.style.display = 'block';
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(() => { box.style.display = 'none'; }, 9000);
  };
  Game.prototype.missionTarget = function () {
    return this.missions.target();
  };
  Game.prototype.refreshMissionList = function () {
    const list = U.el('mission-list');
    if (!list) return;
    list.innerHTML = '';
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const def = this.missions.defs[id];
      const item = document.createElement('div');
      item.className = 'mission-item';
      const status = this.completed.includes(id)
        ? 'Completed'
        : this.missions.id === id ? 'Active — step ' + (this.missions.step + 1) : 'Available';
      item.innerHTML = '<span class="mi-name">' + def.name + '</span>' +
        '<span class="mi-giver">' + def.giver + '</span>' +
        '<span class="mi-reward">$' + def.reward + '</span>' +
        '<span class="mi-status">' + status + '</span>';
      item.onclick = () => { if (this.state === 'playing') this.missions.start(id); };
      list.appendChild(item);
    }
  };

  // --- Input -------------------------------------------------------------------------
  Game.prototype._wireInput = function () {
    const self = this;
    const keymap = {
      KeyW: 'w', ArrowUp: 'w',
      KeyA: 'a', ArrowLeft: 'a',
      KeyS: 's', ArrowDown: 's',
      KeyD: 'd', ArrowRight: 'd',
      ShiftLeft: 'shift', ShiftRight: 'shift',
    };
    window.addEventListener('keydown', (e) => {
      if (e.code in keymap) {
        self.keys[keymap[e.code]] = true;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'KeyE' && self.state === 'playing') {
        if (self.actors.playerCar) self.actors.exitCar();
        else self.actors.stealNearest();
      }
      if (e.code === 'KeyF' && self.state === 'playing' && !self.actors.playerCar) {
        self.actors.punch();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') self.togglePause();
      if (e.code === 'KeyM' && (self.state === 'playing' || self.state === 'paused')) {
        const m = U.el('missions');
        const open = m.style.display !== 'flex';
        U.show(m, open);
        if (open) self.refreshMissionList();
      }
      if (e.code === 'KeyT' && self.state === 'playing') {
        self.world.setTimeOfDay(self.world.timeOfDay + 0.25);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code in keymap) self.keys[keymap[e.code]] = false;
    });
    const canvas = U.el('game-canvas');
    canvas.addEventListener('pointerdown', (e) => {
      self._mouseDown = true;
      self._lastMouseX = e.clientX;
      self._lastMouseY = e.clientY;
    });
    window.addEventListener('pointerup', () => { self._mouseDown = false; });
    window.addEventListener('pointermove', (e) => {
      if (!self._mouseDown) return;
      self.camYaw -= (e.clientX - self._lastMouseX) * 0.005;
      self.camPitch = U.clamp(self.camPitch + (e.clientY - self._lastMouseY) * 0.003, 0.08, 0.9);
      self._lastMouseX = e.clientX;
      self._lastMouseY = e.clientY;
    });
  };

  Game.prototype._wireButtons = function () {
    const self = this;
    U.el('btn-start').addEventListener('click', () => { SB.audio.click(); self.startGame(); });
    U.el('btn-continue').addEventListener('click', () => { SB.audio.click(); self.continueGame(); });
    U.el('btn-resume').addEventListener('click', () => { SB.audio.click(); self.togglePause(); });
    U.el('btn-respawn').addEventListener('click', () => { SB.audio.click(); self.respawn(); });
    U.el('btn-quit').addEventListener('click', () => { self.save(); location.reload(); });
  };

  // --- Per-frame ------------------------------------------------------------------------
  Game.prototype._redLightCheck = function () {
    const pc = this.actors.playerCar;
    if (!pc || this.state !== 'playing') { this.lastJunction = null; return; }
    const rx = U.nearestRoadCoord(pc.x);
    const rz = U.nearestRoadCoord(pc.z);
    const d = U.dist2(pc.x, pc.z, rx, rz);
    const key = rx + ',' + rz;
    if (d < 7 && this.lastJunction !== key) {
      this.lastJunction = key;
      const now = this.gameTime;
      if (!this.junctionCd[key] || now - this.junctionCd[key] > 8) {
        const alongX = Math.abs(Math.sin(pc.heading)) > Math.abs(Math.cos(pc.heading));
        const st = this.world.lightStateAt(rx, rz, alongX);
        if (st === 'red' && Math.abs(pc.speed) > 2) {
          this.junctionCd[key] = now;
          this.addWanted(1);
          this.toast('Ran a red light! +1 star');
        }
      }
    } else if (d > 12) {
      this.lastJunction = null;
    }
  };

  Game.prototype._resprayCheck = function (dt) {
    this.resprayCd = Math.max(0, this.resprayCd - dt);
    const pc = this.actors.playerCar;
    if (!pc || this.state !== 'playing' || this.resprayCd > 0) return;
    const g = U.LANDMARKS.garage;
    if (U.dist2(pc.x, pc.z, g.x, g.z) < 12 && this.wanted > 0 && this.cash >= 150) {
      this.cash -= 150;
      this.setWanted(0);
      this.resprayCd = 2;
      this.toast('Resprayed — the heat is off ($150)');
      SB.audio.cash();
    }
  };

  Game.prototype._updateHud = function (force) {
    const c = this._hudCache;
    const set = (id, v) => {
      if (force || c[id] !== v) {
        c[id] = v;
        const n = U.el(id);
        if (n) n.textContent = v;
      }
    };
    set('hud-cash', '$' + this.cash);
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < this.wanted ? '★' : '☆';
    set('hud-wanted', stars);
    const hp = Math.round(this.actors.player.health);
    set('hud-health', 'HP ' + hp);
    const hb = U.el('hud-healthbar');
    if (hb) hb.style.width = hp + '%';
    set('hud-objective', this.missions.objective());
    const tgt = this.missions.target();
    if (tgt) {
      const d = Math.round(U.dist2(this.actors.player.x, this.actors.player.z, tgt.x, tgt.z));
      set('hud-distance', d + ' m');
    } else {
      set('hud-distance', '');
    }
    const timer = U.el('timer');
    if (timer) {
      if (this.missions.id === 'm3' && this.missions.step === 1 && this.missions.timer > 0) {
        timer.style.display = 'block';
        timer.textContent = '⏱ ' + Math.ceil(this.missions.timer) + 's';
      } else {
        timer.style.display = 'none';
      }
    }
    // Marker beacon follows the mission target.
    if (tgt) this.world.setMarker(tgt.x, tgt.z, true);
    else this.world.setMarker(0, 0, false);
    // Minimap, throttled.
    const now = performance.now();
    if (force || now - this._minimapAt > 150) {
      this._minimapAt = now;
      const mm = U.el('minimap');
      if (mm) {
        const ctx = mm.getContext('2d');
        this.world.drawMinimap(ctx, mm.width, this);
      }
    }
  };

  Game.prototype._updateCamera = function (dt) {
    const a = this.actors;
    const target = new THREE.Vector3(a.player.x, 1.6, a.player.z);
    if (this.state === 'menu') {
      // Slow orbit over the city for the title screen.
      const t = this.gameTime * 0.05;
      const cx = Math.sin(t) * 150, cz = Math.cos(t) * 150;
      this.camera.position.set(cx, 55, cz);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    if (a.playerCar) {
      // Chase camera: ease the yaw behind the car.
      const dyaw = U.angleDiff(a.playerCar.heading, this.camYaw);
      this.camYaw += dyaw * Math.min(1, 2.2 * dt);
    }
    const dist = a.playerCar ? 11.5 : 8;
    const height = a.playerCar ? 4.6 : 3.6;
    const cx = target.x - Math.sin(this.camYaw) * dist;
    const cz = target.z - Math.cos(this.camYaw) * dist;
    const desired = new THREE.Vector3(cx, target.y + height, cz);
    const k = 1 - Math.exp(-8 * dt);
    this._camPos.lerp(desired, k);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(target.x, target.y + 0.6, target.z);
  };

  Game.prototype.frame = function (rawDt) {
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    if (this.state === 'playing') {
      this.gameTime += dt;
      this.world.update(dt);
      const keys = this.keys;
      if (this.shotDrive) keys.w = true;
      this.actors.update(dt, keys);
      if (this.shotDrive) keys.w = false;
      this.missions.update(dt);
      // Wanted decay: one star per 60 s of clean living.
      if (this.wanted > 0 && this.gameTime - this.lastCrimeAt > 60) {
        this.setWanted(this.wanted - 1);
        this.lastCrimeAt = this.gameTime;
      }
      this._resprayCheck(dt);
      this._redLightCheck();
      SB.audio.engine(this.actors.playerCar ? this.actors.playerCar.speed : 0, 26);
    } else {
      // Menu orbit still animates the sky.
      if (this.state === 'menu') {
        this.gameTime += dt;
        this.world.update(dt);
      }
      SB.audio.engine(0, 26);
    }
    this._updateCamera(dt);
    this._updateHud(false);
    this.renderer.render(this.scene, this.camera);
    if (this.shotMode) {
      this.shotFrames++;
      if (this.shotFrames >= 3) window.__shotReady = true;
    }
  };

  // --- Shot modes (for screenshots) ---------------------------------------------------
  Game.prototype.applyShotMode = function () {
    const mode = this.shotMode;
    if (!mode) return;
    if (mode === 'start') return; // title screen as-is
    this.startGame();
    const a = this.actors;
    // Screenshots are taken at bright midday (0.45), not the default
    // golden-hour dusk (0.72), so the city, cars and police read clearly.
    this.world.setTimeOfDay(0.45);
    if (mode === 'drive') {
      // Put Cole in a parked car on a straight road and roll.
      let car = null;
      for (const c of a.cars) {
        if (c.kind === 'parked' && Math.abs(c.x) < 3) { car = c; break; }
      }
      if (!car) car = a.cars.find((c) => c.kind === 'parked');
      if (car) {
        a.teleport(car.x, car.z);
        a.stealNearest();
        this.setWanted(0);
        a.playerCar.heading = 0;
        a.playerCar.speed = 10;
        this.camYaw = 0;
        this.shotDrive = true;
      }
    } else if (mode === 'chase') {
      // Stage the chase on the long east-west road: Cole at (-60, 0)
      // heading east, a cruiser 35 m ahead coming at him, so the frame
      // shows open road and the chase instead of a building wall.
      let car = a.cars.find((c) => c.kind === 'parked');
      if (car) {
        a.teleport(car.x, car.z);
        a.stealNearest();
        this.setWanted(3);
        a.playerCar.x = -60; a.playerCar.z = 0;
        a.playerCar.heading = Math.PI / 2;
        a.playerCar.speed = 12;
        this.camYaw = Math.PI / 2;
        this.shotDrive = true;
        const cop = a.policeCars[0];
        if (cop) {
          cop.x = -25; cop.z = 0;
          cop.heading = -Math.PI / 2;
          cop.speed = 0;
        }
      }
    } else if (mode === 'mission') {
      this.missions.start('m1');
      const car = a.cars.find((c) => c.kind === 'parked');
      if (car) a.teleport(car.x + 2, car.z);
    }
  };

  // Direct views onto the actors, so the debug API and the verification
  // harness can read the same fields the game itself uses.
  Object.defineProperties(Game.prototype, {
    cars: { get: function () { return this.actors.cars; } },
    player: { get: function () { return this.actors.player; } },
    playerCar: { get: function () { return this.actors.playerCar; } },
    policeCars: { get: function () { return this.actors.policeCars; } },
    peds: { get: function () { return this.actors.peds; } },
    enemies: { get: function () { return this.actors.enemies; } },
    crew: { get: function () { return this.actors.crew; } },
    crewInCar: { get: function () { return this.actors.crewInCar; } },
    enemiesDown: { get: function () { return this.actors.enemiesDown; } },
    markedCar: { get: function () { return this.actors.markedCar; } },
    inMarkedCar: { get: function () { return this.actors.inMarkedCar; } },
    health: {
      get: function () { return this.actors.player.health; },
      set: function (v) { this.actors.player.health = v; },
    },
  });

  window.SB.Game = Game;
})();
