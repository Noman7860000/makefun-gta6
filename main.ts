// SUNSET BAY — entrypoint for make.fun's gta6-01 bounty (Node 22).
// Copies game/ and screenshots/ into the output directory and writes
// /output/dossier.json with the kit's buildDossier. No build step, no deps.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-game.ts';

const GAME_TITLE = 'SUNSET BAY';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const ROOT = new URL('.', import.meta.url).pathname;

function copyTree(name: string): void {
  const src = join(ROOT, name);
  if (!existsSync(src)) throw new Error(GAME_TITLE + ': missing ' + name + '/ in the repository');
  cpSync(src, join(OUT_DIR, name), { recursive: true });
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  copyTree('game');
  copyTree('screenshots');
  const shots = readdirSync(join(OUT_DIR, 'screenshots')).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (shots.length < 3 || shots.length > 4) {
    throw new Error(GAME_TITLE + ': expected 3 or 4 screenshots, found ' + shots.length);
  }
  const dossier = buildDossier(OUT_DIR, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(OUT_DIR, 'dossier.json'), dossier);
  console.log(GAME_TITLE + ': wrote ' + join(OUT_DIR, 'dossier.json'));
}

main();
