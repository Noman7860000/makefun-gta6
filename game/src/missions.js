// SUNSET BAY — missions.js
// The five story missions, in order, with their payouts and objectives.
// The manager watches the game each frame and advances steps when the
// player does the thing the step asks for. It never touches the renderer;
// it only reads and writes game state.
(function () {
  'use strict';
  var U = window.SB.util;
  var W = window.SB.world;

  var MISSIONS = {
    m1: {
      id: 'm1', name: 'First Wheels', giver: 'Slim Vasquez', reward: 300,
      steps: [
        'Steal a car — walk up to a parked car and press E',
        "Drive it to Slim's Garage",
      ],
    },
    m2: {
      id: 'm2', name: 'The Getaway', giver: 'Rosa Marín', reward: 600,
      steps: [
        'Steal a car',
        'Pick up the crew at the Docks',
        'Lose the heat — reach the Safehouse',
      ],
    },
    m3: {
      id: 'm3', name: 'Hot Delivery', giver: 'Slim Vasquez', reward: 500, timer: 90,
      steps: [
        'Pick up the package at the Docks',
        'Deliver it to Bayview Mall — fast! You have 90 seconds',
      ],
    },
    m4: {
      id: 'm4', name: 'Repo Man', giver: 'Rosa Marín', reward: 800,
      steps: [
        'Deal with the casino guards — press F to punch',
        'Steal the gold car',
        "Bring the gold car to Slim's Garage",
      ],
    },
    m5: {
      id: 'm5', name: 'The Sunset Heist', giver: 'Slim Vasquez', reward: 2500,
      steps: [
        'Crack the vault at Casino del Sol — stay in the zone',
        'Escape to the Safehouse',
      ],
    },
  };

  var MISSION_ORDER = ['m1', 'm2', 'm3', 'm4', 'm5'];

  function MissionManager(game) {
    this.game = game;
    this.id = null;
    this.step = 0;
    this.timer = 0; // m3 countdown, in game seconds
    this.holdTime = 0; // m5 vault-cracking progress, in game seconds
    this.crewSpawned = false;
    this.goldSpawned = false;
  }

  MissionManager.prototype.def = function () {
    return this.id ? MISSIONS[this.id] : null;
  };

  MissionManager.prototype.objective = function () {
    var d = this.def();
    if (!d) return 'Explore Sunset Bay — press M for missions';
    // m2's step 1 is the escape: the crew is already aboard by then, so
    // the step-1 text is the escape line, not the pickup line.
    if (this.id === 'm2' && this.step === 1) return d.steps[2];
    return d.steps[this.step] || d.steps[d.steps.length - 1];
  };

  // Where the current step wants the player to go (for the beacon/marker).
  MissionManager.prototype.targetPos = function () {
    var L = W.LANDMARKS;
    if (!this.id) return null;
    if (this.id === 'm1') return this.step === 0 ? null : L.garage;
    if (this.id === 'm2') return this.step === 0 ? L.docks : (this.step === 1 ? L.docks : L.safehouse);
    if (this.id === 'm3') return this.step === 0 ? L.docks : L.mall;
    if (this.id === 'm4') return this.step === 2 ? L.garage : L.casino;
    if (this.id === 'm5') return this.step === 0 ? L.casino : L.safehouse;
    return null;
  };

  MissionManager.prototype.start = function (id) {
    var game = this.game;
    var d = MISSIONS[id];
    if (!d) return false;
    this.id = id;
    this.step = 0;
    this.timer = 0;
    this.holdTime = 0;
    this.crewSpawned = false;
    this.goldSpawned = false;
    game.toast(d.name + ' — ' + d.giver + ': ' + d.steps[0]);
    game.audio.blip();
    if (id === 'm2') this._spawnCrew();
    if (id === 'm4') this._spawnGuards();
    return true;
  };

  MissionManager.prototype._spawnCrew = function () {
    var game = this.game;
    if (this.crewSpawned) return;
    this.crewSpawned = true;
    game.crewInCar = 0;
    var L = W.LANDMARKS.docks;
    game.crew = [];
    var spots = [[-150, -150], [-162, -148]];
    for (var i = 0; i < 2; i++) {
      var p = window.SB.actors.makePed(game, game.rng, spots[i][0], spots[i][1]);
      p.isCrew = true;
      p.state = 'wait';
      p.target = null;
      game.crew.push(p);
      game.peds.push(p);
    }
  };

  MissionManager.prototype._spawnGuards = function () {
    var game = this.game;
    game.enemies = [];
    game.enemiesDown = 0;
    var spots = [[98, 110], [110, 108]];
    for (var i = 0; i < 2; i++) {
      var g = window.SB.actors.makePed(game, game.rng, spots[i][0], spots[i][1]);
      g.isGuard = true;
      g.hp = 68; // two solid punches
      g.state = 'guard';
      g.attackCooldown = 0;
      g.mesh.userData.armL = g.mesh.userData.armL; // keep arms wired
      game.enemies.push(g);
      game.peds.push(g);
    }
    game.toast('Two guards are on you — punch them down with F!');
  };

  MissionManager.prototype._spawnGoldCar = function () {
    var game = this.game;
    if (this.goldSpawned) return;
    this.goldSpawned = true;
    var car = {
      kind: 'parked',
      x: 96, z: 96,
      // Facing north, toward the first waypoint of the drive west: the
      // car leaves cleanly instead of spinning around on the spot.
      heading: 0,
      speed: 0,
      hp: 100,
      dead: false,
      isMarked: true,
      color: 0xd8a920,
    };
    car.mesh = window.SB.actors.makeCarMesh(0xd8a920, false, true);
    game.scene.add(car.mesh);
    window.SB.actors.syncMesh(car);
    game.cars.push(car);
    game.markedCar = car;
    game.toast('There it is — the gold car. Steal it!');
    game.audio.blip();
  };

  MissionManager.prototype.fail = function (reason) {
    var game = this.game;
    game.toast(reason);
    game.audio.fail();
    this.id = null;
    this.step = 0;
    this.timer = 0;
    this.holdTime = 0;
  };

  MissionManager.prototype.complete = function () {
    var game = this.game;
    var d = this.def();
    if (!d) return;
    game.cash += d.reward;
    game.completed.push(d.id);
    game.toast(d.name + ' complete! +' + U.fmtMoney(d.reward));
    game.audio.jingle();
    game.audio.cash();
    this.id = null;
    this.step = 0;
    this.timer = 0;
    this.holdTime = 0;
  };

  MissionManager.prototype._near = function (pos, radius) {
    var game = this.game;
    var px = game.playerCar ? game.playerCar.x : game.player.x;
    var pz = game.playerCar ? game.playerCar.z : game.player.z;
    return U.dist2d(px, pz, pos.x, pos.z) < radius;
  };

  MissionManager.prototype.update = function (dt) {
    var game = this.game;
    if (!this.id) return;
    var L = W.LANDMARKS;

    if (this.id === 'm1') {
      if (this.step === 0 && game.playerCar) this.step = 1;
      else if (this.step === 1 && game.playerCar && this._near(L.garage, 16)) this.complete();
    } else if (this.id === 'm2') {
      if (this.step === 0) {
        // The crew runs to the car once it is near the Docks.
        if (game.playerCar && this._near(L.docks, 20)) {
          for (var i = 0; i < game.crew.length; i++) {
            var c = game.crew[i];
            if (c.state === 'wait') c.state = 'board';
          }
        }
        if (game.crewInCar >= 2) {
          this.step = 1;
          game.setWanted(2);
          game.toast('The heat is on — 2 stars! Get to the Safehouse!');
          game.audio.sirenBlip();
        }
      } else if (this.step === 1 && game.playerCar && this._near(L.safehouse, 16)) {
        this.complete();
      }
    } else if (this.id === 'm3') {
      if (this.step === 0) {
        if (this._near(L.docks, 10)) {
          this.step = 1;
          this.timer = MISSIONS.m3.timer;
          game.toast('Package grabbed — 90 seconds to the Mall!');
          game.audio.blip();
        }
      } else if (this.step === 1) {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.fail('Too slow — the delivery went cold. Mission failed.');
          return;
        }
        if (this._near(L.mall, 16)) this.complete();
      }
    } else if (this.id === 'm4') {
      if (this.step === 0) {
        if (game.enemiesDown >= 2) {
          this.step = 1;
          this._spawnGoldCar();
        }
      } else if (this.step === 1) {
        if (game.inMarkedCar) this.step = 2;
      } else if (this.step === 2) {
        if (game.inMarkedCar && this._near(L.garage, 16)) this.complete();
      }
    } else if (this.id === 'm5') {
      if (this.step === 0) {
        if (this._near(L.casino, 12)) {
          this.holdTime += dt;
          if (this.holdTime >= 8) {
            this.step = 1;
            game.setWanted(3);
            game.toast('Vault cracked! The alarm is screaming — RUN to the Safehouse!');
            game.audio.sirenBlip();
          }
        }
      } else if (this.step === 1) {
        if (this._near(L.safehouse, 16)) this.complete();
      }
    }
  };

  window.SB.missions = {
    MISSIONS: MISSIONS,
    MISSION_ORDER: MISSION_ORDER,
    MissionManager: MissionManager,
  };
})();
