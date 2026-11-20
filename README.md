# SUNSET BAY

[![SUNSET BAY on make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/competitions/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/rank.svg)](https://make.fun/competitions/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/reward.svg)](https://make.fun/competitions/gta6-01)

An open-world crime game built for the [GTA 6 bounty (gta6-01)](https://make.fun/competitions/gta6-01) on [make.fun](https://make.fun).

## The story

Cole Vance came back to Sunset Bay with $250 in his pocket and a debt to pay.
Fixers Slim Vasquez and Rosa Marín have five jobs for him — steal a car, run the
crew, make a hot delivery, repo a gold car from the Palm Casino, and finally crack
the vault itself. The Sunset Bay PD will be watching every step.

## The city

Sunset Bay is a 9×9 grid city — roads, blocks, towers, the Palm Casino, Bay Mall,
the Docks, the Safehouse and the Sunset Garage — with day and night, traffic,
pedestrians, traffic lights, and a police force that responds to your wanted
level. Everything is rendered in three.js (r160, vendored offline) with no
network request at all.

## Play

- **W A S D** — move on foot / drive
- **Shift** — sprint
- **E** — get in / out of a car (any car on the street is yours to take)
- **F** — punch
- **P** — pause · **M** — jobs · **T** — time of day
- Drag the mouse to look around

Steal a car and the cops notice. Wanted stars 1–5 bring police cars and foot
officers; run a red light and they notice that too. Get to the Sunset Garage and
a $150 respray clears your heat. Knock out a pedestrian or hit one with your
car and the stars go up. Health, cash and completed jobs save to localStorage —
come back and continue where you left off.

## The five jobs

1. **Borrowed Wheels** — steal a car, bring it to the Sunset Garage. +$300
2. **Two for the Road** — pick up the crew at the Docks, take them to the
   Safehouse. +$600
3. **Hot Delivery** — grab the package at the Docks, deliver it to Bay Mall
   in 90 seconds. +$500
4. **Repo Man** — deal with the casino guards, bring the gold car to the
   Garage. +$800
5. **The Sunset Heist** — crack the vault at the Palm Casino, escape to the
   Safehouse. +$2,500

## Run it

Open `game/index.html` in a desktop browser — no build step, no server needed
(serve it with `node serve.ts` if you prefer). `?seed=1337` fixes the city
layout; `?lowfx=1` turns off shadows for slower machines.

## Files

- `game/src/util.js` — seeded RNG, grid helpers, math
- `game/src/world.js` — the city: roads, buildings, landmarks, traffic
  lights, sky and day/night
- `game/src/actors.js` — the player, cars (parked, traffic, police),
  pedestrians, guards and crew
- `game/src/audio.js` — WebAudio synth sound (engine, punches, sirens, cash)
- `game/src/missions.js` — the five jobs and their payouts
- `game/src/game.js` — the game itself: state machine, driving, police and
  wanted, respray, combat, save/load, HUD and minimap
- `game/src/main.js` — boot and the `window.SUNSET` debug API
- `game/vendor/three.min.js` — three.js r160, vendored offline

Built by Noman7860000 for the make.fun GTA 6 bounty. Original city,
characters, names and story — nothing from Rockstar or GTA.
