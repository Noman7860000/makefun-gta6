// SUNSET BAY — boot: read the URL params, build the game, wire the debug API
// the tests drive (window.SUNSET), and run the frame loop.
// ?seed=N fixes the world layout. ?lowfx=1 trims the scene for slow machines.
// Written fresh for the v9 rebuild.
import { Game } from './game.js';

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;
const lowfx = params.get('lowfx') === '1';

const canvas = document.getElementById('game');
const game = new Game(canvas, { seed, lowfx });

window.SUNSET = {
  game,
  state: () => game.stateSnapshot(),
  startMission: (id) => game.missions.start(id),
  teleport: (x, z) => game.teleport(x, z),
  setWanted: (n) => game.setWanted(n),
  giveCash: (n) => game.giveCash(n),
};

game.start();
