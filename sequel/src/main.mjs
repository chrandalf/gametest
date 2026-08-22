// NEON CITY — a Turbo Esprit tribute.
//
// The 1986 game's soul on 2026 glass: a grid city you learn, lane-grammar
// driving where the scenery is unhittable and the decisions are the game,
// junctions taken on committed indicator turns, and a CRT map that IS the
// road network. Built on Babylon.js; grown out of the Neon Drive 2 demo.
'use strict';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { GRID, CELL, buildNetwork, CLASSES } from './network.mjs';
import { buildCity } from './citygen.mjs';
import { Driver } from './driver.mjs';
import { Hud } from './hud.mjs';
import { Mission } from './mission.mjs';
import { Signals } from './lights.mjs';
import { Peds } from './peds.mjs';
import { Coast } from './outrun.mjs';
import { Sound } from './sound.mjs';

// The artifact sandbox's permissions policy forbids the Gamepad API, and
// Chrome makes the mere call throw. Babylon's input system polls it during
// engine startup, so hand it an empty pad list instead of an exception.
try { navigator.getGamepads && navigator.getGamepads(); }
catch (e) {
  Object.defineProperty(navigator, 'getGamepads',
    { value: () => [], configurable: true });
}

// Boot diagnostics, drawn on the page itself.
const diag = document.getElementById('diag');
const report = (msg) => { if (diag) diag.textContent = msg; };
addEventListener('error', (e) => report('BOOT ERROR: ' + (e.message || e.error)));
addEventListener('unhandledrejection', (e) => report('BOOT ERROR: ' + e.reason));
report('starting engine…');

const canvas = document.getElementById('c');
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.012, 0.006, 0.035, 1);
report('engine up — building the city…');

const cam = new FreeCamera('cam', new Vector3(0, 5, -12), scene);
cam.fov = 0.95;
cam.minZ = 1.2;
cam.maxZ = 2600;

const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.22;
hemi.diffuse = new Color3(0.45, 0.35, 0.75);
hemi.groundColor = new Color3(0.05, 0.02, 0.1);

// The network first: the backdrop wraps whatever size the city came out.
const net = buildNetwork();

// ------------------------------------------------------------- backdrop ----
const mid = Math.max(net.extent.x, net.extent.z) / 2;
function skyTexture() {
  const dt = new DynamicTexture('sky', { width: 64, height: 512 }, scene, true);
  const x = dt.getContext();
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#07021a'); g.addColorStop(0.55, '#2a0c4e');
  g.addColorStop(0.85, '#7a1e63'); g.addColorStop(1, '#c93a6e');
  x.fillStyle = g; x.fillRect(0, 0, 64, 512);
  dt.update();
  return dt;
}
function sunTexture() {
  const dt = new DynamicTexture('sun', { width: 512, height: 512 }, scene, true);
  const x = dt.getContext();
  x.clearRect(0, 0, 512, 512);
  const g = x.createLinearGradient(0, 40, 0, 470);
  g.addColorStop(0, '#ffd24a'); g.addColorStop(0.55, '#ff7a2a'); g.addColorStop(1, '#ff2d78');
  x.fillStyle = g;
  x.beginPath(); x.arc(256, 256, 250, 0, 6.284); x.fill();
  x.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 7; k++) x.fillRect(0, 288 + k * 26, 512, 5 + k * 2.4);
  dt.update(); dt.hasAlpha = true;
  return dt;
}
function ridgeTexture(seed, dark) {
  const dt = new DynamicTexture('ridge' + seed, { width: 1024, height: 256 }, scene, true);
  const x = dt.getContext();
  x.clearRect(0, 0, 1024, 256);
  x.fillStyle = dark;
  x.beginPath(); x.moveTo(0, 256);
  for (let px = 0; px <= 1024; px += 8) {
    const t = px / 1024 * Math.PI * 2;
    const h = 120 + Math.sin(t * 3.1 + seed) * 45 + Math.sin(t * 7.3 + seed * 2.7) * 26
                  + Math.sin(t * 13.7 + seed * 5.1) * 14;
    x.lineTo(px, 256 - h);
  }
  x.lineTo(1024, 256); x.closePath(); x.fill();
  dt.update(); dt.hasAlpha = true;
  return dt;
}
// Four sky walls boxing the city so every heading has a horizon.
const nightSkies = [];
for (const [rx, rz, ry] of [[mid, mid + 1250, 0], [mid, mid - 1250, Math.PI],
                            [mid + 1250, mid, -Math.PI / 2], [mid - 1250, mid, Math.PI / 2]]) {
  const p = MeshBuilder.CreatePlane('sky', { width: 3400, height: 800 }, scene);
  p.position.set(rx, 260, rz);
  p.rotation.y = ry;
  const m = new StandardMaterial('skym', scene);
  m.emissiveTexture = skyTexture(); m.disableLighting = true;
  p.material = m;
  nightSkies.push(p);
}
const sun = MeshBuilder.CreatePlane('sun', { size: 420 }, scene);
sun.position.set(mid, 150, mid + 1240);
const sunM = new StandardMaterial('sunm', scene);
sunM.emissiveTexture = sunTexture(); sunM.opacityTexture = sunM.emissiveTexture;
sunM.disableLighting = true;
sun.material = sunM;
for (const [seed, dz, y, col] of [[1.7, 1180, 70, '#241040'], [4.2, 1120, 50, '#160a2b']]) {
  for (const [px2, pz2, ry] of [[mid, mid + dz, 0], [mid, mid - dz, Math.PI],
                                [mid + dz, mid, -Math.PI / 2], [mid - dz, mid, Math.PI / 2]]) {
    const r = MeshBuilder.CreatePlane('r', { width: 3200, height: 220 }, scene);
    r.position.set(px2, y, pz2);
    r.rotation.y = ry;
    const m = new StandardMaterial('rm', scene);
    m.emissiveTexture = ridgeTexture(seed, col); m.opacityTexture = m.emissiveTexture;
    m.disableLighting = true;
    r.material = m;
    nightSkies.push(r);
  }
}

// ------------------------------------------------------------- the city ----
const mirror = new MirrorTexture('mir', 512, scene, true);
mirror.mirrorPlane = new Plane(0, -1, 0, 0);
mirror.level = 0.8;
mirror.renderList.push(sun);

const cityBits = buildCity(scene, net, mirror);
report('city built — starting traffic…');

// ---- merge pass: the 9-fps fix ----------------------------------------
// Every kerb, neon line and tower was its own draw call - then the mirror
// drew them all again, then the glow layer again. Merge all static
// geometry per material into a handful of meshes.
{
  const MERGE = new Set(['rd', 'wk', 'kb', 'sl', 'el', 'ml', 'b', 'sg',
                         'pad', 'pump', 'sand', 'sea', 'gp', 'gpan',
                         'cone', 'barr', 'pole']);
  const buckets = new Map();
  for (const msh of scene.meshes.slice()) {
    if (!MERGE.has(msh.name) || !msh.material) continue;
    const key = msh.material.uniqueId;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(msh);
  }
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    const merged = Mesh.MergeMeshes(arr, true, true, undefined, false, false);
    if (merged) merged.name = 'static';
  }
  // Rebuild the mirror list: merged statics, live car parts, the sun.
  mirror.renderList = scene.meshes.filter(msh =>
    msh.name === 'static' || msh.name === 'p' || msh.name === 'w' || msh.name === 'sun');
}

// ---- performance pass -------------------------------------------------
// The city never moves: freeze every static world matrix so Babylon stops
// recomputing them, and keep the mirror honest - it was re-rendering the
// ground and the near-coplanar road slabs into itself for nothing.
const CAR_PARTS = new Set(['p', 'w']);
for (const msh of scene.meshes) {
  if (CAR_PARTS.has(msh.name) || msh.name === 'pal' || msh.name === 'sun') continue;
  msh.freezeWorldMatrix();
  msh.doNotSyncBoundingInfo = true;
}
const FLAT = new Set(['g', 'rd', 'wk', 'kb', 'sl']);
mirror.renderList = mirror.renderList.filter(msh => !FLAT.has(msh.name));

// ------------------------------------------------------------- vehicles ----
function buildCar(paintCol, taillit, trimCol) {
  const root = new TransformNode('car', scene);
  const paint = new PBRMaterial('paint', scene);
  paint.albedoColor = paintCol;
  paint.metallic = 0.85; paint.roughness = 0.24;
  paint.reflectionTexture = mirror;
  const blk = new PBRMaterial('blk', scene);
  blk.albedoColor = new Color3(0.02, 0.02, 0.025);
  blk.metallic = 0.3; blk.roughness = 0.6;
  const lit = new StandardMaterial('lit', scene);
  lit.emissiveColor = taillit ? new Color3(1.7, 0.07, 0.05) : new Color3(0.05, 0.05, 0.05);
  lit.disableLighting = true;
  const head = new StandardMaterial('head', scene);
  head.emissiveColor = new Color3(1.35, 1.25, 0.95);
  head.disableLighting = true;
  const part = (w, h, d, x, y, z, mat, rx) => {
    const b = MeshBuilder.CreateBox('p', { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z); b.parent = root; b.material = mat;
    if (rx) b.rotation.x = rx;
    mirror.renderList.push(b);
    return b;
  };
  part(1.9, 0.5, 4.4, 0, 0.62, 0, paint);
  part(1.8, 0.32, 1.6, 0, 0.55, 2.6, paint, 0.10);
  part(1.55, 0.42, 2.0, 0, 1.06, -0.5, blk);
  part(1.8, 0.06, 0.5, 0, 1.14, -2.1, paint);
  part(1.72, 0.24, 0.1, 0, 0.72, -2.24, lit);       // tail bar
  part(0.5, 0.1, 0.06, -0.6, 0.55, 3.38, head);     // headlights
  part(0.5, 0.1, 0.06, 0.6, 0.55, 3.38, head);
  // Neon beltline trim: the silhouette, drawn in light. This is what makes
  // a car readable against the dark instead of a shadow with headlights.
  const trim = new StandardMaterial('trim', scene);
  trim.emissiveColor = trimCol || new Color3(0.55, 0.55, 0.65);
  trim.disableLighting = true;
  part(0.05, 0.05, 4.3, -0.96, 0.86, 0, trim);
  part(0.05, 0.05, 4.3, 0.96, 0.86, 0, trim);
  part(1.9, 0.05, 0.05, 0, 0.86, 2.2, trim);
  part(1.86, 0.05, 0.05, 0, 0.9, -2.2, trim);
  const ind = new StandardMaterial('ind', scene);
  ind.emissiveColor = new Color3(1.5, 0.75, 0.1);
  ind.disableLighting = true;
  const indL = part(0.12, 0.12, 0.5, -0.98, 0.62, 1.4, ind);
  const indR = part(0.12, 0.12, 0.5, 0.98, 0.62, 1.4, ind);
  const wm = new PBRMaterial('wm', scene);
  wm.albedoColor = new Color3(0.03, 0.03, 0.03); wm.roughness = 0.9;
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.35], [0.95, -1.35]]) {
    const w = MeshBuilder.CreateCylinder('w', { diameter: 0.76, height: 0.3, tessellation: 14 }, scene);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); w.parent = root; w.material = wm;
    mirror.renderList.push(w);
  }
  return { root, indL, indR };
}

// The player, starting mid-city on an avenue, pointed somewhere useful.
const startEdge = net.edges.find(e => e.cls === 'avenue') || net.edges[0];
const player = new Driver(net, startEdge, 1, 0, startEdge.len * 0.4);
const playerCar = buildCar(new Color3(0.8, 0.83, 0.9), true, new Color3(0.25, 1.3, 1.6));

// Ambient traffic: the same Driver, piloted by ten lines of AI. This is the
// exact code path the target car and the police will use.
const TRAFFIC_COLOURS = [
  new Color3(0.15, 0.3, 0.85), new Color3(0.75, 0.62, 0.1),
  new Color3(0.6, 0.12, 0.65), new Color3(0.1, 0.6, 0.5),
  new Color3(0.65, 0.66, 0.7), new Color3(0.8, 0.25, 0.1),
];
const traffic = [];
for (let k = 0; k < 14; k++) {
  const e = net.edges[(k * 37) % net.edges.length];
  const lane = k % CLASSES[e.cls].lanesPer;
  const d = new Driver(net, e, k % 2 ? 1 : -1, lane, (k * 19) % Math.max(24, e.len - 12));
  d.ai = { nextThink: 2 + k, cruise: 0.5 + (k % 5) * 0.09 };
  d.car = buildCar(TRAFFIC_COLOURS[k % TRAFFIC_COLOURS.length], true, new Color3(0.4, 0.4, 0.5));
  traffic.push(d);
}

function aiInput(d, dt, t) {
  const a = d.ai;
  let indicate;
  if (t > a.nextThink) {
    a.nextThink = t + 4 + (Math.sin(t * 7 + a.cruise * 90) * 0.5 + 0.5) * 6;
    const r = Math.sin(t * 13.7 + a.cruise * 57) * 0.5 + 0.5;
    indicate = r < 0.55 ? 'straight' : r < 0.78 ? 'left' : 'right';
  }
  return { throttle: 1, steer: 0, indicate,
           stopAt: signals.stopAtFor(d.e, d.dir, t),
           maxSpeed: CLASSES[d.e.cls].limit * a.cruise };
}

// ---- the hunt: target coupe, police cruiser, mission card --------------
const hud = new Hud(net, cityBits.stations);
const mission = new Mission(scene, net, buildCar, hud);
const signals = new Signals(scene, net);
const peds = new Peds(scene, net, 42);

// Every cruiser gets a lightbar; pursuit strobes them blue/red.
const beaconMats = [];
function dressPolice(d) {
  const barMat = new StandardMaterial('bar', scene);
  barMat.emissiveColor = new Color3(1.8, 0.15, 0.15);
  barMat.disableLighting = true;
  const bar = MeshBuilder.CreateBox('p', { width: 1.1, height: 0.16, depth: 0.4 }, scene);
  bar.position.set(0, 1.34, -0.5);
  bar.parent = d.car.root;
  bar.material = barMat;
  beaconMats.push(barMat);
}
for (const d of mission.police) dressPolice(d);
mission.onPoliceSpawn = dressPolice;

const sound = new Sound();

// ---- the coast layer: OutRun lives on the ring road --------------------
const coast = new Coast(net, buildCar, hud);
coast.announceBack = () => mission.announce();

// Day skies for the morph: a blue coastal gradient on planes a step in
// front of the night walls, faded in by the vibe.
function coastSkyTexture() {
  const dt = new DynamicTexture('csky', { width: 64, height: 512 }, scene, true);
  const x = dt.getContext();
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#123b8c'); g.addColorStop(0.5, '#1e7fc4');
  g.addColorStop(0.82, '#4ecbe0'); g.addColorStop(1, '#ffd9a0');
  x.fillStyle = g; x.fillRect(0, 0, 64, 512);
  dt.update();
  return dt;
}
const daySkies = [];
for (const [rx, rz, ry] of [[mid, mid + 1240, 0], [mid, mid - 1240, Math.PI],
                            [mid + 1240, mid, -Math.PI / 2], [mid - 1240, mid, Math.PI / 2]]) {
  const p = MeshBuilder.CreatePlane('dsky', { width: 3400, height: 800 }, scene);
  p.position.set(rx, 260, rz);
  p.rotation.y = ry;
  const dm = new StandardMaterial('dskym', scene);
  dm.emissiveTexture = coastSkyTexture();
  dm.disableLighting = true;
  p.material = dm;
  p.visibility = 0;
  daySkies.push(p);
}
let vibe = 0;

// The run: score, health, and how it ends.
const run = { score: 0, health: 100, over: false, reason: '', time: 0, started: false, saved: false };
const playerPrev = { e: null, dir: 0, s: 0 };
let speedTattleT = 0;
mission.onScore = (n) => { run.score += n; };
coast.onScore = (n) => { run.score += n; };

// ---- the gun: hitscan forward, tracer pooled ---------------------------
const tracers = [];
{
  const tm = new StandardMaterial('trace', scene);
  tm.emissiveColor = new Color3(1.6, 1.3, 0.5);
  tm.disableLighting = true;
  for (let i = 0; i < 10; i++) {
    const t = MeshBuilder.CreateBox('tr', { width: 0.06, height: 0.06, depth: 1 }, scene);
    t.material = tm;
    t.setEnabled(false);
    tracers.push({ mesh: t, life: 0 });
  }
}
function showTracer(x0, z0, x1, z1, y) {
  const t = tracers.find(t => t.life <= 0);
  if (!t) return;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.max(1, Math.hypot(dx, dz));
  t.mesh.setEnabled(true);
  t.mesh.scaling.z = len;
  t.mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  t.mesh.rotation.y = Math.atan2(dx, dz);
  t.life = 0.09;
}
let gunT = 0;
function firePlayerGun(dt) {
  gunT -= dt;
  if (gunT > 0) return;
  gunT = 0.13;
  sound.gun();
  const fx = Math.sin(player.pos.yaw), fz = Math.cos(player.pos.yaw);
  const mx = player.pos.x + fx * 2.4, mz = player.pos.z + fz * 2.4;
  // Nearest thing inside a tight forward cone, out to 65 m.
  let best = null, bestD = 65, bestKind = null;
  const consider = (obj, x, z, kind) => {
    const dx = x - mx, dz = z - mz;
    const d = Math.hypot(dx, dz);
    if (d > bestD || d < 1) return;
    const ang = Math.abs(wrapA(Math.atan2(dx, dz) - player.pos.yaw));
    if (ang < 0.09) { best = obj; bestD = d; bestKind = kind; }
  };
  consider(mission.target, mission.target.pos.x, mission.target.pos.z, 'target');
  for (const p of mission.police) consider(p, p.pos.x, p.pos.z, 'police');
  for (const d of traffic) consider(d, d.pos.x, d.pos.z, 'traffic');
  for (const p of peds.list) {
    if (p.state === 'down') continue;
    const pp = peds.posOf(p);
    consider(p, pp.x, pp.z, 'ped');
  }
  const hx = mx + fx * bestD, hz = mz + fz * bestD;
  showTracer(mx, mz, hx, hz, 0.8);
  if (!best) return;
  if (bestKind === 'target') {
    mission.damageTarget(0.5, player);
    run.score += 25;
  } else if (bestKind === 'police') {
    mission.bumpWanted(2, 'SHOTS FIRED AT POLICE');
  } else if (bestKind === 'traffic') {
    best.gunHp = (best.gunHp ?? 3) - 1;
    if (best.gunHp <= 0 && !best.shotOut) { best.shotOut = true; best.speed = 0; }
    mission.witnessed(1, player, true);
  } else if (bestKind === 'ped') {
    best.state = 'down'; best.downT = 0;
    best.root.rotation.x = Math.PI / 2; best.root.position.y = 0.2;
    run.score = Math.max(0, run.score - 150);
    mission.onPedHit(player, true);
  }
}
function wrapA(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---- game over + the arcade table --------------------------------------
function loadScores() {
  try { return JSON.parse(localStorage.getItem('neoncity_scores') || '[]'); }
  catch (e) { return []; }
}
function saveScores(list) {
  try { localStorage.setItem('neoncity_scores', JSON.stringify(list)); }
  catch (e) { /* private window: the table just does not persist */ }
}
let initials = '';
function gameOver(reason) {
  if (run.over) return;
  run.over = true;
  run.reason = reason;
  initials = '';
  const overEl = document.getElementById('over');
  overEl.style.display = 'flex';
  renderOver();
}
function renderOver() {
  const s = Math.round(run.score);
  const table = loadScores();
  const rows = table.map((r, i) =>
    `${String(i + 1).padStart(2, ' ')}. ${r.n}  ${String(r.s).padStart(6, ' ')}`).join('\n');
  document.getElementById('ovtext').textContent =
    `${run.reason}\n\nSCORE ${s} · LEVEL ${mission.level}\n` +
    `SURVIVED ${Math.round(run.time)}s\n\n` +
    (run.saved ? `SAVED · ${initials.padEnd(3, '_')}\n\n${rows}\n\n`
               : `TYPE 3 INITIALS THEN ENTER\n> ${initials.padEnd(3, '_')}\n\n${rows}\n\n`) +
    (run.saved ? `SPACE RESTARTS` : `ENTER SAVES · SPACE RESTARTS`);
}
addEventListener('keydown', (e) => {
  if (!run.over) return;
  if (/^Key[A-Z]$/.test(e.code) && initials.length < 3) {
    initials += e.code[3]; renderOver();
  } else if (e.code === 'Backspace') {
    initials = initials.slice(0, -1); renderOver();
  } else if (e.code === 'Enter' && initials.length > 0 && !run.saved) {
    run.saved = true;                      // one entry per run, like the arcade
    const table = loadScores();
    table.push({ n: initials.padEnd(3, '_'), s: Math.round(run.score) });
    table.sort((a, b) => b.s - a.s);
    saveScores(table.slice(0, 10));
    renderOver();
  } else if (e.code === 'Space') {
    location.reload();
  }
});

// ---- collisions: longitudinal, in the grammar's terms ------------------
// Same-lane car following stops AI overlap; hard contact swaps momentum
// down the lane and tells the mission when the player is the hammer.
let shake = 0;
const hitCooldown = new Map();
function updateCollisions(dt, clock) {
  const everyone = [player, ...traffic, mission.target, ...mission.police];
  for (let i = 0; i < everyone.length; i++) {
    for (let j = i + 1; j < everyone.length; j++) {
      const a = everyone[i], b = everyone[j];
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 14 * 14) continue;
      // Car-following: an AI close behind in the same lane slows to match.
      if (a.mode === 'edge' && b.mode === 'edge' && a.e === b.e &&
          a.dir === b.dir && a.lane === b.lane) {
        const gap = (b.s - a.s) * a.dir;
        const [lead, tail] = gap > 0 ? [b, a] : [a, b];
        if (Math.abs(gap) < 13 && tail !== player) {
          tail.speed = Math.min(tail.speed, Math.max(0, lead.speed * 0.95));
        }
      }
      // Hard contact: continuous separation every frame (nobody phases
      // through, nobody drives over) plus a proper bounce on the impulse.
      if (d2 < 3.3 * 3.3) {
        const d = Math.sqrt(d2) || 0.1;
        const overlap = 3.3 - d;
        // Who is in front of whom, along each car's own heading.
        const aft = (v, ox, oz) =>
          (Math.sin(v.pos.yaw) * ox + Math.cos(v.pos.yaw) * oz) > 0;
        const bAheadOfA = aft(a, b.pos.x - a.pos.x, b.pos.z - a.pos.z);
        const back = bAheadOfA ? a : b, front = bAheadOfA ? b : a;
        if (back.mode === 'edge') back.s = Math.max(0, back.s - overlap * 0.7);
        if (front.mode === 'edge') front.s = Math.min(front.e.len, front.s + overlap * 0.4);
        // Impulse, gated so one crash is one crash.
        const key = i * 100 + j;
        if ((hitCooldown.get(key) || 0) <= clock) {
          hitCooldown.set(key, clock + 0.4);
          const rel = Math.abs(back.speed - front.speed) + 2;
          front.speed = Math.min(front.speed + rel * 0.65, front.speed + 16);
          // The bounce: the rammer is thrown back off the contact, hard.
          back.speed = Math.max(0, front.speed * 0.2);
          if (back.mode === 'edge') back.s = Math.max(0, back.s - rel * 0.14);
          shake = Math.min(1, rel / 11);
          sound.crash(Math.min(1, rel / 16));
          if (a === player || b === player) {
            mission.onPlayerImpact(a === player ? b : a, rel, player, true);
          }
        } else {
          // Still touching inside the gate: keep speeds honest.
          back.speed = Math.min(back.speed, front.speed + 1);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- post ----
new GlowLayer('glow', scene, { intensity: 0.55 });
const pipe = new DefaultRenderingPipeline('pp', true, scene, [cam]);
pipe.bloomEnabled = true; pipe.bloomThreshold = 0.8; pipe.bloomWeight = 0.4;
pipe.chromaticAberrationEnabled = true; pipe.chromaticAberration.aberrationAmount = 14;
pipe.grainEnabled = true; pipe.grain.intensity = 8; pipe.grain.animated = true;
pipe.imageProcessing.vignetteEnabled = true;
pipe.imageProcessing.vignetteWeight = 1.7;
pipe.imageProcessing.contrast = 1.3;
pipe.imageProcessing.exposure = 1.05;

// ------------------------------------------------------------- controls ----
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  // Indicators: Q left, E right, pressing the same side again cancels.
  if (e.code === 'KeyQ' && !e.repeat) { player.intent = player.intent === 'left' ? 'straight' : 'left'; holdT.q = clock; }
  if (e.code === 'KeyE' && !e.repeat) { player.intent = player.intent === 'right' ? 'straight' : 'right'; holdT.e = clock; }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// -------------------------------------------------------------- the loop ----
let clock = 0;
// The tank and the turbo: Turbo Esprit's two pressures. Fuel burns with
// distance and speed; the turbo drains fast, recharges slow, and shoves.
const tank = { fuel: 100, low: false };
const turbo = { charge: 1, active: false };
const holdT = { q: 0, e: 0 };

const tick = (dt) => {
  clock += dt;
  if (run.over) return;
  const live = run.started;

  const throttle = live ? ((keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0) : 0;
  const steer = live ? (((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + ((keys.KeyD || keys.ArrowRight) ? -1 : 0)) : 0;

  // Hold an indicator ~2 s to swing a full U-turn.
  if (keys.KeyQ && holdT.q !== Infinity && clock - holdT.q > 1.9 && player.mode === 'edge') {
    player.beginUTurn(); holdT.q = Infinity;
  }
  if (!keys.KeyQ) holdT.q = 0;
  if (keys.KeyE && holdT.e !== Infinity && clock - holdT.e > 1.9 && player.mode === 'edge') {
    player.beginUTurn(); holdT.e = Infinity;
  }
  if (!keys.KeyE) holdT.e = 0;

  // Turbo: Shift shoves while the gauge lasts.
  turbo.active = (keys.ShiftLeft || keys.ShiftRight) && throttle > 0 &&
                 turbo.charge > 0.03 && tank.fuel > 0;
  turbo.charge = Math.max(0, Math.min(1,
    turbo.charge + (turbo.active ? -0.28 : 0.07) * dt));
  if (turbo.active && player.mode === 'edge') player.speed += 16 * dt;

  // Fuel: burns with speed, faster on turbo; empty means a crawl.
  tank.fuel = Math.max(0, tank.fuel -
    (0.06 + player.speed * 0.014 + (turbo.active ? 0.5 : 0)) * dt);
  if (tank.fuel < 25 && !tank.low) { tank.low = true;
    hud.say('FUEL LOW — GREEN SQUARES SELL PETROL'); }
  if (tank.fuel > 40) tank.low = false;
  let cap = CLASSES[player.e.cls].limit * (turbo.active ? 3.2 : 2.2);
  if (tank.fuel <= 0) cap = 5;
  player.update(dt, { throttle, steer, maxSpeed: cap });

  // Refuelling: stopped beside a pump.
  for (const st of cityBits.stations) {
    if (Math.hypot(player.pos.x - st.x, player.pos.z - st.z) < 8 &&
        player.speed < 1.5 && tank.fuel < 99.5) {
      tank.fuel = Math.min(100, tank.fuel + 20 * dt);
      if (Math.floor(clock * 2) % 2 === 0) hud.say('FUELLING…');
      mission.tryDisguise(player, clock);
      if (tank.fuel > 99 && tank.chimed !== true) { tank.chimed = true; sound.chime(); }
      if (tank.fuel < 60) tank.chimed = false;
    }
  }

  playerCar.root.position.set(player.pos.x, 0, player.pos.z);
  playerCar.root.rotation.y = player.pos.yaw;
  const blink = Math.sin(clock * 9) > 0;
  playerCar.indL.setEnabled(player.indicator === -1 && blink);
  playerCar.indR.setEnabled(player.indicator === 1 && blink);

  for (const d of traffic) {
    d.update(dt, aiInput(d, dt, clock));
    if (d.blocked) d.beginUTurn();
    d.car.root.position.set(d.pos.x, 0, d.pos.z);
    d.car.root.rotation.y = d.pos.yaw;
    const b2 = Math.sin(clock * 9 + d.ai.cruise * 20) > 0;
    d.car.indL.setEnabled(d.indicator === -1 && b2);
    d.car.indR.setEnabled(d.indicator === 1 && b2);
  }

  if (run.over) { hud.update(dt, player, [...traffic, ...mission.mapEntries()]); return; }
  if (live) {
    run.time += dt;
    run.score += dt * 2 * (1 + mission.wanted * 0.5);
  }

  if (keys.Space && live) firePlayerGun(dt); else gunT = Math.min(gunT, 0.05);
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.setEnabled(false); }
  }

  signals.update(clock);
  peds.update(dt);
  if ((Math.floor(clock) % 5) === 0) peds.recycle();

  // Player over a pedestrian at speed: the city notices.
  if (player.speed > 4) {
    const victim = peds.hitCheck(player.pos.x, player.pos.z);
    if (victim) {
      run.score = Math.max(0, run.score - 150);
      shake = Math.max(shake, 0.5);
      mission.onPedHit(player, true);
    }
  }

  // Red light running: witnessed if the wrong eyes are close.
  if (player.mode === 'edge') {
    if (playerPrev.e === player.e && playerPrev.dir === player.dir &&
        signals.ranRed(player.e, player.dir, playerPrev.s, player.s, clock)) {
      run.score += 15;
      mission.witnessed(1, player, true);
    }
    playerPrev.e = player.e; playerPrev.dir = player.dir; playerPrev.s = player.s;
  }
  // Speeding right past a cruiser is a star on its own.
  if (player.speed > CLASSES[player.e.cls].limit * 1.5 &&
      mission.nearestPoliceDist(player) < 22 && clock > speedTattleT) {
    speedTattleT = clock + 12;
    mission.bumpWanted(1, 'CLOCKED SPEEDING');
  }

  // Roadworks: AI threads round the cones; the player just hits them.
  for (const rw of cityBits.roadworks) {
    for (const d of [...traffic, mission.target, ...mission.police]) {
      if (d.mode === 'edge' && d.e === rw.e && d.dir === rw.dir &&
          d.lane === rw.lane && d.s > rw.s0 - 30 && d.s < rw.s1 && d.lane > 0) {
        d.lane -= 1; d.lat += CLASSES[d.e.cls].laneW;
      }
    }
    if (player.mode === 'edge' && player.e === rw.e && player.dir === rw.dir &&
        player.lane === rw.lane && player.s > rw.s0 && player.s < rw.s1) {
      player.speed *= Math.max(0, 1 - 2.4 * dt);
      shake = Math.max(shake, 0.25);
    }
  }

  // AI shots land as health damage, dodgeable by speed.
  mission.update(dt, player, clock);
  for (const sh of mission.shots) {
    showTracer(sh.from.x, sh.from.z, sh.to.x, sh.to.z, 0.9);
    const dodge = Math.min(0.75, player.speed / 45);
    if (Math.random() > dodge) {
      run.health -= sh.hurt;
      shake = Math.max(shake, 0.3);
    }
  }
  if (run.health <= 0) gameOver('WRECKED BY GUNFIRE');
  if (mission.busted) gameOver('BUSTED');
  updateCollisions(dt, clock);
  if (shake > 0.005) shake *= Math.exp(-dt * 5); else shake = 0;

  // Chase camera: behind and above, leaning with speed, looking through.
  const back = 8.4 + player.speed * 0.16;
  const cx = player.pos.x - Math.sin(player.pos.yaw) * back;
  const cz = player.pos.z - Math.cos(player.pos.yaw) * back;
  const k = Math.min(1, dt * 5.5);
  cam.position.x += (cx - cam.position.x) * k;
  cam.position.z += (cz - cam.position.z) * k;
  cam.position.y += (4.4 + player.speed * 0.05 - cam.position.y) * k;
  if (shake > 0) {
    cam.position.x += (Math.random() - 0.5) * shake * 0.7;
    cam.position.y += (Math.random() - 0.5) * shake * 0.5;
  }
  cam.setTarget(new Vector3(
    player.pos.x + Math.sin(player.pos.yaw) * 7,
    1.2,
    player.pos.z + Math.cos(player.pos.yaw) * 7));

  // ---- the morph: city night <-> coast daylight ------------------------
  const wantVibe = (player.e && player.e.cls === 'highway') ? 1
    : (player.mode === 'turn' ? vibe : 0);
  vibe += (wantVibe - vibe) * Math.min(1, dt * 0.55);
  hemi.intensity = 0.22 + vibe * 0.5;
  hemi.diffuse.set(0.45 + vibe * 0.3, 0.35 + vibe * 0.37, 0.75 + vibe * 0.1);
  hemi.groundColor.set(0.05 + vibe * 0.3, 0.02 + vibe * 0.26, 0.1 + vibe * 0.1);
  scene.clearColor.set(0.012 + vibe * 0.09, 0.006 + vibe * 0.31,
                       0.035 + vibe * 0.52, 1);
  // Only pay for the sky you can actually see: outside the short morph,
  // one full set of sky walls is switched off entirely.
  const dayOn = vibe > 0.02, nightOn = vibe < 0.98;
  for (const p of daySkies) {
    p.setEnabled(dayOn);
    p.visibility = vibe >= 0.98 ? 1 : vibe;
  }
  for (const p of nightSkies) p.setEnabled(nightOn);
  sunM.emissiveColor.set(1 + vibe * 0.25, 1 + vibe * 0.05, 1 - vibe * 0.25);
  sun.scaling.setAll(1 + vibe * 0.4);
  pipe.imageProcessing.exposure = 1.05 + vibe * 0.22;
  pipe.imageProcessing.contrast = 1.3 - vibe * 0.12;

  coast.update(dt, player, clock, mission.wanted);
  sound.update(dt, Math.min(1, player.speed / 55), turbo.active, mission.wanted > 0);

  const strobing = mission.wanted > 0;
  for (let bi = 0; bi < beaconMats.length; bi++) {
    const on = strobing ? Math.sin(clock * 18 + bi * 2) > 0 : Math.sin(clock * 4 + bi) > 0.85;
    beaconMats[bi].emissiveColor.set(on ? 0.4 : 1.8, on ? 0.6 : 0.15, on ? 2.2 : 0.15);
  }
  starsEl.textContent = mission.wanted > 0 ? '★'.repeat(mission.wanted) : '';
  scoreEl.textContent = String(Math.round(run.score)).padStart(6, '0');
  healthBar.style.width = Math.max(0, run.health) + '%';

  hud.update(dt, player, [...traffic, ...mission.mapEntries(), ...coast.mapEntries()]);
  fuelBar.style.width = tank.fuel.toFixed(0) + '%';
  fuelBar.style.background = tank.fuel < 25 ? '#ff5a4d' : '#ffd34d';
  turboBar.style.width = (turbo.charge * 100).toFixed(0) + '%';
  const bp = mission.bearingPoint();
  if (bp) {
    const ang = Math.atan2(bp.x - player.pos.x, bp.z - player.pos.z) - player.pos.yaw;
    tgtEl.style.transform = 'rotate(' + ang.toFixed(2) + 'rad)';
    const dTgt = Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z);
    tgtdEl.textContent = (mission.state === 'locate' ? 'LAST SEEN ' : '') +
      Math.round(dTgt) + 'm';
    tgtBox.style.opacity = mission.state === 'done' ? 0 : 1;
    tgtBox.style.color = mission.state === 'locate' ? '#ff9a8a' : '#ff5a4d';
  } else {
    tgtBox.style.opacity = 0.35;
    tgtEl.style.transform = 'none';
    tgtdEl.textContent = 'NO FIX — SEARCH THE DISTRICT';
  }
};
scene.onBeforeRenderObservable.add(() =>
  tick(Math.min(0.05, engine.getDeltaTime() / 1000)));

// Handles for tests and the console.
window.game = { player, traffic, net, hud, tick, mission, coast };

// ---- intro screen -------------------------------------------------------
{
  const table = loadScores();
  const rows = table.length
    ? 'HALL OF FAME\n' + table.slice(0, 5).map((r, i) =>
        `${i + 1}. ${r.n}  ${r.s}`).join('\n')
    : 'NO SCORES YET — BE FIRST';
  document.getElementById('introtext').textContent =
    'FIND THE BLACK COUPE · RAM OR SHOOT IT · DODGE THE LAW\n' +
    'W/S DRIVE · A/D LANES · Q/E INDICATE (HOLD FOR U-TURN)\n' +
    'SPACE FIRE · SHIFT TURBO · GREEN SQUARES SELL PETROL\n' +
    'THE RING ROAD IS THE COAST — GO SEE IT\n\n' + rows;
}
addEventListener('keydown', (e) => {
  if (!run.started && e.code === 'Enter') {
    run.started = true;
    document.getElementById('intro').style.display = 'none';
    sound.start();
    mission.announce();
  }
  if (e.code === 'KeyM' && sound.started) {
    hud.say(sound.toggle() ? 'SOUND ON' : 'SOUND OFF');
  }
  if (e.code === 'KeyX' && sound.started) sound.next();
});

// Auto quality: when the frame rate sags, render smaller and stretch -
// the neon look survives a soft frame far better than a 9 fps one.
let scaleStep = 0, scaleGoodT = 0, scaleBadT = 0;
setInterval(() => {
  const f = engine.getFps();
  if (f < 26 && scaleStep < 2) {
    scaleBadT += 0.5;
    if (scaleBadT > 1.5) {
      scaleStep++; scaleBadT = 0; scaleGoodT = 0;
      engine.setHardwareScalingLevel(1 + scaleStep * 0.45);
      hud.say('PERFORMANCE MODE — RESOLUTION EASED');
    }
  } else if (f > 52 && scaleStep > 0) {
    scaleGoodT += 0.5;
    if (scaleGoodT > 6) {
      scaleStep--; scaleGoodT = 0;
      engine.setHardwareScalingLevel(1 + scaleStep * 0.45);
      if (scaleStep === 0) hud.say('FULL RESOLUTION RESTORED');
    }
  } else { scaleBadT = 0; }
}, 500);

const fpsEl = document.getElementById('fps');
const fuelBar = document.getElementById('fuel');
const turboBar = document.getElementById('turbo');
const tgtEl = document.getElementById('tgt');
const tgtdEl = document.getElementById('tgtd');
const tgtBox = document.getElementById('tgtbox');
const starsEl = document.getElementById('stars');
const scoreEl = document.getElementById('score');
const healthBar = document.getElementById('health');
setInterval(() => {
  const f = engine.getFps();
  fpsEl.textContent = f.toFixed(0) + ' FPS';
  fpsEl.style.color = f > 50 ? '#7dfcf3' : f > 30 ? '#ffd34d' : '#ff5a4d';
}, 400);

engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
scene.executeWhenReady(() => {
  report('');
  setTimeout(() => { window.ready = true; }, 400);
});
