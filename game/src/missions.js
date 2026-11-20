// SUNSET BAY missions: five jobs in order, each with steps, an objective
// line for the HUD, and a payout. The mission system only reads and writes
// game state (player, cars, cash, wanted, crew, guards) — it never touches
// the renderer.
import { dist } from './util.js';

export const MISSION_DEFS = [
  { id: 'm1', name: 'Borrowed Wheels', payout: 300, desc: 'Steal a car and bring it to the Sunset Garage.' },
  { id: 'm2', name: 'Two for the Road', payout: 600, desc: 'Pick up the crew at the Docks, then take them to the Safehouse.' },
  { id: 'm3', name: 'Hot Delivery', payout: 500, desc: 'Grab the package at the Docks and deliver it to Bay Mall in 90 seconds.' },
  { id: 'm4', name: 'Repo Man', payout: 800, desc: 'Deal with the casino guards, then bring the gold car to the Garage.' },
  { id: 'm5', name: 'The Sunset Heist', payout: 2500, desc: 'Rob the vault at the Palm Casino, then escape to the Safehouse.' },
];

const LM = {
  garage: { x: -156, z: 104 },
  docks: { x: -156, z: -156 },
  safehouse: { x: 156, z: 156 },
  mall: { x: -104, z: 0 },
  casino: { x: 104, z: 104 },
};

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.active = null; // mission id
    this.step = 0;
    this.timer = 0; // m3 countdown
    this.holdTimer = 0; // m5 vault hold
    this.objective = '';
    this.current = null;
  }

  start(id) {
    const def = MISSION_DEFS.find(m => m.id === id);
    if (!def) return false;
    this.cancel();
    this.active = id;
    this.current = def;
    this.step = 0;
    this.timer = 0;
    this.holdTimer = 0;
    const g = this.game;
    if (id === 'm1') {
      this.objective = 'Steal a car';
    } else if (id === 'm2') {
      this.objective = 'Pick up the crew at the Docks';
      g.spawnCrew(LM.docks.x, LM.docks.z);
    } else if (id === 'm3') {
      this.objective = 'Go to the Docks to pick up the package';
    } else if (id === 'm4') {
      this.objective = 'Deal with the guards at the Palm Casino';
      g.spawnGuards(LM.casino.x + 2, LM.casino.z + 6);
      // Parked ON the east-west road by the casino (z = casino.z), east
      // of the junction — the getaway is a straight run west along that
      // road. The old spots (in the block, then on the north-south road
      // south of the junction) both forced an early turn into the blocks,
      // where the car ground along buildings and got rammed to pieces.
      g.spawnMarkedCar(LM.casino.x + 16, LM.casino.z);
    } else if (id === 'm5') {
      this.objective = 'Rob the vault at the Palm Casino — stay in the zone';
    }
    g.toast(`${def.name}: ${this.objective}`);
    return true;
  }

  cancel() {
    if (!this.active) return;
    this.game.clearMissionActors();
    this.active = null;
    this.current = null;
    this.step = 0;
    this.timer = 0;
    this.holdTimer = 0;
    this.objective = '';
  }

  // Called when the player climbs into any car.
  onEnterCar(car) {
    const g = this.game;
    if (this.active === 'm1' && this.step === 0) {
      this.step = 1;
      this.objective = 'Take the car to the Sunset Garage';
      g.setWanted(Math.max(g.wanted, 1));
      g.toast('Stolen car — the cops are onto you. Get to the Garage!');
    }
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const p = g.player;
    if (this.active === 'm1') {
      if (this.step === 1 && g.inCar && g.playerCar) {
        if (dist(g.playerCar.x, g.playerCar.z, LM.garage.x, LM.garage.z) < 14) {
          this.complete();
        }
      }
    } else if (this.active === 'm2') {
      if (this.step === 0) {
        if (g.crewInCar >= 2) {
          this.step = 1;
          this.objective = 'Take the crew to the Safehouse';
          g.setWanted(2);
          g.toast('Crew aboard — 2 stars. Lose the heat, get to the Safehouse.');
        }
      } else if (this.step === 1 && g.inCar && g.playerCar) {
        if (dist(g.playerCar.x, g.playerCar.z, LM.safehouse.x, LM.safehouse.z) < 14) {
          this.complete();
        }
      }
    } else if (this.active === 'm3') {
      if (this.step === 0) {
        if (dist(p.x, p.z, LM.docks.x, LM.docks.z) < 12) {
          this.step = 1;
          this.timer = 90;
          this.objective = 'Deliver the package to Bay Mall — 90 seconds!';
          g.toast('Package picked up. 90 seconds to Bay Mall!');
          g.audio.pickup();
        }
      } else if (this.step === 1) {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 0;
          g.toast('Delivery failed — too slow.');
          g.audio.fail();
          this.cancel();
        } else if (dist(p.x, p.z, LM.mall.x, LM.mall.z) < 12) {
          this.complete();
        }
      }
    } else if (this.active === 'm4') {
      if (this.step === 0) {
        if (g.enemiesDown >= 2) {
          this.step = 1;
          this.objective = 'Take the gold car to the Sunset Garage';
          g.toast('Guards down. Grab the gold car and get it to the Garage.');
        }
      } else if (this.step === 1 && g.inMarkedCar && g.playerCar) {
        if (dist(g.playerCar.x, g.playerCar.z, LM.garage.x, LM.garage.z) < 14) {
          this.complete();
        }
      }
    } else if (this.active === 'm5') {
      if (this.step === 0) {
        if (dist(p.x, p.z, LM.casino.x, LM.casino.z) < 10) {
          this.holdTimer += dt;
          this.objective = `Cracking the vault… ${Math.ceil(8 - this.holdTimer)}s`;
          if (this.holdTimer >= 8) {
            this.step = 1;
            this.objective = 'Escape to the Safehouse';
            g.setWanted(3);
            g.toast('Vault cracked — 3 stars! Run for the Safehouse.');
            g.audio.siren();
          }
        } else {
          this.holdTimer = Math.max(0, this.holdTimer - dt * 2);
          this.objective = 'Rob the vault at the Palm Casino — stay in the zone';
        }
      } else if (this.step === 1) {
        if (dist(p.x, p.z, LM.safehouse.x, LM.safehouse.z) < 14) {
          this.complete();
        }
      }
    }
  }

  complete() {
    const g = this.game;
    const def = this.current;
    g.cash += def.payout;
    g.completed.push(def.id);
    g.toast(`${def.name} complete! +$${def.payout}`);
    g.audio.success();
    g._save();
    this.active = null;
    this.current = null;
    this.step = 0;
    this.timer = 0;
    this.holdTimer = 0;
    this.objective = '';
    g.clearMissionActors();
  }
}
