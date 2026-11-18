// SUNSET BAY — the city: procedural blocks, roads, traffic lights,
// landmarks, sky and the minimap. Written fresh for this entry.
window.SB = window.SB || {};

(function () {
  'use strict';
  const U = window.SB.util;

  function hash2(x, z) {
    let h = (x * 374761393 + z * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function makeTextSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,10,16,0.72)';
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = color; g.lineWidth = 4;
    g.strokeRect(2, 2, 252, 60);
    g.fillStyle = color;
    g.font = 'bold 30px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(18, 4.5, 1);
    return spr;
  }

  function createWorld(scene, rng, opts) {
    opts = opts || {};
    const lowfx = !!opts.lowfx;
    const world = {
      scene,
      buildings: [], // {x1,z1,x2,z2} AABBs for collision
      landmarks: U.LANDMARKS,
      timeOfDay: 0.72,
      gameTime: 0,
      lowfx,
      _lightHeads: null,
      _lightMats: null,
      _marker: null,
      _sun: null,
      _hemi: null,
    };

    // --- Ground and roads ---------------------------------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshLambertMaterial({ color: 0x2b2e33 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = !lowfx;
    scene.add(ground);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x1d1f24 });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0x3a3d45 });
    const roadGeo = new THREE.PlaneGeometry(480, U.ROAD_WIDTH);
    for (const c of U.ROADS) {
      const rv = new THREE.Mesh(roadGeo, roadMat);
      rv.rotation.x = -Math.PI / 2;
      rv.position.set(0, 0.02, c);
      rv.receiveShadow = !lowfx;
      scene.add(rv);
      const rh = new THREE.Mesh(roadGeo, roadMat);
      rh.rotation.x = -Math.PI / 2;
      rh.rotation.z = Math.PI / 2;
      rh.position.set(c, 0.02, 0);
      rh.receiveShadow = !lowfx;
      scene.add(rh);
      // Sidewalks: lighter strips flanking each road.
      for (const off of [-7.5, 7.5]) {
        const sv = new THREE.Mesh(new THREE.PlaneGeometry(480, 4.5), walkMat);
        sv.rotation.x = -Math.PI / 2;
        sv.position.set(0, 0.03, c + off);
        scene.add(sv);
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(480, 4.5), walkMat);
        sh.rotation.x = -Math.PI / 2;
        sh.rotation.z = Math.PI / 2;
        sh.position.set(c + off, 0.03, 0);
        scene.add(sh);
      }
      // Centre dashes.
      const dashMat = new THREE.MeshBasicMaterial({ color: 0x8a8f5a });
      const dashGeo = new THREE.PlaneGeometry(4, 0.35);
      for (let d = -220; d <= 220; d += 16) {
        const dv = new THREE.Mesh(dashGeo, dashMat);
        dv.rotation.x = -Math.PI / 2;
        dv.position.set(d, 0.04, c);
        scene.add(dv);
        const dh = new THREE.Mesh(dashGeo, dashMat);
        dh.rotation.x = -Math.PI / 2;
        dh.rotation.z = Math.PI / 2;
        dh.position.set(c, 0.04, d);
        scene.add(dh);
      }
    }

    // --- Buildings (instanced) ----------------------------------------------
    const placements = [];
    const palette = [0x6b5d4f, 0x4f5b6b, 0x7a6a55, 0x55505a, 0x8a7a5f, 0x3f4a5a, 0x6e6a72, 0x9a8a6a];
    for (let ix = 0; ix < U.ROADS.length - 1; ix++) {
      for (let iz = 0; iz < U.ROADS.length - 1; iz++) {
        const x0 = U.ROADS[ix] + 8, x1 = U.ROADS[ix + 1] - 8;
        const z0 = U.ROADS[iz] + 8, z1 = U.ROADS[iz + 1] - 8;
        const n = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < n; k++) {
          const w = 10 + rng() * 14, d = 10 + rng() * 14;
          const cx = x0 + w / 2 + rng() * Math.max(1, (x1 - x0) - w);
          const cz = z0 + d / 2 + rng() * Math.max(1, (z1 - z0) - d);
          const h = 8 + rng() * rng() * 34;
          placements.push({ cx, cz, w, d, h, color: palette[Math.floor(rng() * palette.length)] });
        }
      }
    }
    // Landmark buildings (kept clear of the mission zones, which sit on roads).
    // Every one of these sits fully inside a city block, at least 2 m clear
    // of every road edge: a landmark box centred on (or overlapping) a road
    // narrows that road to a wedge the autopilot grinds against.
    const landmarkBoxes = [
      { x: -182, z: 120, w: 26, d: 12, h: 10, color: 0x4a6b8a, label: 'GARAGE', labelColor: '#7fd4ff' },
      { x: -130, z: -26, w: 30, d: 20, h: 16, color: 0x8a7a9a, label: 'MALL', labelColor: '#ffd27f' },
      { x: 130, z: 130, w: 26, d: 22, h: 30, color: 0x5a3a7a, label: 'CASINO', labelColor: '#ff7fd4' },
      { x: 170, z: 170, w: 12, d: 10, h: 7, color: 0x7a5a3a, label: 'SAFEHOUSE', labelColor: '#9fff7f' },
      { x: -178, z: -178, w: 18, d: 12, h: 6, color: 0x3a6a4a, label: 'DOCKS', labelColor: '#7fffcf' },
    ];
    for (const lb of landmarkBoxes) {
      placements.push({ cx: lb.x, cz: lb.z, w: lb.w, d: lb.d, h: lb.h, color: lb.color });
      const spr = makeTextSprite(lb.label, lb.labelColor);
      spr.position.set(lb.x, lb.h + 4, lb.z);
      scene.add(spr);
    }
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    const bMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(bGeo, bMat, placements.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    placements.forEach((p, i) => {
      pos.set(p.cx, p.h / 2, p.cz);
      sc.set(p.w, p.h, p.d);
      m4.compose(pos, q, sc);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.setHex(p.color));
      inst.castShadow = !lowfx;
      inst.receiveShadow = !lowfx;
      world.buildings.push({ x1: p.cx - p.w / 2, z1: p.cz - p.d / 2, x2: p.cx + p.w / 2, z2: p.cz + p.d / 2 });
    });
    scene.add(inst);

    // Docks containers for flavour.
    const contMat = new THREE.MeshLambertMaterial({ color: 0xb05a2a });
    const contMat2 = new THREE.MeshLambertMaterial({ color: 0x2a6ab0 });
    [[-168, -164, contMat], [-160, -168, contMat2], [-176, -158, contMat2]].forEach(([x, z, m]) => {
      const c = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 3), m);
      c.position.set(x, 1.5, z);
      c.castShadow = !lowfx;
      scene.add(c);
      world.buildings.push({ x1: x - 4, z1: z - 1.5, x2: x + 4, z2: z + 1.5 });
    });

    // --- Traffic lights (instanced poles + heads) ---------------------------
    const junctions = [];
    for (const rx of U.ROADS) for (const rz of U.ROADS) junctions.push([rx, rz]);
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.14, 4.6, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, junctions.length);
    const headGeo = new THREE.BoxGeometry(0.55, 1.3, 0.55);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const heads = new THREE.InstancedMesh(headGeo, headMat, junctions.length);
    junctions.forEach(([rx, rz], i) => {
      pos.set(rx + 6, 2.3, rz + 6);
      sc.set(1, 1, 1);
      m4.compose(pos, q, sc);
      poles.setMatrixAt(i, m4);
      pos.set(rx + 6, 4.9, rz + 6);
      m4.compose(pos, q, sc);
      heads.setMatrixAt(i, m4);
      heads.setColorAt(i, col.setHex(0x22cc44));
    });
    scene.add(poles);
    scene.add(heads);
    world._lightHeads = heads;
    world._junctions = junctions;

    // --- Mission beacon -------------------------------------------------------
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    beacon.visible = false;
    scene.add(beacon);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4, 5.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    scene.add(ring);
    world._marker = { beacon, ring };
    world.setMarker = function (x, z, on) {
      beacon.visible = !!on;
      ring.visible = !!on;
      if (on) {
        beacon.position.set(x, 13, z);
        ring.position.set(x, 0.06, z);
      }
    };

    // --- Lights and sky -------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0xffd9a0, 0x2a2f3a, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb36b, 1.4);
    sun.position.set(120, 90, 40);
    if (!lowfx) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
      sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
      sun.shadow.camera.far = 500;
    }
    scene.add(sun);
    scene.add(sun.target);
    world._sun = sun;
    world._hemi = hemi;
    scene.fog = new THREE.Fog(0x2a2438, 140, 420);

    world.setTimeOfDay = function (t) {
      world.timeOfDay = ((t % 1) + 1) % 1;
    };

    world.update = function (dt) {
      world.gameTime += dt;
      // Slow day cycle.
      world.timeOfDay = (world.timeOfDay + dt / 600) % 1;
      const t = world.timeOfDay;
      // Sun angle: golden hour at 0.72.
      const ang = t * Math.PI * 2;
      const elev = Math.sin(ang - Math.PI * 0.4);
      const sunH = Math.max(0.12, elev);
      world._sun.position.set(Math.cos(ang) * 160, 40 + sunH * 140, Math.sin(ang) * 160);
      const day = U.clamp(sunH * 1.4, 0.15, 1);
      world._sun.intensity = 0.5 + day * 1.1;
      world._hemi.intensity = 0.35 + day * 0.6;
      const sky = new THREE.Color().setHSL(0.07 + day * 0.03, 0.55, 0.12 + day * 0.22);
      scene.background = sky;
      scene.fog.color.copy(sky);
      // Traffic-light heads follow their junctions' states.
      if (world._lightHeads) {
        let changed = false;
        for (let i = 0; i < world._junctions.length; i++) {
          const [rx, rz] = world._junctions[i];
          const st = world.lightStateAt(rx, rz, false);
          const hex = st === 'green' ? 0x22cc44 : st === 'red' ? 0xee2222 : 0xddaa00;
          if (world._headColors[i] !== hex) { world._headColors[i] = hex; changed = true; }
        }
        if (changed) {
          for (let i = 0; i < world._junctions.length; i++) {
            world._lightHeads.setColorAt(i, col.setHex(world._headColors[i]));
          }
          world._lightHeads.instanceColor.needsUpdate = true;
        }
      }
    };
    world._headColors = new Array(junctions.length).fill(0x22cc44);

    // Traffic-light state. isX: the light governing the road that runs
    // along X (east-west); false: the road along Z (north-south).
    // 20 s game-time cycle: Z green 0-9, Z yellow 9-10, X green 10-19,
    // X yellow 19-20. Offsets vary by junction.
    world.lightStateAt = function (x, z, isX) {
      const rx = U.nearestRoadCoord(x);
      const rz = U.nearestRoadCoord(z);
      const off = hash2(rx + 300, rz + 300) * 14;
      const t = (world.gameTime + off) % 20;
      const zGreen = t < 9;
      const zYellow = t >= 9 && t < 10;
      const xYellow = t >= 19;
      if (isX) return zGreen || zYellow ? 'red' : xYellow ? 'yellow' : 'green';
      return zGreen ? 'green' : zYellow ? 'yellow' : 'red';
    };

    // --- Minimap --------------------------------------------------------------
    world.drawMinimap = function (ctx, size, game) {
      const s = size;
      const toMap = (x, z) => [((x + 240) / 480) * s, ((z + 240) / 480) * s];
      ctx.fillStyle = '#14161c';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#3d414d';
      ctx.lineWidth = 2;
      for (const c of U.ROADS) {
        const [x0] = toMap(c, 0);
        ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, s); ctx.stroke();
        const [, z0] = toMap(0, c);
        ctx.beginPath(); ctx.moveTo(0, z0); ctx.lineTo(s, z0); ctx.stroke();
      }
      // Landmarks.
      const lmColors = { garage: '#7fd4ff', docks: '#7fffcf', mall: '#ffd27f', casino: '#ff7fd4', safehouse: '#9fff7f' };
      for (const key of Object.keys(U.LANDMARKS)) {
        const lm = U.LANDMARKS[key];
        const [mx, mz] = toMap(lm.x, lm.z);
        ctx.fillStyle = lmColors[key];
        ctx.beginPath(); ctx.arc(mx, mz, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      // Mission target.
      const tgt = game.missionTarget && game.missionTarget();
      if (tgt) {
        const [mx, mz] = toMap(tgt.x, tgt.z);
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(mx, mz, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mx, mz, 8, 0, Math.PI * 2); ctx.stroke();
      }
      // Traffic cars (white) and police (red).
      const actors = game.actors;
      if (actors && actors.cars) {
        for (const c of actors.cars) {
          if (c.dead) continue;
          const [mx, mz] = toMap(c.x, c.z);
          ctx.fillStyle = c.kind === 'police' ? '#ff4444' : '#dddddd';
          ctx.fillRect(mx - 1.5, mz - 1.5, 3, 3);
        }
      }
      // Player arrow.
      const pl = actors ? actors.player : { x: 0, z: 0, heading: 0 };
      const [px, pz] = toMap(pl.x, pl.z);
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(Math.PI - pl.heading);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    return world;
  }

  window.SB.createWorld = createWorld;
})();
