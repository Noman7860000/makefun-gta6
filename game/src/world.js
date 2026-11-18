// SUNSET BAY — the city of Sunset Bay. A 9x9 road grid, seeded and deterministic:
// buildings with lit windows, working traffic lights, a beach and ocean on the
// south edge, streetlights, palms and billboards. Classic script, no modules.

(function (global) {
  'use strict';
  const U = global.SBUtil;

  const BLOCK = 52;      // block pitch (road centre to road centre)
  const ROAD_W = 14;     // road width
  const GRID = 9;        // roads per axis
  const HALF = (GRID - 1) * BLOCK / 2; // 208 — city half-extent

  function makeWindowTexture(base, lit, rng) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 122; y += 12) {
      for (let x = 6; x < 58; x += 10) {
        const on = rng.next() < lit;
        g.fillStyle = on ? (rng.next() < 0.7 ? '#ffd98a' : '#9fd8ff') : '#1a2230';
        g.fillRect(x, y, 6, 8);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function makeBillboardTexture(text, sub, bg, fg) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
    g.fillStyle = fg; g.font = 'bold 34px Arial'; g.textAlign = 'center';
    g.fillText(text, 128, 58);
    g.font = '20px Arial'; g.fillText(sub, 128, 96);
    return new THREE.CanvasTexture(c);
  }

  function World(scene, seed) {
    this.scene = scene;
    this.rng = U.makeRng(seed);
    this.buildings = [];   // { minX, maxX, minZ, maxZ, h } collision AABBs
    this.roads = [];       // { x1, z1, x2, z2, axis } for minimap
    this.intersections = []; // { x, z }
    this.lights = [];      // traffic lights { x, z, timer, meshes }
    this.lamps = [];       // { x, z, mat }
    this.landmarks = {};   // named places { x, z }
    this.carSpawns = [];   // parked-car spots { x, z, heading }
    this.pedNodes = [];    // sidewalk waypoints { x, z }
    this.timeOfDay = 0.74; // 0..1: 0 night, 0.25 sunrise, 0.5 noon, 0.75 sunset — open at golden hour
    this._sun = null;
    this._hemi = null;
    this._lampMats = [];
    this.lampsOn = false;
    this.build();
  }

  World.prototype.roadCoord = function (i) { return (i - (GRID - 1) / 2) * BLOCK; };

  World.prototype.build = function () {
    const rng = this.rng;
    const scene = this.scene;

    // Ground: big asphalt-dark plane.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 260, HALF * 2 + 260),
      new THREE.MeshLambertMaterial({ color: 0x38343d })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.05, 40);
    ground.receiveShadow = true;
    scene.add(ground);

    // Roads: dark strips + centre dashes + sidewalks.
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x3d3d49 });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0x6a6472 });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c25a });
    const span = HALF * 2 + ROAD_W;
    for (let i = 0; i < GRID; i++) {
      const c = this.roadCoord(i);
      const rx = new THREE.Mesh(new THREE.PlaneGeometry(span, ROAD_W), roadMat);
      rx.rotation.x = -Math.PI / 2; rx.position.set(0, 0, c); rx.receiveShadow = true; scene.add(rx);
      const rz = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, span), roadMat);
      rz.rotation.x = -Math.PI / 2; rz.position.set(c, 0, 0); rz.receiveShadow = true; scene.add(rz);
      const s1 = new THREE.Mesh(new THREE.PlaneGeometry(span, 3), walkMat);
      s1.rotation.x = -Math.PI / 2; s1.position.set(0, 0.02, c - ROAD_W / 2 - 1.5); scene.add(s1);
      const s2 = s1.clone(); s2.position.z = c + ROAD_W / 2 + 1.5; scene.add(s2);
      const s3 = new THREE.Mesh(new THREE.PlaneGeometry(3, span), walkMat);
      s3.rotation.x = -Math.PI / 2; s3.position.set(c - ROAD_W / 2 - 1.5, 0.02, 0); scene.add(s3);
      const s4 = s3.clone(); s4.position.x = c + ROAD_W / 2 + 1.5; scene.add(s4);
      for (let d = -HALF; d < HALF; d += 8) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.35), dashMat);
        dash.rotation.x = -Math.PI / 2; dash.position.set(d, 0.03, c); scene.add(dash);
        const dash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3), dashMat);
        dash2.rotation.x = -Math.PI / 2; dash2.position.set(c, 0.03, d); scene.add(dash2);
      }
      this.roads.push({ x1: -HALF, z1: c, x2: HALF, z2: c, axis: 'x' });
      this.roads.push({ x1: c, z1: -HALF, x2: c, z2: HALF, axis: 'z' });
      for (let j = 0; j < GRID; j++) this.intersections.push({ x: c, z: this.roadCoord(j) });
    }

    // Buildings: fill each block with 1-3 towers.
    const palettes = [
      { base: '#5a5f6b', win: 0.45 }, { base: '#7a6a58', win: 0.35 },
      { base: '#3e5a74', win: 0.55 }, { base: '#6b4a4a', win: 0.4 },
      { base: '#4a5a4a', win: 0.35 }, { base: '#8a7a5a', win: 0.3 },
      { base: '#2e3a4a', win: 0.6 },
    ];
    const winTex = palettes.map((p) => makeWindowTexture(p.base, p.win, rng));
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let bi = 0; bi < GRID - 1; bi++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        // Leave the central block open as a plaza.
        if (bi === 4 && bj === 4) continue;
        const x0 = this.roadCoord(bi) + ROAD_W / 2 + 2;
        const z0 = this.roadCoord(bj) + ROAD_W / 2 + 2;
        const w = BLOCK - ROAD_W - 4;
        const count = rng.int(1, 3);
        for (let k = 0; k < count; k++) {
          const bw = rng.range(w * 0.3, w * 0.55);
          const bd = rng.range(w * 0.3, w * 0.55);
          const bx = x0 + rng.range(2, w - bw - 2);
          const bz = z0 + rng.range(2, w - bd - 2);
          const h = rng.range(9, 58) * (1 + 0.35 * Math.sin(bi * 1.3 + bj * 0.7));
          const pi = rng.int(0, palettes.length - 1);
          const tex = winTex[pi].clone();
          tex.needsUpdate = true;
          tex.repeat.set(Math.max(1, Math.round(bw / 10)), Math.max(1, Math.round(h / 12)));
          const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x332a1a, emissiveMap: tex, emissiveIntensity: 0.55 });
          const m = new THREE.Mesh(boxGeo, mat);
          m.scale.set(bw, h, bd);
          m.position.set(bx + bw / 2, h / 2, bz + bd / 2);
          m.castShadow = true; m.receiveShadow = true;
          scene.add(m);
          const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x22222a }));
          roof.scale.set(bw + 0.6, 0.5, bd + 0.6);
          roof.position.set(bx + bw / 2, h + 0.25, bz + bd / 2);
          scene.add(roof);
          if (h > 30) {
            const ac = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3a3a42 }));
            ac.scale.set(3, 2, 3);
            ac.position.set(bx + bw / 2, h + 1.5, bz + bd / 2);
            scene.add(ac);
          }
          this.buildings.push({ minX: bx, maxX: bx + bw, minZ: bz, maxZ: bz + bd, h: h });
        }
      }
    }

    // Central plaza: fountain + palms.
    const plazaMat = new THREE.MeshLambertMaterial({ color: 0x6a6258 });
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - ROAD_W, BLOCK - ROAD_W), plazaMat);
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(this.roadCoord(4), 0.04, this.roadCoord(4));
    scene.add(plaza);
    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1.2, 20), new THREE.MeshLambertMaterial({ color: 0x8a8f98 }));
    fountain.position.set(this.roadCoord(4), 0.6, this.roadCoord(4)); fountain.castShadow = true; scene.add(fountain);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.4, 20), new THREE.MeshLambertMaterial({ color: 0x3a9ac4, emissive: 0x0a3a4a }));
    water.position.set(this.roadCoord(4), 1.1, this.roadCoord(4)); scene.add(water);
    this.landmarks.plaza = { x: this.roadCoord(4), z: this.roadCoord(4) };

    // Beach + ocean on the south edge (z > HALF).
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 260, 70), new THREE.MeshLambertMaterial({ color: 0xc2a878 }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, HALF + 35); scene.add(sand);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 260, 220), new THREE.MeshLambertMaterial({ color: 0x1a5a8a, emissive: 0x0a2a4a }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.set(0, -0.4, HALF + 180); scene.add(ocean);
    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 70), new THREE.MeshLambertMaterial({ color: 0x6a4a30 }));
    pier.position.set(-120, 0.5, HALF + 60); pier.castShadow = true; scene.add(pier);
    this.landmarks.beach = { x: -120, z: HALF + 40 };
    this.landmarks.ocean = { x: 0, z: HALF + 120 };

    // Palms.
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2a7a3a });
    const palmAt = (x, z) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 6), trunkMat);
      trunk.position.y = 3.5; trunk.castShadow = true; g.add(trunk);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.4, 4), leafMat);
        const a = (i / 5) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 1.1, 7.2, Math.sin(a) * 1.1);
        leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        g.add(leaf);
      }
      g.position.set(x, 0, z);
      scene.add(g);
    };
    for (let x = -HALF; x <= HALF; x += 26) palmAt(x + rng.range(-4, 4), HALF + rng.range(8, 55));
    palmAt(this.roadCoord(4) - 14, this.roadCoord(4) - 14);
    palmAt(this.roadCoord(4) + 14, this.roadCoord(4) + 14);
    palmAt(this.roadCoord(4) - 14, this.roadCoord(4) + 14);
    palmAt(this.roadCoord(4) + 14, this.roadCoord(4) - 14);

    // Billboards.
    const ads = [
      ['SOLMAR COLA', 'taste the sunset', '#b03030', '#ffe9a8'],
      ['VICE FM 101.1', 'all hits, all night', '#20204a', '#7ad8ff'],
      ['SUNSET BAY', 'live fast. drive faster.', '#c47a1a', '#ffffff'],
    ];
    ads.forEach((ad, i) => {
      const tex = makeBillboardTexture(ad[0], ad[1], ad[2], ad[3]);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(22, 11),
        new THREE.MeshBasicMaterial({ map: tex }));
      const bx = this.roadCoord(3 + i) + 6;
      board.position.set(bx, 26 + i * 4, this.roadCoord(2) - ROAD_W / 2 - 1);
      scene.add(board);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1), new THREE.MeshLambertMaterial({ color: 0x333338 }));
      pole.position.set(bx, 12, this.roadCoord(2) - ROAD_W / 2 - 1);
      scene.add(pole);
    });

    // Streetlights along roads + traffic lights at central intersections.
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (let i = 0; i < GRID; i++) {
      for (let d = -HALF + 26; d <= HALF - 26; d += 52) {
        const x = this.roadCoord(i);
        const z = d;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), poleMat);
        pole.position.set(x + ROAD_W / 2 + 1, 3.5, z); pole.castShadow = true; scene.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), poleMat);
        arm.position.set(x + ROAD_W / 2, 7, z); scene.add(arm);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lampHeadMat.clone());
        head.position.set(x + ROAD_W / 2 - 1.1, 6.9, z); scene.add(head);
        this.lamps.push({ x: x + ROAD_W / 2 - 1.1, z: z, mat: head.material });
        this._lampMats.push(head.material);
      }
    }
    for (let i = 2; i <= 6; i++) {
      for (let j = 2; j <= 6; j++) {
        if ((i + j) % 2 !== 0) continue;
        const x = this.roadCoord(i), z = this.roadCoord(j);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), poleMat);
        pole.position.set(x + ROAD_W / 2 + 0.6, 3, z + ROAD_W / 2 + 0.6); scene.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.7), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
        head.position.set(x + ROAD_W / 2 + 0.6, 5.6, z + ROAD_W / 2 + 0.6); scene.add(head);
        const mk = (color, y) => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: color }));
          m.position.set(x + ROAD_W / 2 + 0.6, y, z + ROAD_W / 2 + 1.0);
          scene.add(m);
          return m;
        };
        const red = mk(0x550000, 6.1), yel = mk(0x554400, 5.6), grn = mk(0x005500, 5.1);
        this.lights.push({ x: x, z: z, timer: rng.range(0, 9), red: red, yel: yel, grn: grn });
      }
    }

    // Parked-car spawn spots along road edges.
    for (let i = 0; i < GRID; i++) {
      for (let d = -HALF + 40; d <= HALF - 40; d += 78) {
        const c = this.roadCoord(i);
        this.carSpawns.push({ x: c + ROAD_W / 2 - 2.4, z: d, heading: 0 });
        this.carSpawns.push({ x: d, z: c + ROAD_W / 2 - 2.4, heading: Math.PI / 2 });
      }
    }

    // Pedestrian sidewalk nodes.
    for (let i = 0; i < GRID; i++) {
      for (let d = -HALF; d <= HALF; d += 26) {
        const c = this.roadCoord(i);
        this.pedNodes.push({ x: c - ROAD_W / 2 - 1.5, z: d });
        this.pedNodes.push({ x: c + ROAD_W / 2 + 1.5, z: d });
        this.pedNodes.push({ x: d, z: c - ROAD_W / 2 - 1.5 });
        this.pedNodes.push({ x: d, z: c + ROAD_W / 2 + 1.5 });
      }
    }

    // Named landmarks for missions.
    this.landmarks.garage = { x: this.roadCoord(1), z: this.roadCoord(6) };
    this.landmarks.hospital = { x: this.roadCoord(7), z: this.roadCoord(1) };
    this.landmarks.casino = { x: this.roadCoord(6), z: this.roadCoord(6) };
    this.landmarks.docks = { x: this.roadCoord(1), z: this.roadCoord(1) };
    this.landmarks.safehouse = { x: this.roadCoord(7), z: this.roadCoord(7) };
    this.landmarks.mall = { x: this.roadCoord(2), z: this.roadCoord(4) };
    this.landmarks.policeHQ = { x: this.roadCoord(6), z: this.roadCoord(2) };

    // Sun + sky.
    this._sun = new THREE.DirectionalLight(0xffc27a, 1.6);
    this._sun.position.set(120, 90, -60);
    this._sun.castShadow = true;
    this._sun.shadow.mapSize.set(2048, 2048);
    this._sun.shadow.camera.left = -260; this._sun.shadow.camera.right = 260;
    this._sun.shadow.camera.top = 260; this._sun.shadow.camera.bottom = -260;
    this._sun.shadow.camera.far = 700;
    this._sun.shadow.bias = -0.0004;
    scene.add(this._sun);
    this._sunTarget = new THREE.Object3D();
    scene.add(this._sunTarget);
    this._sun.target = this._sunTarget;
    this._hemi = new THREE.HemisphereLight(0x8ab4ff, 0x3a2a22, 0.7);
    scene.add(this._hemi);
    scene.fog = new THREE.Fog(0x2a2438, 260, 720);
    this.applyTimeOfDay();
  }

  // Traffic light state near (x,z): 'green'|'yellow'|'red' for traffic moving
  // along the X road (alongX=true) or the Z road.
  World.prototype.lightStateAt = function (x, z, alongX) {
    let best = null, bd = 1e9;
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      const d = U.dist2(x, z, L.x, L.z);
      if (d < bd) { bd = d; best = L; }
    }
    if (!best || bd > 30 * 30) return 'green';
    const t = best.timer % 10;
    if (alongX) return (t >= 5 && t < 9) ? 'green' : (t >= 4 && t < 5) ? 'yellow' : 'red';
    return (t < 4) ? 'green' : (t < 5) ? 'yellow' : 'red';
  };

  World.prototype.update = function (dt) {
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      L.timer += dt;
      const t = L.timer % 10;
      const nsGreen = t < 4, yellow = t >= 4 && t < 5;
      L.red.material.color.setHex(nsGreen || yellow ? 0x550000 : 0xff2211);
      L.yel.material.color.setHex(yellow ? 0xffcc22 : 0x554400);
      L.grn.material.color.setHex(nsGreen ? 0x22ff66 : 0x005500);
    }
  };

  // timeOfDay 0..1: 0 = night, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
  World.prototype.applyTimeOfDay = function () {
    const t = this.timeOfDay;
    const scene = this.scene;
    const ang = t * Math.PI * 2 - Math.PI / 2;
    const elev = Math.sin(ang);
    const azim = Math.cos(ang);
    this._sun.position.set(azim * 260, Math.max(elev, -0.15) * 220 + 20, -120);
    const day = U.clamp(elev * 1.6 + 0.25, 0, 1);
    const sunset = U.clamp(1 - Math.abs(elev) * 2.2, 0, 1) * (elev > -0.05 ? 1 : 0);
    // Warm, readable golden hour: bright orange sky, extra sun + fill light
    // so the city does not fall into black shadow at dusk.
    const sky = new THREE.Color().setHSL(0.62 - sunset * 0.55, 0.55, 0.12 + day * 0.5 + sunset * 0.14);
    scene.background = sky;
    scene.fog.color.copy(sky);
    this._sun.intensity = 0.15 + day * 1.5 + sunset * 0.7;
    this._sun.color.setHSL(0.09 - sunset * 0.05, 0.85, 0.55 + day * 0.15);
    this._hemi.intensity = 0.25 + day * 0.55 + sunset * 0.45;
    const lampOn = day < 0.45;
    for (let i = 0; i < this._lampMats.length; i++) {
      this._lampMats[i].color.setHex(lampOn ? 0xffe9a8 : 0x555550);
    }
    this.lampsOn = lampOn;
  };

  World.prototype.hitsBuilding = function (x, z, r) {
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return b;
    }
    return null;
  };

  World.prototype.nearestRoad = function (v) {
    let best = this.roadCoord(0), bd = 1e9;
    for (let i = 0; i < GRID; i++) {
      const c = this.roadCoord(i);
      const d = Math.abs(v - c);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  World.prototype.isOnRoad = function (x, z) {
    const nx = Math.abs(x - this.nearestRoad(x)) < ROAD_W / 2 + 0.5;
    const nz = Math.abs(z - this.nearestRoad(z)) < ROAD_W / 2 + 0.5;
    return nx || nz;
  };

  global.SBWorld = World;
  global.SBWorldConst = { BLOCK: BLOCK, ROAD_W: ROAD_W, GRID: GRID, HALF: HALF };
})(window);
