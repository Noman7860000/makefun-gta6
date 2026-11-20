// SUNSET BAY — boot. Reads ?seed= and ?lowfx= and ?shot=, builds the Game,
// and exposes the debug API the verification harnesses use as window.SUNSET.
import { Game } from './game.js';

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;
const lowfx = params.get('lowfx') === '1';
const shot = params.get('shot');

const canvas = document.getElementById('game');
const game = new Game(canvas, { seed, lowfx, shot });

// Debug / verification API (used by the missions, playtest, probe and
// screenshot harnesses — see the kit's RULES.txt).
window.SUNSET = {
  state: () => game.getState(),
  game,
  teleport: (x, z) => game.teleport(x, z),
  startMission: (id) => game.startMission(id),
  setWanted: (n) => game.setWanted(n),
  giveCash: (n) => game.giveCash(n),
};
