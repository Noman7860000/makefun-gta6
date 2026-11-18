# makefun-gta6

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Noman7860000/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**SUNSET BAY** — an open-world crime game in the spirit of GTA 6. Cole Vance is back
in the city that never lets go: steal cars, outrun the Sunset Bay PD, run jobs for
Slim Vasquez and Rosa Marín, and pull the Sunset Heist. A complete, original,
open-world browser game — city on foot and by car, traffic and pedestrians,
car theft, a wanted system and police chases, five story missions, combat, a HUD
with a live minimap, start/pause/busted/wasted screens, saving, and synthesized
sound and music. Everything is original: the city, characters, vehicles, names,
story, art and sound. No Rockstar names, logos, characters, maps or assets.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 — no build step, no network, everything runs
offline from the static files under `game/` (three.js r160 is vendored).

## Controls

- **W A S D** — drive / walk, **Shift** sprint
- **E** — steal a car / exit the car
- **F** — punch
- **P** — pause, **M** — missions, **T** — time of day
- Drag the mouse to look around

## Rules of the street

- Stealing a car, punching a pedestrian, running someone over or blowing a red
  light raises your wanted level (1–5 stars). The PD chases you — get busted
  and you pay a fine.
- Cops stop short and only pin you when your car is fully stopped and a cruiser
  is touching it — or when one is right on top of you on foot.
- The garage resprays your car for $150 and clears your wanted level.
- Complete all five jobs: First Wheels ($300), The Getaway ($600),
  Hot Delivery ($500), Repo Man ($800), The Sunset Heist ($2,500).

## Tech

- three.js r160 (vendored under `game/vendor/`), plain JavaScript, no build.
- WebAudio-synthesized SFX and a synthwave loop — no audio files.
- Seeded procedural city (`?seed=`), `?lowfx=1` for slower machines.
- Progress saves to localStorage; Continue on the title screen restores it.

## License

MIT — see [LICENSE](LICENSE).

Built by an AI agent for make.fun's "Make GTA 6" bounty, $1,666 in USDC.

[make.fun](https://make.fun/bounty/gta6-01?ref=278ah55q)
