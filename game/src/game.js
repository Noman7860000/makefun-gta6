// SUNSET BAY — the game itself: loop, controls, camera, wanted/police, stealing,
// combat, HUD + minimap, missions wiring, save/load, screens, shot modes.
// Classic script, no modules. Depends on SBUtil, SBAudio, SBWorld, SBActors, SBMissions.

(function (global) {
  'use strict';
  const U = global.SBUtil;
  const A = global.SBActors;
  const Audio = global.SBAudio;
  const W = global.SBWorldConst;

  const SAVE_KEY = 'sunsetbay.save.v1';
  const STEP = 1 / 60;

  function Game() {
    this.state = 'menu'; // menu | playing | paused | busted | wasted
    this.cash = 250;
    this.health = 100;
    this.wanted = 0;
    this.coolTimer = 0;
    this.bustTimer = 0;
    this.redLightCooldown = 0;
    this.pedHitCooldown = 0;
    this.lastHurt = 0;
    this.elapsed = 0;
    this.kills = 0;
    this.carsStolen = 0;
    this.distanceDriven = 0;
    this.player = null;
    this.playerCar = null;
    this.cars = [];
    this.peds = [];
    this.policeCars = [];
    this.footPolice = [];
    this.enemies = [];
    this.crew = [];
    this.markedCar = null;
    this.crewInCar = 0;
    this.enemiesDown = 0;
    this.inMarkedCar = false;
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.camDist = 9;
    this.camDistTarget = 9;
    this.shake = 0;
    this.keys = {};
    this.dragging = false;
    this.dragMoved = 0;
    this.mouseDownAt = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.punchCooldown = 0;
    this.enterCooldown = 0;
    this.missionRunner = null;
    this.dialogueQueue = [];
    this.dialogueTimer = 0;
    this.saveTimer = 0;
    this.volume = 0.7;
    this.musicOn = true;
    this.sensitivity = 1.0;
    this.stats = { missionsDone: 0, earned: 0 };
    this.shotMode = null;
    this._shotReady = false;
    this._hud = {};
  }

  // ------------------------------------------------------------- boot ----
  Game.prototype.init = function () {
    const params = new URLSearchParams(window.location.search);
    const seedParam = parseInt(params.get('seed') || '', 10);
    this.seed = Number.isInteger(seedParam) ? seedParam : 1337;
    this.shotMode = params.get('shot');
    // ?lowfx=1 turns shadows and antialiasing off: for headless/software
    // rendering and slower machines. The game still plays identically.
    this.lowfx = params.get('lowfx') === '1';
    this.rng = U.makeRng(this.seed);

    this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: !this.lowfx });
    this.renderer.setPixelRatio(this.lowfx ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lowfx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(0, 20, 40);

    this.world = new global.SBWorld(this.scene, this.seed);
    this.missionRunner = new global.SBMissions.MissionRunner(global.SBMissions.missionList(this.world.landmarks));

    this._buildActors();
    this._buildBeacon();
    this._bindInput();
    this._bindUI();
    this._loadSave();
    this._applySettings();
    this._showMenu();
    this._updateMissionList();

    window.addEventListener('resize', () => this._resize());
    // Expose a debug/test hook (harmless in play).
    const self = this;
    global.SUNSET = {
      game: this,
      state: function () { return self._debugState(); },
      teleport: function (x, z) { self._teleport(x, z); },
      setWanted: function (n) { self.setWanted(n); },
      startMission: function (id) { self.startMission(id); },
      giveCash: function (n) { self.cash += n; },
    };
    // Shot staging: paint twice, then signal ready.
    if (this.shotMode) this._stageShot();
    this._loop(0);
  };

  Game.prototype._resize = function () {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  Game.prototype._buildActors = function () {
    const scene = this.scene, world = this.world, rng = this.rng;
    // Player.
    this.player = A.createPerson(scene, { kind: 'player', shirt: 0xd8d8d8, pants: 0x2a3a5a, skin: 0xc98a5e, hair: 0x201510, x: world.landmarks.plaza.x, z: world.landmarks.plaza.z + 8 });
    this.player.heading = Math.PI;
    // Parked cars.
    const spawns = world.carSpawns.slice();
    for (let i = 0; i < 16; i++) {
      const s = spawns[i % spawns.length];
      const car = A.createCar(scene, world, { kind: 'parked', x: s.x + rng.range(-1, 1), z: s.z + rng.range(-1, 1), heading: s.heading, rng: rng });
      this.cars.push(car);
    }
    // Traffic cars.
    for (let i = 0; i < 10; i++) {
      const c = world.roadCoord(rng.int(0, 8));
      const d = world.roadCoord(rng.int(0, 8));
      const alongX = rng.next() < 0.5;
      const car = A.createCar(scene, world, {
        kind: 'traffic', occupied: true,
        x: alongX ? d : c + (rng.next() < 0.5 ? 1.8 : -1.8),
        z: alongX ? c + (rng.next() < 0.5 ? 1.8 : -1.8) : d,
        heading: alongX ? (rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng.next() < 0.5 ? 0 : Math.PI),
        rng: rng, taxi: rng.next() < 0.15,
      });
      car.route = A.planRoute(world, car);
      this.cars.push(car);
    }
    // Pedestrians.
    for (let i = 0; i < 26; i++) {
      const n = world.pedNodes[rng.int(0, world.pedNodes.length - 1)];
      const p = A.createPerson(scene, {
        kind: 'ped',
        shirt: rng.pick([0xc23a2e, 0x2e6ac2, 0xd8a020, 0x3a9a4a, 0x8a4ac2, 0xd8d8d8, 0x222222]),
        pants: rng.pick([0x2a2a30, 0x3a2a1a, 0x1a2a3a]),
        skin: rng.pick([0xc98a5e, 0x8a5a3a, 0xe8b890, 0x6a4a2a]),
        x: n.x + rng.range(-2, 2), z: n.z + rng.range(-2, 2),
      });
      this.peds.push(p);
    }
  };

  Game.prototype._buildBeacon = function () {
    const geo = new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd800, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = 30;
    this.beacon.visible = false;
    this.scene.add(this.beacon);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 24), new THREE.MeshBasicMaterial({ color: 0xffd800, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    this.beaconRing = ring;
    ring.visible = false;
    this.scene.add(ring);
  };

  // ------------------------------------------------------------- input ---
  Game.prototype._bindInput = function () {
    const self = this;
    const canvas = document.getElementById('game');
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      self.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyP' || e.code === 'Escape') self.togglePause();
      if (e.code === 'KeyM') self.toggleMissionList();
      if (e.code === 'KeyE') self.tryEnterExitCar();
      if (e.code === 'KeyF') self.tryPunch();
      if (e.code === 'KeyH') { if (self.playerCar) Audio.horn(); }
      if (e.code === 'KeyC') self.camDistTarget = self.camDistTarget > 10 ? 8 : 13;
      if (e.code === 'KeyT') { self.world.timeOfDay = (self.world.timeOfDay + 0.12) % 1; self.world.applyTimeOfDay(); self.toast('Time of day changed'); }
      if (e.code === 'Enter' && self.state === 'menu') self.startGame();
    });
    window.addEventListener('keyup', (e) => { self.keys[e.code] = false; });
    canvas.addEventListener('mousedown', (e) => {
      self.dragging = true; self.dragMoved = 0;
      self.mouseDownAt = performance.now();
      self.mouseDownX = e.clientX; self.mouseDownY = e.clientY;
      Audio.init();
    });
    window.addEventListener('mousemove', (e) => {
      if (!self.dragging) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      self.dragMoved += Math.abs(dx) + Math.abs(dy);
      self.camYaw -= dx * 0.005 * self.sensitivity;
      self.camPitch = U.clamp(self.camPitch + dy * 0.003 * self.sensitivity, 0.05, 1.1);
    });
    window.addEventListener('mouseup', (e) => {
      if (self.dragging && self.dragMoved < 6 && performance.now() - self.mouseDownAt < 250) {
        if (self.state === 'playing' && !self.playerCar) self.tryPunch();
      }
      self.dragging = false;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      self.camDistTarget = U.clamp(self.camDistTarget + (e.deltaY > 0 ? 1.5 : -1.5), 6, 16);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  // ------------------------------------------------------------- UI ------
  Game.prototype._el = function (id) { return document.getElementById(id); };
  Game.prototype._bindUI = function () {
    const self = this;
    this._hud = {
      hud: this._el('hud'), healthFill: this._el('health-fill'), healthText: this._el('health-text'),
      cash: this._el('cash'), stars: this._el('stars'), speed: this._el('speed'),
      objective: this._el('objective'), objDist: this._el('obj-dist'),
      minimap: this._el('minimap'), subtitles: this._el('subtitles'),
      subWho: this._el('sub-who'), subText: this._el('sub-text'),
      toasts: this._el('toasts'), progress: this._el('progress'), progressFill: this._el('progress-fill'),
      timer: this._el('timer'), hint: this._el('hint'),
      menu: this._el('menu'), pause: this._el('pause'), end: this._el('end'),
      missions: this._el('missions'), missionList: this._el('mission-list'),
    };
    this._el('btn-start').addEventListener('click', () => { Audio.init(); Audio.click(); self.startGame(); });
    this._el('btn-continue').addEventListener('click', () => { Audio.init(); Audio.click(); self.startGame(true); });
    this._el('btn-missions').addEventListener('click', () => { Audio.init(); Audio.click(); self.toggleMissionList(); });
    this._el('btn-resume').addEventListener('click', () => { Audio.click(); self.togglePause(); });
    this._el('btn-quit').addEventListener('click', () => { Audio.click(); self.quitToMenu(); });
    this._el('btn-respawn').addEventListener('click', () => { Audio.click(); self.respawn(); });
    this._el('btn-end-menu').addEventListener('click', () => { Audio.click(); self.quitToMenu(); });
    this._el('btn-close-missions').addEventListener('click', () => { Audio.click(); self.toggleMissionList(); });
    this._el('vol').addEventListener('input', (e) => { self.volume = parseFloat(e.target.value); Audio.setVolume(self.volume); self._save(); });
    this._el('music').addEventListener('change', (e) => { self.musicOn = e.target.checked; Audio.setMusic(self.musicOn); self._save(); });
    this._el('sens').addEventListener('input', (e) => { self.sensitivity = parseFloat(e.target.value); self._save(); });
  };

  Game.prototype._showMenu = function () {
    this.state = 'menu';
    this._hud.menu.style.display = 'flex';
    this._hud.pause.style.display = 'none';
    this._hud.end.style.display = 'none';
    this._hud.hud.style.display = 'none';
    this._el('btn-continue').style.display = this._saveExists() ? 'block' : 'none';
  };
  Game.prototype._showHUD = function () {
    this._hud.menu.style.display = 'none';
    this._hud.pause.style.display = 'none';
    this._hud.end.style.display = 'none';
    this._hud.missions.style.display = 'none';
    this._hud.hud.style.display = 'block';
  };

  Game.prototype.startGame = function (fromSave) {
    Audio.init();
    if (fromSave) this._loadSave(); else { this.cash = 250; }
    this.health = 100;
    this.wanted = 0;
    this.coolTimer = 0;
    this.state = 'playing';
    this._showHUD();
    this._teleport(this.world.landmarks.plaza.x, this.world.landmarks.plaza.z + 8);
    this.player.heading = Math.PI;
    this.setObjective('Free roam — press M for missions, or steal a car and explore Sunset Bay.', null);
    this.toast('Welcome to Sunset Bay');
    this._save();
  };

  Game.prototype.quitToMenu = function () {
    this._save();
    this.missionRunner.active = false;
    this.missionRunner.current = null;
    this._clearMissionActors();
    this._showMenu();
    this._updateMissionList();
  };

  Game.prototype.respawn = function () {
    const fine = Math.min(this.cash, this.state === 'busted' ? 200 : 100);
    this.cash -= fine;
    this.health = 100;
    this.wanted = 0;
    this.bustTimer = 0;
    if (this.playerCar) { this.playerCar = null; }
    this._teleport(this.world.landmarks.hospital.x, this.world.landmarks.hospital.z);
    this.player.mesh.visible = true;
    this.state = 'playing';
    this._showHUD();
    this.setObjective('Free roam — press M for missions.', null);
    this.toast('You paid a $' + fine + ' fine. Back on the streets.');
    this._save();
  };

  Game.prototype.togglePause = function () {
    if (this.state === 'playing') {
      this.state = 'paused';
      this._hud.pause.style.display = 'flex';
      this._save();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this._hud.pause.style.display = 'none';
    }
  };

  Game.prototype.toggleMissionList = function () {
    if (this.state !== 'playing' && this.state !== 'menu') return;
    const m = this._hud.missions;
    if (m.style.display === 'flex') { m.style.display = 'none'; if (this.state === 'playing') this.state = 'playing'; return; }
    this._updateMissionList();
    m.style.display = 'flex';
  };

  Game.prototype._updateMissionList = function () {
    const list = this._hud.missionList;
    list.innerHTML = '';
    const done = this.missionRunner.completed;
    this.missionRunner.list.forEach((m, i) => {
      const unlocked = i === 0 || done.includes(this.missionRunner.list[i - 1].id);
      const isDone = done.includes(m.id);
      const div = document.createElement('div');
      div.className = 'mission-item' + (isDone ? ' done' : '') + (unlocked ? '' : ' locked');
      div.innerHTML = '<b>' + (i + 1) + '. ' + m.title + '</b> — ' + m.giver +
        '<br><span>' + m.brief + '</span><br><span class="reward">Reward: $' + m.reward +
        (isDone ? ' · COMPLETED' : unlocked ? ' · available' : ' · finish the previous job first') + '</span>';
      if (unlocked) {
        div.addEventListener('click', () => {
          Audio.click();
          this._hud.missions.style.display = 'none';
          if (this.state === 'menu') this.startGame();
          this.startMission(m.id);
        });
      }
      list.appendChild(div);
    });
  };

  Game.prototype.startMission = function (id) {
    if (this.state !== 'playing') return;
    this._clearMissionActors();
    if (this.missionRunner.start(id, this._missionCtx())) {
      this.toast('Mission started: ' + this.missionRunner.current.title);
    }
  };

  Game.prototype._clearMissionActors = function () {
    const remove = (arr) => { while (arr.length) { const a = arr.pop(); this.scene.remove(a.mesh); } };
    remove(this.enemies); remove(this.crew);
    this.enemiesDown = 0; this.crewInCar = 0;
    if (this.markedCar) {
      const i = this.cars.indexOf(this.markedCar);
      if (i >= 0) { this.scene.remove(this.markedCar.mesh); this.cars.splice(i, 1); }
      this.markedCar = null;
    }
    this.inMarkedCar = false;
    this.beacon.visible = false; this.beaconRing.visible = false;
    this._hud.progress.style.display = 'none';
    this._hud.timer.style.display = 'none';
  };

  // --------------------------------------------------------- missions ----
  Game.prototype._missionCtx = function () {
    const self = this;
    return {
      playerPos: { x: this.player.x, z: this.player.z },
      inCar: !!this.playerCar,
      car: this.playerCar,
      wanted: this.wanted,
      inMarkedCar: this.inMarkedCar,
      crewInCar: this.crewInCar,
      enemiesDown: this.enemiesDown,
      setWanted: (n) => self.setWanted(n),
      say: (who, text) => self.say(who, text),
      setObjective: (text, marker) => self.setObjective(text, marker),
      setProgress: (f) => self.setProgress(f),
      setTimer: (s) => self.setTimer(s),
      addCash: (n) => { self.cash += n; self.stats.earned += n; self.stats.missionsDone++; },
      jingle: () => Audio.jingle(),
      spawnEnemies: (at, count) => self._spawnEnemies(at, count),
      spawnCrew: (at, count) => self._spawnCrew(at, count),
      spawnMarkedCar: (at) => self._spawnMarkedCar(at),
      crewBoard: () => self._crewBoard(),
      onFail: (reason) => self._missionFailed(reason),
    };
  };

  Game.prototype._spawnEnemies = function (at, count) {
    for (let i = 0; i < count; i++) {
      const e = A.createPerson(this.scene, {
        kind: 'enemy', enemy: true, hp: 60,
        shirt: 0x1a1a1a, pants: 0x2a2a30, skin: 0xc98a5e,
        x: at.x + this.rng.range(-6, 6), z: at.z + this.rng.range(-6, 6),
      });
      this.enemies.push(e);
    }
  };
  Game.prototype._spawnCrew = function (at, count) {
    for (let i = 0; i < count; i++) {
      const c = A.createPerson(this.scene, {
        kind: 'ped',
        shirt: 0xd8a020, pants: 0x2a2a30, skin: 0x8a5a3a,
        x: at.x + this.rng.range(-5, 5), z: at.z + this.rng.range(-5, 5),
      });
      c.state = 'wait';
      this.crew.push(c);
    }
  };
  Game.prototype._spawnMarkedCar = function (at) {
    const car = A.createCar(this.scene, this.world, {
      kind: 'parked', color: 0xd8a020, maxSpeed: 40,
      x: at.x + 6, z: at.z + 6, heading: Math.PI / 4, rng: this.rng,
    });
    this.markedCar = car;
    this.cars.push(car);
    this.toast('The gold car is parked by the casino');
  };
  Game.prototype._crewBoard = function () {
    // Crew members near the car climb in.
    for (let i = this.crew.length - 1; i >= 0; i--) {
      const c = this.crew[i];
      if (U.dist(c.x, c.z, this.player.x, this.player.z) < 6) {
        this.scene.remove(c.mesh);
        this.crew.splice(i, 1);
        this.crewInCar++;
        Audio.chime();
        this.toast('Crew member got in (' + this.crewInCar + ')');
      }
    }
  };
  Game.prototype._missionFailed = function (reason) {
    this._clearMissionActors();
    this.say('Slim', 'Job blown. ' + reason);
    Audio.sting();
    this.setObjective('Mission failed — press M to try another job.', null);
  };

  // ---------------------------------------------------------- wanted -----
  Game.prototype.setWanted = function (n) {
    n = U.clamp(Math.round(n), 0, 5);
    if (n > this.wanted) this.toast('Wanted level ' + n + (n >= 3 ? ' — the whole city is after you!' : ''));
    this.wanted = n;
    if (n === 0) { this.coolTimer = 0; this.bustTimer = 0; }
  };
  Game.prototype.addWanted = function (n) { this.setWanted(this.wanted + n); };

  // ---------------------------------------------------------- combat -----
  Game.prototype.tryPunch = function () {
    if (this.state !== 'playing' || this.playerCar || this.punchCooldown > 0) return;
    this.punchCooldown = 0.38;
    this.player.punchTimer = 0.35;
    Audio.punch();
    const fx = Math.sin(this.player.heading), fz = Math.cos(this.player.heading);
    const targets = this.peds.concat(this.enemies).concat(this.footPolice);
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead || t.state === 'down') continue;
      const dx = t.x - this.player.x, dz = t.z - this.player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.4 && (dx * fx + dz * fz) / (d || 1) > 0.2) {
        t.hp -= 34;
        t.state = t.kind === 'ped' ? 'flee' : t.state;
        if (t.kind === 'police') this.addWanted(1);
        if (t.hp <= 0) {
          t.state = 'down'; t.downTimer = 5;
          if (t.kind === 'enemy') { this.enemiesDown++; this.kills++; this.toast('Guard down'); }
          if (t.kind === 'police') { this.addWanted(1); }
        } else if (t.kind === 'ped') {
          this.addWanted(1); // assault is a crime — the heat rises
          this.toast('Assault! Wanted +1');
        }
        break;
      }
    }
  };

  Game.prototype.tryEnterExitCar = function () {
    if (this.state !== 'playing' || this.enterCooldown > 0) return;
    this.enterCooldown = 0.4;
    if (this.playerCar) {
      // Get out.
      const car = this.playerCar;
      const side = car.heading + Math.PI / 2;
      const px = car.x + Math.sin(side) * 2.6, pz = car.z + Math.cos(side) * 2.6;
      const res = A.resolveCircleBuilding(this.world, px, pz, 0.6);
      this.player.x = res.x; this.player.z = res.z;
      this.player.y = 0; this.player.vy = 0;
      this.player.heading = car.heading;
      this.player.mesh.visible = true;
      this.playerCar = null;
      this.inMarkedCar = false;
      car.kind = 'parked';
      car.speed = 0;
      Audio.engine(0, false);
      return;
    }
    // Find the nearest enterable car.
    let best = null, bd = 16;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.dead || c.hp <= 0) continue;
      if (c.kind === 'police') continue;
      if (c.kind === 'traffic' && Math.abs(c.speed) > 2.5) continue;
      const d2 = U.dist2(this.player.x, this.player.z, c.x, c.z);
      if (d2 < bd) { bd = d2; best = c; }
    }
    if (!best) { this.toast('No car close enough'); return; }
    if (best.kind === 'traffic' && best.occupied) {
      // Yank the driver out.
      best.occupied = false;
      const driver = A.createPerson(this.scene, { kind: 'ped', shirt: 0x6a6a6a, x: best.x + 2, z: best.z + 2 });
      driver.state = 'flee';
      this.peds.push(driver);
      this.addWanted(1);
      this.carsStolen++;
      this.toast('Car stolen! Wanted +1');
      Audio.sting();
    } else if (best.kind === 'parked') {
      this.carsStolen++;
      this.addWanted(1);
      this.toast('Car stolen! Wanted +1');
    }
    this.playerCar = best;
    best.kind = 'player';
    best.speed = 0;
    this.player.mesh.visible = false;
    if (best === this.markedCar) this.inMarkedCar = true;
    Audio.chime();
  };

  // ---------------------------------------------------------- dialogue ---
  Game.prototype.say = function (who, text) {
    this.dialogueQueue.push({ who: who, text: text });
  };
  Game.prototype.setObjective = function (text, marker) {
    this._hud.objective.textContent = text;
    if (marker) {
      this.beacon.position.x = marker.x; this.beacon.position.z = marker.z;
      this.beaconRing.position.x = marker.x; this.beaconRing.position.z = marker.z;
      this.beacon.visible = true; this.beaconRing.visible = true;
      this.marker = marker;
    } else {
      this.beacon.visible = false; this.beaconRing.visible = false;
      this.marker = null;
    }
    this._updateObjDist();
  };
  Game.prototype._updateObjDist = function () {
    if (!this.marker) { this._hud.objDist.textContent = ''; return; }
    const d = Math.round(U.dist(this.player.x, this.player.z, this.marker.x, this.marker.z));
    this._hud.objDist.textContent = d + 'm';
  };
  Game.prototype.setProgress = function (f) {
    const p = this._hud.progress;
    if (f <= 0) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    this._hud.progressFill.style.width = Math.round(f * 100) + '%';
  };
  Game.prototype.setTimer = function (s) {
    const t = this._hud.timer;
    if (s <= 0) { t.style.display = 'none'; return; }
    t.style.display = 'block';
    t.textContent = '⏱ ' + U.fmtTime(s);
    t.style.color = s < 15 ? '#ff5555' : '#ffd800';
  };
  Game.prototype.toast = function (msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this._hud.toasts.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3400);
    while (this._hud.toasts.children.length > 4) this._hud.toasts.removeChild(this._hud.toasts.firstChild);
  };

  // ------------------------------------------------------------- save ----
  Game.prototype._saveExists = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };
  Game.prototype._save = function () {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, cash: this.cash, completed: this.missionRunner.completed,
        volume: this.volume, musicOn: this.musicOn, sensitivity: this.sensitivity,
      }));
    } catch (e) { /* storage unavailable — play on without saving */ }
  };
  Game.prototype._loadSave = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.cash === 'number') this.cash = s.cash;
      if (Array.isArray(s.completed)) this.missionRunner.completed = s.completed.slice();
      if (typeof s.volume === 'number') this.volume = s.volume;
      if (typeof s.musicOn === 'boolean') this.musicOn = s.musicOn;
      if (typeof s.sensitivity === 'number') this.sensitivity = s.sensitivity;
    } catch (e) { /* corrupted save — start fresh */ }
  };
  Game.prototype._applySettings = function () {
    const vol = this._el('vol'); if (vol) vol.value = this.volume;
    const mus = this._el('music'); if (mus) mus.checked = this.musicOn;
    const sen = this._el('sens'); if (sen) sen.value = this.sensitivity;
    Audio.setVolume(this.volume);
  };

  // ------------------------------------------------------------- loop ----
  Game.prototype._loop = function (t) {
    requestAnimationFrame((nt) => this._loop(nt));
    const now = t / 1000;
    if (!this._lastT) this._lastT = now;
    let dt = Math.min(now - this._lastT, 0.1);
    this._lastT = now;
    if (this.state === 'playing' || this.state === 'menu') {
      this._acc = (this._acc || 0) + dt;
      let steps = 0;
      while (this._acc >= STEP && steps < 8) {
        this._step(STEP, this.state === 'menu');
        this._acc -= STEP;
        steps++;
      }
      if (steps === 8) this._acc = 0;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.shotMode && !this._shotReady) {
      this._shotFrames = (this._shotFrames || 0) + 1;
      if (this._shotFrames >= 3) { this._shotReady = true; window.__shotReady = true; }
    }
  };

  Game.prototype._step = function (dt, attract) {
    this.elapsed += dt;
    this.world.update(dt);
    // Slow day cycle: full loop ~9 minutes.
    this.world.timeOfDay = (this.world.timeOfDay + dt / 540) % 1;
    if (Math.abs(this.world.timeOfDay - (this._lastTOD || 0)) > 0.002) {
      this.world.applyTimeOfDay();
      this._lastTOD = this.world.timeOfDay;
    }
    // Traffic + peds always live (attract mode behind the menu too).
    this._updateTraffic(dt);
    this._updatePeds(dt);
    this._updatePolice(dt);
    if (attract) {
      // Slow cinematic orbit for the menu backdrop.
      const a = this.elapsed * 0.05;
      this.camera.position.set(Math.sin(a) * 90, 45, Math.cos(a) * 90);
      this.camera.lookAt(0, 5, 0);
      this._updateHUD();
      return;
    }
    this._updatePlayer(dt);
    this._updateMissions(dt);
    this._updateWanted(dt);
    this._updateCamera(dt);
    this._updateAudio(dt);
    this._updateHUD();
    this._updateDialogue(dt);
    this.saveTimer += dt;
    if (this.saveTimer > 8) { this.saveTimer = 0; this._save(); }
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.enterCooldown > 0) this.enterCooldown -= dt;
    if (this.redLightCooldown > 0) this.redLightCooldown -= dt;
    if (this.pedHitCooldown > 0) this.pedHitCooldown -= dt;
  };

  Game.prototype._updatePlayer = function (dt) {
    const p = this.player;
    if (this.playerCar) {
      const car = this.playerCar;
      const input = {
        throttle: (this.keys.KeyW || this.keys.ArrowUp) ? 1 : 0,
        brake: (this.keys.KeyS || this.keys.ArrowDown) ? 1 : 0,
        steer: ((this.keys.KeyA || this.keys.ArrowLeft) ? -1 : 0) + ((this.keys.KeyD || this.keys.ArrowRight) ? 1 : 0),
      };
      // Note: steering sign — heading grows clockwise seen from above; D should turn right.
      const before = { x: car.x, z: car.z };
      const events = [];
      A.driveCar(car, this.world, input, dt, events);
      this.distanceDriven += U.dist(before.x, before.z, car.x, car.z);
      for (let i = 0; i < events.length; i++) {
        if (events[i].type === 'crash') { Audio.crash(events[i].intensity); this.shake = Math.max(this.shake, events[i].intensity * 0.5); car.hp -= events[i].intensity * 14; }
      }
      // Skid sound on hard steering at speed.
      Audio.skid(Math.abs(car.steer) > 0.7 && Math.abs(car.speed) > 14);
      // Car vs traffic cars.
      this._carCollisions(car, dt);
      // Pedestrians hit by the player car.
      for (let i = 0; i < this.peds.length; i++) {
        const ped = this.peds[i];
        if (ped.dead || ped.state === 'down') continue;
        if (U.dist(car.x, car.z, ped.x, ped.z) < 2.6 && Math.abs(car.speed) > 6) {
          ped.state = 'down'; ped.downTimer = 6; ped.hp = 0;
          Audio.crash(0.8);
          this.shake = Math.max(this.shake, 0.6);
          car.speed *= 0.6;
          if (this.pedHitCooldown <= 0) { this.addWanted(1); this.pedHitCooldown = 2; this.toast('Pedestrian hit! Wanted +1'); }
        }
      }
      // Red light running.
      if (this.redLightCooldown <= 0 && Math.abs(car.speed) > 5) {
        const near = this.world.lightStateAt(car.x, car.z, Math.abs(Math.cos(car.heading)) < 0.5);
        const onRoadX = Math.abs(car.x - this.world.nearestRoad(car.x)) < 8;
        const onRoadZ = Math.abs(car.z - this.world.nearestRoad(car.z)) < 8;
        if (near === 'red' && onRoadX && onRoadZ) {
          this.addWanted(1);
          this.redLightCooldown = 6;
          this.toast('Ran a red light! Wanted +1');
        }
      }
      // Respray garage clears wanted.
      const g = this.world.landmarks.garage;
      if (this.wanted > 0 && this.cash >= 150 && U.dist(car.x, car.z, g.x, g.z) < 9) {
        this.cash -= 150;
        this.setWanted(0);
        this.toast('Respray complete — heat cleared ($150)');
        Audio.chime();
      }
      // Wrecked car.
      if (car.hp <= 0) {
        car.speed = 0;
        this.toast('Your car is wrecked — get out!');
      }
      // Sync player position to the car.
      p.x = car.x; p.z = car.z;
      p.heading = car.heading;
      this._updateObjDist();
      return;
    }
    // On foot.
    Audio.skid(false);
    const fwd = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const right = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
    let mx = 0, mz = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) { mx += fwd.x; mz += fwd.z; }
    if (this.keys.KeyS || this.keys.ArrowDown) { mx -= fwd.x; mz -= fwd.z; }
    if (this.keys.KeyD || this.keys.ArrowRight) { mx += right.x; mz += right.z; }
    if (this.keys.KeyA || this.keys.ArrowLeft) { mx -= right.x; mz -= right.z; }
    const moving = (mx !== 0 || mz !== 0);
    const run = this.keys.ShiftLeft || this.keys.ShiftRight;
    const speed = run ? 9 : 5;
    if (moving) {
      const len = Math.sqrt(mx * mx + mz * mz);
      mx /= len; mz /= len;
      p.heading = U.angleLerp(p.heading, Math.atan2(mx, mz), U.clamp(12 * dt, 0, 1));
      p.speed = speed;
      const nx = p.x + mx * speed * dt;
      const nz = p.z + mz * speed * dt;
      const res = A.resolveCircleBuilding(this.world, nx, nz, 0.6);
      p.x = res.x; p.z = res.z;
    } else p.speed = 0;
    // Jump + gravity.
    if ((this.keys.Space) && p.y === 0) { p.vy = 7.5; }
    if (p.y > 0 || p.vy !== 0) {
      p.vy -= 22 * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; }
    }
    // Traffic cars can knock the player down. Police cars never do — they
    // arrest you (bust timer), they don't run you down.
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c === this.playerCar || c.dead || c.kind === 'police') continue;
      if (U.dist(p.x, p.z, c.x, c.z) < 2.4 && Math.abs(c.speed) > 4) {
        this._hurtPlayer(12);
        p.x += Math.sin(c.heading) * 2; p.z += Math.cos(c.heading) * 2;
        Audio.crash(0.5);
        this.shake = 0.5;
      }
    }
    // Health regen after 6s calm.
    if (this.elapsed - this.lastHurt > 6 && this.health < 100) this.health = Math.min(100, this.health + 3 * dt);
    A.animatePerson(p, dt, moving);
    A.syncPersonMesh(p);
    this._updateObjDist();
  };

  Game.prototype._hurtPlayer = function (dmg) {
    if (this.state !== 'playing') return;
    this.health -= dmg;
    this.lastHurt = this.elapsed;
    Audio.hurt();
    this.shake = Math.max(this.shake, 0.35);
    if (this.health <= 0) {
      this.health = 0;
      this._wasted();
    }
  };

  Game.prototype._carCollisions = function (car, dt) {
    for (let i = 0; i < this.cars.length; i++) {
      const o = this.cars[i];
      if (o === car || o.dead) continue;
      const ov = A.circleOverlap(car.x, car.z, 2.2, o.x, o.z, 2.2);
      if (!ov) continue;
      // Push apart, exchange a little speed, damage both.
      car.x += ov.nx * ov.depth * 0.6; car.z += ov.nz * ov.depth * 0.6;
      o.x -= ov.nx * ov.depth * 0.4; o.z -= ov.nz * ov.depth * 0.4;
      const closing = Math.abs(car.speed - o.speed);
      if (closing > 5) {
        Audio.crash(U.clamp(closing / 25, 0.2, 1));
        this.shake = Math.max(this.shake, 0.4);
        // Police-vs-player-car contact never deals crash damage: the ram
        // rule in _updatePolice is the only police damage, so a patrol car
        // cannot grind a stopped car to dust by repeatedly driving into it.
        const policeHit = (car === this.playerCar && o.kind === 'police') || (o === this.playerCar && car.kind === 'police');
        if (!policeHit) {
          car.hp -= closing * 0.5;
          o.hp -= closing * 0.5;
        }
        car.speed *= 0.55;
        o.speed *= 0.6;
        if (o.kind === 'traffic') { o.route = null; }
      }
    }
  };

  Game.prototype._updateTraffic = function (dt) {
    const px = this.player.x, pz = this.player.z;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.kind !== 'traffic') continue;
      if (c.hp <= 0) { c.dead = true; c.speed = 0; continue; }
      // Recycle far-away traffic near the player to keep streets alive.
      if (U.dist(c.x, c.z, px, pz) > 280) {
        const rc = this.world.roadCoord(this.rng.int(1, 7));
        const rd = this.world.roadCoord(this.rng.int(1, 7));
        c.x = rc; c.z = rd; c.route = null; c.speed = 0;
      }
      // Pedestrian directly ahead?
      c.nearPed = false;
      for (let j = 0; j < this.peds.length; j++) {
        const p = this.peds[j];
        if (p.dead || p.state === 'down') continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        const fwd = dx * Math.sin(c.heading) + dz * Math.cos(c.heading);
        const side = Math.abs(dx * Math.cos(c.heading) - dz * Math.sin(c.heading));
        if (fwd > 0 && fwd < 9 && side < 2.5) { c.nearPed = true; break; }
      }
      A.updateTrafficCar(c, this.world, this.cars, dt, { x: px, z: pz });
    }
  };

  Game.prototype._updatePeds = function (dt) {
    const danger = this.playerCar ? { x: this.playerCar.x, z: this.playerCar.z } : { x: this.player.x, z: this.player.z };
    const dangerR = this.playerCar ? 14 : 6;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (p.dead) { this.scene.remove(p.mesh); this.peds.splice(i, 1); continue; }
      A.updatePed(p, this.world, dt, danger, dangerR);
    }
    // Keep the streets populated.
    if (this.peds.length < 22 && Math.random() < dt * 0.5) {
      const n = this.world.pedNodes[this.rng.int(0, this.world.pedNodes.length - 1)];
      const near = U.dist(n.x, n.z, this.player.x, this.player.z);
      if (near < 160 && near > 40) {
        this.peds.push(A.createPerson(this.scene, {
          kind: 'ped',
          shirt: this.rng.pick([0xc23a2e, 0x2e6ac2, 0xd8a020, 0x3a9a4a, 0x8a4ac2, 0xd8d8d8]),
          x: n.x, z: n.z,
        }));
      }
    }
    // Enemies + crew.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.scene.remove(e.mesh); this.enemies.splice(i, 1); continue; }
      A.updateEnemy(e, this.world, this.player.x, this.player.z, dt, this._eventSink());
    }
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (c.state === 'wait') {
        // Walk toward the player's car when it is near.
        if (this.playerCar && U.dist(c.x, c.z, this.player.x, this.player.z) < 16) {
          const want = Math.atan2(this.player.x - c.x, this.player.z - c.z);
          c.heading = U.angleLerp(c.heading, want, U.clamp(4 * dt, 0, 1));
          c.speed = 4;
          c.x += Math.sin(c.heading) * c.speed * dt;
          c.z += Math.cos(c.heading) * c.speed * dt;
          A.animatePerson(c, dt, true);
          A.syncPersonMesh(c);
        } else { A.animatePerson(c, dt, false); }
      }
    }
  };

  Game.prototype._eventSink = function () {
    const self = this;
    return {
      push: function (ev) {
        if (ev.type === 'playerHit') self._hurtPlayer(ev.damage);
      },
    };
  };

  Game.prototype._updatePolice = function (dt) {
    const px = this.player.x, pz = this.player.z;
    const wantCars = this.wanted === 0 ? 0 : Math.min(1 + Math.floor(this.wanted / 2), 3);
    const wantFoot = this.wanted >= 3 ? Math.min(this.wanted - 2, 3) : (this.wanted >= 2 ? 1 : 0);
    // Spawn police cars as needed.
    while (this.policeCars.length < wantCars) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(45, 75);
      const x = U.clamp(px + Math.sin(a) * d, -W.HALF, W.HALF);
      const z = U.clamp(pz + Math.cos(a) * d, -W.HALF, W.HALF);
      const car = A.createCar(this.scene, this.world, {
        kind: 'police', color: 0xe8e8e8, maxSpeed: 38, police: true,
        x: this.world.nearestRoad(x), z: this.world.nearestRoad(z), rng: this.rng,
      });
      car.heading = Math.atan2(px - car.x, pz - car.z);
      this.policeCars.push(car);
      this.cars.push(car);
    }
    while (this.footPolice.length < wantFoot) {
      const a = this.rng.range(0, Math.PI * 2);
      const p = A.createPerson(this.scene, {
        kind: 'police', police: true, hp: 120,
        shirt: 0x1a2a6a, pants: 0x1a1a22,
        x: px + Math.sin(a) * 30, z: pz + Math.cos(a) * 30,
      });
      this.footPolice.push(p);
    }
    // Update police cars.
    for (let i = this.policeCars.length - 1; i >= 0; i--) {
      const car = this.policeCars[i];
      if (this.wanted === 0 || U.dist(car.x, car.z, px, pz) > 260) {
        this.scene.remove(car.mesh);
        const ci = this.cars.indexOf(car);
        if (ci >= 0) this.cars.splice(ci, 1);
        this.policeCars.splice(i, 1);
        continue;
      }
      const events = [];
      A.updatePoliceCar(car, this.world, px, pz, dt, events, !this.playerCar);
      for (let j = 0; j < events.length; j++) if (events[j].type === 'crash') Audio.crash(0.3);
      // Ramming the player's car damages it — hard enough to threaten a
      // chase (about 20s of two cars ramming to wreck), not so hard that a
      // mission escape is over the moment the police catch up.
      if (this.playerCar && U.dist(car.x, car.z, this.playerCar.x, this.playerCar.z) < 4.6) {
        this.playerCar.hp -= 2.5 * dt;
        this.shake = Math.max(this.shake, 0.25);
        if (Math.random() < dt * 2) Audio.crash(0.3);
      }
    }
    // Foot police.
    for (let i = this.footPolice.length - 1; i >= 0; i--) {
      const p = this.footPolice[i];
      if (this.wanted === 0 || U.dist(p.x, p.z, px, pz) > 120) {
        this.scene.remove(p.mesh);
        this.footPolice.splice(i, 1);
        continue;
      }
      if (p.dead) { this.scene.remove(p.mesh); this.footPolice.splice(i, 1); continue; }
      A.updateFootPolice(p, this.world, px, pz, dt, this._eventSink());
    }
  };

  Game.prototype._updateMissions = function (dt) {
    if (!this.missionRunner.active) return;
    const ctx = this._missionCtx();
    ctx.playerPos = { x: this.player.x, z: this.player.z };
    ctx.inCar = !!this.playerCar;
    ctx.car = this.playerCar;
    ctx.wanted = this.wanted;
    ctx.inMarkedCar = this.inMarkedCar;
    ctx.crewInCar = this.crewInCar;
    ctx.enemiesDown = this.enemiesDown;
    this.missionRunner.update(dt, ctx);
  };

  Game.prototype._updateWanted = function (dt) {
    if (this.wanted === 0) return;
    // Nearest police distance.
    let nearest = 1e9;
    for (let i = 0; i < this.policeCars.length; i++) nearest = Math.min(nearest, U.dist(this.policeCars[i].x, this.policeCars[i].z, this.player.x, this.player.z));
    for (let i = 0; i < this.footPolice.length; i++) nearest = Math.min(nearest, U.dist(this.footPolice[i].x, this.footPolice[i].z, this.player.x, this.player.z));
    if (nearest > 70) {
      this.coolTimer += dt;
      if (this.coolTimer > 18) { this.setWanted(this.wanted - 1); this.toast('Heat cooling off…'); }
    } else this.coolTimer = 0;
    // Busted checks.
    if (!this.playerCar) {
      let close = false;
      for (let i = 0; i < this.footPolice.length; i++) if (U.dist(this.footPolice[i].x, this.footPolice[i].z, this.player.x, this.player.z) < 2.4) close = true;
      for (let i = 0; i < this.policeCars.length; i++) if (U.dist(this.policeCars[i].x, this.policeCars[i].z, this.player.x, this.player.z) < 3.2) close = true;
      if (close) {
        this.bustTimer += dt;
        if (this.bustTimer > 1.4) this._busted();
      } else this.bustTimer = Math.max(0, this.bustTimer - dt);
    } else {
      const car = this.playerCar;
      let pinned = false;
      if (car.hp <= 0) pinned = true;
      for (let i = 0; i < this.policeCars.length; i++) {
        if (Math.abs(car.speed) < 1 && U.dist(this.policeCars[i].x, this.policeCars[i].z, car.x, car.z) < 5) pinned = true;
      }
      if (pinned) {
        this.bustTimer += dt;
        if (this.bustTimer > 2.5) this._busted();
      } else this.bustTimer = Math.max(0, this.bustTimer - dt);
    }
  };

  Game.prototype._busted = function () {
    this.state = 'busted';
    this._hud.end.style.display = 'flex';
    this._el('end-title').textContent = 'BUSTED!';
    this._el('end-text').textContent = 'The Sunset Bay PD caught up with you. The city never forgets — but it does forgive, for a price.';
    this._el('end-stats').textContent = 'Cash: ' + U.fmtMoney(this.cash) + '  ·  Missions done: ' + this.stats.missionsDone + '  ·  Cars stolen: ' + this.carsStolen + '  ·  Distance driven: ' + Math.round(this.distanceDriven) + 'm';
    Audio.sting();
    this._save();
  };
  Game.prototype._wasted = function () {
    this.state = 'wasted';
    this._hud.end.style.display = 'flex';
    this._el('end-title').textContent = 'WASTED';
    this._el('end-text').textContent = 'You got beaten down in the streets of Sunset Bay. The hospital patched you up — the bill is on you.';
    this._el('end-stats').textContent = 'Cash: ' + U.fmtMoney(this.cash) + '  ·  Missions done: ' + this.stats.missionsDone + '  ·  Cars stolen: ' + this.carsStolen + '  ·  Distance driven: ' + Math.round(this.distanceDriven) + 'm';
    Audio.sting();
    this._save();
  };

  Game.prototype._updateCamera = function (dt) {
    const target = this.playerCar
      ? { x: this.playerCar.x, z: this.playerCar.z, y: 1.2 }
      : { x: this.player.x, z: this.player.z, y: 1.6 };
    // When driving, ease the camera yaw behind the car unless the user is dragging.
    // camYaw is the direction the camera LOOKS, and the camera sits opposite it,
    // so "behind the car" means camYaw equals the car heading.
    if (this.playerCar && !this.dragging) {
      const behind = this.playerCar.heading;
      this.camYaw = U.angleLerp(this.camYaw, behind, U.clamp(1.1 * dt, 0, 1));
    }
    this.camDist = U.damp(this.camDist, this.camDistTarget, 5, dt);
    const dist = this.playerCar ? this.camDist + 3 : this.camDist;
    const cx = target.x - Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cz = target.z - Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cy = target.y + Math.sin(this.camPitch) * dist + 1.2;
    this.camera.position.x = U.damp(this.camera.position.x, cx, 8, dt);
    this.camera.position.y = U.damp(this.camera.position.y, cy, 8, dt);
    this.camera.position.z = U.damp(this.camera.position.z, cz, 8, dt);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    const lookX = target.x + Math.sin(this.camYaw) * 4;
    const lookZ = target.z + Math.cos(this.camYaw) * 4;
    this.camera.lookAt(lookX, target.y + 0.6, lookZ);
    // Beacon pulse.
    if (this.beacon.visible) {
      const s = 1 + Math.sin(this.elapsed * 4) * 0.12;
      this.beacon.scale.set(s, 1, s);
      this.beacon.material.opacity = 0.18 + Math.sin(this.elapsed * 4) * 0.06;
    }
  };

  Game.prototype._updateAudio = function (dt) {
    if (!Audio.ctx) return;
    if (this.playerCar) Audio.engine(U.clamp(Math.abs(this.playerCar.speed) / this.playerCar.maxSpeed, 0, 1), true);
    else Audio.engine(0, false);
    let nearest = 1e9;
    for (let i = 0; i < this.policeCars.length; i++) nearest = Math.min(nearest, U.dist(this.policeCars[i].x, this.policeCars[i].z, this.player.x, this.player.z));
    Audio.siren(this.wanted > 0 && nearest < 120, nearest);
  };

  Game.prototype._updateDialogue = function (dt) {
    if (this.dialogueQueue.length === 0) {
      if (this._hud.subtitles.style.display !== 'none') this._hud.subtitles.style.display = 'none';
      return;
    }
    this.dialogueTimer -= dt;
    if (this.dialogueTimer <= 0) {
      const line = this.dialogueQueue.shift();
      this._hud.subWho.textContent = line.who;
      this._hud.subText.textContent = line.text;
      this._hud.subtitles.style.display = 'block';
      this.dialogueTimer = 3.4;
    }
  };

  // ------------------------------------------------------------- HUD -----
  Game.prototype._updateHUD = function () {
    const h = this._hud;
    if (this.state === 'menu') return;
    h.healthFill.style.width = Math.max(0, this.health) + '%';
    h.healthFill.style.background = this.health > 50 ? '#3ac25e' : this.health > 25 ? '#d8a020' : '#c23a2e';
    h.healthText.textContent = Math.ceil(this.health);
    h.cash.textContent = U.fmtMoney(this.cash);
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < this.wanted ? '★' : '☆';
    h.stars.textContent = stars;
    h.stars.style.color = this.wanted > 0 ? '#ffd800' : '#888888';
    h.speed.textContent = this.playerCar ? Math.round(Math.abs(this.playerCar.speed) * 3.6) + ' km/h' : '';
    const hint = this.playerCar
      ? 'E exit car · H horn · C camera · P pause'
      : 'WASD move · Shift run · Space jump · E steal car · F punch · M missions';
    h.hint.textContent = hint;
    this._drawMinimap();
  };

  Game.prototype._drawMinimap = function () {
    const c = this._hud.minimap;
    if (!c) return;
    const g = c.getContext('2d');
    const S = c.width;
    const scale = S / (W.HALF * 2 + 40);
    const toX = (x) => S / 2 + x * scale;
    const toZ = (z) => S / 2 + z * scale;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#101018';
    g.fillRect(0, 0, S, S);
    // Buildings.
    g.fillStyle = '#3a3a48';
    for (let i = 0; i < this.world.buildings.length; i++) {
      const b = this.world.buildings[i];
      g.fillRect(toX(b.minX), toZ(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    }
    // Roads.
    g.strokeStyle = '#5a5a68';
    g.lineWidth = Math.max(1, 14 * scale);
    for (let i = 0; i < this.world.roads.length; i++) {
      const r = this.world.roads[i];
      g.beginPath(); g.moveTo(toX(r.x1), toZ(r.z1)); g.lineTo(toX(r.x2), toZ(r.z2)); g.stroke();
    }
    // Beach + ocean.
    g.fillStyle = '#c2a878';
    g.fillRect(0, toZ(W.HALF), S, S - toZ(W.HALF));
    g.fillStyle = '#1a5a8a';
    g.fillRect(0, toZ(W.HALF + 70), S, S - toZ(W.HALF + 70));
    // Mission marker.
    if (this.marker) {
      const pulse = 4 + Math.sin(this.elapsed * 5) * 1.5;
      g.fillStyle = '#ffd800';
      g.beginPath(); g.arc(toX(this.marker.x), toZ(this.marker.z), pulse + 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#101018';
      g.beginPath(); g.arc(toX(this.marker.x), toZ(this.marker.z), pulse, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd800';
      g.beginPath(); g.arc(toX(this.marker.x), toZ(this.marker.z), 2.5, 0, Math.PI * 2); g.fill();
    }
    // Traffic cars.
    g.fillStyle = '#cccccc';
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.kind === 'police') continue;
      g.fillRect(toX(car.x) - 1.5, toZ(car.z) - 1.5, 3, 3);
    }
    // Police (flashing).
    const flash = Math.sin(this.elapsed * 8) > 0;
    g.fillStyle = flash ? '#ff3333' : '#3388ff';
    for (let i = 0; i < this.policeCars.length; i++) {
      const car = this.policeCars[i];
      g.beginPath(); g.arc(toX(car.x), toZ(car.z), 3.5, 0, Math.PI * 2); g.fill();
    }
    // Player arrow.
    const px = toX(this.player.x), pz = toZ(this.player.z);
    const heading = this.playerCar ? this.playerCar.heading : this.player.heading;
    g.save();
    g.translate(px, pz);
    g.rotate(Math.atan2(Math.sin(heading), Math.cos(heading)) + Math.PI);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
    // North marker.
    g.fillStyle = '#888888';
    g.font = 'bold 10px Arial';
    g.fillText('N', S - 12, 12);
  };

  // ----------------------------------------------------------- shots -----
  Game.prototype._stageShot = function () {
    const mode = this.shotMode;
    // Golden-hour light for every shot, and stage near the city centre so
    // buildings frame the car on both sides.
    this.world.timeOfDay = 0.74;
    this.world.applyTimeOfDay();
    const parked = this.cars.filter((c) => c.kind === 'parked');
    const nearCentre = parked.slice().sort((a, b) => (Math.abs(a.x) + Math.abs(a.z)) - (Math.abs(b.x) + Math.abs(b.z)))[0];
    // Start the game immediately so the world is live behind the shot.
    this.startGame();
    if (mode === 'start') {
      this._showMenu();
      return;
    }
    if (mode === 'drive') {
      const car = nearCentre;
      if (car) {
        this._teleport(car.x, car.z);
        this.tryEnterExitCar();
        this.playerCar.speed = 22;
        this.camYaw = this.playerCar.heading;
        this.camPitch = 0.16;
        this.camDistTarget = 9;
      }
    } else if (mode === 'chase') {
      const car = nearCentre;
      if (car) {
        this._teleport(car.x, car.z);
        this.tryEnterExitCar();
        this.playerCar.speed = 26;
        this.camYaw = this.playerCar.heading;
        this.camPitch = 0.16;
        this.camDistTarget = 9;
      }
      this.setWanted(3);
    } else if (mode === 'mission') {
      this.startMission('m1');
      const car = nearCentre;
      if (car) {
        this._teleport(car.x, car.z);
        this.tryEnterExitCar();
        this.playerCar.speed = 16;
        this.camYaw = this.playerCar.heading;
        this.camPitch = 0.18;
        this.camDistTarget = 9;
      }
    }
    // Let the camera settle for a couple of frames before the screenshot.
    this._shotFrames = 0;
  };

  Game.prototype._teleport = function (x, z) {
    this.player.x = x; this.player.z = z;
    this.player.y = 0; this.player.vy = 0;
    A.syncPersonMesh(this.player);
    // Snap the camera behind the player so shots are framed immediately.
    this.camYaw = this.player.heading + Math.PI;
    this.camera.position.set(x - Math.sin(this.camYaw) * 10, 8, z - Math.cos(this.camYaw) * 10);
    this.camera.lookAt(x, 2, z);
  };

  Game.prototype._debugState = function () {
    return {
      state: this.state,
      cash: this.cash,
      health: Math.round(this.health),
      wanted: this.wanted,
      inCar: !!this.playerCar,
      carSpeed: this.playerCar ? Math.round(this.playerCar.speed * 10) / 10 : 0,
      carHp: this.playerCar ? Math.round(this.playerCar.hp) : null,
      player: { x: Math.round(this.player.x), z: Math.round(this.player.z) },
      cars: this.cars.length,
      traffic: this.cars.filter((c) => c.kind === 'traffic').length,
      police: this.policeCars.length,
      footPolice: this.footPolice.length,
      peds: this.peds.length,
      enemies: this.enemies.length,
      mission: this.missionRunner.current ? this.missionRunner.current.id : null,
      missionStep: this.missionRunner.stepIdx,
      completed: this.missionRunner.completed.slice(),
      objective: this._hud.objective ? this._hud.objective.textContent : '',
    };
  };

  global.SBGame = Game;
})(window);
