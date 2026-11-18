# SUNSET BAY — Open-World Crime Game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game in the spirit of GTA 6, built by an AI agent for make.fun's "Make GTA 6" bounty, $1,666 in USDC.

Cole Vance came back to Sunset Bay with nothing but a busted car and a debt to Slim Vasquez. One last score was supposed to clear it. Now the whole city — the fixers, the gangs, the Sunset Bay PD — wants a piece of him. Steal cars, outrun the law, and pull off five jobs to buy your way out.

## What is in the game

- **A 3D city to explore** — Sunset Bay: a 9×9 road grid with towers, a central plaza with a fountain, a beach and ocean with a pier, palms, billboards, a hospital, casino, docks, mall, police HQ, safehouse and garage. Day/night cycle that opens at golden hour.
- **On foot and by car** — third-person walking, running and jumping, plus arcade car driving with steering, braking, reversing, skids and collisions. Camera orbits with the mouse and eases behind the car when driving.
- **Traffic and pedestrians** — AI cars drive the streets, stop at red lights and avoid each other; pedestrians walk the sidewalks and flee when scared.
- **Stealing cars** — walk up to any parked or stopped car, press E, and drive it away. Getting out is the same key.
- **Wanted system and police** — stealing cars, hitting pedestrians, running red lights and assault raise wanted stars (1–5). Police cruisers and on-foot officers chase you, ram your car and try to bust you. Lay low and the heat cools off; a respray at the garage clears it for $150.
- **Five story missions** — with objectives, markers, dialogue and cash rewards: First Wheels (steal a car for Slim), The Getaway (pick up crew under pursuit), Hot Delivery (90-second dash), Repo Man (fight the casino guards, steal the gold car), and The Sunset Heist (rob the vault, lose 3 stars). Missions unlock in order; press M for the mission list.
- **Combat** — punches on foot (F or click); guards and police fight back.
- **HUD** — health, cash, wanted stars, speed, mission objective with distance, live canvas minimap (player, cars, police, mission marker), subtitles, toasts, timers and progress bars.
- **Start screen and saves** — title, story intro and controls on the menu; progress, cash, completed missions and settings save to localStorage, with a Continue button.
- **Sound** — fully synthesized WebAudio: engine hum, sirens, skids, horns, punches, crashes, chimes and a synthwave music loop. No audio files, no network.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Move / drive |
| Shift | Run |
| Space | Jump |
| E | Steal / exit car |
| F / Click | Punch |
| Mouse drag | Camera · wheel zooms |
| H | Horn |
| C | Camera distance |
| T | Time of day |
| M | Missions |
| P / Esc | Pause |

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. The game runs fully offline from the static files under `game/` — three.js is vendored at `game/vendor/three.min.js`, and nothing is fetched from a network at runtime.

## Tech

- three.js r160 (vendored, UMD build) for the 3D city; plain canvas 2D for the minimap; WebAudio for all sound.
- `game/src/util.js` (seeded RNG and helpers), `audio.js` (synth), `world.js` (city, landmarks, day/night), `actors.js` (cars, traffic, police and pedestrian AI), `missions.js` (the five story jobs), `game.js` (loop, player, wanted, HUD, saves, screenshots), `main.js` (boot).
- `main.ts` hands the entry in: it copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json` with the vendored make.fun library. Test it with `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.
- Screenshots in `screenshots/` are real renders of the game, taken headless from `?shot=start|drive|chase|mission` (see `shots.json`).

Built by an AI agent for [make.fun's "Make GTA 6" bounty](https://make.fun/bounty/gta6-01?ref=278ah55q).
