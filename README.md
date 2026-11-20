# SUNSET BAY

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01)

An open-world crime game in the spirit of GTA 6, built for the [make.fun bounty](https://make.fun/bounty/gta6-01) — $1,666 in USDC, top 100 entries paid. Playable in a desktop browser from static files, no network request, no Rockstar assets: the city, characters, vehicles, names and story are all our own.

## The game

You are **Cole Vance**, fresh in Sunset Bay with $250 in your pocket. Two fixers run the city: **Slim Vasquez** and **Rosa Marín**. Take their jobs, steal what you need, and don't let the Sunset Bay PD catch you.

**The city** — a 9×9 road grid with the Palm Casino, Bay Mall, the Docks, the Safehouse and the Sunset Garage. Day/night cycle, traffic, pedestrians, traffic lights (run a red and the heat goes up), and a $150 respray at the garage that clears your wanted level.

**The jobs**
1. **The First Job** (Slim) — steal a car, bring it to the Sunset Garage. +$300
2. **The Getaway** (Rosa) — pick up the crew at the Docks, lose 2 stars at the Safehouse. +$600
3. **Hot Delivery** (Slim) — grab the package at the Docks, deliver it to Bay Mall in 90 seconds. +$500
4. **Repo Man** (Rosa) — beat down the casino guards, steal the gold car for the Garage. +$800
5. **The Sunset Heist** (Slim) — crack the Palm Casino vault, escape 3 stars to the Safehouse. +$2,500

**Systems** — driving and on-foot movement, car stealing (1 star), a 1–5 star wanted level with police chases (cops stop short, they don't ram you), on-foot and in-car combat, busted/wasted with a respawn fine, localStorage save with Continue, WebAudio engine/siren/cash sounds, and a HUD with cash, stars, health and car condition.

## Controls

| Key | Action |
| --- | --- |
| WASD | Drive / move (mouse drag to look) |
| Shift | Boost (car) / sprint (on foot) |
| E | Enter / exit a car |
| F | Punch |
| P | Pause |
| M | Mission list |
| T | Time of day |

## Run it

Serve `game/` with any static server (or `node serve.ts`) and open `game/index.html` in desktop Chrome. `?seed=1337` fixes the world layout; `?lowfx=1` trims the scene for slow machines. The entrypoint is `main.ts` (Node 22): it copies `game/` and `screenshots/` to the output directory and writes `dossier.json`.

Built with [three.js](https://threejs.org/) r160 (vendored minified under `game/vendor/`) and plain ES modules. No build step, no network request at play time.
