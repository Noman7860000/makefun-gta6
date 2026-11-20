// SUNSET BAY — boot, three.js rendering, input, HUD and the window.SUNSET API.
// ?seed=N fixes the city. ?lowfx=1 trims effects for slow machines.
import * as THREE from '../vendor/three.module.js';
import { createGame } from './game.js';
import { MISSION_LIST } from './missions.js';
import { clamp, lerp } from './util.js';

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
const lowfx = params.get('lowfx') === '1';

const canvas = document.getElementById('game');
const game = createGame(seed);
const world = game.world;

// ---- renderer / scene ---------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e1e);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 900);

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffe0b3, 1.0);
scene.add(sun);
scene.add(sun.target);

// ---- ground: a painted top-down map of the city -------------------------
function makeGroundTexture() {
  const S = 1024;
  const half = 260;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  const px = (v) => ((v + half) / (half * 2)) * S;
  ctx.fillStyle = '#26301f';
  ctx.fillRect(0, 0, S, S);
  // The bay, west edge.
  ctx.fillStyle = '#1d4e6b';
  ctx.fillRect(0, 0, px(-238), S);
  ctx.fillStyle = '#2e6b8a';
  ctx.fillRect(0, 0, px(-246), S);
  // City blocks.
  ctx.fillStyle = '#2b313b';
  for (const bx of [-182, -130, -78, -26, 26, 78, 130, 182]) {
    for (const bz of [-182, -130, -78, -26, 26, 78, 130, 182]) {
      ctx.fillRect(px(bx - 24), px(bz - 24), px(48) - px(0), px(48) - px(0));
    }
  }
  // Roads.
  ctx.fillStyle = '#14161a';
  for (const c of world.roads) {
    ctx.fillRect(0, px(c - 6), S, px(12) - px(0));
    ctx.fillRect(px(c - 6), 0, px(12) - px(0), S);
  }
  // Lane dashes.
  ctx.fillStyle = '#c8a13a';
  for (const c of world.roads) {
    for (let v = -240; v < 240; v += 16) {
      ctx.fillRect(px(v), px(c - 0.4), px(8) - px(0), px(0.8) - px(0));
      ctx.fillRect(px(c - 0.4), px(v), px(0.8) - px(0), px(8) - px(0));
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(520, 520),
  new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// ---- buildings ----------------------------------------------------------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function lambert(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
for (const b of world.buildings) {
  const m = new THREE.Mesh(boxGeo, lambert(b.color));
  m.scale.set(b.w, b.h, b.d);
  m.position.set(b.x, b.h / 2, b.z);
  scene.add(m);
  // Rooftop rim for landmarks.
  if (b.landmark) {
    const rim = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    rim.scale.set(b.w + 0.6, 0.5, b.d + 0.6);
    rim.position.set(b.x, b.h + 0.25, b.z);
    scene.add(rim);
  }
}
// Landmark name sprites.
function makeLabel(text) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(36, 6.75, 1);
  return spr;
}
for (const b of world.buildings) {
  if (!b.label) continue;
  const spr = makeLabel(b.label);
  spr.position.set(b.x, b.h + 7, b.z);
  scene.add(spr);
}
// Street lamps.
const lampGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 6);
const lampMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
const bulbGeo = new THREE.SphereGeometry(0.45, 8, 6);
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
if (!lowfx) {
  for (const l of world.lamps) {
    const pole = new THREE.Mesh(lampGeo, lampMat);
    pole.position.set(l.x, 3, l.z);
    scene.add(pole);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(l.x, 6.2, l.z);
    scene.add(bulb);
  }
}

// ---- entity meshes ------------------------------------------------------
const meshOf = new Map();
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0c0e });
const cabinMat = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });

function makeCarMesh(car) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(boxGeo, lambert(car.color));
  body.scale.set(2.2, 0.75, 4.4);
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(boxGeo, cabinMat);
  cabin.scale.set(1.9, 0.62, 2.1);
  cabin.position.set(0, 1.28, -0.25);
  g.add(cabin);
  for (const [wx, wz] of [[-1.05, 1.45], [1.05, 1.45], [-1.05, -1.45], [1.05, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.38, wz);
    g.add(w);
  }
  for (const hx of [-0.7, 0.7]) {
    const h = new THREE.Mesh(boxGeo, headMat);
    h.scale.set(0.35, 0.18, 0.1);
    h.position.set(hx, 0.62, 2.22);
    g.add(h);
  }
  if (car.kind === 'police') {
    const red = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.scale.set(0.5, 0.22, 0.7);
    red.position.set(-0.45, 1.72, -0.25);
    g.add(red);
    const blue = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x2255ff }));
    blue.scale.set(0.5, 0.22, 0.7);
    blue.position.set(0.45, 1.72, -0.25);
    g.add(blue);
    g.userData.lights = [red, blue];
  }
  if (car.marked) {
    const glow = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    glow.scale.set(2.3, 0.12, 4.5);
    glow.position.y = 0.08;
    g.add(glow);
  }
  return g;
}

function makePersonMesh(color, isGuard, isCop) {
  const g = new THREE.Group();
  const bodyColor = isCop ? 0x1d2f55 : isGuard ? 0x2a2a33 : color;
  const body = new THREE.Mesh(boxGeo, lambert(bodyColor));
  body.scale.set(0.55, 1.0, 0.35);
  body.position.y = 0.95;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), lambert(0xe0b090));
  head.position.y = 1.62;
  g.add(head);
  if (isGuard) {
    const band = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xdd2222 }));
    band.scale.set(0.58, 0.12, 0.38);
    band.position.y = 1.15;
    g.add(band);
  }
  if (isCop) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10), lambert(0x11131a));
    cap.position.y = 1.78;
    g.add(cap);
  }
  return g;
}

// Cole Vance, the player.
const playerMesh = makePersonMesh(0xd4762a, false, false);
scene.add(playerMesh);

function syncMeshes(now) {
  const alive = new Set();
  for (const car of game.cars) {
    alive.add(car);
    if (!meshOf.has(car)) {
      const m = makeCarMesh(car);
      meshOf.set(car, m);
      scene.add(m);
    }
    const m = meshOf.get(car);
    m.position.set(car.x, 0, car.z);
    m.rotation.y = car.heading;
    if (car.dead) m.rotation.z = 0.12;
    if (car.kind === 'police' && m.userData.lights) {
      const phase = Math.floor(now / 350) % 2 === 0;
      m.userData.lights[0].visible = phase;
      m.userData.lights[1].visible = !phase;
    }
  }
  for (const ped of game.peds) {
    alive.add(ped);
    if (!meshOf.has(ped)) {
      const m = makePersonMesh(ped.color, false, false);
      meshOf.set(ped, m);
      scene.add(m);
    }
    const m = meshOf.get(ped);
    m.position.set(ped.x, ped.state === 'down' ? 0.3 : 0, ped.z);
    m.rotation.y = ped.heading;
    m.rotation.z = ped.state === 'down' ? Math.PI / 2 : 0;
  }
  for (const g of game.enemies) {
    alive.add(g);
    if (!meshOf.has(g)) {
      const m = makePersonMesh(0, true, false);
      meshOf.set(g, m);
      scene.add(m);
    }
    const m = meshOf.get(g);
    m.position.set(g.x, g.state === 'down' ? 0.3 : 0, g.z);
    m.rotation.y = g.heading;
    m.rotation.z = g.state === 'down' ? Math.PI / 2 : 0;
  }
  for (const fp of game.footPolice) {
    alive.add(fp);
    if (!meshOf.has(fp)) {
      const m = makePersonMesh(0, false, true);
      meshOf.set(fp, m);
      scene.add(m);
    }
    const m = meshOf.get(fp);
    m.position.set(fp.x, 0, fp.z);
    m.rotation.y = fp.heading;
  }
  for (const [entity, m] of [...meshOf.entries()]) {
    if (!alive.has(entity)) {
      scene.remove(m);
      meshOf.delete(entity);
    }
  }
  // Player mesh.
  playerMesh.visible = !game.playerCar;
  playerMesh.position.set(game.player.x, 0, game.player.z);
  playerMesh.rotation.y = game.player.heading;
}

// ---- camera ---------------------------------------------------------------
const camTarget = new THREE.Vector3();
function updateCamera(dt, now) {
  if (game.state === 'menu') {
    const a = now / 9000;
    camTarget.set(0, 0, 0);
    camera.position.set(Math.sin(a) * 190, 95, Math.cos(a) * 190);
    camera.lookAt(0, 0, 0);
    return;
  }
  const t = game.playerCar || game.player;
  const dist = game.playerCar ? 13 : 8.5;
  const height = game.playerCar ? 6 : 4.5;
  const cx = t.x - Math.sin(game.camYaw) * dist;
  const cz = t.z - Math.cos(game.camYaw) * dist;
  const k = Math.min(1, dt * 6);
  camera.position.x += (cx - camera.position.x) * k;
  camera.position.y += (height - camera.position.y) * k;
  camera.position.z += (cz - camera.position.z) * k;
  camTarget.set(
    t.x + Math.sin(game.camYaw) * 4,
    1.5,
    t.z + Math.cos(game.camYaw) * 4,
  );
  camera.lookAt(camTarget);
}

// ---- lighting / sky -------------------------------------------------------
const nightSky = new THREE.Color(0x0a0e1e);
const daySky = new THREE.Color(0x8fc3e8);
const duskSky = new THREE.Color(0xe8875a);
const skyColor = new THREE.Color();
function updateLights() {
  const day = world.daylight();
  sun.intensity = 0.25 + 0.95 * day;
  ambient.intensity = 0.3 + 0.45 * day;
  const ang = (world.timeOfDay - 0.25) * Math.PI * 2;
  const elev = Math.sin(ang);
  sun.position.set(Math.cos(ang) * 140, Math.max(25, elev * 150), 60);
  if (day < 0.45) skyColor.copy(nightSky).lerp(duskSky, day / 0.45);
  else skyColor.copy(duskSky).lerp(daySky, (day - 0.45) / 0.55);
  scene.background = skyColor;
}

// ---- HUD ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hudCache = {};
function setText(id, value) {
  if (hudCache[id] !== value) {
    hudCache[id] = value;
    $(id).textContent = value;
  }
}
function missionTarget() {
  const lm = world.landmarks;
  switch (game.mission) {
    case 'm1': return game.missionStep === 0 ? null : lm.garage;
    case 'm2': return game.missionStep === 0 ? lm.docks : lm.safehouse;
    case 'm3': return game.missionStep === 0 ? lm.docks : lm.mall;
    case 'm4': return game.missionStep === 0 ? lm.casino : lm.garage;
    case 'm5': return game.missionStep === 0 ? lm.casino : lm.safehouse;
    default: return null;
  }
}
const minimap = $('minimap');
const mmCtx = minimap.getContext('2d');
let mmTimer = 0;
function drawMinimap(now) {
  const W = 180;
  const toPx = (v) => ((v + 260) / 520) * W;
  mmCtx.fillStyle = '#14161a';
  mmCtx.fillRect(0, 0, W, W);
  mmCtx.strokeStyle = '#3a4048';
  mmCtx.lineWidth = 2;
  for (const c of world.roads) {
    mmCtx.beginPath();
    mmCtx.moveTo(0, toPx(c));
    mmCtx.lineTo(W, toPx(c));
    mmCtx.stroke();
    mmCtx.beginPath();
    mmCtx.moveTo(toPx(c), 0);
    mmCtx.lineTo(toPx(c), W);
    mmCtx.stroke();
  }
  const lmColors = { casino: '#c9a227', mall: '#3f6fb5', docks: '#4a6a72', safehouse: '#b5763f', garage: '#b5483f' };
  for (const [key, lm] of Object.entries(world.landmarks)) {
    mmCtx.fillStyle = lmColors[key] || '#ffffff';
    mmCtx.fillRect(toPx(lm.x) - 3, toPx(lm.z) - 3, 6, 6);
  }
  const target = missionTarget();
  if (target) {
    const pulse = 5 + Math.sin(now / 250) * 2;
    mmCtx.strokeStyle = '#ffd23f';
    mmCtx.lineWidth = 2;
    mmCtx.beginPath();
    mmCtx.arc(toPx(target.x), toPx(target.z), pulse, 0, Math.PI * 2);
    mmCtx.stroke();
  }
  for (const cop of game.policeCars) {
    mmCtx.fillStyle = '#ff4444';
    mmCtx.beginPath();
    mmCtx.arc(toPx(cop.x), toPx(cop.z), 2.5, 0, Math.PI * 2);
    mmCtx.fill();
  }
  mmCtx.fillStyle = '#ffffff';
  mmCtx.beginPath();
  mmCtx.arc(toPx(game.player.x), toPx(game.player.z), 3.5, 0, Math.PI * 2);
  mmCtx.fill();
}

function updateHUD(now, dt) {
  const s = game.getState();
  setText('cash', '$' + s.cash);
  setText('wanted', s.wanted > 0 ? '★'.repeat(s.wanted) : '');
  const hb = $('health-bar');
  const hpct = s.health + '%';
  if (hudCache.hp !== hpct) {
    hudCache.hp = hpct;
    hb.style.width = hpct;
  }
  setText('health-text', String(s.health));
  setText('objective', s.objective || (s.state === 'playing' ? 'Free roam — press M for missions' : ''));
  if (game.mission === 'm3' && game.missionStep === 1) {
    const t = Math.max(0, Math.ceil(game.missionTimer));
    setText('timer', Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'));
  } else {
    setText('timer', '');
  }
  setText('speed', game.playerCar ? Math.round(Math.abs(game.playerCar.speed) * 3.6) + ' km/h' : '');
  mmTimer -= dt;
  if (mmTimer <= 0) {
    mmTimer = 0.15;
    drawMinimap(now);
  }
  // Mission list statuses.
  for (const item of document.querySelectorAll('.mission-item')) {
    const id = item.dataset.id;
    const st = item.querySelector('.mi-status');
    let text = 'Available';
    let done = false;
    if (game.completed.includes(id)) {
      text = 'Completed ✓';
      done = true;
    } else if (game.mission === id) {
      text = 'Active — ' + (game.objective || '');
    }
    if (st.textContent !== text) st.textContent = text;
    item.classList.toggle('done', done);
  }
}

// ---- overlays -------------------------------------------------------------
let lastState = null;
function syncOverlays() {
  const s = game.state;
  if (s === lastState) return;
  lastState = s;
  $('menu').style.display = s === 'menu' ? 'flex' : 'none';
  $('paused').style.display = s === 'paused' ? 'flex' : 'none';
  $('end-screen').style.display = s === 'busted' || s === 'wasted' ? 'flex' : 'none';
  if (s === 'busted') {
    $('end-title').textContent = 'BUSTED';
    $('end-sub').textContent = 'The cops caught up with you. $200 fine.';
  } else if (s === 'wasted') {
    $('end-title').textContent = 'WASTED';
    $('end-sub').textContent = 'You got beat down. $100 hospital bill.';
  }
  if (s === 'menu') {
    const save = game.loadSave();
    $('btn-continue').style.display = save ? 'inline-block' : 'none';
  }
}

let missionsOpen = false;
function setMissionsOpen(open) {
  missionsOpen = open;
  $('missions').style.display = open ? 'flex' : 'none';
}

// ---- toasts / status --------------------------------------------------------
const statusEl = $('status');
function announce(msg) {
  statusEl.textContent = msg;
}
game.onToast = (text) => {
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = text;
  $('toasts').appendChild(div);
  setTimeout(() => div.remove(), 4000);
  announce(text);
};
game.onEnd = () => {
  syncOverlays();
};

// ---- buttons ----------------------------------------------------------------
$('btn-start').addEventListener('click', () => {
  game.startGame();
  announce('Playing. Cole Vance, $250. Press M for missions.');
});
$('btn-continue').addEventListener('click', () => {
  const save = game.loadSave();
  if (save && game.loadFromSave(save)) {
    announce('Save loaded. Cash $' + game.cash + '.');
  }
});
$('btn-respawn').addEventListener('click', () => {
  game.respawn();
  announce('Back on your feet at the Safehouse.');
});
for (const item of document.querySelectorAll('.mission-item')) {
  item.addEventListener('click', () => {
    if (game.state !== 'playing') return;
    if (game.startMission(item.dataset.id)) setMissionsOpen(false);
  });
}

// ---- keyboard / mouse ---------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  game.input.keys.add(e.code);
  if (e.code === 'KeyP') {
    if (game.state === 'playing') game.setPaused(true);
    else if (game.state === 'paused') game.setPaused(false);
  } else if (e.code === 'KeyM') {
    if (game.state === 'playing' || missionsOpen) setMissionsOpen(!missionsOpen);
  } else if (e.code === 'KeyT') {
    if (game.state === 'playing') {
      world.advanceTime(0.25);
      game.toast('Time of day changed.');
    }
  } else if (e.code === 'KeyE') {
    game.tryEnterExit();
  } else if (e.code === 'KeyF') {
    game.punch();
  }
});
window.addEventListener('keyup', (e) => {
  game.input.keys.delete(e.code);
});
window.addEventListener('blur', () => {
  game.input.keys.clear();
});
let dragging = false;
let lastPX = 0;
let lastPY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastPX = e.clientX;
  lastPY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPX;
  const dy = e.clientY - lastPY;
  lastPX = e.clientX;
  lastPY = e.clientY;
  game.camYaw -= dx * 0.005;
  game.camPitch = clamp(game.camPitch + dy * 0.003, 0.12, 0.6);
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- public API ---------------------------------------------------------------
window.SUNSET = {
  game,
  state: () => game.getState(),
  startMission: (id) => game.startMission(id),
  teleport: (x, z) => game.teleport(x, z),
  setWanted: (n) => game.setWanted(n),
  giveCash: (n) => game.giveCash(n),
};

// ---- main loop ---------------------------------------------------------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt);
  syncMeshes(now);
  updateCamera(dt, now);
  updateLights();
  renderer.render(scene, camera);
  updateHUD(now, dt);
  syncOverlays();
  if (!window.__sunsetReady) window.__sunsetReady = true;
}
announce('SUNSET BAY. Press Start to play.');
requestAnimationFrame(frame);
