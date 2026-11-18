// SUNSET BAY — actors: the player, cars (parked / traffic / police),
// pedestrians, mission guards and crew, and all of their AI and collisions.
// Written fresh for this entry.
window.SB = window.SB || {};

(function () {
  'use strict';
  const U = window.SB.util;

  const CAR_COLORS = [0xc0392b, 0x2980b9, 0xf39c12, 0x27ae60, 0x8e44ad, 0xdfe6e9, 0x2c3e50, 0xe67e22, 0x16a085, 0xb03a5b];
  const PED_SHIRTS = [0xd35400, 0x2980b9, 0x27ae60, 0x8e44ad, 0xc0392b, 0xf1c40f, 0x1abc9c, 0xecf0f1];

  function makeCarMesh(color, isPolice) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 4.4), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.55, 2.2),
      new THREE.MeshLambertMaterial({ color: 0x1a2028 })
    );
    cabin.position.set(0, 1.1, -0.2);
    cabin.castShadow = true;
    g.add(cabin);
    const wheels = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.4, 4.0),
      new THREE.MeshLambertMaterial({ color: 0x111111 })
    );
    wheels.position.y = 0.2;
    g.add(wheels);
    if (isPolice) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.18, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xff2222 })
      );
      bar.position.set(0, 1.45, -0.2);
      g.add(bar);
      g.userData.lightBar = bar;
    }
    return g;
  }

  function makePedMesh(shirt, skin) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 1.05, 0.35),
      new THREE.MeshLambertMaterial({ color: shirt })
    );
    body.position.y = 0.95;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 10, 8),
      new THREE.MeshLambertMaterial({ color: skin })
    );
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(head);
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.5, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x222831 })
    );
    legs.position.y = 0.25;
    g.add(legs);
    return g;
  }

  function createActors(game, world, rng, opts) {
    opts = opts || {};
    const scene = world.scene;
    const A = {
      game, world, rng,
      player: { x: 0, z: 20, heading: 0, health: 100, speed: 0, stumble: 0, regenDelay: 0 },
      cars: [],
      peds: [],
      policeCars: [],
      enemies: [],
      crew: [],
      playerCar: null,
      crewInCar: 0,
      enemiesDown: 0,
      markedCar: null,
      inMarkedCar: false,
      bustTimer: 0,
      _buildHitCd: 0,
      _carHitCd: 0,
      _punchCd: 0,
      _spawnTimer: 0,
      _sirenPhase: 0,
    };

    // --- Player mesh ----------------------------------------------------------
    const playerMesh = makePedMesh(0xffd23f, 0xd9a066);
    playerMesh.scale.set(1.15, 1.15, 1.15);
    scene.add(playerMesh);
    A._playerMesh = playerMesh;

    // --- Collision helpers ----------------------------------------------------
    function collideCircle(x, z, r) {
      // Push a circle out of every building AABB. Returns {x, z, hit, nx, nz}.
      let hit = false, nx = 0, nz = 0;
      for (const b of world.buildings) {
        const cx = U.clamp(x, b.x1, b.x2);
        const cz = U.clamp(z, b.z1, b.z2);
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          hit = true;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            nx = dx / d; nz = dz / d;
            x = cx + nx * r; z = cz + nz * r;
          } else {
            // Centre inside the box: push out along the smallest penetration.
            const pl = x - b.x1, pr = b.x2 - x, pt = z - b.z1, pb = b.z2 - z;
            const m = Math.min(pl, pr, pt, pb);
            if (m === pl) { x = b.x1 - r; nx = -1; }
            else if (m === pr) { x = b.x2 + r; nx = 1; }
            else if (m === pt) { z = b.z1 - r; nz = -1; }
            else { z = b.z2 + r; nz = 1; }
          }
        }
      }
      x = U.clamp(x, -U.WORLD_HALF, U.WORLD_HALF);
      z = U.clamp(z, -U.WORLD_HALF, U.WORLD_HALF);
      return { x, z, hit, nx, nz };
    }
    A._collideCircle = collideCircle;

    // --- Car creation -----------------------------------------------------------
    function spawnCar(kind, x, z, heading, color) {
      const isPolice = kind === 'police';
      const mesh = makeCarMesh(color !== undefined ? color : U.pick(rng, CAR_COLORS), isPolice);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = heading;
      scene.add(mesh);
      const car = {
        kind, x, z, heading, speed: 0, hp: 150, dead: false,
        mesh, color, targetJunction: null, cruise: 8 + rng() * 4,
        lane: (rng() < 0.5 ? -1 : 1) * 2.4,
        reverseTimer: 0, sideTimer: 0, sideSign: 1,
        hitCd: 0, isPlayer: false, marked: false,
      };
      A.cars.push(car);
      if (isPolice) A.policeCars.push(car);
      return car;
    }

    function randomRoadPoint() {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const c = U.pick(rng, U.ROADS);
      const along = -200 + rng() * 400;
      return axis === 'x' ? { x: along, z: c } : { x: c, z: along };
    }

    function spawnParked() {
      for (let i = 0; i < 14; i++) {
        const p = randomRoadPoint();
        const axis = Math.abs(p.x - U.nearestRoadCoord(p.x)) < Math.abs(p.z - U.nearestRoadCoord(p.z)) ? 'z' : 'x';
        const heading = axis === 'z' ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const off = rng() < 0.5 ? -3.6 : 3.6;
        const x = axis === 'z' ? p.x + off : p.x;
        const z = axis === 'z' ? p.z : p.z + off;
        spawnCar('parked', x, z, heading);
      }
    }

    function spawnTraffic(n) {
      for (let i = 0; i < n; i++) {
        const p = randomRoadPoint();
        const c = spawnCar('traffic', p.x, p.z, rng() * Math.PI * 2);
        c.targetJunction = [U.nearestRoadCoord(p.x), U.nearestRoadCoord(p.z)];
      }
    }

    // --- Pedestrians ------------------------------------------------------------
    function spawnPed(x, z) {
      const mesh = makePedMesh(U.pick(rng, PED_SHIRTS), 0xc98a5e);
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      const ped = {
        x, z, heading: rng() * Math.PI * 2, speed: 1.1 + rng() * 0.9,
        hp: 100, state: 'walk', dead: false, downTimer: 0,
        hitCd: 0, mesh, wander: 0,
      };
      A.peds.push(ped);
      return ped;
    }
    function spawnPeds(n) {
      for (let i = 0; i < n; i++) {
        const p = randomRoadPoint();
        const off = rng() < 0.5 ? -7.5 : 7.5;
        const axis = Math.abs(p.x - U.nearestRoadCoord(p.x)) < 1 ? 'z' : 'x';
        spawnPed(axis === 'z' ? p.x + off : p.x, axis === 'z' ? p.z : p.z + off);
      }
    }

    // --- Mission actors ---------------------------------------------------------
    A.spawnGuards = function () {
      A.clearEnemies();
      const spots = [[104, 110], [108, 106]];
      for (const [x, z] of spots) {
        const mesh = makePedMesh(0x7a1020, 0xb07a4e);
        mesh.scale.set(1.25, 1.25, 1.25);
        mesh.position.set(x, 0, z);
        scene.add(mesh);
        A.enemies.push({
          x, z, heading: 0, hp: 100, state: 'chase', dead: false,
          punchCd: 0, mesh,
        });
      }
      A.enemiesDown = 0;
    };
    A.clearEnemies = function () {
      for (const e of A.enemies) scene.remove(e.mesh);
      A.enemies = [];
      A.enemiesDown = 0;
    };
    A.spawnCrew = function () {
      A.clearCrew();
      const spots = [[-158, -154], [-152, -158]];
      for (const [x, z] of spots) {
        const mesh = makePedMesh(0x1a6a4a, 0xc98a5e);
        mesh.position.set(x, 0, z);
        scene.add(mesh);
        A.crew.push({ x, z, heading: 0, state: 'wait', mesh });
      }
      A.crewInCar = 0;
    };
    A.clearCrew = function () {
      for (const c of A.crew) scene.remove(c.mesh);
      A.crew = [];
      A.crewInCar = 0;
    };
    A.spawnGoldCar = function () {
      if (A.markedCar) return A.markedCar;
      const car = spawnCar('parked', 112, 100, Math.PI / 2, 0xd4af37);
      car.marked = true;
      A.markedCar = car;
      return car;
    };
    A.clearMarkedCar = function () {
      if (A.markedCar && A.playerCar !== A.markedCar) {
        scene.remove(A.markedCar.mesh);
        A.cars.splice(A.cars.indexOf(A.markedCar), 1);
      }
      A.markedCar = null;
      A.inMarkedCar = false;
    };

    // --- Police -------------------------------------------------------------------
    A.spawnPolice = function (n) {
      while (A.policeCars.length < n) {
        const ang = rng() * Math.PI * 2;
        const d = 65 + rng() * 20;
        let x = A.player.x + Math.sin(ang) * d;
        let z = A.player.z + Math.cos(ang) * d;
        x = U.clamp(x, -220, 220);
        z = U.clamp(z, -220, 220);
        // Snap onto the nearest road so cruisers start on drivable ground.
        const rx = U.nearestRoadCoord(x), rz = U.nearestRoadCoord(z);
        if (Math.abs(x - rx) < Math.abs(z - rz)) x = rx; else z = rz;
        const car = spawnCar('police', x, z, Math.atan2(A.player.x - x, A.player.z - z), 0x111418);
        car.cruise = 24;
      }
    };
    A.clearPolice = function () {
      for (const c of A.policeCars) scene.remove(c.mesh);
      A.cars = A.cars.filter((c) => c.kind !== 'police');
      A.policeCars = [];
      A.bustTimer = 0;
    };

    // --- Player actions -------------------------------------------------------------
    A.teleport = function (x, z) {
      A.player.x = U.clamp(x, -U.WORLD_HALF, U.WORLD_HALF);
      A.player.z = U.clamp(z, -U.WORLD_HALF, U.WORLD_HALF);
      if (A.playerCar) {
        A.playerCar.x = A.player.x;
        A.playerCar.z = A.player.z;
      }
    };

    A.stealNearest = function () {
      if (A.playerCar) return false;
      let best = null, bd = 4.2;
      for (const c of A.cars) {
        if (c.kind !== 'parked' || c.dead) continue;
        const d = U.dist2(c.x, c.z, A.player.x, A.player.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return false;
      A.playerCar = best;
      best.kind = 'player';
      best.isPlayer = true;
      A.inMarkedCar = best.marked === true;
      A.player.x = best.x;
      A.player.z = best.z;
      A.player.heading = best.heading;
      game.addWanted(1);
      game.toast('Car stolen — the law is coming');
      SB.audio.pickup();
      return true;
    };

    A.exitCar = function () {
      if (!A.playerCar) return false;
      const c = A.playerCar;
      A.player.x = c.x + Math.cos(c.heading) * 2.4;
      A.player.z = c.z - Math.sin(c.heading) * 2.4;
      A.player.heading = c.heading;
      c.kind = 'parked';
      c.isPlayer = false;
      c.speed = 0;
      A.playerCar = null;
      A.inMarkedCar = false;
      return true;
    };

    A.punch = function () {
      if (A._punchCd > 0) return false;
      A._punchCd = 0.45;
      const p = A.player;
      let best = null, bd = 2.6, isEnemy = false;
      for (const e of A.enemies) {
        if (e.state === 'down') continue;
        const d = U.dist2(e.x, e.z, p.x, p.z);
        if (d < bd) {
          const ang = Math.atan2(e.x - p.x, e.z - p.z);
          if (Math.abs(U.angleDiff(ang, p.heading)) < 1.05) { bd = d; best = e; isEnemy = true; }
        }
      }
      if (!best) {
        for (const q of A.peds) {
          if (q.state === 'down') continue;
          const d = U.dist2(q.x, q.z, p.x, p.z);
          if (d < bd) {
            const ang = Math.atan2(q.x - p.x, q.z - p.z);
            if (Math.abs(U.angleDiff(ang, p.heading)) < 1.05) { bd = d; best = q; isEnemy = false; }
          }
        }
      }
      if (!best) return false;
      SB.audio.punch();
      best.hp -= 34;
      if (best.hp <= 0) {
        best.state = 'down';
        if (isEnemy) {
          A.enemiesDown = A.enemies.filter((e) => e.state === 'down').length;
        } else {
          best.downTimer = 15;
          game.addWanted(1);
          game.toast('You beat someone down — witnesses called it in');
        }
      } else if (!isEnemy) {
        game.addWanted(1);
      }
      return true;
    };

    A.damagePlayer = function (amount) {
      const p = A.player;
      if (game.state !== 'playing') return;
      p.health -= amount;
      p.regenDelay = 10;
      if (p.health <= 0) {
        p.health = 0;
        game.onWasted();
      }
    };

    A.damagePlayerCar = function (amount) {
      const c = A.playerCar;
      if (!c) return;
      c.hp -= amount;
      if (c.hp <= 0) {
        c.hp = 0;
        c.dead = true;
        game.onCarWrecked(c);
      }
    };

    A.respawn = function () {
      const p = A.player;
      p.health = 100;
      p.x = 156; p.z = 150;
      p.heading = Math.PI;
      p.stumble = 0;
      if (A.playerCar) {
        A.playerCar.kind = 'parked';
        A.playerCar.isPlayer = false;
        A.playerCar = null;
        A.inMarkedCar = false;
      }
      A.clearPolice();
      A.bustTimer = 0;
    };

    // --- Per-frame update --------------------------------------------------------------
    A.update = function (dt, keys) {
      const p = A.player;
      A._punchCd = Math.max(0, A._punchCd - dt);
      A._buildHitCd = Math.max(0, A._buildHitCd - dt);
      A._carHitCd = Math.max(0, A._carHitCd - dt);
      if (p.regenDelay > 0) p.regenDelay -= dt;
      else if (p.health < 100 && game.state === 'playing') p.health = Math.min(100, p.health + 2 * dt);
      if (p.stumble > 0) p.stumble -= dt;

      // --- Player on foot ---
      if (!A.playerCar && game.state === 'playing' && p.stumble <= 0) {
        const cy = game.camYaw;
        const fx = Math.sin(cy), fz = Math.cos(cy);
        const rx = -Math.cos(cy), rz = Math.sin(cy);
        let mx = 0, mz = 0;
        if (keys.w) { mx += fx; mz += fz; }
        if (keys.s) { mx -= fx; mz -= fz; }
        if (keys.d) { mx += rx; mz += rz; }
        if (keys.a) { mx -= rx; mz -= rz; }
        const len = Math.hypot(mx, mz);
        if (len > 0.01) {
          const sp = keys.shift ? 10 : 6;
          mx /= len; mz /= len;
          p.heading = Math.atan2(mx, mz);
          const nx = p.x + mx * sp * dt;
          const nz = p.z + mz * sp * dt;
          const r = collideCircle(nx, nz, 0.6);
          p.x = r.x; p.z = r.z;
        }
      }

      // --- Player car ---
      const pc = A.playerCar;
      if (pc && game.state === 'playing') {
        const steerIn = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
        const throttle = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
        const spd = pc.speed;
        // Steering stays strong at speed: the old authority (1 - v/42, floor
        // 0.35) gave a 36 m turning radius at top speed, so the car could
        // not make a 90-degree turn inside a 12 m road and swung wide into
        // buildings. 2.4 rad/s with a 0.7 floor turns inside ~11 m at 22 m/s.
        const steerAuthority = U.clamp(1.1 - Math.abs(spd) / 70, 0.7, 1);
        pc.heading += steerIn * 2.4 * steerAuthority * dt * (spd >= 0 ? 1 : -1);
        if (throttle > 0) pc.speed = Math.min(22, spd + 14 * dt);
        else if (throttle < 0) {
          pc.speed = spd > 0.5 ? spd - 25 * dt : Math.max(-8, spd - 10 * dt);
        } else {
          // Strong engine braking: lifting off the gas stops the car in
          // ~1 s instead of coasting 30+ m past the destination, so the
          // car actually stops where the driver aimed it (the crew, the
          // garage, the delivery point) instead of overshooting it.
          pc.speed = Math.abs(spd) < 0.2 ? 0 : spd * (1 - 2.0 * dt) - Math.sign(spd) * 2.0 * dt;
        }
        const fx = Math.sin(pc.heading), fz = Math.cos(pc.heading);
        const nx = pc.x + fx * pc.speed * dt;
        const nz = pc.z + fz * pc.speed * dt;
        const r = collideCircle(nx, nz, 1.7);
        pc.x = r.x; pc.z = r.z;
        if (r.hit) {
          const into = Math.abs(pc.speed) * Math.max(0, -(fx * r.nx + fz * r.nz));
          if (into > 6 && A._buildHitCd <= 0) {
            const intensity = U.clamp((into - 6) / 20, 0, 1);
            if (intensity > 0.35) {
              A.damagePlayerCar(Math.min(8, intensity * 8));
              A._buildHitCd = 1;
              game.toast('You smashed into a building');
            }
          }
          // Scrub speed on impact, but KEEP the pushed-out position:
          // collideCircle already slid the car out of the wall, so the
          // tangential motion carries it along the face instead of the
          // old forward nudge grinding it back into the same spot.
          pc.speed *= 0.4;
        }
        p.x = pc.x; p.z = pc.z; p.heading = pc.heading;
      }

      // --- Traffic AI ---
      for (const c of A.cars) {
        if (c.kind !== 'traffic' || c.dead) continue;
        updateTrafficCar(c, dt);
      }

      // --- Police AI ---
      updatePolice(dt);

      // --- Peds ---
      for (const q of A.peds) {
        if (q.dead) continue;
        if (q.state === 'down') {
          q.downTimer -= dt;
          if (q.downTimer <= 0) { q.state = 'walk'; q.hp = 100; }
          continue;
        }
        q.wander -= dt;
        if (q.wander <= 0) {
          q.wander = 2 + rng() * 4;
          // Turn at random, staying roughly along roads.
          q.heading += (rng() < 0.5 ? -1 : 1) * (Math.PI / 2) * (rng() < 0.6 ? 1 : 0);
        }
        const nx = q.x + Math.sin(q.heading) * q.speed * dt;
        const nz = q.z + Math.cos(q.heading) * q.speed * dt;
        const r = collideCircle(nx, nz, 0.5);
        if (r.hit) q.heading += Math.PI / 2;
        else { q.x = r.x; q.z = r.z; }
      }

      // --- Guards ---
      for (const e of A.enemies) {
        if (e.state === 'down') continue;
        e.punchCd = Math.max(0, e.punchCd - dt);
        const d = U.dist2(e.x, e.z, p.x, p.z);
        if (d < 30 && game.state === 'playing') {
          const ang = Math.atan2(p.x - e.x, p.z - e.z);
          e.heading = ang;
          if (d > 2.2) {
            const nx = e.x + Math.sin(ang) * 3.2 * dt;
            const nz = e.z + Math.cos(ang) * 3.2 * dt;
            const r = collideCircle(nx, nz, 0.6);
            e.x = r.x; e.z = r.z;
          } else if (e.punchCd <= 0) {
            e.punchCd = 1;
            A.damagePlayer(8);
            SB.audio.punch();
          }
        }
      }

      // --- Crew boarding ---
      // The crew jogs to the car, so the radius is generous; the car must
      // still be slow (they cannot board a car doing 20 m/s).
      if (A.crew.length > 0 && pc) {
        for (const c of A.crew) {
          if (c.state !== 'wait') continue;
          if (U.dist2(c.x, c.z, pc.x, pc.z) < 18 && Math.abs(pc.speed) < 5) {
            c.state = 'boarded';
            A.crewInCar++;
            scene.remove(c.mesh);
            SB.audio.pickup();
          }
        }
      }

      // --- Car-car collisions (player car vs others) ---
      if (pc) {
        for (const o of A.cars) {
          if (o === pc || o.dead || o.kind === 'police') continue;
          const d = U.dist2(o.x, o.z, pc.x, pc.z);
          if (d < 3.6 && d > 0.01) {
            const push = (3.6 - d) / 2;
            const nx = (o.x - pc.x) / d, nz = (o.z - pc.z) / d;
            o.x += nx * push; o.z += nz * push;
            pc.x -= nx * push; pc.z -= nz * push;
            const rel = Math.abs(pc.speed - o.speed);
            if (rel > 4 && A._carHitCd <= 0) {
              A.damagePlayerCar(rel * 0.2);
              A._carHitCd = 0.5;
              o.speed = Math.max(0, o.speed - rel * 0.3);
            }
          }
        }
      }

      // --- Cars hitting pedestrians ---
      for (const c of A.cars) {
        if (c.dead || (c.kind !== 'traffic' && c.kind !== 'player')) continue;
        for (const q of A.peds) {
          if (q.state === 'down' || q.hitCd > 0) continue;
          if (U.dist2(c.x, c.z, q.x, q.z) < 2.2 && Math.abs(c.speed) > 3) {
            q.state = 'down';
            q.downTimer = 12;
            q.hitCd = 2;
            if (c.kind === 'player') {
              game.addWanted(1);
              game.toast('You ran someone over');
            }
          }
        }
        // Traffic cars knocking the on-foot player down (per-car cooldown).
        if (c.kind === 'traffic' && !pc && game.state === 'playing' && p.stumble <= 0) {
          if (c.hitCd > 0) c.hitCd -= dt;
          else if (U.dist2(c.x, c.z, p.x, p.z) < 2.1 && Math.abs(c.speed) > 2) {
            c.hitCd = 1;
            p.stumble = 0.8;
            A.damagePlayer(12);
            game.toast('A car clipped you');
          }
        }
      }
      for (const q of A.peds) q.hitCd = Math.max(0, q.hitCd - dt);

      // --- Sync meshes ---
      syncMeshes(dt);
    };

    function updateTrafficCar(c, dt) {
      // Waypoint driving on the road grid: head for the target junction,
      // then pick the next one (straight / left / right, never a U-turn).
      let tx = c.targetJunction[0], tz = c.targetJunction[1];
      let d = U.dist2(c.x, c.z, tx, tz);
      if (d < 6) {
        const opts = [];
        const dirs = [[52, 0], [-52, 0], [0, 52], [0, -52]];
        const back = [-Math.sign(tx - c.x || 1) * 0, 0];
        for (const [dx, dz] of dirs) {
          const nx = tx + dx, nz = tz + dz;
          if (Math.abs(nx) > 208 || Math.abs(nz) > 208) continue;
          if (dx === -Math.sign(c.x - tx) * 52 && dz === 0 && Math.abs(c.z - tz) < 1) continue;
          if (dz === -Math.sign(c.z - tz) * 52 && dx === 0 && Math.abs(c.x - tx) < 1) continue;
          opts.push([nx, nz]);
        }
        if (opts.length === 0) opts.push([tx, tz]);
        // Prefer going straight: the option most aligned with current heading.
        let best = opts[0], bestScore = -1e9;
        for (const [nx, nz] of opts) {
          const ang = Math.atan2(nx - c.x, nz - c.z);
          const score = Math.cos(U.angleDiff(ang, c.heading)) + rng() * 0.35;
          if (score > bestScore) { bestScore = score; best = [nx, nz]; }
        }
        c.targetJunction = best;
        tx = best[0]; tz = best[1];
        d = U.dist2(c.x, c.z, tx, tz);
      }
      // Red light ahead: slow to a stop before the junction.
      let wantSpeed = c.cruise;
      const ahead = world.lightStateAt(tx, tz, Math.abs(tx - c.x) > Math.abs(tz - c.z));
      if (d < 16 && ahead === 'red') wantSpeed = 0;
      // Car ahead in the same lane: match its pace.
      for (const o of A.cars) {
        if (o === c || o.dead) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const fwd = dx * Math.sin(c.heading) + dz * Math.cos(c.heading);
        const side = dx * Math.cos(c.heading) - dz * Math.sin(c.heading);
        if (fwd > 0 && fwd < 11 && Math.abs(side) < 3) {
          wantSpeed = Math.min(wantSpeed, Math.max(0, o.speed));
        }
      }
      c.speed += U.clamp(wantSpeed - c.speed, -10 * dt, 6 * dt);
      const desired = Math.atan2(tx - c.x, tz - c.z);
      const diff = U.angleDiff(desired, c.heading);
      c.heading += U.clamp(diff, -1.4 * dt, 1.4 * dt);
      const nx = c.x + Math.sin(c.heading) * c.speed * dt;
      const nz = c.z + Math.cos(c.heading) * c.speed * dt;
      const r = collideCircle(nx, nz, 1.7);
      c.x = r.x; c.z = r.z;
      if (r.hit) { c.heading += Math.PI / 2; c.speed *= 0.5; }
    }

    function updatePolice(dt) {
      const p = A.player;
      const pc = A.playerCar;
      // Flash the light bars.
      A._sirenPhase += dt;
      const barOn = Math.floor(A._sirenPhase / 0.4) % 2 === 0;
      for (const cop of A.policeCars) {
        const bar = cop.mesh.userData.lightBar;
        if (bar) bar.material.color.setHex(barOn ? 0xff2222 : 0x2266ff);
      }
      if (game.state !== 'playing') return;
      const targetX = p.x, targetZ = p.z;
      let anyPin = false;
      for (const cop of A.policeCars) {
        if (cop.dead) continue;
        cop.reverseTimer = Math.max(0, cop.reverseTimer - dt);
        cop.sideTimer = Math.max(0, cop.sideTimer - dt);
        const dx = targetX - cop.x, dz = targetZ - cop.z;
        const dist = Math.hypot(dx, dz) || 0.01;
        const dirX = dx / dist, dirZ = dz / dist;
        // Stop point: 13 m short of the player along the approach line.
        let sx = targetX - dirX * 13;
        let sz = targetZ - dirZ * 13;
        // Head-on deadlock: a cruiser nose-to-nose with the player car
        // backs off instead of sitting bumper to bumper.
        if (pc) {
          const faceDot = Math.sin(cop.heading) * Math.sin(pc.heading) + Math.cos(cop.heading) * Math.cos(pc.heading);
          if (dist < 9 && faceDot < -0.7 && Math.abs(pc.speed) < 2 && Math.abs(cop.speed) < 2 && cop.reverseTimer <= 0) {
            cop.reverseTimer = 2;
          }
          // Cruiser blocking the player's path pulls 12 m to the side.
          const toCopX = cop.x - pc.x, toCopZ = cop.z - pc.z;
          const fwd = toCopX * Math.sin(pc.heading) + toCopZ * Math.cos(pc.heading);
          const side = toCopX * Math.cos(pc.heading) - toCopZ * Math.sin(pc.heading);
          if (fwd > 0 && fwd < 15 && Math.abs(side) < 4 && Math.abs(pc.speed) > 2 && cop.sideTimer <= 0) {
            cop.sideTimer = 3;
            cop.sideSign = side >= 0 ? 1 : -1;
          }
        }
        if (cop.sideTimer > 0) {
          sx += -dirZ * 12 * cop.sideSign;
          sz += dirX * 12 * cop.sideSign;
        }
        const dStop = U.dist2(cop.x, cop.z, sx, sz);
        let wantSpeed;
        if (cop.reverseTimer > 0) wantSpeed = -6;
        else {
          // Braking profile: v = sqrt(2 * 16 * distance-left), capped.
          wantSpeed = Math.sqrt(2 * 16 * Math.max(0, dStop));
          wantSpeed = Math.min(wantSpeed, 26);
          if (dStop < 20) wantSpeed = Math.min(wantSpeed, 6);
          if (dStop < 2) wantSpeed = 0;
        }
        cop.speed += U.clamp(wantSpeed - cop.speed, -14 * dt, 9 * dt);
        const desired = cop.reverseTimer > 0
          ? Math.atan2(cop.x - targetX, cop.z - targetZ)
          : Math.atan2(sx - cop.x, sz - cop.z);
        const diff = U.angleDiff(desired, cop.heading);
        cop.heading += U.clamp(diff, -2.2 * dt, 2.2 * dt);
        const nx = cop.x + Math.sin(cop.heading) * cop.speed * dt;
        const nz = cop.z + Math.cos(cop.heading) * cop.speed * dt;
        const r = collideCircle(nx, nz, 1.7);
        cop.x = r.x; cop.z = r.z;
        if (r.hit) cop.speed *= 0.5;

        // Ram: only while actually moving into the player car.
        if (pc && dist < 6 && cop.speed > 3) {
          const closing = (Math.sin(cop.heading) * dirX + Math.cos(cop.heading) * dirZ) > 0.3;
          if (closing) A.damagePlayerCar(2.5 * dt);
        }

        // Bust timer: pin only when the target is stopped and a cruiser is
        // actually touching it; on foot, only when a cruiser is close and slow.
        // (Checked once per frame across all cruisers, so one pinning cop
        // cannot be cancelled out by the others standing off.)
        let pin = false;
        if (pc) {
          pin = Math.abs(pc.speed) < 0.5 && dist < 4.6;
        } else {
          pin = dist < 4.6 && Math.abs(cop.speed) < 3;
        }
        if (pin) anyPin = true;
      }
      if (anyPin) {
        A.bustTimer += dt;
        if (A.bustTimer >= 4) {
          A.bustTimer = 0;
          game.onBusted();
        }
      } else if (A.bustTimer > 0) {
        A.bustTimer = Math.max(0, A.bustTimer - dt * 2);
      }
    }

    function syncMeshes(dt) {
      const p = A.player;
      A._playerMesh.position.set(p.x, 0, p.z);
      A._playerMesh.rotation.y = p.heading;
      A._playerMesh.visible = !A.playerCar;
      for (const c of A.cars) {
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.heading;
        c.mesh.visible = !c.dead || c === A.playerCar;
        if (c.marked && !c.dead) {
          c.mesh.children[0].material = c.mesh.children[0].material;
        }
      }
      for (const q of A.peds) {
        q.mesh.position.set(q.x, 0, q.z);
        q.mesh.rotation.y = q.heading;
        q.mesh.visible = q.state !== 'down' ? true : true;
        // Lying down: tip the ped over.
        q.mesh.rotation.x = q.state === 'down' ? -Math.PI / 2 : 0;
        q.mesh.position.y = q.state === 'down' ? 0.35 : 0;
      }
      for (const e of A.enemies) {
        e.mesh.position.set(e.x, 0, e.z);
        e.mesh.rotation.y = e.heading;
        e.mesh.rotation.x = e.state === 'down' ? -Math.PI / 2 : 0;
        e.mesh.position.y = e.state === 'down' ? 0.35 : 0;
      }
      for (const c of A.crew) {
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.heading;
      }
    }

    spawnParked();
    spawnTraffic(opts.lowfx ? 14 : 22);
    spawnPeds(opts.lowfx ? 14 : 26);
    return A;
  }

  window.SB.createActors = createActors;
})();
