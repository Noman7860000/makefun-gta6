# SUNSET BAY — an open-world crime game

![Make GTA 6](https://make.fun/badge/gta6-01.svg)
![Rank](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/rank.svg)
![Reward](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/reward.svg)

**SUNSET BAY** is an open-world crime game built for the
[Make GTA 6 competition on make.fun](https://make.fun/c/gta6-01).
Cole Vance is back in Sunset Bay with $250, a borrowed jacket and a
reputation to rebuild. Slim Vasquez has work at the garage, Rosa Marín has
bigger plans at the Casino del Sol, and the Sunset Bay PD has eyes
everywhere. Steal cars, run the jobs, dodge the heat — and take the
Sunset Heist.

Play it at the [Make GTA 6 competition page](https://make.fun/c/gta6-01)
once the entry is live.

## The city

Sunset Bay is a sun-soaked coastal city on a road grid, built in three.js:
a beach and ocean to the south, a golden-hour sun, palms, street lights and
traffic lights, and a skyline of lit-window towers. Drive anywhere, on foot
or behind the wheel.

## What is in the game

- **Open world on foot and by car** — steal any parked car (E to get in and
  out), drive with WASD, and explore the whole grid.
- **Traffic and pedestrians** — cars cruise the roads and stop at red
  lights; pedestrians walk the sidewalks and scatter when trouble starts.
- **Wanted level, 1–5 stars** — stealing cars, knocking pedestrians down
  and running red lights draw the Sunset Bay PD. Police cars chase and box
  you in; foot cops run you down on foot. Get caught standing next to a cop
  and you are BUSTED.
- **Respray garage** — roll into Slim's Garage with $150 and the heat is
  cleared.
- **Five story missions** with payouts:
  1. **First Wheels** (+$300) — steal a car and bring it to the garage.
  2. **The Getaway** (+$600) — pick up Rosa's crew at the Docks and lose
     a 2-star heat on the way to the Safehouse.
  3. **Hot Delivery** (+$500) — grab the package at the Docks and reach
     Bayview Mall in 90 seconds.
  4. **Repo Man** (+$800) — deal with the casino guards and steal the
     gold car for the garage.
  5. **The Sunset Heist** (+$2,500) — crack the vault at Casino del Sol
     and escape a 3-star alarm to the Safehouse.
- **Combat** — punch with F; guards and pedestrians go down, and the law
  notices.
- **HUD with a live minimap** — cash, health, wanted stars, the clock,
  speed, the mission objective, a countdown timer and a top-down map with
  the mission marker, police and the player.
- **Start screen, pause, and save/load** — your cash, health, missions and
  position save to the browser and come back with Continue.
- **Day and night** — press T to cycle the time of day, from noon blue to
  sunset gold to night, with the street lights coming on.
- **Synthesised sound** — engine hum, police siren, punches, cash and
  mission jingles, all generated with WebAudio. No audio files.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive |
| E | Enter or exit a car |
| F | Punch |
| P | Pause |
| M | Mission list |
| T | Cycle time of day |
| Shift | Sprint |
| Mouse drag | Look around |

## How to play

Open `game/index.html` in desktop Chrome, or serve the `game/` folder with
any static server (`node serve.ts`, then http://localhost:8080). The game
is plain static files with no build step and no network requests: three.js
is vendored offline under `game/vendor/three.min.js`.

## Files

- `game/index.html` — the page, HUD and menus
- `game/src/util.js` — seeded random numbers and small helpers
- `game/src/world.js` — the city, sky, lights and traffic lights
- `game/src/actors.js` — cars, pedestrians, traffic, police
- `game/src/audio.js` — synthesised WebAudio sound
- `game/src/missions.js` — the five story missions
- `game/src/game.js` — the game itself: driving, combat, wanted, HUD
- `game/src/main.js` — boot and the debug API
- `screenshots/` — four screenshots taken from the game
- `main.ts` — hands the entry in: copies `game/` and `screenshots/` and
  writes `dossier.json`

## License

MIT — see `LICENSE`.
