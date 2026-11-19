// SUNSET BAY — game.js
// The Game class: the state machine (menu / playing / paused / busted /
// wasted), the player on foot and in a car, combat, the wanted level and
// the police, the respray garage, red lights, the HUD and minimap, saving
// and loading, the camera, and the debug API the verification harnesses use.
(function () {
  'use strict';
  var U = window.SB.util;
  var W = window.SB.world;
  var A = window.SB.actors;

  var SAVE_KEY = 'sunsetbay-save-v1';

  function Game(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.lowfx = !!opts.lowfx;
    this.shotMode = opts.shot || null;
    this.seed = opts.seed || 1337;
    this.rng = U.RNG(this.seed);

    // --- World state (plain fields: the harnesses read and write these) ---
    this.state = 'menu';
    this.cash = 250;
    this.health = 100;
    this.wanted = 0;
    this.completed = [];
    this.player = { x: 0, z: 24, heading: 0 };
    this.playerCar = null;
    this.inMarkedCar = false;
    this.markedCar = null;
    this.cars = [];
    this.peds = [];
    this.policeCars = [];
    this.footCops = [];
    this.enemies = [];
    this.enemiesDown = 0;
    this.crew = [];
    this.crewInCar = 0;
    this.camYaw = 0;
    this.bustedTimer = 0;
    this.lastDamageAt = -100;
    this.framesPainted = 0;
    this.shotReady = false;
    this.shotAutoDrive = false;

    // --- Three.js setup ---
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !this.lowfx,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.lowfx ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lowfx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 900);

    this.world = new W.World(this.scene, this.rng, this.lowfx);
    this.audio = new window.SB.audio.AudioSys();
    this.missions = new window.SB.missions.MissionManager(this);

    this._buildPlayer();
    this._spawnParkedCars();
    this._spawnTraffic();
    this._spawnPeds();
    this._buildBeacon();
    this._bindInput();
    this._bindUI();
    this._buildMissionList();
    this._updateContinueButton();
    this._updateHUD();

    var self = this;
    window.addEventListener('resize', function () { self._onResize(); });
    this._lastNow = performance.now();
    this._clock = 0;
    var loop = function (now) {
      requestAnimationFrame(loop);
      var dt = Math.min((now - self._lastNow) / 1000, 0.05);
      self._lastNow = now;
      self._tick(dt);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ setup
  Game.prototype._buildPlayer = function () {
    this.playerMesh = A.makePersonMesh(0x2e8a7a, false);
    // Cole Vance wears a sunset-orange jacket over the teal shirt.
    var jacket = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.5, 0.42),
      new THREE.MeshLambertMaterial({ color: 0xd87a2e })
    );
    jacket.position.y = 1.15;
    this.playerMesh.add(jacket);
    this.scene.add(this.playerMesh);
    A.syncMesh(this.playerMesh && this.player);
    this.playerMesh.position.set(this.player.x, 0, this.player.z);
  };

  Game.prototype._spawnParkedCars = function () {
    var spots = 0, guard = 0;
    while (spots < 26 && guard++ < 300) {
      var alongNS = this.rng.chance(0.5);
      var coord = this.rng.pick(W.ROAD_COORDS);
      var along = this.rng.range(-200, 200);
      var side = this.rng.pick([-10.5, 10.5]);
      var x = alongNS ? coord + side : along;
      var z = alongNS ? along : coord + side;
      // Keep parked cars clear of the landmark junctions, of each other,
      // and of every building footprint — a car inside a building can
      // never be reached, and a player teleported next to one gets shoved
      // out by the building collision.
      var clear = true;
      var keys = Object.keys(W.LANDMARKS);
      for (var i = 0; i < keys.length; i++) {
        var L = W.LANDMARKS[keys[i]];
        if (U.dist2d(x, z, L.x, L.z) < 16) { clear = false; break; }
      }
      if (clear) {
        for (var bi = 0; bi < this.world.buildings.length; bi++) {
          var b = this.world.buildings[bi];
          if (Math.abs(x - b.x) < b.hw + 3.5 && Math.abs(z - b.z) < b.hd + 3.5) { clear = false; break; }
        }
      }
      if (!clear) continue;
      for (var j = 0; j < this.cars.length; j++) {
        if (U.dist2d(x, z, this.cars[j].x, this.cars[j].z) < 9) { clear = false; break; }
      }
      if (!clear) continue;
      var car = {
        kind: 'parked',
        x: x, z: z,
        heading: alongNS ? (this.rng.chance(0.5) ? 0 : Math.PI) : (this.rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2),
        speed: 0, hp: 100, dead: false,
        color: this.rng.pick(A.CAR_COLORS),
        bumpCooldown: 0,
      };
      car.mesh = A.makeCarMesh(car.color, false, false);
      this.scene.add(car.mesh);
      A.syncMesh(car);
      this.cars.push(car);
      spots++;
    }
  };

  Game.prototype._spawnTraffic = function () {
    for (var i = 0; i < 14; i++) {
      var car = A.makeTrafficCar(this, this.rng);
      this.cars.push(car);
    }
  };

  Game.prototype._spawnPeds = function () {
    for (var i = 0; i < 24; i++) {
      var ped = A.makePed(this, this.rng);
      this.peds.push(ped);
    }
  };

  Game.prototype._buildBeacon = function () {
    // A tall glowing column marking the current mission target.
    var geo = new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffc21a, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = 30;
    this.beacon.visible = false;
    this.scene.add(this.beacon);
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(3, 4.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    this.beaconRing = ring;
    ring.visible = false;
    this.scene.add(ring);
  };

  // ------------------------------------------------------------------ input
  Game.prototype._bindInput = function () {
    var self = this;
    this.keys = {};
    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      self.keys[e.code] = true;
      if (e.code === 'KeyP') self.togglePause();
      if (e.code === 'KeyT') self.cycleTimeOfDay();
      if (e.code === 'KeyM') self.toggleMissionList();
      if (e.code === 'KeyE') self.toggleCar();
      if (e.code === 'KeyF') self.punch();
      if (e.code === 'ArrowLeft') self.camYaw += 0.35;
      if (e.code === 'ArrowRight') self.camYaw -= 0.35;
    });
    window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    // Drag to look around.
    var dragging = false, lastX = 0, lastY = 0;
    this.canvas.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      self.camYaw -= (e.clientX - lastX) * 0.005;
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('pointerup', function () { dragging = false; });
  };

  Game.prototype._bindUI = function () {
    var self = this;
    var startBtn = document.getElementById('btn-start');
    if (startBtn) startBtn.addEventListener('click', function () { self.startGame(); });
    var contBtn = document.getElementById('btn-continue');
    if (contBtn) contBtn.addEventListener('click', function () { self.loadSave(); });
    var respBtn = document.getElementById('btn-respawn');
    if (respBtn) respBtn.addEventListener('click', function () { self.respawn(); });
    var resumeBtn = document.getElementById('btn-resume');
    if (resumeBtn) resumeBtn.addEventListener('click', function () { self.togglePause(); });
    var saveBtn = document.getElementById('btn-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      self._save();
      self.toast('Game saved.');
    });
  };

  Game.prototype._buildMissionList = function () {
    var list = document.getElementById('missions');
    if (!list) return;
    var order = window.SB.missions.MISSION_ORDER;
    var defs = window.SB.missions.MISSIONS;
    for (var i = 0; i < order.length; i++) {
      (function (id) {
        var d = defs[id];
        var div = document.createElement('div');
        div.className = 'mission-item';
        div.dataset.mission = id;
        div.innerHTML = '<b>' + d.name + '</b><span>' + d.giver + ' · ' +
          (window.SB.util.fmtMoney(d.reward)) + '</span><em>' + d.steps[0] + '</em>';
        div.addEventListener('click', function () {
          var g = window.SUNSET && window.SUNSET.game;
          if (g) {
            if (g.state !== 'playing') g.startGame();
            g.startMission(id);
            g.toggleMissionList(true);
          }
        });
        list.appendChild(div);
      })(order[i]);
    }
  };

  Game.prototype._updateContinueButton = function () {
    var btn = document.getElementById('btn-continue');
    if (!btn) return;
    var has = false;
    try { has = !!window.localStorage.getItem(SAVE_KEY); } catch (e) {}
    btn.style.display = has ? '' : 'none';
  };

  Game.prototype._onResize = function () {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  // ------------------------------------------------------------- state flow
  Game.prototype.startGame = function () {
    this.audio.ensure();
    this.state = 'playing';
    document.getElementById('menu').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('end-screen').style.display = 'none';
    document.getElementById('pause-screen').style.display = 'none';
    this._updateHUD();
  };

  Game.prototype.togglePause = function () {
    if (this.state === 'playing') {
      this.state = 'paused';
      document.getElementById('pause-screen').style.display = 'flex';
    } else if (this.state === 'paused') {
      this.state = 'playing';
      document.getElementById('pause-screen').style.display = 'none';
    }
  };

  Game.prototype.cycleTimeOfDay = function () {
    this.world.timeOfDay = (this.world.timeOfDay + 0.25) % 1;
    this.world.updateLighting();
  };

  Game.prototype.toggleMissionList = function (forceClose) {
    var el = document.getElementById('missions');
    if (!el) return;
    if (forceClose) { el.style.display = 'none'; return; }
    var open = el.style.display === 'flex';
    if (!open) {
      // Refresh the status line of each mission item.
      var items = el.querySelectorAll('.mission-item');
      for (var i = 0; i < items.length; i++) {
        var id = items[i].dataset.mission;
        var status = this.completed.indexOf(id) >= 0 ? ' ✓ DONE'
          : (this.missions.id === id ? ' ● ACTIVE' : '');
        var em = items[i].querySelector('em');
        if (em) em.textContent = window.SB.missions.MISSIONS[id].steps[0] + status;
      }
    }
    el.style.display = open ? 'none' : 'flex';
  };

  Game.prototype.respawn = function () {
    this.cash = Math.max(0, this.cash - 100);
    this.health = 100;
    this.setWanted(0);
    this.bustedTimer = 0;
    if (this.playerCar) { this.playerCar = null; this.inMarkedCar = false; }
    this.player.x = W.LANDMARKS.safehouse.x;
    this.player.z = W.LANDMARKS.safehouse.z;
    this.player.heading = 0;
    this.camYaw = Math.atan2(0 - this.player.x, 0 - this.player.z);
    // Getting caught ends the job you were on — and it keeps the respawn
    // itself from completing a mission (the safehouse is a mission target).
    if (this.missions.id) this.missions.fail('Mission failed — the cops got you.');
    this.state = 'playing';
    document.getElementById('end-screen').style.display = 'none';
    this.toast('You paid a $100 fine. Back on the streets.');
    this._updateHUD();
  };

  Game.prototype._endScreen = function (kind) {
    this.state = kind; // 'busted' or 'wasted'
    var title = document.getElementById('end-title');
    if (title) title.textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
    document.getElementById('end-screen').style.display = 'flex';
    this.audio.setEngine(false, 0);
    this.audio.setSiren(false);
  };

  // ------------------------------------------------------------------ debug
  Game.prototype.getState = function () {
    return {
      state: this.state,
      player: { x: this.player.x, z: this.player.z },
      inCar: !!this.playerCar,
      mission: this.missions.id,
      missionStep: this.missions.step,
      objective: this.missions.objective(),
      cash: this.cash,
      wanted: this.wanted,
      health: this.health,
      carHp: this.playerCar ? this.playerCar.hp : 100,
      completed: this.completed.slice(),
      enemies: this.enemies.filter(function (e) { return !e.dead && e.state !== 'down'; }).length,
      police: this.policeCars.length,
      footPolice: this.footCops.length,
    };
  };

  Game.prototype.teleport = function (x, z) {
    this.player.x = x;
    this.player.z = z;
    if (this.playerCar) {
      this.playerCar.x = x;
      this.playerCar.z = z;
      this.playerCar.speed = 0;
      A.syncMesh(this.playerCar);
    }
    this.playerMesh.position.set(x, 0, z);
  };

  Game.prototype.startMission = function (id) {
    if (this.state === 'menu') this.startGame();
    if (this.state !== 'playing') return false;
    return this.missions.start(id);
  };

  Game.prototype.setWanted = function (n) {
    this.wanted = U.clamp(Math.round(n), 0, 5);
    this._syncPolice();
    this._updateHUD();
  };

  Game.prototype.addWanted = function (n) {
    this.setWanted(this.wanted + n);
  };

  Game.prototype.giveCash = function (n) {
    this.cash += n;
    this._updateHUD();
  };

  Game.prototype._syncPolice = function () {
    // Police cars: one per star. Foot cops: two once the heat is 2+.
    while (this.policeCars.length < this.wanted) {
      var car = A.makePoliceCar(this, this.rng, this.player.x, this.player.z);
      this.policeCars.push(car);
    }
    while (this.policeCars.length > this.wanted) {
      var old = this.policeCars.pop();
      this.scene.remove(old.mesh);
    }
    var wantFoot = this.wanted >= 2 ? 2 : 0;
    while (this.footCops.length < wantFoot) {
      this.footCops.push(A.makeFootCop(this, this.rng, this.player.x, this.player.z));
    }
    while (this.footCops.length > wantFoot) {
      var cop = this.footCops.pop();
      this.scene.remove(cop.mesh);
    }
    this.audio.setSiren(this.wanted > 0 && this.state === 'playing');
  };

  // ------------------------------------------------------------------ combat
  Game.prototype.punch = function () {
    if (this.state !== 'playing' || this.playerCar) return;
    var now = this._clock;
    // The cooldown is short on purpose: under a slow renderer a game
    // second is several real seconds, and a punch per key press must land.
    if (now - (this._lastPunch || -10) < 0.15) return;
    this._lastPunch = now;
    this.audio.thud();
    // Find the nearest hittable target in front of the player.
    var best = null, bestD = 2.6;
    var fx = Math.sin(this.player.heading), fz = Math.cos(this.player.heading);
    var consider = function (t) {
      if (!t || t.dead || t.state === 'down') return;
      var dx = t.x - this.player.x, dz = t.z - this.player.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > bestD) return;
      var dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < 0.45) return;
      best = t; bestD = d;
    }.bind(this);
    for (var i = 0; i < this.enemies.length; i++) consider(this.enemies[i]);
    if (!best) {
      for (var j = 0; j < this.peds.length; j++) {
        var p = this.peds[j];
        if (p.isGuard || p.isCrew) continue;
        consider(p);
      }
    }
    if (!best) return;
    best.hp -= 34;
    // A little knockback so the punch reads.
    best.x += fx * 0.4;
    best.z += fz * 0.4;
    if (best.hp <= 0) {
      best.hp = 0;
      best.state = 'down';
      best.downTimer = 0;
      best.mesh.rotation.x = -Math.PI / 2;
      best.mesh.position.y = 0.3;
      if (best.isGuard) {
        this.enemiesDown++;
      } else {
        this.addWanted(1);
        this.toast('You knocked a pedestrian down! Wanted up.');
        // Bystanders scatter.
        for (var k = 0; k < this.peds.length; k++) {
          var q = this.peds[k];
          if (q === best || q.state === 'down' || q.isCrew || q.isGuard) continue;
          if (U.dist2d(q.x, q.z, this.player.x, this.player.z) < 16) {
            q.state = 'flee';
            var ax = q.x - this.player.x, az = q.z - this.player.z;
            var ad = Math.sqrt(ax * ax + az * az) || 1;
            q.target = { x: q.x + (ax / ad) * 34, z: q.z + (az / ad) * 34 };
          }
        }
      }
    }
  };

  Game.prototype.damagePlayer = function (amount) {
    if (this.state !== 'playing') return;
    this.health -= amount;
    this.lastDamageAt = this._clock;
    if (this.health <= 0) {
      this.health = 0;
      this._endScreen('wasted');
    }
    this._updateHUD();
  };

  // -------------------------------------------------------------------- cars
  Game.prototype.toggleCar = function () {
    if (this.state !== 'playing') return;
    if (this.playerCar) {
      // Step out beside the car.
      var car = this.playerCar;
      this.player.x = car.x + 2.5;
      this.player.z = car.z;
      this.player.heading = this.camYaw;
      this.playerCar = null;
      this.inMarkedCar = false;
      this.playerMesh.visible = true;
      this.audio.setEngine(false, 0);
      this._updateHUD();
      return;
    }
    var best = null, bestD = 4.5;
    for (var i = 0; i < this.cars.length; i++) {
      var c = this.cars[i];
      if (c.dead || c.kind === 'police') continue;
      var d = U.dist2d(c.x, c.z, this.player.x, this.player.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return;
    this.playerCar = best;
    this.inMarkedCar = !!best.isMarked;
    this.player.x = best.x;
    this.player.z = best.z;
    this.player.heading = best.heading;
    this.camYaw = best.heading;
    this.playerMesh.visible = false;
    if (best.kind === 'parked' || best.kind === 'traffic') {
      // Stealing a car draws the eye of the law — at least one star.
      if (this.wanted < 1) this.addWanted(1);
      this.toast(best.isMarked ? 'You stole the gold car!' : 'You stole a car! Wanted up.');
    }
    this._updateHUD();
  };

  Game.prototype._updatePlayerCar = function (dt) {
    var car = this.playerCar;
    if (!car) return;
    var k = this.keys;
    var fwd = (k.KeyW ? 1 : 0) || (this.shotAutoDrive ? 1 : 0);
    var back = k.KeyS ? 1 : 0;
    if (fwd) car.speed = Math.min(27, car.speed + 16 * dt);
    else if (back) {
      if (car.speed > 0.5) car.speed = Math.max(0, car.speed - 24 * dt);
      else car.speed = Math.max(-9, car.speed - 10 * dt);
    } else {
      // Coast down. The decel is firm so the car stops near where the
      // driver lifts off, instead of coasting far past a waypoint.
      if (car.speed > 0) car.speed = Math.max(0, car.speed - 9 * dt);
      else if (car.speed < 0) car.speed = Math.min(0, car.speed + 9 * dt);
    }
    var steer = (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0);
    var spd = Math.abs(car.speed);
    if (steer !== 0 && spd > 0.4) {
      var rate = 2.1 * U.clamp(spd / 6, 0.15, 1);
      car.heading += steer * rate * (car.speed >= 0 ? 1 : -1) * dt;
    }
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    // Buildings are solid. When the car smacks one, deflect its heading
    // away from the wall (once per bump, gated by the bump cooldown):
    // a car that keeps pointing into a wall grinds along it and wrecks
    // itself, while a deflected car slides along the wall and back onto
    // the road. Deflecting on every overlapping tick instead would spin
    // the car, so the bump cooldown is the gate.
    car.bumpCooldown = Math.max(0, (car.bumpCooldown || 0) - dt);
    var preX = car.x, preZ = car.z;
    var hitBuilding = this.world.resolveBuildings(car, 2.0);
    if (hitBuilding && spd > 8 && car.bumpCooldown <= 0) {
      var pushX = car.x - preX, pushZ = car.z - preZ;
      var pushLen = Math.sqrt(pushX * pushX + pushZ * pushZ);
      if (pushLen > 0.01) {
        var fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
        if (fwdX * pushX + fwdZ * pushZ < 0) {
          var pushHeading = Math.atan2(pushX, pushZ);
          var turn = U.angleDiff(car.heading, pushHeading);
          car.heading += U.clamp(turn, -0.45, 0.45);
        }
      }
      car.hp -= 3;
      car.speed *= 0.5;
      car.bumpCooldown = 0.6;
      this.audio.thud();
      this.toast('You smashed into a building!');
    }
    car.x = U.clamp(car.x, -W.BOUND, W.BOUND);
    car.z = U.clamp(car.z, -W.BOUND, W.BOUND);
    // Bumping other cars.
    for (var i = 0; i < this.cars.length; i++) {
      var o = this.cars[i];
      if (o === car || o.dead) continue;
      var dx = car.x - o.x, dz = car.z - o.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 4.2 && d > 0.01) {
        var push = (4.2 - d) / 2;
        car.x += (dx / d) * push;
        car.z += (dz / d) * push;
        if (spd > 6 && car.bumpCooldown <= 0) {
          car.hp -= 2;
          car.speed *= 0.7;
          car.bumpCooldown = 0.5;
          this.audio.thud();
        }
        if (o.kind === 'traffic') {
          o.x -= (dx / d) * push;
          o.z -= (dz / d) * push;
          o.speed *= 0.5;
          A.syncMesh(o);
        }
      }
    }
    // Running a pedestrian over.
    for (var j = 0; j < this.peds.length; j++) {
      var p = this.peds[j];
      if (p.state === 'down' || p.isCrew) continue;
      var pd = U.dist2d(car.x, car.z, p.x, p.z);
      if (pd < 2.2 && spd > 3) {
        p.hp = 0;
        p.state = 'down';
        p.downTimer = 0;
        p.mesh.rotation.x = -Math.PI / 2;
        p.mesh.position.y = 0.3;
        car.speed *= 0.85;
        if (p.isGuard) {
          this.enemiesDown++;
        } else {
          this.addWanted(1);
          this.toast('You hit a pedestrian! Wanted up.');
        }
      }
    }
    this.player.x = car.x;
    this.player.z = car.z;
    this.player.heading = car.heading;
    if (car.hp <= 0) {
      car.hp = 0;
      car.dead = true;
      car.mesh.children.forEach(function (m) {
        if (m.material && m.material.color) m.material.color.setHex(0x222222);
      });
      this.toast('Your car is wrecked!');
      this.playerCar = null;
      this.inMarkedCar = false;
      this.player.x = car.x + 2.5;
      this.player.z = car.z;
      this.playerMesh.visible = true;
      this.audio.setEngine(false, 0);
    }
    A.syncMesh(car);
    // The camera trails the car's heading.
    this.camYaw = U.turnToward(this.camYaw, car.heading, 1.4 * dt);
  };

  Game.prototype._updatePlayerOnFoot = function (dt) {
    var k = this.keys;
    var sprint = k.ShiftLeft || k.ShiftRight;
    var speed = sprint ? 9 : 5;
    var fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    var rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
    var mx = 0, mz = 0;
    if (k.KeyW) { mx += fx; mz += fz; }
    if (k.KeyS) { mx -= fx; mz -= fz; }
    if (k.KeyA) { mx -= rx; mz -= rz; }
    if (k.KeyD) { mx += rx; mz += rz; }
    var len = Math.sqrt(mx * mx + mz * mz);
    var ox = this.player.x, oz = this.player.z;
    if (len > 0) {
      this.player.x += (mx / len) * speed * dt;
      this.player.z += (mz / len) * speed * dt;
      this.player.heading = Math.atan2(mx, mz);
      this._walkPhase = (this._walkPhase || 0) + dt * (sprint ? 11 : 7);
      var swing = Math.sin(this._walkPhase) * 0.55;
      this.playerMesh.userData.armL.rotation.x = swing;
      this.playerMesh.userData.armR.rotation.x = -swing;
    }
    this.world.resolveBuildings(this.player, 0.7);
    this.player.x = U.clamp(this.player.x, -W.BOUND, W.BOUND);
    this.player.z = U.clamp(this.player.z, -W.BOUND, W.BOUND);
    // Measured on-foot speed (after building push-out): the busted rule
    // uses it, so a player sprinting away from a cop is not "caught".
    var moved = U.dist2d(ox, oz, this.player.x, this.player.z);
    this.playerSpeed = dt > 0 ? moved / dt : 0;
    this.playerMesh.position.set(this.player.x, 0, this.player.z);
    this.playerMesh.rotation.y = this.player.heading;
    // Traffic can clip a player on foot.
    for (var i = 0; i < this.cars.length; i++) {
      var c = this.cars[i];
      if (c.kind !== 'traffic' || c.dead) continue;
      if (U.dist2d(c.x, c.z, this.player.x, this.player.z) < 2 && Math.abs(c.speed) > 4) {
        if (this._clock - (this._lastHitAt || -10) > 1) {
          this._lastHitAt = this._clock;
          this.damagePlayer(10);
          this.toast('A car clipped you!');
        }
      }
    }
  };

  // ------------------------------------------------------------- police etc
  Game.prototype._updatePolice = function (dt) {
    for (var i = 0; i < this.policeCars.length; i++) {
      A.updatePoliceCar(this, this.policeCars[i], dt);
    }
    for (var j = 0; j < this.footCops.length; j++) {
      A.updateFootCop(this, this.footCops[j], dt);
    }
    // Busted: a cop stays right on top of the player, on foot, with heat,
    // while the player is not getting away — sprinting past a cop is an
    // escape, not a capture.
    if (this.state === 'playing' && !this.playerCar && this.wanted > 0) {
      var nearest = 1e9;
      for (var a = 0; a < this.policeCars.length; a++) {
        nearest = Math.min(nearest, U.dist2d(this.policeCars[a].x, this.policeCars[a].z, this.player.x, this.player.z));
      }
      for (var b = 0; b < this.footCops.length; b++) {
        nearest = Math.min(nearest, U.dist2d(this.footCops[b].x, this.footCops[b].z, this.player.x, this.player.z));
      }
      if (nearest < 2.2 && (this.playerSpeed || 0) < 3) {
        this.bustedTimer += dt;
        if (this.bustedTimer > 2) {
          this._endScreen('busted');
          this.audio.fail();
        }
      } else {
        this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2);
      }
    } else {
      this.bustedTimer = 0;
    }
  };

  Game.prototype._updateCrewAndGuards = function (dt) {
    for (var i = 0; i < this.peds.length; i++) {
      var p = this.peds[i];
      if (p.isGuard) {
        if (p.state === 'down') continue;
        var dx = this.player.x - p.x, dz = this.player.z - p.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < 30 && d > 1.4) {
          p.heading = U.turnToward(p.heading, Math.atan2(dx, dz), 4 * dt);
          p.x += Math.sin(p.heading) * 2.4 * dt;
          p.z += Math.cos(p.heading) * 2.4 * dt;
          p.walkPhase = (p.walkPhase || 0) + dt * 8;
          var swing = Math.sin(p.walkPhase) * 0.5;
          p.mesh.userData.armL.rotation.x = swing;
          p.mesh.userData.armR.rotation.x = -swing;
        }
        if (d < 2.2) {
          p.attackCooldown = (p.attackCooldown || 0) - dt;
          if (p.attackCooldown <= 0) {
            p.attackCooldown = 1.6;
            this.damagePlayer(1);
            this.audio.thud();
          }
        }
        this.world.resolveBuildings(p, 0.6);
        A.syncMesh(p);
      } else if (p.isCrew) {
        if (p.state === 'board' && this.playerCar) {
          var cx = this.playerCar.x - p.x, cz = this.playerCar.z - p.z;
          var cd = Math.sqrt(cx * cx + cz * cz);
          if (cd < 4) {
            p.state = 'inCar';
            p.mesh.visible = false;
            this.crewInCar++;
            this.toast('Crew member hopped in (' + this.crewInCar + '/2)');
          } else if (cd < 80) {
            // The crew runs to the car — the car may have coasted well
            // past the Docks before it stopped, so they chase it down.
            p.heading = U.turnToward(p.heading, Math.atan2(cx, cz), 4 * dt);
            p.x += Math.sin(p.heading) * 5.5 * dt;
            p.z += Math.cos(p.heading) * 5.5 * dt;
            A.syncMesh(p);
          }
        }
      } else {
        A.updatePed(this, p, dt);
      }
    }
  };

  Game.prototype._checkGarageAndLights = function (dt) {
    // Respray: rolling into Slim's Garage with heat, and $150 in pocket,
    // repaints the car and clears the wanted level.
    var G = W.LANDMARKS.garage;
    if (this.playerCar && this.wanted > 0 && this.cash >= 150 &&
        U.dist2d(this.playerCar.x, this.playerCar.z, G.x, G.z) < 10) {
      this.cash -= 150;
      this.setWanted(0);
      this.toast('Respray — $150 · Heat cleared');
      this.audio.cash();
    }
    // Red lights: crossing a junction on red, in a car, draws a star.
    // Pulling into the garage forecourt does not count: the garage sits
    // on its junction, and a car rolling in for a respray would otherwise
    // re-arm its wanted level mid-visit and pay for the same respray
    // twice.
    var garageDist = this.playerCar
      ? U.dist2d(this.playerCar.x, this.playerCar.z, G.x, G.z)
      : 1e9;
    if (this.playerCar && Math.abs(this.playerCar.speed) > 3 && this.world.lightPhase() === 'red' && garageDist >= 10) {
      var jx = W.nearestRoadCoord(this.playerCar.x);
      var jz = W.nearestRoadCoord(this.playerCar.z);
      if (Math.abs(this.playerCar.x - jx) < 5 && Math.abs(this.playerCar.z - jz) < 5) {
        var key = jx + ',' + jz;
        this._rlCooldown = this._rlCooldown || {};
        if ((this._rlCooldown[key] || -100) < this._clock - 12) {
          this._rlCooldown[key] = this._clock;
          this.addWanted(1);
          this.toast('Ran a red light! Wanted up.');
          this.audio.sirenBlip();
        }
      }
    }
  };

  // -------------------------------------------------------------------- save
  Game.prototype._save = function () {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: this.cash,
        health: this.health,
        completed: this.completed,
        mission: this.missions.id,
        missionStep: this.missions.step,
        x: this.player.x,
        z: this.player.z,
        wanted: this.wanted,
        timeOfDay: this.world.timeOfDay,
      }));
      this._updateContinueButton();
    } catch (e) { /* storage may be unavailable */ }
  };

  Game.prototype.loadSave = function () {
    var data = null;
    try { data = JSON.parse(window.localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) {}
    if (!data) return;
    this.cash = data.cash;
    this.health = data.health;
    this.completed = data.completed || [];
    this.wanted = 0;
    this.player.x = data.x;
    this.player.z = data.z;
    if (data.timeOfDay !== undefined) this.world.timeOfDay = data.timeOfDay;
    this.startGame();
    this.setWanted(data.wanted || 0);
    if (data.mission) {
      this.startMission(data.mission);
      this.missions.step = data.missionStep || 0;
      if (data.mission === 'm4' && this.missions.step >= 1) this.missions._spawnGoldCar();
      if (data.mission === 'm3' && this.missions.step === 1) this.missions.timer = 90;
    }
    this._updateHUD();
    this.toast('Save loaded.');
  };

  // --------------------------------------------------------------------- HUD
  Game.prototype.toast = function (msg) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    box.appendChild(div);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 3400);
  };

  Game.prototype._updateHUD = function () {
    var cashEl = document.getElementById('cash');
    if (cashEl) cashEl.textContent = U.fmtMoney(this.cash);
    var hpEl = document.getElementById('health-fill');
    if (hpEl) hpEl.style.width = U.clamp(this.health, 0, 100) + '%';
    var starsEl = document.getElementById('stars');
    if (starsEl) {
      var s = '';
      for (var i = 0; i < 5; i++) s += i < this.wanted ? '★' : '☆';
      starsEl.textContent = s;
      starsEl.style.color = this.wanted > 0 ? '#ffd24a' : '#888888';
    }
    var objEl = document.getElementById('objective');
    if (objEl) {
      var m = this.missions.def();
      objEl.textContent = m
        ? m.name + ': ' + this.missions.objective()
        : this.missions.objective();
    }
    var speedEl = document.getElementById('speed');
    if (speedEl) {
      speedEl.textContent = this.playerCar
        ? Math.round(Math.abs(this.playerCar.speed) * 3.6) + ' km/h'
        : '';
    }
    var clockEl = document.getElementById('clock');
    if (clockEl) {
      var h = Math.floor(this.world.timeOfDay * 24);
      var min = Math.floor((this.world.timeOfDay * 24 - h) * 60);
      clockEl.textContent = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    }
  };

  Game.prototype._updateTimer = function () {
    var el = document.getElementById('timer');
    if (!el) return;
    if (this.missions.id === 'm3' && this.missions.step === 1) {
      el.textContent = '⏱ ' + U.fmtClock(this.missions.timer);
    } else if (this.missions.id === 'm5' && this.missions.step === 0 && this.missions.holdTime > 0) {
      el.textContent = 'Cracking vault… ' + Math.floor(this.missions.holdTime / 8 * 100) + '%';
    } else {
      el.textContent = '';
    }
  };

  Game.prototype._drawMinimap = function () {
    var cv = document.getElementById('minimap');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var S = cv.width;
    var toMap = function (v) { return ((v + 240) / 480) * S; };
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#1d2b33';
    ctx.fillRect(0, 0, S, S);
    // Ocean strip at the bottom (south = -z maps to the top of the map).
    ctx.fillStyle = '#2a6f8f';
    ctx.fillRect(0, 0, S, toMap(-208));
    // Roads.
    ctx.strokeStyle = '#555a63';
    ctx.lineWidth = 5;
    for (var i = 0; i < W.ROAD_COORDS.length; i++) {
      var c = toMap(W.ROAD_COORDS[i]);
      ctx.beginPath(); ctx.moveTo(0, c); ctx.lineTo(S, c); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, S); ctx.stroke();
    }
    // Buildings.
    ctx.fillStyle = '#8a7a68';
    for (var b = 0; b < this.world.buildings.length; b++) {
      var bl = this.world.buildings[b];
      if (bl.h > 30) ctx.fillStyle = '#6a7a8c';
      else ctx.fillStyle = '#8a7a68';
      ctx.fillRect(toMap(bl.x - bl.hw), toMap(bl.z - bl.hd), toMap(bl.hw * 2) - toMap(0), toMap(bl.hd * 2) - toMap(0));
    }
    // Mission target.
    var target = this.missions.targetPos();
    if (target) {
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(toMap(target.x), toMap(target.z), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Police.
    ctx.fillStyle = '#4a90ff';
    for (var p = 0; p < this.policeCars.length; p++) {
      ctx.beginPath();
      ctx.arc(toMap(this.policeCars[p].x), toMap(this.policeCars[p].z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    var px = toMap(this.player.x), pz = toMap(this.player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.player.heading + Math.PI);
    ctx.fillStyle = '#2aff66';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // ------------------------------------------------------------------ camera
  Game.prototype._updateCamera = function (dt) {
    var tx = this.player.x, tz = this.player.z;
    if (this.state === 'menu') {
      var a = this._clock * 0.06;
      this.camera.position.set(Math.cos(a) * 150, 95, Math.sin(a) * 150);
      this.camera.lookAt(0, 0, -20);
      return;
    }
    var dist = this.playerCar ? 13 : 10;
    var height = this.playerCar ? 5.5 : 4.5;
    var fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    var cx = tx - fx * dist, cz = tz - fz * dist;
    var want = new THREE.Vector3(cx, height, cz);
    this.camera.position.lerp(want, Math.min(1, dt * 5));
    this.camera.lookAt(tx + fx * 8, 1.6, tz + fz * 8);
  };

  // -------------------------------------------------------------------- tick
  Game.prototype._tick = function (dt) {
    this._clock += dt;
    this.world.update(dt);
    if (this.state === 'playing') {
      if (this.playerCar) this._updatePlayerCar(dt);
      else this._updatePlayerOnFoot(dt);
      for (var i = 0; i < this.cars.length; i++) {
        var c = this.cars[i];
        if (c.kind === 'traffic') A.updateTrafficCar(this, c, dt);
      }
      this._updateCrewAndGuards(dt);
      this._updatePolice(dt);
      this._checkGarageAndLights(dt);
      this.missions.update(dt);
      // Slow health regen after 8 quiet seconds.
      if (this.health > 0 && this.health < 100 && this._clock - this.lastDamageAt > 8) {
        this.health = Math.min(100, this.health + 2 * dt);
      }
      // Mission beacon.
      var target = this.missions.targetPos();
      if (target) {
        this.beacon.visible = true;
        this.beaconRing.visible = true;
        this.beacon.position.set(target.x, 30, target.z);
        this.beaconRing.position.set(target.x, 0.15, target.z);
        var pulse = 1 + Math.sin(this._clock * 4) * 0.15;
        this.beacon.scale.set(pulse, 1, pulse);
      } else {
        this.beacon.visible = false;
        this.beaconRing.visible = false;
      }
      // Engine + siren follow the driving state.
      this.audio.setEngine(!!this.playerCar, this.playerCar ? Math.abs(this.playerCar.speed) / 27 : 0);
      this.audio.setSiren(this.wanted > 0);
      this._updateHUD();
      this._updateTimer();
      this._minimapTimer = (this._minimapTimer || 0) + dt;
      if (this._minimapTimer > 0.15) {
        this._minimapTimer = 0;
        this._drawMinimap();
      }
      // Autosave every 20 game-seconds while playing.
      this._saveTimer = (this._saveTimer || 0) + dt;
      if (this._saveTimer > 20) {
        this._saveTimer = 0;
        this._save();
      }
    } else {
      this.audio.setEngine(false, 0);
      if (this.state !== 'paused') this.audio.setSiren(false);
    }
    this._updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.framesPainted++;
    if (this.shotMode && !this.shotReady && this.framesPainted >= 4) {
      this.shotReady = true;
      window.__shotReady = true;
    }
  };

  // -------------------------------------------------------------- shot modes
  Game.prototype.setupShot = function (mode) {
    var self = this;
    this.shotMode = mode;
    this.framesPainted = 0;
    if (mode === 'start') {
      // Menu stays up; the camera orbits the city behind it.
      return;
    }
    this.startGame();
    // A hero car for the driving shots, parked on the north road.
    var hero = null;
    for (var i = 0; i < this.cars.length; i++) {
      var c = this.cars[i];
      if (c.kind === 'parked' && Math.abs(c.x) < 14 && Math.abs(c.z - 40) < 30) { hero = c; break; }
    }
    if (!hero) {
      hero = {
        kind: 'parked', x: 0, z: 40, heading: 0, speed: 0, hp: 100,
        dead: false, color: 0xc23a2e, bumpCooldown: 0,
      };
      hero.mesh = A.makeCarMesh(hero.color, false, false);
      this.scene.add(hero.mesh);
      A.syncMesh(hero);
      this.cars.push(hero);
    }
    var enterHero = function () {
      self.teleport(hero.x + 2, hero.z);
      self.toggleCar();
      self.setWanted(0);
      hero.speed = 0;
    };
    if (mode === 'drive') {
      this.world.timeOfDay = 0.74;
      this.world.updateLighting();
      enterHero();
      hero.heading = 0;
      hero.speed = 16;
      this.camYaw = 0;
      this.shotAutoDrive = true;
    } else if (mode === 'chase') {
      this.world.timeOfDay = 0.74;
      this.world.updateLighting();
      enterHero();
      hero.heading = 0;
      hero.speed = 12;
      this.camYaw = 0;
      this.setWanted(3);
      this.shotAutoDrive = true;
      // Put one police car ahead of the player, in frame and closing in,
      // so the shot reads as a chase instead of an empty road.
      var lead = this.policeCars[0];
      if (lead) {
        lead.x = hero.x;
        lead.z = hero.z + 26;
        lead.heading = Math.PI;
        lead.speed = 0;
        window.SB.actors.syncMesh(lead);
      }
      this.toast('The Sunset Bay PD is on your tail!');
    } else if (mode === 'mission') {
      enterHero();
      // Park on the road north of the Docks, facing the mission beacon:
      // the road ahead is clear, so the shot shows the car, the beacon
      // and the objective instead of a building wall.
      this.teleport(-156, -132);
      hero.x = -156; hero.z = -132;
      hero.heading = Math.PI;
      hero.speed = 0;
      window.SB.actors.syncMesh(hero);
      this.player.x = hero.x; this.player.z = hero.z;
      this.camYaw = Math.PI;
      this.startMission('m3');
    }
  };

  window.SB.game = { Game: Game };
})();
