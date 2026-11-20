// SUNSET BAY — the five missions. Each has steps, an objective line and a
// payout. The manager works on the game object; game.js wires it in.
import { dist2d } from './util.js';
import { makeCar, makeGuard } from './actors.js';

export const MISSION_LIST = [
  { id: 'm1', name: 'First Wheels', fixer: 'Slim Vasquez', reward: 300, desc: 'Steal a car and take it to the Sunset Garage.' },
  { id: 'm2', name: 'The Getaway', fixer: 'Rosa Marín', reward: 600, desc: 'Pick up the crew at the Docks, then lose the heat at the Safehouse.' },
  { id: 'm3', name: 'Hot Delivery', fixer: 'Slim Vasquez', reward: 500, desc: 'Grab the package at the Docks and deliver it to Bay Mall in 90 seconds.' },
  { id: 'm4', name: 'Repo Man', fixer: 'Rosa Marín', reward: 800, desc: 'Beat the casino guards, steal the gold car, bring it to the Garage.' },
  { id: 'm5', name: 'The Sunset Heist', fixer: 'Slim Vasquez', reward: 2500, desc: 'Rob the Palm Casino vault, then escape to the Safehouse.' },
];

export function missionDef(id) {
  return MISSION_LIST.find((m) => m.id === id) || null;
}

function activePos(game) {
  if (game.playerCar) return { x: game.playerCar.x, z: game.playerCar.z };
  return { x: game.player.x, z: game.player.z };
}

function clearMissionActors(game) {
  game.enemies = [];
  game.enemiesDown = 0;
  if (game.markedCar) {
    // The gold car stays in the world as an ordinary parked car.
    game.markedCar.kind = 'parked';
    game.markedCar = null;
  }
  game.inMarkedCar = false;
  game.crewInCar = 0;
  game.crewTimer = 0;
  game.m5Hold = 0;
}

export function startMission(game, id) {
  const def = missionDef(id);
  if (!def) return false;
  if (game.completed.includes(id)) {
    game.toast(`"${def.name}" is already done.`);
    return false;
  }
  clearMissionActors(game);
  game.mission = id;
  game.missionStep = 0;
  game.missionTimer = 0;
  game.objective = '';
  switch (id) {
    case 'm1':
      game.objective = 'Steal a car';
      break;
    case 'm2':
      game.objective = 'Steal a car and take it to the Docks';
      break;
    case 'm3':
      game.objective = 'Go to the Docks and pick up the package';
      break;
    case 'm4': {
      game.objective = 'Beat down the casino guards';
      const g1 = makeGuard(104, 108);
      const g2 = makeGuard(108, 112);
      game.enemies.push(g1, g2);
      break;
    }
    case 'm5':
      game.objective = 'Rob the casino vault — stay in the zone';
      break;
    default:
      break;
  }
  game.audio.missionStart();
  game.toast(`${def.name} — ${def.desc}`);
  return true;
}

export function abortMission(game, reason) {
  if (!game.mission) return;
  clearMissionActors(game);
  game.mission = null;
  game.missionStep = 0;
  game.missionTimer = 0;
  game.objective = '';
  if (reason) game.toast(reason);
}

function completeMission(game) {
  const def = missionDef(game.mission);
  if (!def) return;
  game.cash += def.reward;
  game.completed.push(def.id);
  game.audio.cash();
  game.audio.missionComplete();
  game.toast(`${def.name} complete! +$${def.reward}`);
  game.autosave();
  const done = def.id;
  clearMissionActors(game);
  game.mission = null;
  game.missionStep = 0;
  game.missionTimer = 0;
  game.objective = '';
  // eslint-disable-next-line no-unused-vars
  void done;
}

export function onEnterCar(game, car) {
  if (game.mission === 'm1' && game.missionStep === 0) {
    game.missionStep = 1;
    game.objective = 'Drive it to the Sunset Garage';
    game.toast('Nice wheels. Now get it to the Garage.');
  } else if (game.mission === 'm4' && game.missionStep === 1 && car === game.markedCar) {
    game.inMarkedCar = true;
    game.objective = 'Take the gold car to the Sunset Garage';
    game.toast('That is the one. Drive it to the Garage — easy now.');
  }
}

export function updateMissions(game, dt) {
  if (!game.mission) return;
  const lm = game.world.landmarks;
  const pos = activePos(game);
  switch (game.mission) {
    case 'm1': {
      if (game.missionStep === 1 && game.playerCar && dist2d(game.playerCar.x, game.playerCar.z, lm.garage.x, lm.garage.z) < 12) {
        completeMission(game);
      }
      break;
    }
    case 'm2': {
      if (game.missionStep === 0) {
        // The crew hops in fast: a car arriving at speed crosses the zone in
        // ~1-2 game-seconds, so boarding has to finish inside that window.
        if (game.playerCar && dist2d(game.playerCar.x, game.playerCar.z, lm.docks.x, lm.docks.z) < 20) {
          game.crewTimer += dt;
          if (game.crewTimer >= 0.4 && game.crewInCar < 2) {
            game.crewTimer = 0;
            game.crewInCar += 1;
            game.toast(game.crewInCar === 1 ? 'Crew member hopped in.' : 'Crew is in. Go!');
          }
          if (game.crewInCar >= 2) {
            game.missionStep = 1;
            game.setWanted(2);
            game.objective = 'Lose the heat — get to the Safehouse';
            game.toast('The crew is in — and so are the cops. Run!');
          }
        }
      } else if (game.playerCar && game.crewInCar >= 2
        && dist2d(game.playerCar.x, game.playerCar.z, lm.safehouse.x, lm.safehouse.z) < 12) {
        completeMission(game);
      }
      break;
    }
    case 'm3': {
      if (game.missionStep === 0) {
        if (dist2d(pos.x, pos.z, lm.docks.x, lm.docks.z) < 12) {
          game.missionStep = 1;
          game.missionTimer = 90;
          game.objective = 'Deliver the package to Bay Mall — 90 seconds!';
          game.toast('Package secured. 90 seconds — move!');
        }
      } else {
        game.missionTimer -= dt;
        if (game.missionTimer <= 0) {
          game.missionTimer = 0;
          game.audio.fail();
          abortMission(game, 'The delivery went cold. Too slow.');
        } else if (dist2d(pos.x, pos.z, lm.mall.x, lm.mall.z) < 12) {
          completeMission(game);
        }
      }
      break;
    }
    case 'm4': {
      game.enemiesDown = game.enemies.filter((e) => e.state === 'down').length;
      if (game.missionStep === 0 && game.enemiesDown >= 2) {
        game.missionStep = 1;
        const gold = makeCar('parked', 112, 104, Math.PI / 2, 0xe0a52e);
        gold.marked = true;
        game.cars.push(gold);
        game.markedCar = gold;
        game.objective = 'Steal the gold car and take it to the Garage';
        game.toast('Guards are down. The gold car is yours — take it.');
      } else if (game.missionStep === 1 && game.inMarkedCar && game.playerCar
        && dist2d(game.playerCar.x, game.playerCar.z, lm.garage.x, lm.garage.z) < 12) {
        completeMission(game);
      }
      break;
    }
    case 'm5': {
      if (game.missionStep === 0) {
        if (dist2d(pos.x, pos.z, lm.casino.x, lm.casino.z) < 12) {
          game.m5Hold += dt;
          if (game.m5Hold >= 8) {
            game.missionStep = 1;
            game.setWanted(3);
            game.objective = 'Vault cracked! Escape to the Safehouse!';
            game.toast('Vault cracked — the alarm is screaming. Run!');
          }
        }
      } else if (dist2d(pos.x, pos.z, lm.safehouse.x, lm.safehouse.z) < 12) {
        completeMission(game);
      }
      break;
    }
    default:
      break;
  }
}
