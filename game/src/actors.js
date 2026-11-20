// SUNSET BAY — actors: cars (parked, traffic, police, marked), pedestrians and
// guards. Cars pass through each other (no wedging); traffic keeps to road lanes.
// Written fresh for the v9 rebuild.
import { mulberry32, rand, pick, clamp, wrapAngle, dist } from './util.js';
import { ROAD_COORDS, CITY } from './world.js';

const CAR_COLORS = [0xb03030, 0x3050b0, 0xd0c030, 0x30a0a0, 0x808080, 0xe0e0e0, 0x503060, 0x2a7a3a];

export function makeCar(kind, x, z, heading, color) {
  return {
    kind, x, z, heading, speed: 0, hp: 100,
    color: color ?? pick(mulberry32((Math.random() * 1e9) | 0), CAR_COLORS),
    dead: false, isPolice: kind === 'police',
    lane: null, dir: 1, mesh: null, lightBar: null,
  };
}

// Traffic cars cruise their road lane and turn at junctions. They never leave
// the road, so they never hit a building.
export function updateTraffic(car, world, dt, rng) {
  if (car.lane === null) return;
  const speed = car.cruise || 10;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  car.x += fx * speed * dt;
  car.z += fz * speed * dt;
  // At a junction, sometimes turn onto the cross road.
  const rx = world.nearestRoadCoord(car.x);
  const rz = world.nearestRoadCoord(car.z);
  const nearJunction = Math.abs(car.x - rx) < 3 && Math.abs(car.z - rz) < 3;
  if (nearJunction && rng() < dt * 0.25) {
    const turn = pick(rng, [-1, 1]);
    const alongZ = Math.abs(Math.cos(car.heading)) > 0.7;
    if (alongZ) {
      car.heading = (turn > 0 ? Math.PI / 2 : -Math.PI / 2);
      car.z = rz;
    } else {
      car.heading = turn > 0 ? 0 : Math.PI;
      car.x = rx;
    }
  }
  // Turn around at the city edge.
  if (car.x > CITY - 10 || car.x < -CITY + 10 || car.z > CITY - 10 || car.z < -CITY + 10) {
    car.heading = wrapAngle(car.heading + Math.PI);
  }
  car.speed = speed;
}

export function spawnTraffic(world, rng, count) {
  const cars = [];
  for (let i = 0; i < count; i++) {
    const alongZ = rng() < 0.5;
    const road = pick(rng, ROAD_COORDS);
    const laneOff = pick(rng, [-3, 3]);
    const along = rand(rng, -200, 200);
    const heading = alongZ ? (laneOff > 0 ? 0 : Math.PI) : (laneOff > 0 ? Math.PI / 2 : -Math.PI / 2);
    const car = makeCar('traffic', alongZ ? road + laneOff : along, alongZ ? along : road + laneOff, heading);
    car.lane = road;
    car.cruise = rand(rng, 8, 12);
    cars.push(car);
  }
  return cars;
}

export function spawnParked(world, rng, count) {
  const cars = [];
  for (let i = 0; i < count; i++) {
    const alongZ = rng() < 0.5;
    const road = pick(rng, ROAD_COORDS);
    const side = pick(rng, [-7.5, 7.5]);
    const along = rand(rng, -200, 200);
    const heading = alongZ ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    cars.push(makeCar('parked', alongZ ? road + side : along, alongZ ? along : road + side, heading));
  }
  return cars;
}

// Police chase the player and stop short (7 m) — they close in but never park
// on top of the player, so a stopped player is never rammed into a bust.
// The approach speed is proportional to the distance past 7 m, so the car
// eases to a stop instead of overshooting into the player.
export function updatePolice(car, tx, tz, dt) {
  const d = dist(car.x, car.z, tx, tz);
  const desired = Math.atan2(tx - car.x, tz - car.z);
  car.heading = car.heading + clamp(wrapAngle(desired - car.heading), -2.2 * dt, 2.2 * dt);
  const targetSpeed = clamp((d - 7) * 1.5, 0, 21);
  car.speed += clamp(targetSpeed - car.speed, -40 * dt, 14 * dt);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  car.x = clamp(car.x, -CITY, CITY);
  car.z = clamp(car.z, -CITY, CITY);
}

// Pedestrians stroll the sidewalks (8 m off the road centre) and never wander
// into traffic. A downed ped gets back up after 30 s.
export function makePed(x, z, heading) {
  return {
    x, z, heading, speed: rand(mulberry32((Math.random() * 1e9) | 0), 1.0, 1.8),
    hp: 100, state: 'walk', dead: false, downTimer: 0, mesh: null,
    shirt: pick(mulberry32((Math.random() * 1e9) | 0), [0xc04040, 0x4060c0, 0x40a040, 0xd0a040, 0x9040a0, 0xe0e0e0]),
  };
}

export function updatePed(ped, world, dt, rng) {
  if (ped.state === 'down') {
    ped.downTimer -= dt;
    if (ped.downTimer <= 0) { ped.state = 'walk'; ped.hp = 100; }
    return;
  }
  ped.x += Math.sin(ped.heading) * ped.speed * dt;
  ped.z += Math.cos(ped.heading) * ped.speed * dt;
  const rx = world.nearestRoadCoord(ped.x);
  const rz = world.nearestRoadCoord(ped.z);
  const nearJunction = Math.abs(ped.x - rx) < 4 && Math.abs(ped.z - rz) < 4;
  if (nearJunction && rng() < dt * 0.3) {
    ped.heading = pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]);
  }
  if (ped.x > CITY - 8 || ped.x < -CITY + 8 || ped.z > CITY - 8 || ped.z < -CITY + 8) {
    ped.heading = wrapAngle(ped.heading + Math.PI);
  }
}

export function spawnPeds(world, rng, count) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const alongZ = rng() < 0.5;
    const road = pick(rng, ROAD_COORDS);
    const side = pick(rng, [-8, 8]);
    const along = rand(rng, -200, 200);
    const heading = alongZ ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    peds.push(makePed(alongZ ? road + side : along, alongZ ? along : road + side, heading));
  }
  return peds;
}

// Guards (m4): they stand at the casino, chase the player when close, and
// punch back slowly — 1.5 hp/s, so two guards cost ~12 hp to beat down.
export function makeGuard(x, z) {
  return { x, z, heading: 0, hp: 100, state: 'stand', dead: false, downTimer: 0, attackCd: 0, mesh: null };
}

export function updateGuard(g, player, dt) {
  if (g.state === 'down') {
    g.downTimer -= dt;
    if (g.downTimer <= 0) { g.state = 'stand'; g.hp = 100; }
    return;
  }
  const d = dist(g.x, g.z, player.x, player.z);
  if (d < 30) {
    g.heading = Math.atan2(player.x - g.x, player.z - g.z);
    if (d > 2.2) {
      g.x += Math.sin(g.heading) * 2.2 * dt;
      g.z += Math.cos(g.heading) * 2.2 * dt;
    } else {
      g.attackCd -= dt;
      if (g.attackCd <= 0) {
        player.health -= 1.5;
        g.attackCd = 1;
      }
    }
  }
}
