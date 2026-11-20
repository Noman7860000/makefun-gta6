// SUNSET BAY — the five missions for Slim Vasquez and Rosa Marín.
// Written fresh for the v9 rebuild.
import { dist } from './util.js';

export const MISSIONS = [
  { id: 'm1', name: 'The First Job', fixer: 'Slim Vasquez', reward: 300, desc: 'Steal a car and bring it to the Sunset Garage.' },
  { id: 'm2', name: 'The Getaway', fixer: 'Rosa Marín', reward: 600, desc: 'Pick up the crew at the Docks, then lose the heat at the Safehouse.' },
  { id: 'm3', name: 'Hot Delivery', fixer: 'Slim Vasquez', reward: 500, desc: 'Grab the package at the Docks and deliver it to Bay Mall in 90 seconds.' },
  { id: 'm4', name: 'Repo Man', fixer: 'Rosa Marín', reward: 800, desc: 'Beat down the casino guards and steal the gold car for the Garage.' },
  { id: 'm5', name: 'The Sunset Heist', fixer: 'Slim Vasquez', reward: 2500, desc: 'Crack the Palm Casino vault, then escape to the Safehouse.' },
];

const NEAR = 12; // mission trigger radius

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.current = null; // {id, step, objective, holdTimer, timer, boardTimer}
    this.completed = [];
  }

  get def() {
    return this.current ? MISSIONS.find((m) => m.id === this.current.id) : null;
  }

  start(id) {
    const def = MISSIONS.find((m) => m.id === id);
    if (!def) return;
    this._clearMissionActors();
    const g = this.game;
    g.crewInCar = 0;
    g.markedCar = null;
    g.inMarkedCar = false;
    this.current = { id, step: 0, objective: '', holdTimer: 0, timer: 0, boardTimer: 0 };
    if (id === 'm1') this.current.objective = 'Steal a car';
    if (id === 'm2') {
      this.current.objective = 'Pick up the crew at the Docks';
      g.spawnCrew();
    }
    if (id === 'm3') this.current.objective = 'Pick up the package at the Docks';
    if (id === 'm4') {
      this.current.objective = 'Beat down the two guards at the Palm Casino';
      g.spawnGuards();
    }
    if (id === 'm5') this.current.objective = 'Rob the vault at the Palm Casino';
    g.toast(`${def.name} — ${def.fixer}: ${this.current.objective}`);
    g.hud();
  }

  _clearMissionActors() {
    const g = this.game;
    for (const e of g.enemies) if (e.mesh) g.scene.remove(e.mesh);
    g.enemies = [];
    g.enemiesDown = 0;
    for (const c of g.crew) if (c.mesh) g.scene.remove(c.mesh);
    g.crew = [];
    if (g.markedCar && g.markedCar.mesh) {
      g.scene.remove(g.markedCar.mesh);
      const i = g.cars.indexOf(g.markedCar);
      if (i >= 0) g.cars.splice(i, 1);
    }
    g.markedCar = null;
  }

  complete() {
    const g = this.game;
    const def = this.def;
    if (!def || !this.current) return;
    g.cash += def.reward;
    this.completed.push(def.id);
    g.toast(`${def.name} complete! +$${def.reward}`);
    g.audio.cash();
    g.audio.mission();
    this.current = null;
    g.hud();
  }

  fail(msg) {
    const g = this.game;
    g.toast(msg);
    g.audio.fail();
    this.current = null;
    g.hud();
  }

  update(dt) {
    const g = this.game;
    const m = this.current;
    if (!m) return;
    const lm = g.world.landmarks;
    const near = (pt, r) => dist(g.player.x, g.player.z, pt.x, pt.z) < r
      || (g.playerCar && dist(g.playerCar.x, g.playerCar.z, pt.x, pt.z) < r);
    const nearCar = (pt, r) => g.playerCar && dist(g.playerCar.x, g.playerCar.z, pt.x, pt.z) < r;

    if (m.id === 'm1') {
      if (m.step === 0 && g.playerCar) {
        m.step = 1;
        m.objective = 'Drive it to the Sunset Garage';
        g.hud();
      } else if (m.step === 1 && nearCar(lm.garage, NEAR)) {
        this.complete();
      }
    } else if (m.id === 'm2') {
      if (m.step === 0 && nearCar(lm.docks, 14)) {
        m.boardTimer += dt;
        if (m.boardTimer > 1 && g.crewInCar < 1) { g.crewInCar = 1; g.hud(); }
        if (m.boardTimer > 2 && g.crewInCar < 2) {
          g.crewInCar = 2;
          m.step = 1;
          m.objective = 'Lose the heat — get to the Safehouse';
          g.setWanted(2);
          g.toast('Crew aboard! 2 stars — lose them at the Safehouse');
          g.hud();
        }
      } else if (m.step === 1 && nearCar(lm.safehouse, NEAR)) {
        this.complete();
      }
    } else if (m.id === 'm3') {
      if (m.step === 0 && dist(g.player.x, g.player.z, lm.docks.x, lm.docks.z) < 10) {
        m.step = 1;
        m.timer = 90;
        m.objective = 'Deliver to Bay Mall — 90 seconds!';
        g.hud();
      } else if (m.step === 1) {
        m.timer -= dt;
        if (m.timer <= 0) { this.fail('Delivery failed — too slow.'); return; }
        if (near(lm.mall, NEAR)) this.complete();
      }
    } else if (m.id === 'm4') {
      if (m.step === 0 && g.enemiesDown >= 2) {
        m.step = 1;
        m.objective = 'Steal the gold car';
        g.spawnMarkedCar();
        g.hud();
      } else if (m.step === 1 && g.inMarkedCar && nearCar(lm.garage, NEAR)) {
        this.complete();
      }
    } else if (m.id === 'm5') {
      if (m.step === 0) {
        if (dist(g.player.x, g.player.z, lm.casino.x, lm.casino.z) < NEAR) {
          m.holdTimer += dt;
          if (m.holdTimer >= 8) {
            m.step = 1;
            m.objective = 'Escape to the Safehouse — 3 stars!';
            g.setWanted(3);
            g.toast('Vault cracked! 3 stars — run for the Safehouse');
            g.hud();
          }
        } else {
          m.holdTimer = 0;
        }
      } else if (m.step === 1 && near(lm.safehouse, NEAR)) {
        this.complete();
      }
    }
  }
}
