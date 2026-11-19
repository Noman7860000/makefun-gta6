// SUNSET BAY — actors.js
// Everything that moves through the city besides the player: the car and
// pedestrian meshes, the traffic cars that cruise the road grid, the
// pedestrians on the sidewalks, and the police cars and foot cops that
// respond to the wanted level. Behaviour functions take the game object so
// this file never imports the game itself.
(function () {
  'use strict';
  var U = window.SB.util;
  var W = window.SB.world;

  var CAR_COLORS = [0xc23a2e, 0x2e6fc2, 0xd8c93a, 0x3aa655, 0x8a8f96, 0x22242a, 0xe8e2d4, 0x7a4a9c, 0xd87a2e];
  var SHIRT_COLORS = [0xd84a4a, 0x4a7ad8, 0x4ad87a, 0xd8c94a, 0xe8e8e8, 0x9c4ad8, 0x4ad8d8, 0xd88a4a];

  function makeCarMesh(color, isPolice, isGold) {
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: color });
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 4.4), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);
    var cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.55, 2.1),
      new THREE.MeshLambertMaterial({ color: 0x1c2733 })
    );
    cabin.position.set(0, 1.08, -0.25);
    cabin.castShadow = true;
    g.add(cabin);
    // Wheels.
    var wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
    var wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
    var wheelPos = [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]];
    for (var i = 0; i < 4; i++) {
      var w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wheelPos[i][0], 0.38, wheelPos[i][1]);
      g.add(w);
    }
    // Headlights and tail lights.
    var headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    var tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1), headMat);
    hl.position.set(-0.65, 0.6, 2.21);
    g.add(hl);
    var hr = hl.clone();
    hr.position.x = 0.65;
    g.add(hr);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1), tailMat);
    tl.position.set(-0.65, 0.6, -2.21);
    g.add(tl);
    var tr = tl.clone();
    tr.position.x = 0.65;
    g.add(tr);
    if (isPolice) {
      var bar = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.22, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x11131a })
      );
      bar.position.set(0, 1.45, -0.25);
      g.add(bar);
      var red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.52), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      red.position.set(-0.32, 1.46, -0.25);
      g.add(red);
      var blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.52), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
      blue.position.set(0.32, 1.46, -0.25);
      g.add(blue);
      g.userData.lightBar = { red: red, blue: blue };
    }
    if (isGold) {
      var stripe = new THREE.Mesh(
        new THREE.BoxGeometry(2.12, 0.1, 4.42),
        new THREE.MeshBasicMaterial({ color: 0xffe97a })
      );
      stripe.position.y = 0.88;
      g.add(stripe);
    }
    return g;
  }

  function makePersonMesh(shirtColor, isCop) {
    var g = new THREE.Group();
    var shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), shirt);
    body.position.y = 1.0;
    body.castShadow = true;
    g.add(body);
    var legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.32),
      new THREE.MeshLambertMaterial({ color: isCop ? 0x1a2a4a : 0x2e3440 })
    );
    legs.position.y = 0.28;
    g.add(legs);
    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xc98d64 })
    );
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(head);
    if (isCop) {
      var hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.3, 0.14, 10),
        new THREE.MeshLambertMaterial({ color: 0x14203a })
      );
      hat.position.y = 1.94;
      g.add(hat);
    } else {
      var hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x241a12 })
      );
      hair.position.y = 1.76;
      g.add(hair);
    }
    // Simple swinging arms, animated by the update loop.
    var armGeo = new THREE.BoxGeometry(0.14, 0.7, 0.14);
    var armMat = new THREE.MeshLambertMaterial({ color: shirtColor });
    var armL = new THREE.Mesh(armGeo, armMat);
    armL.position.set(-0.4, 1.0, 0);
    g.add(armL);
    var armR = new THREE.Mesh(armGeo, armMat);
    armR.position.set(0.4, 1.0, 0);
    g.add(armR);
    g.userData.armL = armL;
    g.userData.armR = armR;
    return g;
  }

  function syncMesh(obj) {
    if (!obj.mesh) return;
    obj.mesh.position.set(obj.x, obj.y || 0, obj.z);
    obj.mesh.rotation.y = obj.heading || 0;
  }

  // ---- Traffic -------------------------------------------------------------
  // A traffic car cruises one road line at a time and turns at junctions.
  // It stops for red lights and crawls around cars ahead of it.
  function makeTrafficCar(game, rng) {
    var alongNS = rng.chance(0.5);
    var coord = rng.pick(W.ROAD_COORDS);
    var along = rng.range(-200, 200);
    var car = {
      kind: 'traffic',
      x: alongNS ? coord : along,
      z: alongNS ? along : coord,
      heading: 0,
      speed: 0,
      hp: 100,
      dead: false,
      color: rng.pick(CAR_COLORS),
      cruise: rng.range(8, 12),
      stopTimer: 0,
      bumpCooldown: 0,
    };
    // Face along the road.
    if (alongNS) car.heading = rng.chance(0.5) ? 0 : Math.PI;
    else car.heading = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
    car.mesh = makeCarMesh(car.color, false, false);
    game.scene.add(car.mesh);
    syncMesh(car);
    return car;
  }

  function updateTrafficCar(game, car, dt) {
    if (car.dead) return;
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    // Junction ahead? If the light is red or yellow, stop before it.
    var aheadX = car.x + fx * 13, aheadZ = car.z + fz * 13;
    var jx = W.nearestRoadCoord(aheadX), jz = W.nearestRoadCoord(aheadZ);
    var nearJunction = Math.abs(aheadX - jx) < 7 && Math.abs(aheadZ - jz) < 7;
    var light = game.world.lightPhase();
    var wantStop = false;
    if (nearJunction && light !== 'green') {
      // Only stop if the junction is genuinely in front of us.
      var jdx = jx - car.x, jdz = jz - car.z;
      var fwd = jdx * fx + jdz * fz;
      if (fwd > 2 && fwd < 16) wantStop = true;
    }
    // A car ahead on the same road: slow down, never rear-end it.
    for (var i = 0; i < game.cars.length; i++) {
      var o = game.cars[i];
      if (o === car || o.dead) continue;
      var dx = o.x - car.x, dz = o.z - car.z;
      var fwd2 = dx * fx + dz * fz;
      var side = dx * fz - dz * fx;
      if (fwd2 > 0 && fwd2 < 11 && Math.abs(side) < 3.2) { wantStop = true; break; }
    }
    if (wantStop) {
      car.speed = Math.max(0, car.speed - 22 * dt);
    } else {
      car.speed = Math.min(car.cruise, car.speed + 7 * dt);
    }
    car.x += fx * car.speed * dt;
    car.z += fz * car.speed * dt;
    // At a junction, sometimes turn onto the crossing road.
    var atJx = Math.abs(car.x - W.nearestRoadCoord(car.x)) < 1.6;
    var atJz = Math.abs(car.z - W.nearestRoadCoord(car.z)) < 1.6;
    if (atJx && atJz && game.rng.chance(0.25)) {
      var turn = game.rng.pick([-Math.PI / 2, Math.PI / 2]);
      car.heading += turn;
      car.x = W.nearestRoadCoord(car.x);
      car.z = W.nearestRoadCoord(car.z);
    }
    // Wrap around the city edge so traffic never runs out.
    if (car.x > 226) car.x = -226;
    if (car.x < -226) car.x = 226;
    if (car.z > 226) car.z = -226;
    if (car.z < -226) car.z = 226;
    syncMesh(car);
  }

  // ---- Pedestrians ---------------------------------------------------------
  function makePed(game, rng, x, z) {
    var ped = {
      x: x !== undefined ? x : rng.range(-200, 200),
      z: z !== undefined ? z : rng.range(-200, 200),
      heading: rng.range(0, Math.PI * 2),
      hp: 100,
      state: 'walk',
      dead: false,
      speed: rng.range(1.1, 1.9),
      target: null,
      downTimer: 0,
      walkPhase: rng.range(0, Math.PI * 2),
    };
    ped.mesh = makePersonMesh(rng.pick(SHIRT_COLORS), false);
    game.scene.add(ped.mesh);
    pickPedTarget(game, ped);
    syncMesh(ped);
    return ped;
  }

  function pickPedTarget(game, ped) {
    // Walk along the sidewalks: a target on a road line, offset to the side.
    var c = game.rng.pick(W.ROAD_COORDS);
    var off = game.rng.pick([-11, 11]);
    if (game.rng.chance(0.5)) ped.target = { x: c + off, z: game.rng.range(-200, 200) };
    else ped.target = { x: game.rng.range(-200, 200), z: c + off };
  }

  function updatePed(game, ped, dt) {
    if (ped.state === 'down') {
      ped.downTimer += dt;
      if (ped.downTimer > 25) {
        // Get back up after a while, a little the worse for wear.
        ped.state = 'walk';
        ped.hp = 60;
        ped.downTimer = 0;
        ped.mesh.rotation.x = 0;
        ped.mesh.position.y = 0;
      }
      return;
    }
    var t = ped.target;
    if (!t) { pickPedTarget(game, ped); return; }
    var dx = t.x - ped.x, dz = t.z - ped.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 2) { pickPedTarget(game, ped); return; }
    var want = Math.atan2(dx, dz);
    ped.heading = U.turnToward(ped.heading, want, 3.2 * dt);
    var sp = ped.state === 'flee' ? 4.2 : ped.speed;
    ped.x += Math.sin(ped.heading) * sp * dt;
    ped.z += Math.cos(ped.heading) * sp * dt;
    ped.walkPhase += dt * (ped.state === 'flee' ? 11 : 6);
    var swing = Math.sin(ped.walkPhase) * 0.55;
    ped.mesh.userData.armL.rotation.x = swing;
    ped.mesh.userData.armR.rotation.x = -swing;
    // Fleeing peds calm down once they are far from the player.
    if (ped.state === 'flee' && U.dist2d(ped.x, ped.z, game.player.x, game.player.z) > 40) {
      ped.state = 'walk';
    }
    syncMesh(ped);
  }

  // ---- Police --------------------------------------------------------------
  function makePoliceCar(game, rng, nearX, nearZ) {
    // Spawn on a road 40-60 m from the player, facing roughly toward them.
    var ang = rng.range(0, Math.PI * 2);
    var d = rng.range(40, 58);
    var p = W.snapToRoad(nearX + Math.cos(ang) * d, nearZ + Math.sin(ang) * d);
    var car = {
      kind: 'police',
      x: p.x,
      z: p.z,
      heading: Math.atan2(nearX - p.x, nearZ - p.z),
      speed: 0,
      hp: 100,
      dead: false,
      stuckTimer: 0,
      flashPhase: rng.range(0, 1),
    };
    car.mesh = makeCarMesh(0x1a1d24, true, false);
    game.scene.add(car.mesh);
    syncMesh(car);
    return car;
  }

  function updatePoliceCar(game, car, dt) {
    if (car.dead) return;
    var tx = game.playerCar ? game.playerCar.x : game.player.x;
    var tz = game.playerCar ? game.playerCar.z : game.player.z;
    var dx = tx - car.x, dz = tz - car.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var wantHeading = Math.atan2(dx, dz);
    car.heading = U.turnToward(car.heading, wantHeading, 2.6 * dt);
    // Chase hard, but stop a respectful distance short of the player: the
    // police box the player in rather than parking on top of them. Speed
    // is staged by distance so a car at full tilt cannot overshoot
    // through the standoff ring, and a car that ends up too close backs
    // off to it.
    var targetSpeed;
    if (dist > 25) targetSpeed = 26;
    else if (dist > 12) targetSpeed = 12;
    else if (dist > 9) targetSpeed = 0;
    else targetSpeed = -6;
    if (car.speed < targetSpeed) car.speed = Math.min(targetSpeed, car.speed + 30 * dt);
    else car.speed = Math.max(targetSpeed, car.speed - 30 * dt);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    // Unstick: if we have barely moved while far from the player, we are
    // wedged on a building — reappear on a road near the player.
    if (dist > 14 && Math.abs(car.speed) < 1.5) {
      car.stuckTimer += dt;
      if (car.stuckTimer > 3) {
        var p = W.snapToRoad(game.player.x + game.rng.range(-45, 45), game.player.z + game.rng.range(-45, 45));
        car.x = p.x; car.z = p.z;
        car.heading = Math.atan2(tx - p.x, tz - p.z);
        car.stuckTimer = 0;
      }
    } else car.stuckTimer = 0;
    game.world.resolveBuildings(car, 2.1);
    car.x = U.clamp(car.x, -W.BOUND, W.BOUND);
    car.z = U.clamp(car.z, -W.BOUND, W.BOUND);
    // Flash the light bar.
    car.flashPhase += dt * 6;
    var on = Math.sin(car.flashPhase * Math.PI) > 0;
    if (car.mesh.userData.lightBar) {
      car.mesh.userData.lightBar.red.material.color.setHex(on ? 0xff2222 : 0x551111);
      car.mesh.userData.lightBar.blue.material.color.setHex(on ? 0x2244ff : 0x111155);
    }
    syncMesh(car);
  }

  function makeFootCop(game, rng, nearX, nearZ) {
    var ang = rng.range(0, Math.PI * 2);
    var cop = {
      x: nearX + Math.cos(ang) * 26,
      z: nearZ + Math.sin(ang) * 26,
      heading: 0,
      hp: 100,
      state: 'chase',
      dead: false,
      // Deliberately slower than the player's sprint (9 m/s) and slower
      // than a player sliding along a wall (~6 m/s): foot cops can catch
      // a player who stops or gets cornered, never one who keeps running.
      speed: 5.5,
      walkPhase: 0,
    };
    cop.mesh = makePersonMesh(0x1a2a4a, true);
    game.scene.add(cop.mesh);
    syncMesh(cop);
    return cop;
  }

  function updateFootCop(game, cop, dt) {
    if (cop.dead) return;
    var dx = game.player.x - cop.x, dz = game.player.z - cop.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1.5) {
      var want = Math.atan2(dx, dz);
      cop.heading = U.turnToward(cop.heading, want, 4 * dt);
      cop.x += Math.sin(cop.heading) * cop.speed * dt;
      cop.z += Math.cos(cop.heading) * cop.speed * dt;
      cop.walkPhase += dt * 10;
      var swing = Math.sin(cop.walkPhase) * 0.6;
      cop.mesh.userData.armL.rotation.x = swing;
      cop.mesh.userData.armR.rotation.x = -swing;
    }
    game.world.resolveBuildings(cop, 0.6);
    syncMesh(cop);
  }

  window.SB.actors = {
    CAR_COLORS: CAR_COLORS,
    makeCarMesh: makeCarMesh,
    makePersonMesh: makePersonMesh,
    syncMesh: syncMesh,
    makeTrafficCar: makeTrafficCar,
    updateTrafficCar: updateTrafficCar,
    makePed: makePed,
    pickPedTarget: pickPedTarget,
    updatePed: updatePed,
    makePoliceCar: makePoliceCar,
    updatePoliceCar: updatePoliceCar,
    makeFootCop: makeFootCop,
    updateFootCop: updateFootCop,
  };
})();
