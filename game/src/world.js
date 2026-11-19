// SUNSET BAY — world.js
// Builds the city of Sunset Bay: the road grid, the ground, the skyline of
// buildings, palms, street lights and traffic lights, the beach and the
// ocean, and the day/night sun. It also owns the traffic-light clock and the
// building-collision test the cars and the player use.
(function () {
  'use strict';
  var U = window.SB.util;

  // The road grid: roads run along these coordinates in both directions.
  var ROAD_COORDS = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
  var ROAD_HALF = 7; // half the width of a road surface
  var BOUND = 232; // world edge; the player and cars are clamped inside it

  var LANDMARKS = {
    garage: { x: -156, z: 104, label: "Slim's Garage" },
    docks: { x: -156, z: -156, label: 'The Docks' },
    safehouse: { x: 156, z: 156, label: 'Safehouse' },
    mall: { x: -104, z: 0, label: 'Bayview Mall' },
    casino: { x: 104, z: 104, label: 'Casino del Sol' },
    beach: { x: 0, z: -208, label: 'Sunset Beach' },
  };

  function nearestRoadCoord(v) {
    var best = ROAD_COORDS[0], bd = 1e9;
    for (var i = 0; i < ROAD_COORDS.length; i++) {
      var d = Math.abs(v - ROAD_COORDS[i]);
      if (d < bd) { bd = d; best = ROAD_COORDS[i]; }
    }
    return best;
  }

  // Snap a point onto the nearest road line (used to spawn cars on roads).
  function snapToRoad(x, z) {
    var dx = Math.abs(x - nearestRoadCoord(x));
    var dz = Math.abs(z - nearestRoadCoord(z));
    if (dx <= dz) return { x: nearestRoadCoord(x), z: z };
    return { x: x, z: nearestRoadCoord(z) };
  }

  // Paint the ground texture: asphalt roads with dashes, pale sidewalks,
  // warm block interiors, and sand where the city meets the sea.
  function makeGroundTexture(rng) {
    var S = 1024, cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    var worldToPx = function (v) { return ((v + 260) / 520) * S; };
    // Block interiors: warm dusty ground.
    ctx.fillStyle = '#b98d5f';
    ctx.fillRect(0, 0, S, S);
    // Sand along the south edge (the beach, z < -208).
    ctx.fillStyle = '#e3c98f';
    ctx.fillRect(0, 0, S, worldToPx(-208));
    // Sidewalk ribbons along every road.
    ctx.fillStyle = '#c9c2b4';
    for (var i = 0; i < ROAD_COORDS.length; i++) {
      var c = worldToPx(ROAD_COORDS[i]);
      var w = worldToPx(ROAD_HALF + 3) - worldToPx(0);
      ctx.fillRect(0, c - w, S, w * 2);
      ctx.fillRect(c - w, 0, w * 2, S);
    }
    // Asphalt.
    ctx.fillStyle = '#3a3a40';
    for (var j = 0; j < ROAD_COORDS.length; j++) {
      var cc = worldToPx(ROAD_COORDS[j]);
      var ww = worldToPx(ROAD_HALF) - worldToPx(0);
      ctx.fillRect(0, cc - ww, S, ww * 2);
      ctx.fillRect(cc - ww, 0, ww * 2, S);
    }
    // Centre dashes.
    ctx.fillStyle = '#d8c95a';
    for (var k = 0; k < ROAD_COORDS.length; k++) {
      var d = worldToPx(ROAD_COORDS[k]);
      for (var p = -250; p < 250; p += 16) {
        ctx.fillRect(worldToPx(p), d - 1, 8, 2);
        ctx.fillRect(d - 1, worldToPx(p), 2, 8);
      }
    }
    // A few scrubby patches inside blocks so the ground is not flat colour.
    for (var n = 0; n < 260; n++) {
      var gx = rng.range(-240, 240), gz = rng.range(-240, 240);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(120,90,50,0.25)' : 'rgba(90,120,70,0.22)';
      ctx.beginPath();
      ctx.arc(worldToPx(gx), worldToPx(gz), rng.range(3, 10), 0, Math.PI * 2);
      ctx.fill();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // A small canvas texture of lit windows, stretched over a building box.
  function makeWindowTexture(rng, litRatio) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#7a7f88';
    ctx.fillRect(0, 0, 64, 128);
    for (var y = 6; y < 122; y += 12) {
      for (var x = 6; x < 58; x += 10) {
        var lit = rng.next() < litRatio;
        ctx.fillStyle = lit ? (rng.chance(0.6) ? '#ffd98a' : '#9fd8ff') : '#3a3f47';
        ctx.fillRect(x, y, 6, 8);
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // A floating label sprite drawn on a canvas (used for landmark signs).
  function makeLabelSprite(text, color) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(10,10,18,0.72)';
    ctx.beginPath();
    ctx.roundRect(4, 6, 248, 52, 10);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var spr = new THREE.Sprite(mat);
    spr.scale.set(22, 5.5, 1);
    return spr;
  }

  function World(scene, rng, lowfx) {
    this.scene = scene;
    this.rng = rng;
    this.lowfx = !!lowfx;
    this.timeOfDay = 0.72; // golden late afternoon at boot
    this.clock = 0; // game seconds since boot; drives the traffic lights
    this.buildings = []; // {x, z, hw, hd, h} collision boxes
    this.landmarks = LANDMARKS;
    this.lightPoles = []; // {red, yellow, green} meshes per junction
    this._build();
  }

  World.prototype._build = function () {
    var rng = this.rng;
    var scene = this.scene;

    // Ground.
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshLambertMaterial({ map: makeGroundTexture(rng) })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // The ocean south of the beach, and a strip of sand is in the texture.
    var ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 320),
      new THREE.MeshLambertMaterial({ color: 0x2a6f8f })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, -0.4, -240 - 160);
    scene.add(ocean);

    // Sky dome colour is set by updateLighting; start with a sunset tint.
    scene.background = new THREE.Color(0xf2a65e);
    scene.fog = new THREE.Fog(0xf2a65e, 180, 520);

    // Sun (directional, casts the long shadows) + hemisphere fill.
    this.sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
    this.sun.position.set(120, 90, -80);
    this.sun.castShadow = !this.lowfx;
    if (!this.lowfx) {
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.camera.left = -260;
      this.sun.shadow.camera.right = 260;
      this.sun.shadow.camera.top = 260;
      this.sun.shadow.camera.bottom = -260;
      this.sun.shadow.camera.far = 600;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffd9b0, 0x4a3a30, 0.9);
    scene.add(this.hemi);

    // The low sun itself, a glowing disc hanging over the ocean.
    var sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(26, 32),
      new THREE.MeshBasicMaterial({ color: 0xffdf8a, fog: false })
    );
    sunDisc.position.set(-40, 42, -420);
    sunDisc.lookAt(0, 42, 0);
    scene.add(sunDisc);
    this.sunDisc = sunDisc;

    // Prebuilt sky colours (reused every frame; no per-frame allocation).
    this._skyNight = new THREE.Color(0x10182e);
    this._skyGold = new THREE.Color(0xf2a65e);
    this._skyDay = new THREE.Color(0x87bfe8);
    this._skyDusk = new THREE.Color(0x2a2a4a);

    this._buildBuildings();
    this._buildPalms();
    this._buildStreetLights();
    this._buildTrafficLights();
    this._buildLandmarkProps();
  };

  World.prototype._buildBuildings = function () {
    var rng = this.rng;
    var scene = this.scene;
    var palette = [0x8a6f5c, 0x9c8a7a, 0x7a7f8c, 0xb08d6a, 0x6f7d6a, 0xa08a9c, 0x84755a, 0x5f7086];
    var blockCenters = [-182, -130, -78, -26, 26, 78, 130, 182];
    var winTex = makeWindowTexture(rng, 0.45);
    for (var bi = 0; bi < blockCenters.length; bi++) {
      for (var bj = 0; bj < blockCenters.length; bj++) {
        var bx = blockCenters[bi], bz = blockCenters[bj];
        // The beach blocks stay open (sand, palms, boardwalk).
        if (bz <= -182) continue;
        // Blocks that hold a landmark prop stay open too, so no tower
        // ever grows through the garage, the mall, the casino or the
        // safehouse.
        if ((bx === 130 && bz === 78) || (bx === -182 && bz === 130) ||
            (bx === -130 && bz === -26) || (bx === 182 && bz === 182)) continue;
        var n = rng.int(1, 3);
        for (var k = 0; k < n; k++) {
          var w = rng.range(14, 26), d = rng.range(14, 26);
          var h = rng.chance(0.18) ? rng.range(34, 58) : rng.range(10, 30);
          // Keep every face at least 7 m clear of the road surface (14 m
          // from the nearest road centreline): a block is 52 m across and
          // the roads eat 7 m on each side, so the centre may stray at
          // most 12 m minus half the footprint. A car that weaves off a
          // road then has a wide shoulder before it meets a wall, and the
          // driver can steer back instead of wedging between towers.
          var maxOx = Math.max(0, 12 - w / 2);
          var maxOz = Math.max(0, 12 - d / 2);
          var ox = rng.range(-maxOx, maxOx), oz = rng.range(-maxOz, maxOz);
          var x = bx + ox, z = bz + oz;
          var color = rng.pick(palette);
          var mats = [];
          for (var f = 0; f < 6; f++) {
            if (f === 2 || f === 3) {
              // Roof and underside stay plain.
              mats.push(new THREE.MeshLambertMaterial({ color: color }));
            } else {
              mats.push(new THREE.MeshLambertMaterial({ map: winTex, color: color }));
            }
          }
          // BoxGeometry material order: +x, -x, +y, -y, +z, -z. Windows
          // belong on the four vertical faces; the roof stays plain.
          var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
          mesh.position.set(x, h / 2, z);
          mesh.castShadow = !this.lowfx;
          mesh.receiveShadow = true;
          scene.add(mesh);
          // A flat roof cap in a darker tone.
          var cap = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6),
            new THREE.MeshLambertMaterial({ color: 0x3c3630 })
          );
          cap.position.set(x, h + 0.4, z);
          scene.add(cap);
          this.buildings.push({ x: x, z: z, hw: w / 2, hd: d / 2, h: h });
        }
      }
    }
  };

  World.prototype._buildPalms = function () {
    var rng = this.rng;
    var scene = this.scene;
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
    var leafMat = new THREE.MeshLambertMaterial({ color: 0x3f7d3a });
    for (var i = 0; i < 55; i++) {
      var onBeach = rng.chance(0.35);
      var x, z;
      if (onBeach) {
        x = rng.range(-220, 220);
        z = rng.range(-232, -214);
      } else {
        // Along a sidewalk edge.
        var c = rng.pick(ROAD_COORDS);
        if (rng.chance(0.5)) { x = c + rng.pick([-11, 11]); z = rng.range(-200, 200); }
        else { x = rng.range(-200, 200); z = c + rng.pick([-11, 11]); }
      }
      // Keep palms off the road surface and out of building footprints.
      if (Math.abs(x - nearestRoadCoord(x)) < 9 && Math.abs(z - nearestRoadCoord(z)) < 9) continue;
      var h = rng.range(5, 8);
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h, 6), trunkMat);
      trunk.position.set(x, h / 2, z);
      trunk.castShadow = !this.lowfx;
      scene.add(trunk);
      for (var l = 0; l < 5; l++) {
        var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 4), leafMat);
        var a = (l / 5) * Math.PI * 2;
        leaf.position.set(x + Math.cos(a) * 1.1, h + 0.6, z + Math.sin(a) * 1.1);
        leaf.rotation.z = Math.cos(a) * 1.1;
        leaf.rotation.x = -Math.sin(a) * 1.1;
        scene.add(leaf);
      }
    }
  };

  World.prototype._buildStreetLights = function () {
    var scene = this.scene;
    var poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    var bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    this.streetBulbs = [];
    for (var i = 0; i < ROAD_COORDS.length; i++) {
      for (var j = -2; j <= 2; j++) {
        var c = ROAD_COORDS[i];
        var along = j * 104;
        var pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7, 6), poleMat);
        pole1.position.set(c + 10, 3.5, along);
        scene.add(pole1);
        var bulb1 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), bulbMat);
        bulb1.position.set(c + 10, 7.1, along);
        scene.add(bulb1);
        this.streetBulbs.push(bulb1);
        var pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7, 6), poleMat);
        pole2.position.set(along, 3.5, c + 10);
        scene.add(pole2);
        var bulb2 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), bulbMat);
        bulb2.position.set(along, 7.1, c + 10);
        scene.add(bulb2);
        this.streetBulbs.push(bulb2);
      }
    }
  };

  World.prototype._buildTrafficLights = function () {
    var scene = this.scene;
    var poleMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
    // Lights at the nine central junctions; each has red / yellow / green.
    var junctions = [];
    for (var i = -1; i <= 1; i++) {
      for (var j = -1; j <= 1; j++) junctions.push([i * 52, j * 52]);
    }
    junctions.push([0, -104], [0, 104], [-104, 0], [104, 0]);
    for (var n = 0; n < junctions.length; n++) {
      var jx = junctions[n][0], jz = junctions[n][1];
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.5, 6), poleMat);
      pole.position.set(jx + 8.5, 3.25, jz + 8.5);
      scene.add(pole);
      var head = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 2.6, 0.7),
        new THREE.MeshLambertMaterial({ color: 0x15161a })
      );
      head.position.set(jx + 8.5, 6.6, jz + 8.5);
      scene.add(head);
      var mk = function (color, y) {
        var m = new THREE.Mesh(
          new THREE.SphereGeometry(0.34, 8, 6),
          new THREE.MeshBasicMaterial({ color: color })
        );
        m.position.set(jx + 8.5, y, jz + 8.1);
        scene.add(m);
        return m;
      };
      this.lightPoles.push({
        red: mk(0xff2a22, 7.4),
        yellow: mk(0xffc21a, 6.6),
        green: mk(0x2aff66, 5.8),
      });
    }
  };

  World.prototype._buildLandmarkProps = function () {
    var scene = this.scene;
    // Garage: a low workshop block with a sign, beside the junction — kept
    // clear of both roads that meet there.
    var garage = new THREE.Mesh(
      new THREE.BoxGeometry(20, 7, 14),
      new THREE.MeshLambertMaterial({ color: 0x4a6a8c })
    );
    garage.position.set(-180, 3.5, 122);
    garage.castShadow = !this.lowfx;
    scene.add(garage);
    this.buildings.push({ x: -180, z: 122, hw: 10, hd: 7, h: 7 });
    var gSign = makeLabelSprite("SLIM'S GARAGE", '#7fd8ff');
    gSign.position.set(-180, 10.5, 122);
    scene.add(gSign);
    // Casino: a taller gold-trimmed block with a sign. It sits south-east
    // of the vault junction, clear of the roads and clear of the diagonal
    // line from the casino to the Safehouse, so a getaway on foot is
    // never walled in by it.
    var casino = new THREE.Mesh(
      new THREE.BoxGeometry(26, 20, 14),
      new THREE.MeshLambertMaterial({ color: 0x8c6a2a })
    );
    casino.position.set(132, 10, 84);
    casino.castShadow = !this.lowfx;
    scene.add(casino);
    this.buildings.push({ x: 132, z: 84, hw: 13, hd: 7, h: 20 });
    var cSign = makeLabelSprite('CASINO DEL SOL', '#ffd24a');
    cSign.position.set(132, 24, 84);
    scene.add(cSign);
    // Mall: a wide low block.
    var mall = new THREE.Mesh(
      new THREE.BoxGeometry(28, 9, 14),
      new THREE.MeshLambertMaterial({ color: 0x7a8a9c })
    );
    mall.position.set(-134, 4.5, -18);
    mall.castShadow = !this.lowfx;
    scene.add(mall);
    this.buildings.push({ x: -134, z: -18, hw: 14, hd: 7, h: 9 });
    var mSign = makeLabelSprite('BAYVIEW MALL', '#9fe8a8');
    mSign.position.set(-134, 12, -18);
    scene.add(mSign);
    // Docks: crates and a small warehouse near the water end of the grid.
    var crateMat = new THREE.MeshLambertMaterial({ color: 0x8c6a3a });
    var crates = [[-168, -168, 4], [-168, -172, 3], [-166, -160, 2.4], [-146, -166, 3.4]];
    for (var i = 0; i < crates.length; i++) {
      var s = crates[i][2];
      var crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      crate.position.set(crates[i][0], s / 2, crates[i][1]);
      crate.castShadow = !this.lowfx;
      scene.add(crate);
      this.buildings.push({ x: crates[i][0], z: crates[i][1], hw: s / 2, hd: s / 2, h: s });
    }
    var dSign = makeLabelSprite('THE DOCKS', '#ffb08a');
    dSign.position.set(-156, 9, -168);
    scene.add(dSign);
    // Safehouse: a small house with a warm porch light.
    var house = new THREE.Mesh(
      new THREE.BoxGeometry(10, 6, 10),
      new THREE.MeshLambertMaterial({ color: 0x9c7a5c })
    );
    house.position.set(172, 3, 172);
    house.castShadow = !this.lowfx;
    scene.add(house);
    this.buildings.push({ x: 172, z: 172, hw: 5, hd: 5, h: 6 });
    var roof = new THREE.Mesh(
      new THREE.ConeGeometry(9, 4, 4),
      new THREE.MeshLambertMaterial({ color: 0x5a3a2a })
    );
    roof.position.set(172, 8, 172);
    roof.rotation.y = Math.PI / 4;
    scene.add(roof);
    var sSign = makeLabelSprite('SAFEHOUSE', '#9fe8a8');
    sSign.position.set(172, 12, 172);
    scene.add(sSign);
  };

  // Traffic-light phase: 12 s cycle — green 0-5.5, yellow 5.5-6.5, red
  // 6.5-12. The cycle is short on purpose: under a slow renderer a game
  // second is several real seconds, so a full cycle still passes quickly.
  // The same phase shows at every junction, so lightStateAt is unambiguous
  // for any caller (and for the red-light rule).
  World.prototype.lightPhase = function () {
    var p = this.clock % 12;
    if (p < 5.5) return 'green';
    if (p < 6.5) return 'yellow';
    return 'red';
  };

  World.prototype.lightStateAt = function (x, z, ns) {
    return this.lightPhase();
  };

  // Push a circle (x, z, radius) out of every building it overlaps.
  // Returns true when a push happened.
  World.prototype.resolveBuildings = function (pos, radius) {
    var hit = false;
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      var cx = U.clamp(pos.x, b.x - b.hw, b.x + b.hw);
      var cz = U.clamp(pos.z, b.z - b.hd, b.z + b.hd);
      var dx = pos.x - cx, dz = pos.z - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 < 1e-6) {
          // Dead centre: push out along the smaller penetration axis.
          var px = b.hw + radius - Math.abs(pos.x - b.x);
          var pz = b.hd + radius - Math.abs(pos.z - b.z);
          if (px < pz) pos.x += (pos.x >= b.x ? px : -px);
          else pos.z += (pos.z >= b.z ? pz : -pz);
        } else {
          var d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        }
        hit = true;
      }
    }
    return hit;
  };

  // Sun, sky and fog for the current time of day (0 = dawn, 0.5 = noon,
  // 0.75 = dusk, 1 = midnight). The day advances slowly on its own.
  World.prototype.updateLighting = function () {
    var t = this.timeOfDay;
    var day = Math.sin(t * Math.PI); // 0 at night, 1 at midday
    day = U.clamp(day, 0, 1);
    var sunAngle = t * Math.PI * 2 - Math.PI / 2;
    var sx = Math.cos(sunAngle) * 160;
    var sy = Math.sin(sunAngle) * 140 + 30;
    var sz = -90;
    this.sun.position.set(sx, Math.max(sy, 8), sz);
    this.sun.intensity = 0.4 + day * 2.2;
    this.hemi.intensity = 0.35 + day * 0.8;
    var sky;
    if (t < 0.22 || t > 0.92) sky = this._skyNight; // night
    else if (t < 0.35) sky = this._skyGold; // sunrise gold
    else if (t < 0.6) sky = this._skyDay; // midday blue
    else if (t < 0.8) sky = this._skyGold; // sunset gold
    else sky = this._skyDusk; // dusk
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.sunDisc.material.color.setHex(day > 0.4 ? 0xffdf8a : 0xff9a5a);
    this.sunDisc.position.set(sx * 2.4, Math.max(sy * 2.2, 18), -420);
    var night = day < 0.35;
    for (var i = 0; i < this.streetBulbs.length; i++) {
      this.streetBulbs[i].material.color.setHex(night ? 0xffe9a8 : 0x555550);
    }
  };

  World.prototype.update = function (dt) {
    this.clock += dt;
    // A full day takes about 12 game-minutes; the T key jumps it instead.
    this.timeOfDay = (this.timeOfDay + dt / 720) % 1;
    this.updateLighting();
    var phase = this.lightPhase();
    for (var i = 0; i < this.lightPoles.length; i++) {
      var p = this.lightPoles[i];
      p.red.material.color.setHex(phase === 'red' ? 0xff2a22 : 0x4a1414);
      p.yellow.material.color.setHex(phase === 'yellow' ? 0xffc21a : 0x4a3a10);
      p.green.material.color.setHex(phase === 'green' ? 0x2aff66 : 0x103a1e);
    }
  };

  window.SB.world = {
    World: World,
    ROAD_COORDS: ROAD_COORDS,
    ROAD_HALF: ROAD_HALF,
    BOUND: BOUND,
    LANDMARKS: LANDMARKS,
    nearestRoadCoord: nearestRoadCoord,
    snapToRoad: snapToRoad,
  };
})();
