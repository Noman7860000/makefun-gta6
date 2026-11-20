// SUNSET BAY — actors: cars (parked / traffic / police), pedestrians,
// casino guards and foot police. Factories plus per-frame AI updates.
// Everything here works on plain data; main.js syncs meshes to it.
import { mulberry32, clamp, angDiff, dist2d, pick } from './util.js';
import { ROAD_COORDS, GRID_MIN, GRID_MAX, nearestRoadCoord } from './world.js';

const CAR_COLORS = [0xd43d2a, 0x2a6fd4, 0xe0a52e, 0x3aa655, 0xdddddd, 0x222226, 0x7a4fd4, 0xd4762a];
const PED_COLORS = [0xe0a060, 0x7a9ac0, 0xc06a7a, 0x6aa06a, 0xa08050, 0x8a6aa0];

export function makeCar(kind, x, z, heading, color) {
  return {
    kind, x, z, heading, speed: 0, hp: 100, maxHp: 100, dead: false,
    color, mesh: null, ramCooldown: 0, lastHit: -999, offsetAngle: Math.random() * Math.PI * 2,
    road: null, coord: 0, dir: 1, targetSpeed: 0, nextJunction: 0,
  };
}

export function makePed(x, z, heading, color) {
  return {
    x, z, heading, speed: 0, hp: 100, state: 'walk', color, mesh: null,
    road: null, coord: 0, dir: 1, offset: 7, downTimer: 0, fleeTimer: 0, counted: false,
  };
}

export function makeGuard(x, z) {
  return {
    x, z, heading: 0, hp: 100, state: 'idle', dead: false,
    attackCooldown: 0, spawnX: x, spawnZ: z, mesh: null,
  };
}

export function makeFootCop(x, z) {
  return { x, z, heading: 0, speed: 0, mesh: null };
}

// ---- Spawning -----------------------------------------------------------

export function spawnParkedCars(game) {
  const rng = game.rng;
  const pads = Object.values(game.world.landmarks);
  let placed = 0;
  let guard = 0;
  while (placed < 18 && guard < 300) {
    guard += 1;
    const axis = rng() < 0.5 ? 'x' : 'z';
    const coord = pick(rng, ROAD_COORDS);
    const along = -200 + rng() * 400;
    const side = rng() < 0.5 ? -1 : 1;
    const x = axis === 'x' ? along : coord + side * 7;
    const z = axis === 'x' ? coord + side * 7 : along;
    if (pads.some((p) => dist2d(x, z, p.x, p.z) < 18)) continue;
    if (dist2d(x, z, game.player.x, game.player.z) < 20) continue;
    if (game.cars.some((c) => dist2d(x, z, c.x, c.z) < 8)) continue;
    const heading = axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
    const car = makeCar('parked', x, z, heading, pick(rng, CAR_COLORS));
    game.cars.push(car);
    placed += 1;
  }
}

export function spawnTraffic(game, count) {
  const rng = game.rng;
  for (let i = 0; i < count; i += 1) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const coord = pick(rng, ROAD_COORDS);
    const along = -200 + rng() * 400;
    const dir = rng() < 0.5 ? -1 : 1;
    const car = makeCar('traffic', axis === 'x' ? along : coord, axis === 'x' ? coord : along,
      axis === 'x' ? (dir === 1 ? Math.PI / 2 : -Math.PI / 2) : (dir === 1 ? 0 : Math.PI),
      pick(rng, CAR_COLORS));
    car.road = axis;
    car.coord = coord;
    car.dir = dir;
    car.targetSpeed = 10 + rng() * 4;
    car.nextJunction = nextJunctionCoord(along, dir);
    car.speed = car.targetSpeed;
    game.cars.push(car);
  }
}

function nextJunctionCoord(along, dir) {
  // The next road coordinate ahead of `along` in direction `dir`.
  const sorted = [...ROAD_COORDS].sort((a, b) => a - b);
  if (dir > 0) {
    for (const c of sorted) if (c > along + 2) return c;
    return GRID_MAX;
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) if (sorted[i] < along - 2) return sorted[i];
  return GRID_MIN;
}

export function spawnPeds(game, count) {
  const rng = game.rng;
  for (let i = 0; i < count; i += 1) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const coord = pick(rng, ROAD_COORDS);
    const along = -200 + rng() * 400;
    const dir = rng() < 0.5 ? -1 : 1;
    const side = rng() < 0.5 ? -1 : 1;
    const ped = makePed(
      axis === 'x' ? along : coord + side * 7,
      axis === 'x' ? coord + side * 7 : along,
      axis === 'x' ? (dir === 1 ? Math.PI / 2 : -Math.PI / 2) : (dir === 1 ? 0 : Math.PI),
      pick(rng, PED_COLORS));
    ped.road = axis;
    ped.coord = coord;
    ped.dir = dir;
    ped.offset = side * 7;
    ped.speed = 1 + rng() * 0.5;
    game.peds.push(ped);
  }
}

// ---- Traffic ------------------------------------------------------------

export function updateTraffic(game, dt) {
  const world = game.world;
  for (const car of game.cars) {
    if (car.kind !== 'traffic' || car.dead) continue;
    const axis = car.road;
    const along = axis === 'x' ? car.x : car.z;
    // Junction ahead: turn, or stop on red.
    const distJ = (car.nextJunction - along) * car.dir;
    let target = car.targetSpeed;
    if (distJ < 14 && distJ > -2) {
      const jx = axis === 'x' ? car.nextJunction : car.coord;
      const jz = axis === 'x' ? car.coord : car.nextJunction;
      const light = world.lightStateAt(jx, jz, axis === 'x');
      if (light === 'red') target = 0;
    }
    // Car ahead in the same lane: slow down.
    for (const other of game.cars) {
      if (other === car || other.dead) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const fwd = axis === 'x' ? dx * car.dir : dz * car.dir;
      const side = axis === 'x' ? Math.abs(dz) : Math.abs(dx);
      if (fwd > 0 && fwd < 11 && side < 4.5) { target = 0; break; }
    }
    // Accelerate / brake toward the target speed.
    if (car.speed < target) car.speed = Math.min(target, car.speed + 6 * dt);
    else if (car.speed > target) car.speed = Math.max(target, car.speed - 14 * dt);
    // Move.
    if (axis === 'x') car.x += car.dir * car.speed * dt;
    else car.z += car.dir * car.speed * dt;
    car.heading = axis === 'x'
      ? (car.dir === 1 ? Math.PI / 2 : -Math.PI / 2)
      : (car.dir === 1 ? 0 : Math.PI);
    // Reached the junction: turn or carry on.
    const after = (car.nextJunction - (axis === 'x' ? car.x : car.z)) * car.dir;
    if (after <= 0.5 && car.speed > 0.5) {
      const jx = axis === 'x' ? car.nextJunction : car.coord;
      const jz = axis === 'x' ? car.coord : car.nextJunction;
      const rng = game.rng;
      const atEdge = Math.abs(jx) >= GRID_MAX || Math.abs(jz) >= GRID_MAX;
      if (atEdge || rng() < 0.3) {
        // Turn onto the crossing road.
        const newAxis = axis === 'x' ? 'z' : 'x';
        const newDir = rng() < 0.5 ? -1 : 1;
        const newCoord = newAxis === 'x' ? jz : jx;
        if (newAxis === 'x') {
          car.z = newCoord;
          car.x = clamp(car.x, GRID_MIN, GRID_MAX);
        } else {
          car.x = newCoord;
          car.z = clamp(car.z, GRID_MIN, GRID_MAX);
        }
        car.road = newAxis;
        car.coord = newCoord;
        car.dir = newDir;
        car.nextJunction = nextJunctionCoord(newAxis === 'x' ? car.x : car.z, newDir);
      } else {
        car.nextJunction = nextJunctionCoord(axis === 'x' ? car.x : car.z, car.dir);
      }
    }
    // Keep inside the city.
    car.x = clamp(car.x, GRID_MIN - 6, GRID_MAX + 6);
    car.z = clamp(car.z, GRID_MIN - 6, GRID_MAX + 6);
  }
}

// ---- Pedestrians --------------------------------------------------------

export function updatePeds(game, dt) {
  const player = game.player;
  for (const ped of game.peds) {
    if (ped.state === 'down') {
      ped.downTimer += dt;
      if (ped.downTimer > 25) {
        ped.state = 'walk';
        ped.hp = 100;
        ped.downTimer = 0;
        ped.counted = false;
      }
      continue;
    }
    // Flee from nearby violence.
    const dPlayer = dist2d(ped.x, ped.z, player.x, player.z);
    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      const away = Math.atan2(ped.x - player.x, ped.z - player.z);
      ped.heading = away;
      ped.x += Math.sin(away) * 3.2 * dt;
      ped.z += Math.cos(away) * 3.2 * dt;
      if (ped.fleeTimer <= 0) ped.state = 'walk';
      continue;
    }
    if (dPlayer < 6 && game.lastViolence > game.time - 3) {
      ped.state = 'flee';
      ped.fleeTimer = 4;
      continue;
    }
    // Stroll along the sidewalk.
    const axis = ped.road;
    const speed = ped.speed;
    if (axis === 'x') {
      ped.x += ped.dir * speed * dt;
      ped.heading = ped.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      if (ped.x > GRID_MAX || ped.x < GRID_MIN) ped.dir *= -1;
      if (Math.abs(ped.x - nearestRoadCoord(ped.x)) < 2 && game.rng() < dt * 0.25) {
        ped.road = 'z';
        ped.coord = nearestRoadCoord(ped.x);
        ped.dir = game.rng() < 0.5 ? -1 : 1;
      }
    } else {
      ped.z += ped.dir * speed * dt;
      ped.heading = ped.dir === 1 ? 0 : Math.PI;
      if (ped.z > GRID_MAX || ped.z < GRID_MIN) ped.dir *= -1;
      if (Math.abs(ped.z - nearestRoadCoord(ped.z)) < 2 && game.rng() < dt * 0.25) {
        ped.road = 'x';
        ped.coord = nearestRoadCoord(ped.z);
        ped.dir = game.rng() < 0.5 ? -1 : 1;
      }
    }
  }
}

// ---- Police -------------------------------------------------------------

export function spawnPoliceCar(game) {
  // Spawn on a road 45-70 m from the player.
  const rng = game.rng;
  const px = game.playerCar ? game.playerCar.x : game.player.x;
  const pz = game.playerCar ? game.playerCar.z : game.player.z;
  for (let tries = 0; tries < 20; tries += 1) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const coord = pick(rng, ROAD_COORDS);
    const along = -200 + rng() * 400;
    const x = axis === 'x' ? along : coord;
    const z = axis === 'x' ? coord : along;
    const d = dist2d(x, z, px, pz);
    if (d > 45 && d < 80) {
      const car = makeCar('police', x, z, 0, 0x11131a);
      car.offsetAngle = rng() * Math.PI * 2;
      game.cars.push(car);
      game.policeCars.push(car);
      return car;
    }
  }
  return null;
}

export function updatePolice(game, dt) {
  const target = game.playerCar
    ? { x: game.playerCar.x, z: game.playerCar.z }
    : { x: game.player.x, z: game.player.z };
  for (const cop of game.policeCars) {
    if (cop.dead) continue;
    cop.ramCooldown = Math.max(0, cop.ramCooldown - dt);
    const d = dist2d(cop.x, cop.z, target.x, target.z);
    // Hold a loose ring around the player instead of parking on top of them.
    cop.offsetAngle += dt * 0.12;
    const ringR = 7;
    const tx = target.x + Math.sin(cop.offsetAngle) * ringR;
    const tz = target.z + Math.cos(cop.offsetAngle) * ringR;
    const desired = Math.atan2(tx - cop.x, tz - cop.z);
    const diff = angDiff(cop.heading, desired);
    const turnRate = 2.4;
    cop.heading += clamp(diff, -turnRate * dt, turnRate * dt);
    const aligned = Math.abs(diff) < 1.1;
    const wantSpeed = d > 9 ? 22 : d > 7.5 ? 10 : 0;
    if (aligned && cop.speed < wantSpeed) cop.speed = Math.min(wantSpeed, cop.speed + 12 * dt);
    else if (cop.speed > wantSpeed) cop.speed = Math.max(wantSpeed, cop.speed - 16 * dt);
    cop.x += Math.sin(cop.heading) * cop.speed * dt;
    cop.z += Math.cos(cop.heading) * cop.speed * dt;
    // Ram: only when properly close, and rarely.
    if (d < 4.6 && cop.ramCooldown <= 0) {
      cop.ramCooldown = 2;
      if (game.playerCar) {
        game.damageCar(game.playerCar, 1);
        const push = Math.atan2(game.playerCar.x - cop.x, game.playerCar.z - cop.z);
        game.playerCar.x += Math.sin(push) * 0.6;
        game.playerCar.z += Math.cos(push) * 0.6;
      } else {
        game.damagePlayer(5);
      }
    }
  }
  // Foot police run the player down on foot.
  for (const fp of game.footPolice) {
    const d = dist2d(fp.x, fp.z, game.player.x, game.player.z);
    if (d > 2.2) {
      fp.heading = Math.atan2(game.player.x - fp.x, game.player.z - fp.z);
      fp.x += Math.sin(fp.heading) * 5.5 * dt;
      fp.z += Math.cos(fp.heading) * 5.5 * dt;
    }
  }
}

// ---- Guards ---------------------------------------------------------------

export function updateGuards(game, dt) {
  for (const g of game.enemies) {
    if (g.state === 'down' || g.dead) continue;
    g.attackCooldown = Math.max(0, g.attackCooldown - dt);
    const d = dist2d(g.x, g.z, game.player.x, game.player.z);
    if (d < 30) {
      g.state = d < 2.2 ? 'attack' : 'chase';
      g.heading = Math.atan2(game.player.x - g.x, game.player.z - g.z);
      if (g.state === 'chase') {
        g.x += Math.sin(g.heading) * 3.4 * dt;
        g.z += Math.cos(g.heading) * 3.4 * dt;
      } else if (g.attackCooldown <= 0) {
        g.attackCooldown = 1.2;
        game.damagePlayer(5);
      }
    } else {
      g.state = 'idle';
      // Drift back toward the spawn point.
      const ds = dist2d(g.x, g.z, g.spawnX, g.spawnZ);
      if (ds > 3) {
        const h = Math.atan2(g.spawnX - g.x, g.spawnZ - g.z);
        g.heading = h;
        g.x += Math.sin(h) * 1.5 * dt;
        g.z += Math.cos(h) * 1.5 * dt;
      }
    }
  }
}

// ---- Collisions -----------------------------------------------------------

export function resolveCarCollisions(game, dt) {
  const cars = game.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < cars.length; j += 1) {
      const b = cars[j];
      if (b.dead) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 4.0 && d > 0.01) {
        // The player's car is never blocked by another car: the other car is
        // shoved aside and the player drives on. (A stopped car wedging the
        // player for minutes is what kept killing the long drives.)
        const overlap = 4.0 - d;
        const nx = dx / d;
        const nz = dz / d;
        const aIsPlayer = a === game.playerCar;
        const bIsPlayer = b === game.playerCar;
        if (aIsPlayer) {
          b.x += nx * overlap;
          b.z += nz * overlap;
        } else if (bIsPlayer) {
          a.x -= nx * overlap;
          a.z -= nz * overlap;
        } else {
          a.x -= nx * overlap * 0.5;
          a.z -= nz * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.z += nz * overlap * 0.5;
        }
        // Damage is throttled: a sustained grind must not drain hp every
        // frame. Police contact is handled by the ram logic, not here, and
        // the player's car takes no collision damage from traffic.
        const involvesPolice = a.kind === 'police' || b.kind === 'police';
        const rel = Math.abs(a.speed - b.speed);
        if (!involvesPolice && rel > 8
          && game.time - a.lastHit > 1 && game.time - b.lastHit > 1) {
          const dmg = Math.min(3, (rel - 8) * 0.4);
          a.lastHit = game.time;
          b.lastHit = game.time;
          if (!aIsPlayer) game.damageCar(a, dmg);
          if (!bIsPlayer) game.damageCar(b, dmg);
        }
      }
    }
    // Buildings push cars out (soft, so nobody gets wedged).
    for (const bd of game.world.buildings) {
      const hw = bd.w / 2 + 2;
      const hd = bd.d / 2 + 2;
      const dx = a.x - bd.x;
      const dz = a.z - bd.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        const px = hw - Math.abs(dx);
        const pz = hd - Math.abs(dz);
        if (px < pz) a.x = bd.x + (dx > 0 ? hw : -hw);
        else a.z = bd.z + (dz > 0 ? hd : -hd);
        a.speed *= 0.6;
      }
    }
  }
  // Cars vs pedestrians.
  for (const car of cars) {
    if (car.dead || Math.abs(car.speed) < 3) continue;
    for (const ped of game.peds) {
      if (ped.state === 'down') continue;
      if (dist2d(car.x, car.z, ped.x, ped.z) < 2.4) {
        knockPedDown(game, ped);
        car.speed *= 0.7;
        if (car === game.playerCar && !ped.counted) {
          ped.counted = true;
          game.addWanted(1, 'pedestrian');
        }
      }
    }
    // Cars vs the on-foot player.
    if (car !== game.playerCar && !game.playerCar) {
      if (dist2d(car.x, car.z, game.player.x, game.player.z) < 2.2) {
        game.damagePlayer(8);
        const push = Math.atan2(game.player.x - car.x, game.player.z - car.z);
        game.player.x += Math.sin(push) * 1.2;
        game.player.z += Math.cos(push) * 1.2;
      }
    }
  }
}

export function knockPedDown(game, ped) {
  ped.state = 'down';
  ped.hp = 0;
  ped.downTimer = 0;
  game.lastViolence = game.time;
}
