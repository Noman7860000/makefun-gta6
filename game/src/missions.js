// SUNSET BAY — missions: the five story jobs, their steps, dialogue,
// timers and rewards. Written fresh for this entry.
window.SB = window.SB || {};

(function () {
  'use strict';
  const U = window.SB.util;

  const DEFS = {
    m1: {
      name: 'First Wheels',
      giver: 'Slim Vasquez',
      reward: 300,
      intro: 'Slim: "Cole, you need wheels. Jack a parked car and bring it to my garage. Quiet-like."',
      steps: [
        { text: 'Steal a parked car', hint: 'Walk up to a parked car and press E' },
        { text: 'Drive it to the garage', hint: 'Follow the yellow marker to the garage' },
      ],
    },
    m2: {
      name: 'The Getaway',
      giver: 'Rosa Marín',
      reward: 600,
      intro: 'Rosa: "Two of my crew are waiting at the docks. Pick them up — then lose the cops at the safehouse."',
      steps: [
        { text: 'Pick up the crew at the docks', hint: 'Get a car and drive to the docks so the crew can board' },
        { text: 'Escape to the safehouse', hint: 'Wanted level 2 — reach the safehouse' },
      ],
    },
    m3: {
      name: 'Hot Delivery',
      giver: 'Slim Vasquez',
      reward: 500,
      intro: 'Slim: "A package is waiting at the docks. Get it to the mall — you have 90 seconds once you grab it."',
      steps: [
        { text: 'Pick up the package at the docks', hint: 'Go to the docks on foot or by car' },
        { text: 'Deliver it to the mall in 90s', hint: 'Drive fast — the timer is running' },
      ],
    },
    m4: {
      name: 'Repo Man',
      giver: 'Rosa Marín',
      reward: 800,
      intro: 'Rosa: "A gold sedan at the casino belongs to a man who stopped paying. Handle the guards, then bring it to the garage in one piece."',
      steps: [
        { text: 'Beat down the two guards', hint: 'Get close and press F to punch' },
        { text: 'Steal the gold car, deliver it to the garage', hint: 'Keep its health above 40' },
      ],
    },
    m5: {
      name: 'The Sunset Heist',
      giver: 'Slim Vasquez',
      reward: 2500,
      intro: 'Slim: "The big one, Cole. The casino vault. Stay in the vault zone for 8 seconds — then run for the safehouse."',
      steps: [
        { text: 'Crack the vault at the casino', hint: 'Stand in the vault zone for 8 seconds' },
        { text: 'Escape to the safehouse', hint: 'The alarm trips 3 stars — get to the safehouse' },
      ],
    },
  };

  // Step targets per mission/step: [x, z] or null (no single target).
  function stepTarget(id, step) {
    const L = U.LANDMARKS;
    if (id === 'm1') return step === 0 ? null : [L.garage.x, L.garage.z];
    if (id === 'm2') return step === 0 ? [L.docks.x, L.docks.z] : [L.safehouse.x, L.safehouse.z];
    if (id === 'm3') return step === 0 ? [L.docks.x, L.docks.z] : [L.mall.x, L.mall.z];
    if (id === 'm4') return step === 0 ? [L.casino.x, L.casino.z] : [L.garage.x, L.garage.z];
    if (id === 'm5') return step === 0 ? [L.casino.x, L.casino.z] : [L.safehouse.x, L.safehouse.z];
    return null;
  }

  function createMissions(game, actors) {
    const M = {
      defs: DEFS,
      id: null,
      step: 0,
      timer: 0,
      holdProgress: 0,
      stepTarget,
    };

    M.start = function (id) {
      if (!DEFS[id]) return false;
      M.cancel();
      M.id = id;
      M.step = 0;
      M.timer = 0;
      M.holdProgress = 0;
      const def = DEFS[id];
      game.say(def.giver, def.intro);
      game.toast('Mission started: ' + def.name + ' — $' + def.reward);
      if (id === 'm2') actors.spawnCrew();
      if (id === 'm4') {
        actors.spawnGuards();
        actors.spawnGoldCar();
      }
      game.refreshMissionList();
      return true;
    };

    M.cancel = function () {
      if (!M.id) return;
      M.id = null;
      M.step = 0;
      M.timer = 0;
      M.holdProgress = 0;
      actors.clearCrew();
      actors.clearEnemies();
      actors.clearMarkedCar();
      game.refreshMissionList();
    };

    M.objective = function () {
      if (!M.id) return 'Free roam — press M for missions';
      const def = DEFS[M.id];
      return def.name + ': ' + def.steps[M.step].text;
    };

    M.target = function () {
      if (!M.id) return null;
      const t = stepTarget(M.id, M.step);
      return t ? { x: t[0], z: t[1] } : null;
    };

    M.complete = function () {
      const def = DEFS[M.id];
      game.cash += def.reward;
      game.completed.push(M.id);
      game.toast('Mission complete: ' + def.name + ' — +$' + def.reward);
      SB.audio.cash();
      SB.audio.jingle();
      const done = M.id;
      M.id = null;
      M.step = 0;
      M.timer = 0;
      M.holdProgress = 0;
      actors.clearCrew();
      actors.clearEnemies();
      actors.clearMarkedCar();
      game.refreshMissionList();
      game.save();
      return done;
    };

    M.fail = function (why) {
      const def = DEFS[M.id];
      game.toast('Mission failed: ' + def.name + ' — ' + why);
      SB.audio.fail();
      M.cancel();
    };

    // Per-frame mission logic. Called by the game loop while playing.
    M.update = function (dt) {
      if (!M.id) return;
      const p = actors.player;
      const pc = actors.playerCar;
      const L = U.LANDMARKS;
      const at = (lm, r) => U.dist2(p.x, p.z, lm.x, lm.z) < (r || 12);

      if (M.id === 'm1') {
        if (M.step === 0 && pc) {
          M.step = 1;
          game.say('Slim Vasquez', 'Slim: "Good. Now bring it to my garage — the yellow marker."');
          game.refreshMissionList();
        } else if (M.step === 1 && pc && at(L.garage)) {
          M.complete();
        }
      } else if (M.id === 'm2') {
        if (M.step === 0 && actors.crewInCar >= 2) {
          M.step = 1;
          game.setWanted(2);
          game.say('Rosa Marín', 'Rosa: "Crew\'s in! Cops are on you — get to the safehouse!"');
          game.refreshMissionList();
        } else if (M.step === 1 && at(L.safehouse)) {
          M.complete();
        }
      } else if (M.id === 'm3') {
        if (M.step === 0 && at(L.docks, 10)) {
          M.step = 1;
          M.timer = 90;
          game.say('Slim Vasquez', 'Slim: "Package in hand. Mall. 90 seconds. Go!"');
          SB.audio.pickup();
          game.refreshMissionList();
        } else if (M.step === 1) {
          M.timer -= dt;
          if (M.timer <= 0) {
            M.fail('the delivery was too slow');
          } else if (at(L.mall)) {
            M.complete();
          }
        }
      } else if (M.id === 'm4') {
        if (M.step === 0 && actors.enemiesDown >= 2) {
          M.step = 1;
          game.say('Rosa Marín', 'Rosa: "Guards are down. Take the gold sedan to the garage — don\'t wreck it."');
          game.refreshMissionList();
        } else if (M.step === 1 && actors.inMarkedCar && at(L.garage)) {
          if (pc && pc.hp >= 40) {
            M.complete();
          } else {
            M.fail('the gold car arrived too damaged');
          }
        }
      } else if (M.id === 'm5') {
        if (M.step === 0) {
          if (at(L.casino)) {
            M.holdProgress += dt;
            if (M.holdProgress >= 8) {
              M.step = 1;
              game.setWanted(3);
              game.say('Slim Vasquez', 'Slim: "Vault\'s open! Alarm\'s screaming — 3 stars! RUN to the safehouse!"');
              game.refreshMissionList();
            }
          } else {
            M.holdProgress = Math.max(0, M.holdProgress - dt * 2);
          }
        } else if (M.step === 1 && at(L.safehouse)) {
          M.complete();
        }
      }
    };

    return M;
  }

  window.SB.createMissions = createMissions;
})();
