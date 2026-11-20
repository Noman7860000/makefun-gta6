// SUNSET BAY actors: the player on foot, cars (parked, traffic, police),
// pedestrians, casino guards and the m2 crew. Meshes are simple grouped
// boxes so the game stays fast under software rendering; the driving,
// chasing and boarding brains live here too.
import { GRID, clamp, angleDiff, dist, makeRng, mergeGeos } from './util.js';

const THREE = window.THREE;

const CAR_COLORS = [
  0xc23a3a, 0x3a6ac2, 0xd8b13a, 0x3a9a5a, 0x8a5ac2, 0xd8d8d8,
  0x2a2a2e, 0xc27a3a, 0x5ab8c2, 0x9a3a6a, 0x4a4a8a, 0xb8b8a8,
];
const SHIRT_COLORS = [
  0xe8e8e8, 0x4a90d8, 0xd84a6a, 0x4ad88a, 0xd8a03a, 0x8a5ad8,
  0x3a3a3a, 0xc2c23a, 0x5ad8c2, 0xd88a4a,
];

function makeCarMesh(color, police) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.4), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.6, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x1c2733 }),
  );
  cabin.position.set(0, 1.15, -0.2);
  cabin.castShadow = true;
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheels = [];
  for (const [wx, wz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.38, wz);
    g.add(w);
    wheels.push(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const s of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), lightMat);
    hl.position.set(s, 0.6, 2.22);
    g.add(hl);
  }
  if (police) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.18, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    bar.position.set(0, 1.55, 0.1);
    g.add(bar);
    g.userData.lightBar = bar;
  }
  g.userData.wheels = wheels;
  return g;
}

// Fast version: the whole car as ONE vertex-coloured mesh (one draw call).
// Used in lowfx mode; the detailed multi-mesh version above is for the
// full-quality screenshots.
function makeCarMeshMerged(color, police) {
  const parts = [];
  const bodyCol = new THREE.Color(color);
  const cabinCol = new THREE.Color(0x1c2733);
  const wheelCol = new THREE.Color(0x141414);
  const lightCol = new THREE.Color(0xfff2b0);
  const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  parts.push({ geo: new THREE.BoxGeometry(1.9, 0.7, 4.4), matrix: at(0, 0.55, 0), color: bodyCol });
  parts.push({ geo: new THREE.BoxGeometry(1.7, 0.6, 2.2), matrix: at(0, 1.15, -0.2), color: cabinCol });
  for (const [wx, wz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    parts.push({
      geo: new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10),
      matrix: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(wx, 0.38, wz),
      color: wheelCol,
    });
  }
  for (const s of [-0.6, 0.6]) {
    parts.push({ geo: new THREE.BoxGeometry(0.35, 0.18, 0.1), matrix: at(s, 0.6, 2.22), color: lightCol });
  }
  const mesh = new THREE.Mesh(
    mergeGeos(parts),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  mesh.castShadow = true;
  if (police) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.18, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    bar.position.set(0, 1.55, 0.1);
    mesh.add(bar);
    mesh.userData.lightBar = bar;
  }
  return mesh;
}

function makePersonMesh(shirt, skin = 0xc89878) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.85, 0.36),
    new THREE.MeshLambertMaterial({ color: shirt }),
  );
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshLambertMaterial({ color: skin }),
  );
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const legs = [];
  for (const s of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.24), legMat);
    leg.position.set(s, 0.32, 0);
    g.add(leg);
    legs.push(leg);
  }
  const armMat = new THREE.MeshLambertMaterial({ color: shirt });
  const arms = [];
  for (const s of [-0.4, 0.4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.18), armMat);
    arm.position.set(s, 1.05, 0);
    g.add(arm);
    arms.push(arm);
  }
  g.userData.legs = legs;
  g.userData.arms = arms;
  return g;
}

// Fast version: the whole person as ONE vertex-coloured mesh (one draw
// call). Used in lowfx mode; the detailed version above is for the
// full-quality screenshots. (No swinging limbs here — the walk cycle is a
// lowfx-only sacrifice; the person still moves and falls the same way.)
function makePersonMeshMerged(shirt, skin = 0xc89878) {
  const parts = [];
  const shirtCol = new THREE.Color(shirt);
  const skinCol = new THREE.Color(skin);
  const legCol = new THREE.Color(0x2a2a3a);
  const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  parts.push({ geo: new THREE.BoxGeometry(0.62, 0.85, 0.36), matrix: at(0, 1.05, 0), color: shirtCol });
  parts.push({ geo: new THREE.SphereGeometry(0.24, 10, 8), matrix: at(0, 1.68, 0), color: skinCol });
  for (const s of [-0.16, 0.16]) {
    parts.push({ geo: new THREE.BoxGeometry(0.22, 0.6, 0.24), matrix: at(s, 0.32, 0), color: legCol });
  }
  for (const s of [-0.4, 0.4]) {
    parts.push({ geo: new THREE.BoxGeometry(0.16, 0.62, 0.18), matrix: at(s, 1.05, 0), color: shirtCol });
  }
  const mesh = new THREE.Mesh(
    mergeGeos(parts),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- cars ----
export class Car {
  constructor(scene, x, z, heading, kind, color, police = false, merged = false) {
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.hp = 100; this.kind = kind; // parked|traffic|police|gold
    this.hitCooldown = 0; // seconds of game time before another crash can hurt it
    this.color = color;
    this.dead = false;
    this.mesh = merged ? makeCarMeshMerged(color, police) : makeCarMesh(color, police);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    // traffic brain
    this.axis = 'x'; this.dir = 1; this.lane = 2; this.road = 0;
    this.targetSpeed = 0;
    this.stuckTimer = 0;
    this.lastX = x; this.lastZ = z;
  }

  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const wheels = this.mesh.userData.wheels;
    if (wheels) {
      const spin = this.speed * 0.06;
      for (const w of wheels) w.rotation.x += spin;
    }
  }

  // Drive the car toward a heading at a target speed (arcade handling:
  // steering needs motion, braking is strong, top speed is capped).
  driveToward(dt, desiredHeading, targetSpeed, accel = 10) {
    const dh = angleDiff(this.heading, desiredHeading);
    const steer = clamp(dh * 1.6, -1, 1);
    const moving = Math.abs(this.speed) > 0.5;
    if (moving) this.heading += steer * 1.7 * dt * clamp(Math.abs(this.speed) / 6, 0.25, 1) * Math.sign(this.speed);
    if (this.speed < targetSpeed) this.speed = Math.min(targetSpeed, this.speed + accel * dt);
    else if (this.speed > targetSpeed) this.speed = Math.max(targetSpeed, this.speed - accel * 1.6 * dt);
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
  }

  updateTraffic(dt, world, rng, others) {
    // Pick a road to follow if none yet.
    if (this.targetSpeed === 0 && this.speed === 0) {
      const alongX = rng.chance(0.5);
      if (alongX) { this.axis = 'x'; this.road = this.z; this.dir = rng.chance(0.5) ? 1 : -1; }
      else { this.axis = 'z'; this.road = this.x; this.dir = rng.chance(0.5) ? 1 : -1; }
      this.lane = this.dir > 0 ? 2 : -2;
      this.targetSpeed = rng.range(8, 12);
    }
    // Where am I heading, and is a junction coming up?
    const along = this.axis === 'x' ? this.x : this.z;
    const cross = this.axis === 'x' ? this.z : this.x;
    let nextJunction = null;
    for (const c of GRID) {
      const d = (c - along) * this.dir;
      if (d > 2 && d < 60) { nextJunction = { at: c, dist: d }; break; }
    }
    // Traffic light: stop at red before the junction.
    let want = this.targetSpeed;
    if (nextJunction && nextJunction.dist < 16) {
      const st = world.lightStateAt(this.x, this.z, this.axis === 'x');
      if (st !== 'green') want = 0;
    }
    // Car ahead: slow down instead of rear-ending it.
    for (const o of others) {
      if (o === this || o.dead) continue;
      const dx = o.x - this.x;
      const dz = o.z - this.z;
      const fwd = dx * this.fx + dz * this.fz;
      const side = Math.abs(dx * this.fz - dz * this.fx);
      if (fwd > 0 && fwd < 12 && side < 3.5) { want = Math.min(want, 2); break; }
    }
    // Maybe turn at the junction.
    if (nextJunction && nextJunction.dist < 3 && rng.chance(0.4)) {
      const crossCoord = nextJunction.at;
      if (this.axis === 'x') {
        this.axis = 'z'; this.road = crossCoord; this.dir = rng.chance(0.5) ? 1 : -1;
      } else {
        this.axis = 'x'; this.road = crossCoord; this.dir = rng.chance(0.5) ? 1 : -1;
      }
      this.lane = this.dir > 0 ? 2 : -2;
    }
    // Steer back onto the lane centre.
    const lanePos = this.axis === 'x' ? this.z : this.x;
    const laneTarget = this.road + this.lane;
    const laneErr = laneTarget - lanePos;
    const baseHeading = this.axis === 'x'
      ? (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (this.dir > 0 ? 0 : Math.PI);
    const desired = baseHeading + clamp(laneErr * 0.06, -0.5, 0.5);
    this.driveToward(dt, desired, want, 7);
    // If wedged (not moving for a while), reverse out and re-aim.
    if (Math.abs(this.speed) < 0.5 && want > 0) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 3) {
      this.speed = -4;
      this.stuckTimer = -2; // grace period while reversing
    }
    this.syncMesh();
  }

  updatePolice(dt, world, tx, tz, stopDist) {
    const d = dist(this.x, this.z, tx, tz);
    const desired = Math.atan2(tx - this.x, tz - this.z);
    let want = 0;
    // Ease off as we close in: charging at 20 m/s to 10 m out and only
    // then braking means overshooting into the suspect's car every time.
    // A pursuit that slows early still catches a slow car and barely
    // nudges a fast one.
    if (d > stopDist + 15) want = 20;
    else if (d > stopDist + 5) want = 10;
    else if (d > stopDist) want = 5;
    else if (d < stopDist - 2.5) want = -4;
    this.driveToward(dt, desired, want, 12);
    // flash the light bar
    if (this.mesh.userData.lightBar) {
      const t = Math.floor(performance.now() / 280) % 2;
      this.mesh.userData.lightBar.material.color.set(t === 0 ? 0xff2222 : 0x2244ff);
    }
    // stuck against a wall: reverse briefly
    const moved = dist(this.x, this.z, this.lastX, this.lastZ);
    if (moved < 0.05 && want > 0) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 2.5) {
      this.speed = -5;
      this.stuckTimer = -1.5;
    }
    this.lastX = this.x; this.lastZ = this.z;
    this.syncMesh();
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}

// -------------------------------------------------------------- people ----
export class Person {
  constructor(scene, x, z, shirt, role = 'ped', merged = false) {
    this.x = x; this.z = z;
    this.heading = Math.random() * Math.PI * 2;
    this.hp = 100;
    this.role = role; // ped | guard | crew
    this.state = 'walk'; // walk | down | flee | wait | board
    this.speed = 0;
    this.dead = false;
    this.downTimer = 0;
    this.walkPhase = Math.random() * 6;
    this.target = null; // {x, z} waypoint
    this.attackTimer = 0;
    this.mesh = merged ? makePersonMeshMerged(shirt) : makePersonMesh(shirt);
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
  }

  syncMesh(dt) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const swing = this.speed > 0.5 ? Math.sin(this.walkPhase) * 0.5 : 0;
    const legs = this.mesh.userData.legs;
    const arms = this.mesh.userData.arms;
    if (legs) {
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
    }
    if (arms) {
      arms[0].rotation.x = -swing * 0.7;
      arms[1].rotation.x = swing * 0.7;
    }
    if (this.state === 'down') {
      this.mesh.rotation.x = Math.PI / 2 - 0.1;
      this.mesh.position.y = 0.25;
    } else {
      this.mesh.rotation.x = 0;
      this.mesh.position.y = 0;
    }
  }

  walkToward(dt, tx, tz, speed) {
    const d = dist(this.x, this.z, tx, tz);
    if (d < 0.6) { this.speed = 0; return true; }
    this.heading = Math.atan2(tx - this.x, tz - this.z);
    this.speed = speed;
    this.walkPhase += dt * speed * 1.6;
    this.x += Math.sin(this.heading) * speed * dt;
    this.z += Math.cos(this.heading) * speed * dt;
    return false;
  }

  updatePed(dt, world, rng, danger) {
    if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) {
        this.state = 'walk';
        this.hp = 100;
        this.speed = 0;
      }
      this.syncMesh(dt);
      return;
    }
    // Flee from nearby danger (a speeding car or a fight).
    if (danger && dist(this.x, this.z, danger.x, danger.z) < 9) {
      this.state = 'flee';
      const away = Math.atan2(this.x - danger.x, this.z - danger.z);
      this.heading = away;
      this.speed = 5;
      this.walkPhase += dt * 8;
      this.x += Math.sin(this.heading) * 5 * dt;
      this.z += Math.cos(this.heading) * 5 * dt;
      world.resolveCircle(this, 0.8);
      this.syncMesh(dt);
      return;
    }
    this.state = 'walk';
    if (!this.target || dist(this.x, this.z, this.target.x, this.target.z) < 2) {
      // pick a new sidewalk waypoint on the grid
      const c = rng.pick(GRID);
      if (rng.chance(0.5)) this.target = { x: rng.range(-200, 200), z: c + (rng.chance(0.5) ? 7.5 : -7.5) };
      else this.target = { x: c + (rng.chance(0.5) ? 7.5 : -7.5), z: rng.range(-200, 200) };
    }
    this.walkToward(dt, this.target.x, this.target.z, 1.6);
    world.resolveCircle(this, 0.8);
    this.syncMesh(dt);
  }

  updateGuard(dt, world, px, pz, playerAlive) {
    if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) { this.state = 'walk'; this.hp = 60; }
      this.syncMesh(dt);
      return 0;
    }
    const d = dist(this.x, this.z, px, pz);
    let dealt = 0;
    if (playerAlive && d < 42) {
      this.walkToward(dt, px, pz, 4.2);
      if (d < 2.3) {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.attackTimer = 1.3;
          dealt = 6; // one guard punch
        }
      }
    } else {
      this.speed = 0;
    }
    world.resolveCircle(this, 0.8);
    this.syncMesh(dt);
    return dealt;
  }

  updateCrew(dt, world, car) {
    if (this.state === 'board') return;
    // They are waiting for the car — hurry over from anywhere in the
    // dock yard, not just when it stops right next to them, or the
    // pickup stalls while the police close in.
    if (car && dist(this.x, this.z, car.x, car.z) < 30) {
      const arrived = this.walkToward(dt, car.x, car.z, 7);
      if (arrived || dist(this.x, this.z, car.x, car.z) < 4) {
        this.state = 'board';
        this.speed = 0;
        this.mesh.visible = false;
      }
    }
    world.resolveCircle(this, 0.8);
    this.syncMesh(dt);
  }

  knockDown() {
    this.state = 'down';
    this.downTimer = 30;
    this.speed = 0;
  }

  dispose(scene) {
    scene.remove(this.mesh);
  }
}

export function randomCarColor(rng) {
  return rng.pick(CAR_COLORS);
}
export function randomShirt(rng) {
  return rng.pick(SHIRT_COLORS);
}
