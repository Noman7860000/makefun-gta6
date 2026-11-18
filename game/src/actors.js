// SUNSET BAY — actors: cars (player / traffic / police / parked), people
// (player on foot, pedestrians, foot police, enemies) and their physics/AI.
// Classic script, no modules. All movers resolve against building AABBs.

(function (global) {
  'use strict';
  const U = global.SBUtil;

  const CAR_COLORS = [0xc23a2e, 0x2e6ac2, 0xd8a020, 0x3a9a4a, 0x8a4ac2, 0xc2c2c2, 0x222222, 0x6a8a9a, 0xd87030, 0x4a2a6a];

  // ---- collision helpers -------------------------------------------------
  function resolveCircleBuilding(world, x, z, r) {
    const b = world.hitsBuilding(x, z, r);
    if (!b) return { x: x, z: z, hit: false };
    // Push out along the smallest penetration axis.
    const dxl = (x + r) - b.minX, dxr = b.maxX - (x - r);
    const dzl = (z + r) - b.minZ, dzr = b.maxZ - (z - r);
    const m = Math.min(dxl, dxr, dzl, dzr);
    if (m === dxl) x = b.minX - r;
    else if (m === dxr) x = b.maxX + r;
    else if (m === dzl) z = b.minZ - r;
    else z = b.maxZ + r;
    return { x: x, z: z, hit: true };
  }
  function circleOverlap(ax, az, ar, bx, bz, br) {
    const dx = ax - bx, dz = az - bz;
    const d = Math.sqrt(dx * dx + dz * dz);
    const min = ar + br;
    if (d >= min || d === 0) return null;
    return { nx: dx / d, nz: dz / d, depth: min - d, d: d };
  }

  // ---- car mesh ----------------------------------------------------------
  function makeCarMesh(color, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: color });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x101418, emissive: 0x0a1a24 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
    body.position.y = 0.55; body.castShadow = true; g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glassMat);
    cabin.position.set(0, 1.1, -0.2); cabin.castShadow = true; g.add(cabin);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.9), bodyMat);
    hood.position.set(0, 0.82, 1.75); g.add(hood);
    // Headlights + taillights.
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xcc2211 });
    [-0.65, 0.65].forEach((x) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), hlMat);
      hl.position.set(x, 0.62, 2.22); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), tlMat);
      tl.position.set(x, 0.62, -2.22); g.add(tl);
    });
    // Wheels.
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]].forEach((p, i) => {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.set(p[0], 0.36, p[1]);
      w.castShadow = true;
      g.add(w);
      wheels.push({ mesh: w, front: i < 2 });
    });
    if (opts.police) {
      const barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      barR.position.set(-0.4, 1.48, -0.2); g.add(barR);
      const barB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0x2255ff }));
      barB.position.set(0.4, 1.48, -0.2); g.add(barB);
      g.userData.lightBar = [barR, barB];
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.2, 4.42), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      stripe.position.y = 0.55; g.add(stripe);
    }
    if (opts.taxi) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0xffd800 }));
      sign.position.set(0, 1.5, -0.2); g.add(sign);
    }
    return { group: g, wheels: wheels, bodyMat: bodyMat };
  }

  // ---- car ----------------------------------------------------------------
  function createCar(scene, world, opts) {
    opts = opts || {};
    const rng = opts.rng || U.makeRng(1);
    const color = opts.color !== undefined ? opts.color : rng.pick(CAR_COLORS);
    const built = makeCarMesh(color, opts);
    scene.add(built.group);
    const car = {
      mesh: built.group,
      wheels: built.wheels,
      bodyMat: built.bodyMat,
      x: opts.x || 0, z: opts.z || 0,
      heading: opts.heading || 0,
      speed: 0, steer: 0,
      maxSpeed: opts.maxSpeed || 34,
      accel: opts.accel || 16,
      hp: 100, maxHp: 100,
      kind: opts.kind || 'traffic', // player | traffic | police | parked
      occupied: !!opts.occupied,
      driver: null,
      cruise: opts.cruise || rng.range(10, 14),
      route: null, routeIdx: 0,
      stopped: false, stopTimer: 0,
      reverseTimer: 0, stuckTimer: 0,
      sirenPhase: 0,
      dead: false,
      radius: 2.3,
    };
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    return car;
  }

  function carForward(car) {
    return { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  }

  // Player-driven arcade physics. input: { throttle, brake, steer }.
  // events: array to push { type:'crash', intensity } etc.
  function driveCar(car, world, input, dt, events) {
    const prevSpeed = car.speed;
    const targetSteer = U.clamp(input.steer, -1, 1);
    car.steer = U.damp(car.steer, targetSteer, 8, dt);
    const maxF = car.maxSpeed, maxR = 13;
    if (input.throttle > 0) car.speed += car.accel * input.throttle * dt;
    if (input.brake > 0) {
      if (car.speed > 0.5) car.speed -= 30 * input.brake * dt;
      else car.speed -= 10 * input.brake * dt; // reverse
    }
    // Drag + rolling resistance.
    car.speed -= car.speed * 0.35 * dt;
    if (Math.abs(car.speed) < 0.15 && input.throttle <= 0 && input.brake <= 0) car.speed = 0;
    car.speed = U.clamp(car.speed, -maxR, maxF);
    // Steering: sharper at low speed, milder at high speed. D (positive steer)
    // turns the car toward screen-right, which decreases heading.
    const spd = Math.abs(car.speed);
    const turnRate = car.steer * U.clamp(spd / 8, 0, 1) * 1.9 * (car.speed >= 0 ? 1 : -1);
    car.heading -= turnRate * dt;
    const f = carForward(car);
    let nx = car.x + f.x * car.speed * dt;
    let nz = car.z + f.z * car.speed * dt;
    const res = resolveCircleBuilding(world, nx, nz, 2.0);
    if (res.hit) {
      const impact = Math.abs(prevSpeed);
      if (impact > 7 && events) events.push({ type: 'crash', intensity: U.clamp(impact / 30, 0.2, 1), x: nx, z: nz });
      car.speed *= -0.3;
      nx = res.x; nz = res.z;
    }
    // World bounds.
    nx = U.clamp(nx, -300, 300); nz = U.clamp(nz, -300, 330);
    car.x = nx; car.z = nz;
    syncCarMesh(car, dt);
  }

  function syncCarMesh(car, dt) {
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    const spin = car.speed * dt / 0.36;
    for (let i = 0; i < car.wheels.length; i++) {
      const w = car.wheels[i];
      w.mesh.rotation.x += spin;
      if (w.front) w.mesh.rotation.y = car.steer * 0.42;
    }
    if (car.kind === 'police' && car.mesh.userData.lightBar) {
      car.sirenPhase += dt * 6;
      const on = Math.sin(car.sirenPhase) > 0;
      car.mesh.userData.lightBar[0].material.color.setHex(on ? 0xff2222 : 0x550000);
      car.mesh.userData.lightBar[1].material.color.setHex(on ? 0x000088 : 0x2255ff);
    }
  }

  // Traffic AI: follow the road grid, stop at red lights, avoid cars ahead.
  function updateTrafficCar(car, world, cars, dt, playerPos) {
    if (!car.route || car.routeIdx >= car.route.length) {
      car.route = planRoute(world, car);
      car.routeIdx = 0;
    }
    const target = car.route[car.routeIdx];
    const dx = target.x - car.x, dz = target.z - car.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 3) { car.routeIdx++; return; }
    const wantHeading = Math.atan2(dx, dz);
    const diff = U.angleDiff(car.heading, wantHeading);
    // Slow for turns.
    const turnSlow = Math.abs(diff) > 0.5 ? 0.45 : 1;
    // Red light ahead? Stop line is 6m before the intersection.
    let blocked = false;
    const aheadX = car.x + Math.sin(car.heading) * 9;
    const aheadZ = car.z + Math.cos(car.heading) * 9;
    const alongX = Math.abs(Math.cos(car.heading)) < 0.5;
    if (world.lightStateAt(aheadX, aheadZ, alongX) === 'red') blocked = true;
    // Car ahead in same lane?
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o === car || o.dead) continue;
      const odx = o.x - car.x, odz = o.z - car.z;
      const fwd = odx * Math.sin(car.heading) + odz * Math.cos(car.heading);
      const side = Math.abs(odx * Math.cos(car.heading) - odz * Math.sin(car.heading));
      if (fwd > 0 && fwd < 10 && side < 3.2) { blocked = true; break; }
    }
    // Pedestrian right in front?
    if (car.nearPed) blocked = true;
    const targetSpeed = blocked ? 0 : car.cruise * turnSlow;
    car.speed = U.damp(car.speed, targetSpeed, 1.6, dt);
    car.heading = U.angleLerp(car.heading, wantHeading, U.clamp(2.2 * dt, 0, 1));
    const f = carForward(car);
    let nx = car.x + f.x * car.speed * dt;
    let nz = car.z + f.z * car.speed * dt;
    const res = resolveCircleBuilding(world, nx, nz, 2.0);
    if (res.hit) { nx = res.x; nz = res.z; car.speed *= 0.5; }
    car.x = nx; car.z = nz;
    syncCarMesh(car, dt);
  }

  // Pick a random route: a few intersections to visit.
  function planRoute(world, car) {
    const rng = U.makeRng((Math.random() * 1e9) | 0);
    const pts = [];
    let x = world.nearestRoad(car.x), z = world.nearestRoad(car.z);
    pts.push({ x: x, z: z });
    for (let i = 0; i < 5; i++) {
      if (rng.next() < 0.5) x = world.roadCoord(rng.int(0, 8));
      else z = world.roadCoord(rng.int(0, 8));
      pts.push({ x: x, z: z });
    }
    return pts;
  }

  // Police pursuit: seek the target with road bias; reverse out when stuck.
  function updatePoliceCar(car, world, tx, tz, dt, events, onFoot) {
    const d = U.dist(car.x, car.z, tx, tz);
    if (car.reverseTimer > 0) {
      car.reverseTimer -= dt;
      car.speed = U.damp(car.speed, -8, 3, dt);
      car.heading += 1.6 * dt;
    } else {
      const wantHeading = Math.atan2(tx - car.x, tz - car.z);
      const diff = U.angleDiff(car.heading, wantHeading);
      // On foot, the patrol car stops short and lets foot police make the
      // arrest — it does not run the player down. In a car, it pulls up
      // alongside and stops: the pin/bust rule then makes the arrest. It
      // must not keep ramming a stopped car at full speed.
      const targetSpeed = onFoot
        ? (d > 8 ? car.maxSpeed : 0)
        : (d > 12 ? car.maxSpeed : (d > 5 ? Math.max(10, car.maxSpeed * 0.5) : 0));
      car.speed = U.damp(car.speed, targetSpeed, 1.8, dt);
      car.heading = U.angleLerp(car.heading, wantHeading, U.clamp(3.0 * dt, 0, 1));
      // Stuck detection: barely moving while trying.
      if (!onFoot && Math.abs(car.speed) < 1.5 && d > 6) {
        car.stuckTimer += dt;
        if (car.stuckTimer > 1.2) { car.reverseTimer = 0.9; car.stuckTimer = 0; }
      } else car.stuckTimer = 0;
    }
    const f = carForward(car);
    const prevSpeed = car.speed;
    let nx = car.x + f.x * car.speed * dt;
    let nz = car.z + f.z * car.speed * dt;
    const res = resolveCircleBuilding(world, nx, nz, 2.0);
    if (res.hit) {
      if (Math.abs(prevSpeed) > 8 && events) events.push({ type: 'crash', intensity: 0.4, x: nx, z: nz });
      car.speed *= -0.25;
      nx = res.x; nz = res.z;
    }
    car.x = nx; car.z = nz;
    syncCarMesh(car, dt);
  }

  // ---- person mesh ---------------------------------------------------------
  function makePersonMesh(opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: opts.skin || 0xc98a5e });
    const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt || 0x3a6ac2 });
    const pants = new THREE.MeshLambertMaterial({ color: opts.pants || 0x2a2a30 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
    torso.position.y = 1.12; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skin);
    head.position.y = 1.68; head.castShadow = true; g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), new THREE.MeshLambertMaterial({ color: opts.hair || 0x1a1a1a }));
    hair.position.y = 1.9; g.add(hair);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), pants);
    legL.position.set(-0.17, 0.36, 0); g.add(legL);
    const legR = legL.clone(); legR.position.x = 0.17; g.add(legR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), shirt);
    armL.position.set(-0.42, 1.14, 0); g.add(armL);
    const armR = armL.clone(); armR.position.x = 0.42; g.add(armR);
    if (opts.police) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x1a2a6a }));
      cap.position.y = 1.98; g.add(cap);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd800 }));
      badge.position.set(0.14, 1.3, 0.18); g.add(badge);
    }
    if (opts.enemy) {
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.38), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      vest.position.y = 1.2; g.add(vest);
    }
    g.userData.parts = { legL: legL, legR: legR, armL: armL, armR: armR, torso: torso };
    return g;
  }

  function createPerson(scene, opts) {
    opts = opts || {};
    const mesh = makePersonMesh(opts);
    scene.add(mesh);
    const p = {
      mesh: mesh,
      x: opts.x || 0, z: opts.z || 0,
      heading: opts.heading || 0,
      speed: 0, vy: 0, y: 0,
      hp: opts.hp || 100, maxHp: opts.hp || 100,
      kind: opts.kind || 'ped', // player | ped | police | enemy
      state: 'walk', // walk | flee | down | chase | attack
      node: null, nodeTimer: 0,
      attackTimer: 0, punchTimer: 0,
      downTimer: 0, walkPhase: 0,
      dead: false,
      radius: 0.6,
    };
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.heading;
    return p;
  }

  function animatePerson(p, dt, moving) {
    const parts = p.mesh.userData.parts;
    if (!parts) return;
    if (moving) {
      p.walkPhase += dt * (p.speed > 6 ? 11 : 7);
      const s = Math.sin(p.walkPhase);
      parts.legL.rotation.x = s * 0.7;
      parts.legR.rotation.x = -s * 0.7;
      parts.armL.rotation.x = -s * 0.5;
      parts.armR.rotation.x = s * 0.5;
    } else {
      parts.legL.rotation.x = U.damp(parts.legL.rotation.x, 0, 10, dt);
      parts.legR.rotation.x = U.damp(parts.legR.rotation.x, 0, 10, dt);
      parts.armL.rotation.x = U.damp(parts.armL.rotation.x, 0, 10, dt);
      parts.armR.rotation.x = U.damp(parts.armR.rotation.x, 0, 10, dt);
    }
    if (p.state === 'down') {
      p.mesh.rotation.x = U.damp(p.mesh.rotation.x, -Math.PI / 2 * 0.9, 6, dt);
    } else {
      p.mesh.rotation.x = U.damp(p.mesh.rotation.x, 0, 8, dt);
    }
    // Punch animation: right arm swings forward.
    if (p.punchTimer > 0) {
      p.punchTimer -= dt;
      parts.armR.rotation.x = -1.6 * Math.sin((p.punchTimer / 0.35) * Math.PI);
    }
  }

  function syncPersonMesh(p) {
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.y = p.heading;
  }

  // Pedestrian AI: wander sidewalks, flee danger, go down when hit.
  function updatePed(p, world, dt, dangerPos, dangerRadius) {
    if (p.state === 'down') {
      p.downTimer -= dt;
      if (p.downTimer <= 0) { p.dead = true; }
      animatePerson(p, dt, false);
      return;
    }
    let speed = 1.3;
    if (dangerPos && U.dist(p.x, p.z, dangerPos.x, dangerPos.z) < dangerRadius) {
      p.state = 'flee';
      speed = 3.4;
      const away = Math.atan2(p.x - dangerPos.x, p.z - dangerPos.z);
      p.heading = U.angleLerp(p.heading, away, U.clamp(6 * dt, 0, 1));
    } else {
      if (p.state === 'flee') p.state = 'walk';
      p.nodeTimer -= dt;
      if (!p.node || p.nodeTimer <= 0 || U.dist(p.x, p.z, p.node.x, p.node.z) < 2) {
        const nodes = world.pedNodes;
        p.node = nodes[(Math.random() * nodes.length) | 0];
        p.nodeTimer = 14;
      }
      const want = Math.atan2(p.node.x - p.x, p.node.z - p.z);
      p.heading = U.angleLerp(p.heading, want, U.clamp(2.5 * dt, 0, 1));
    }
    p.speed = speed;
    const nx = p.x + Math.sin(p.heading) * speed * dt;
    const nz = p.z + Math.cos(p.heading) * speed * dt;
    const res = resolveCircleBuilding(world, nx, nz, 0.6);
    p.x = res.x; p.z = res.z;
    animatePerson(p, dt, true);
    syncPersonMesh(p);
  }

  // Foot police: run at the player, punch when close.
  function updateFootPolice(p, world, tx, tz, dt, events) {
    if (p.state === 'down') { p.downTimer -= dt; if (p.downTimer <= 0) p.dead = true; animatePerson(p, dt, false); return; }
    const d = U.dist(p.x, p.z, tx, tz);
    if (d < 1.9) {
      p.attackTimer -= dt;
      if (p.attackTimer <= 0) {
        p.attackTimer = 1.4;
        p.punchTimer = 0.35;
        if (events) events.push({ type: 'playerHit', damage: 7, x: p.x, z: p.z });
      }
      p.speed = 0;
      animatePerson(p, dt, false);
      syncPersonMesh(p);
      return;
    }
    const want = Math.atan2(tx - p.x, tz - p.z);
    p.heading = U.angleLerp(p.heading, want, U.clamp(5 * dt, 0, 1));
    p.speed = 7.5;
    const nx = p.x + Math.sin(p.heading) * p.speed * dt;
    const nz = p.z + Math.cos(p.heading) * p.speed * dt;
    const res = resolveCircleBuilding(world, nx, nz, 0.6);
    p.x = res.x; p.z = res.z;
    animatePerson(p, dt, true);
    syncPersonMesh(p);
  }

  // Enemy (guard/gang): approaches and punches the player.
  function updateEnemy(p, world, tx, tz, dt, events) {
    if (p.state === 'down') { p.downTimer -= dt; if (p.downTimer <= 0) p.dead = true; animatePerson(p, dt, false); return; }
    const d = U.dist(p.x, p.z, tx, tz);
    if (d < 2.0) {
      p.attackTimer -= dt;
      if (p.attackTimer <= 0) {
        p.attackTimer = 1.4;
        p.punchTimer = 0.35;
        if (events) events.push({ type: 'playerHit', damage: 7, x: p.x, z: p.z });
      }
      p.speed = 0;
      animatePerson(p, dt, false);
      syncPersonMesh(p);
      return;
    }
    if (d > 60) { // too far: idle in place
      p.speed = 0;
      animatePerson(p, dt, false);
      syncPersonMesh(p);
      return;
    }
    const want = Math.atan2(tx - p.x, tz - p.z);
    p.heading = U.angleLerp(p.heading, want, U.clamp(4 * dt, 0, 1));
    p.speed = 5.2;
    const nx = p.x + Math.sin(p.heading) * p.speed * dt;
    const nz = p.z + Math.cos(p.heading) * p.speed * dt;
    const res = resolveCircleBuilding(world, nx, nz, 0.6);
    p.x = res.x; p.z = res.z;
    animatePerson(p, dt, true);
    syncPersonMesh(p);
  }

  global.SBActors = {
    CAR_COLORS: CAR_COLORS,
    resolveCircleBuilding: resolveCircleBuilding,
    circleOverlap: circleOverlap,
    makeCarMesh: makeCarMesh,
    createCar: createCar,
    driveCar: driveCar,
    syncCarMesh: syncCarMesh,
    updateTrafficCar: updateTrafficCar,
    updatePoliceCar: updatePoliceCar,
    planRoute: planRoute,
    makePersonMesh: makePersonMesh,
    createPerson: createPerson,
    animatePerson: animatePerson,
    syncPersonMesh: syncPersonMesh,
    updatePed: updatePed,
    updateFootPolice: updateFootPolice,
    updateEnemy: updateEnemy,
  };
})(window);
