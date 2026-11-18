// SUNSET BAY — an open-world crime game in the spirit of GTA 6, built for
// make.fun's gta6-01 bounty (Node 22, standard library only).
//
// The game itself is plain static files under game/ — game/index.html plus its
// scripts and the vendored three.js library — so a desktop browser plays it
// fully offline, no network requests at runtime. This entrypoint is the
// hand-in plumbing: it copies game/ and screenshots/ from beside this file
// into /output and writes /output/dossier.json, the summary the judge reads,
// using the vendored make.fun library (vendor/makefun-game.ts).
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// SUNSET BAY: explore the city of Sunset Bay on foot or by stolen car, outrun
// the Sunset Bay PD's wanted system, and work through five story missions for
// Slim Vasquez and Rosa Marín — a getaway, a hot delivery, a repo job, and a
// final casino heist. HUD with a live minimap, health, cash, wanted stars and
// speed; synthesized WebAudio sound and music; day/night cycle that opens at
// golden hour; progress saved to localStorage.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

export const GAME_TITLE = 'SUNSET BAY';
export const GAME_DESCRIPTION =
  'An open-world crime game: steal cars, dodge the police, and pull off five story missions across the city of Sunset Bay.';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyGameFiles() {
  mkdirSync(outDir, { recursive: true });
  cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  const shotsDir = join(repoRoot, 'screenshots');
  if (existsSync(shotsDir)) cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

function writeDossier() {
  // The scorer's own caps (reference/gate.json): only text_max_bytes shapes
  // the bytes; the others refuse an entry the scorer would refuse — more than
  // 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB
  // of game files in all, or a path under game/ over 1000 bytes. game/ counts
  // beside /output's own 1000-entry cap, its screenshots/ and dossier.json.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
}

copyGameFiles();
writeDossier();
console.log(`${GAME_TITLE}: wrote ${join(outDir, 'dossier.json')}`);
