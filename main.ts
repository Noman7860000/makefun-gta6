// SUNSET BAY — the gta6-01 entrypoint (Node 22, standard library only).
//
// The game is this directory's game/ folder: plain static files a desktop
// browser loads offline (game/index.html and its ES modules, three.js r160
// vendored minified under game/vendor/), no network request at play time.
// This program hands it in: it copies game/ and screenshots/ from beside
// this file to /output and writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library.
//
// The game itself: Cole Vance, $250 in his pocket, a 9x9 street grid with
// the Palm Casino, Bay Mall, the Docks, the Safehouse and the Sunset Garage,
// five missions for Slim Vasquez and Rosa Marin, car stealing, a 1-5 star
// wanted level with police, combat, a save, and a HUD. Open it with
// `node serve.ts`, then http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// SUNSET BAY's entry config: what the game is, where it lives, and the
// limits the scorer enforces on the handed-in copy.
const SUNSET_BAY = {
  title: 'SUNSET BAY',
  bounty: 'gta6-01',
  bountyUrl: 'https://make.fun/bounty/gta6-01',
  hero: 'Cole Vance',
  startingCash: 250,
  fixers: ['Slim Vasquez', 'Rosa Marín'],
  landmarks: ['Palm Casino', 'Bay Mall', 'The Docks', 'Safehouse', 'Sunset Garage'],
  missions: [
    { id: 'm1', name: 'The First Job', reward: 300 },
    { id: 'm2', name: 'The Getaway', reward: 600 },
    { id: 'm3', name: 'Hot Delivery', reward: 500 },
    { id: 'm4', name: 'Repo Man', reward: 800 },
    { id: 'm5', name: 'The Sunset Heist', reward: 2500 },
  ],
  // The scorer's own caps (reference/gate.json): only text_max_bytes shapes
  // the bytes; the others refuse an entry the scorer would refuse (more than
  // 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB
  // of game files, in all, or a path under game/ over 1000 bytes).
  caps: {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  },
};

// Stage the entry: game/ and screenshots/ go to the output directory, and
// the dossier is written from the staged copy so it describes exactly what
// the judge will play.
function stageEntry(here, out) {
  mkdirSync(out, { recursive: true });
  cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  if (existsSync(join(here, 'screenshots'))) {
    cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  }
  return buildDossier(out, SUNSET_BAY.caps);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const dossier = stageEntry(here, out);
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`${SUNSET_BAY.title} staged for ${SUNSET_BAY.bounty}: ${SUNSET_BAY.missions.length} missions, ${SUNSET_BAY.landmarks.length} landmarks -> ${out}`);
