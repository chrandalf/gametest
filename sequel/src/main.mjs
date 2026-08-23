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
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { GRID, CELL, buildNetwork, CLASSES, nodeAhead, headingSlot, turnOptions }
  from './network.mjs';
import { buildCity } from './citygen.mjs';
import { Driver } from './driver.mjs';
import { Hud } from './hud.mjs';
import { Mission, OFFENCES } from './mission.mjs';
import { Signals } from './lights.mjs';
import { Peds } from './peds.mjs';
import { Coast } from './outrun.mjs';
import { Pickups } from './pickups.mjs';
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
// Distance haze. A neon strip is 20 cm wide: two hundred metres out it is
// thinner than a pixel, so the rasteriser catches it on one frame and misses
// it on the next and the whole far half of the city strobes. Fading those
// lines into the haze before they get that small is the fix - and a neon
// city with depth in it looks better anyway.
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = 0.0017;
scene.fogColor = new Color3(0.05, 0.03, 0.11);
report('engine up — building the city…');

// Photosensitivity: one switch over everything in the game that pulses. On
// by default if the browser says this viewer prefers reduced motion, and F
// toggles it at any time.
let fogScale = 1;
const safe = { reduceFlash: false };
try { safe.reduceFlash = matchMedia('(prefers-reduced-motion: reduce)').matches; }
catch (e) { /* not every browser has it */ }

const cam = new FreeCamera('cam', new Vector3(0, 5, -12), scene);
cam.fov = 0.95;
cam.minZ = 1.2;
cam.maxZ = 2600;

const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.22;
hemi.diffuse = new Color3(0.45, 0.35, 0.75);
hemi.groundColor = new Color3(0.05, 0.02, 0.1);

// ---- the four cities ----------------------------------------------------
// Turbo Esprit shipped four towns and let you choose before you set off;
// so does this. The seed IS the town: block sizes, where the avenues run,
// which streets exist, where the garages are, how the districts fall. The
// choice rides in the URL hash so a restart stays in the same town and
// switching is a clean reload into a different one.
// Each town carries its own night-sky palette and its own default coast
// mood, so crossing the bridge FEELS like arriving somewhere else.
const CITIES = [
  { name: 'NEON CITY',    seed: 19860508, coast: 'off',
    sky: ['#07021a', '#2a0c4e', '#7a1e63', '#c93a6e'] },
  { name: 'SODIUM BAY',   seed: 19870127, coast: 'day',
    sky: ['#120618', '#3a1c3e', '#8a4a2e', '#e0923e'] },
  { name: 'VELVET SHORE', seed: 19881104, coast: 'sunset',
    sky: ['#0a0220', '#3a0a4e', '#94185e', '#e0447e'] },
  { name: 'MERIDIAN',     seed: 19900615, coast: 'off',
    sky: ['#02141a', '#0c3a3e', '#1e6a5e', '#3ac98e'] },
];
let cityIdx = 0;
{
  const m = /city(\d)/.exec(location.hash || '');
  if (m) cityIdx = Math.min(CITIES.length - 1, +m[1] || 0);
}
const CITY = CITIES[cityIdx];

// The network first: the backdrop wraps whatever size the city came out.
const net = buildNetwork(CITY.seed);

// ------------------------------------------------------------- backdrop ----
const mid = Math.max(net.extent.x, net.extent.z) / 2;
function skyTexture() {
  const dt = new DynamicTexture('sky', { width: 64, height: 512 }, scene, true);
  const x = dt.getContext();
  const g = x.createLinearGradient(0, 0, 0, 512);
  const [c0, c1, c2, c3] = CITY.sky;
  g.addColorStop(0, c0); g.addColorStop(0.55, c1);
  g.addColorStop(0.85, c2); g.addColorStop(1, c3);
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
  m.fogEnabled = false;
  p.material = m;
  nightSkies.push(p);
}
const sun = MeshBuilder.CreatePlane('sun', { size: 420 }, scene);
sun.position.set(mid, 150, mid + 1240);
const sunM = new StandardMaterial('sunm', scene);
sunM.emissiveTexture = sunTexture(); sunM.opacityTexture = sunM.emissiveTexture;
sunM.disableLighting = true;
sunM.fogEnabled = false;
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
    m.fogEnabled = false;
    r.material = m;
    nightSkies.push(r);
  }
}

// ------------------------------------------------------------- the city ----
const mirror = new MirrorTexture('mir', 512, scene, true);
mirror.mirrorPlane = new Plane(0, -1, 0, 0);
mirror.level = 0.8;
// Every other frame is plenty for a reflection that lives in car paint.
mirror.refreshRate = 2;
mirror.renderList.push(sun);

const cityBits = buildCity(scene, net, mirror, CITY.seed);
report('city built — starting traffic…');

// ---- districts: merge per tile, not per city --------------------------
// Merging every kerb and tower into one mesh per material killed the draw
// calls, but it also handed the renderer a set of meshes the size of the
// whole city - and a mesh that big is never outside the view, so frustum
// culling had nothing left to reject and every district behind you was
// drawn in full. Merging per tile instead keeps the low draw count AND
// gives the culler something to throw away, which is most of the map.
const TILE = 260;
const tiles = new Map();
const globalStatics = [];
function tileAt(x, z) {
  const kx = Math.floor(x / TILE), kz = Math.floor(z / TILE);
  const k = kx + ':' + kz;
  let t = tiles.get(k);
  if (!t) {
    t = { cx: (kx + 0.5) * TILE, cz: (kz + 0.5) * TILE, meshes: [], on: true };
    tiles.set(k, t);
  }
  return t;
}
{
  const MERGE = new Set(['rd', 'wk', 'kb', 'sl', 'el', 'ml', 'b', 'sg',
                         'pad', 'pump', 'sand', 'sea', 'gp', 'gpan',
                         'cone', 'barr', 'bump', 'pole', 'dk', 'prp', 'dd', 'pier',
                         'twl', 'bod', 'parapole', 'shade', 'ib', 'iland',
                         'trunk', 'leaf', 'grass', 'crate', 'stack']);
  // Where each merged mesh sits has to be worked out from the meshes going
  // into it. A merged mesh's world bounding box is not computed until it is
  // first rendered, so reading it here hands back zeroes and files half the
  // city under the wrong district.
  const ALWAYS = new Set(['ib', 'iland']);
  const buckets = new Map();
  for (const msh of scene.meshes.slice()) {
    // Instance source meshes are disabled and must stay that way.
    if (!MERGE.has(msh.name) || !msh.material || !msh.isEnabled(false)) continue;
    const key = msh.material.uniqueId + '|' + Math.floor(msh.position.x / TILE) +
                '|' + Math.floor(msh.position.z / TILE);
    let b = buckets.get(key);
    if (!b) { b = { arr: [], x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }; buckets.set(key, b); }
    b.arr.push(msh);
    b.x0 = Math.min(b.x0, msh.position.x); b.x1 = Math.max(b.x1, msh.position.x);
    b.z0 = Math.min(b.z0, msh.position.z); b.z1 = Math.max(b.z1, msh.position.z);
  }
  for (const b of buckets.values()) {
    const merged = b.arr.length > 1
      ? Mesh.MergeMeshes(b.arr, true, true, undefined, false, false)
      : b.arr[0];
    if (!merged) continue;
    merged.name = 'static';
    // The sand and the sea are single strips hundreds of metres long. They
    // belong to no one district, so they are never distance-culled.
    const span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
    // The island is always drawn, wherever you are: its lights across the
    // water are how you know it is there at all.
    if (span > TILE * 2.5 || ALWAYS.has(b.arr[0].name)) globalStatics.push(merged);
    else tileAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2).meshes.push(merged);
  }
  // Everything that stayed unmerged - lamp and lane-marking instances, the
  // traffic signals, the palms - joins the same tiles, so a district that
  // is switched off is switched off entirely.
  const DYNAMIC = new Set(['p', 'w', 'ped', 'pedh', 'tr', 'sky', 'r',
                           'dsky', 'sun', 'g', 'static', 'car',
                           'cass', 'case', 'sigl']);
  for (const msh of scene.meshes) {
    if (DYNAMIC.has(msh.name) || !msh.material || !msh.isEnabled(false)) continue;
    // Same rule as the merged geometry: anything longer than a couple of
    // districts (the surf, for one) belongs to none of them.
    const ext = msh.getBoundingInfo().boundingBox.extendSize;
    if (Math.max(ext.x, ext.z) * 2 > TILE * 2.5) { globalStatics.push(msh); continue; }
    tileAt(msh.position.x, msh.position.z).meshes.push(msh);
  }
  // Rebuild the mirror list: merged statics, live car parts, the sun.
  mirror.renderList = scene.meshes.filter(msh =>
    msh.name === 'static' || msh.name === 'p' || msh.name === 'w' || msh.name === 'sun');
}

// How far the city is drawn. Tied to the quality rung, because "render less"
// is the honest version of "run faster", and the haze hides the edge.
const DRAW_RANGE = [820, 760, 640, 500];
let drawRange = DRAW_RANGE[0];
function updateDistricts(px, pz) {
  const r = drawRange + TILE * 0.75;
  const r2 = r * r;
  for (const t of tiles.values()) {
    const dx = t.cx - px, dz = t.cz - pz;
    const want = dx * dx + dz * dz < r2;
    if (want === t.on) continue;
    t.on = want;
    for (const msh of t.meshes) msh.setEnabled(want);
  }
}

// ---- performance pass -------------------------------------------------
// The city never moves: freeze every static world matrix so Babylon stops
// recomputing them, and keep the mirror honest - it was re-rendering the
// ground and the near-coplanar road slabs into itself for nothing.
const CAR_PARTS = new Set(['p', 'w']);
for (const msh of scene.meshes) {
  if (CAR_PARTS.has(msh.name) || msh.name === 'pal' || msh.name === 'sun' ||
      msh.name === 'cass' || msh.name === 'case') continue;
  msh.freezeWorldMatrix();
  msh.doNotSyncBoundingInfo = true;
}
// The mirror is the wet ground itself, so anything lying flat on it has
// nothing to add to its own reflection.
const FLAT_MATS = new Set(['gm', 'road', 'walk', 'stop']);
mirror.renderList = mirror.renderList.filter(msh =>
  !(msh.material && FLAT_MATS.has(msh.material.name)));

// ------------------------------------------------------------- vehicles ----
// A body built from cross sections rather than from boxes. Each station is
// a chamfered rectangle at a point along the car; consecutive stations are
// skinned with quads and the ends capped. That is what buys the wedge nose,
// the raked screen, the haunches over the back wheels and the fastback -
// the things that separate a sports car from a phone lying on the road.
function loftBody(stations, mat, scene) {
  const N = 8;
  const pos = [], idx = [], uvs = [];
  for (const st of stations) {
    const cx = st.hw * 0.26, cy = (st.hi - st.lo) * 0.3;
    const ring = [[-st.hw + cx, st.lo], [st.hw - cx, st.lo],
                  [st.hw, st.lo + cy], [st.hw, st.hi - cy],
                  [st.hw - cx, st.hi], [-st.hw + cx, st.hi],
                  [-st.hw, st.hi - cy], [-st.hw, st.lo + cy]];
    for (const [x, y] of ring) { pos.push(x, y, st.z); uvs.push(0, 0); }
  }
  for (let si = 0; si < stations.length - 1; si++) {
    const a = si * N, b = a + N;
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      idx.push(a + k, a + k2, b + k2, a + k, b + k2, b + k);
    }
  }
  const last = (stations.length - 1) * N;
  for (let k = 1; k < N - 1; k++) {
    idx.push(0, k, k + 1);
    idx.push(last, last + k + 1, last + k);
  }
  const normals = [];
  VertexData.ComputeNormals(pos, idx, normals);
  // Winding is easy to get backwards and impossible to see until the car
  // renders inside out, so check it: the outermost vertex on the right of
  // the car must have a normal that points right.
  let far = 0;
  for (let i = 1; i < pos.length / 3; i++) if (pos[i * 3] > pos[far * 3]) far = i;
  if (normals[far * 3] < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
    VertexData.ComputeNormals(pos, idx, normals);
  }
  const m = new Mesh('p', scene);
  const vd = new VertexData();
  vd.positions = pos; vd.indices = idx; vd.normals = normals; vd.uvs = uvs;
  vd.applyToMesh(m);
  m.material = mat;
  return m;
}

// Lower body: low wedge nose, shoulder rising to the cowl, widest over the
// back wheels, tail cut off short.
const BODY_SECTIONS = [
  { z:  2.30, hw: 0.58, lo: 0.30, hi: 0.44 },
  { z:  1.95, hw: 0.84, lo: 0.24, hi: 0.53 },
  { z:  1.45, hw: 0.97, lo: 0.22, hi: 0.62 },
  { z:  0.80, hw: 0.98, lo: 0.22, hi: 0.71 },
  { z:  0.20, hw: 0.99, lo: 0.22, hi: 0.78 },
  { z: -0.60, hw: 1.00, lo: 0.22, hi: 0.80 },
  { z: -1.35, hw: 1.02, lo: 0.24, hi: 0.80 },
  { z: -1.95, hw: 0.96, lo: 0.30, hi: 0.77 },
  { z: -2.30, hw: 0.82, lo: 0.38, hi: 0.71 },
];
// Greenhouse: a steeply raked screen, a short flat roof, a fastback.
const CABIN_SECTIONS = [
  { z:  0.34, hw: 0.74, lo: 0.76, hi: 0.83 },
  { z: -0.28, hw: 0.79, lo: 0.78, hi: 1.15 },
  { z: -1.00, hw: 0.78, lo: 0.78, hi: 1.15 },
  { z: -1.52, hw: 0.72, lo: 0.78, hi: 0.94 },
  { z: -1.92, hw: 0.62, lo: 0.78, hi: 0.83 },
];

function buildCar(paintCol, taillit, trimCol) {
  const root = new TransformNode('car', scene);
  // No planar mirror on the paint. The mirror is the wet ground plane, so
  // reflecting it onto bodywork smeared lit windows across the car and made
  // it read as a flat panel of noise rather than a shape. Paint now reads as
  // paint: its own colour, lifted enough to be visible at night, shaded by
  // the ambient so the curves of the loft actually show.
  const paint = new PBRMaterial('paint', scene);
  paint.albedoColor = paintCol;
  paint.metallic = 0.35; paint.roughness = 0.3;
  paint.emissiveColor = paintCol.scale(0.16);
  const blk = new PBRMaterial('blk', scene);
  blk.albedoColor = new Color3(0.015, 0.02, 0.03);
  blk.metallic = 0.5; blk.roughness = 0.18;
  blk.emissiveColor = new Color3(0.02, 0.05, 0.09);
  const lit = new StandardMaterial('lit', scene);
  lit.emissiveColor = taillit ? new Color3(1.7, 0.07, 0.05) : new Color3(0.05, 0.05, 0.05);
  lit.disableLighting = true;
  const head = new StandardMaterial('head', scene);
  head.emissiveColor = new Color3(1.35, 1.25, 0.95);
  head.disableLighting = true;
  const parts = [];
  const part = (w, h, d, x, y, z, mat, rx) => {
    const b = MeshBuilder.CreateBox('p', { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z); b.parent = root; b.material = mat;
    if (rx) b.rotation.x = rx;
    parts.push(b);
    return b;
  };
  for (const [sections, mat] of [[BODY_SECTIONS, paint], [CABIN_SECTIONS, blk]]) {
    const m = loftBody(sections, mat, scene);
    m.parent = root;
    parts.push(m);
  }
  part(1.66, 0.06, 0.34, 0, 0.25, 2.16, blk);        // front splitter
  part(0.46, 0.09, 0.05, -0.52, 0.47, 2.24, head);   // headlights
  part(0.46, 0.09, 0.05, 0.52, 0.47, 2.24, head);
  part(1.62, 0.16, 0.06, 0, 0.60, -2.30, lit);       // tail bar
  part(0.10, 0.22, 0.34, -0.70, 0.90, -1.95, blk);   // spoiler struts
  part(0.10, 0.22, 0.34, 0.70, 0.90, -1.95, blk);
  part(1.74, 0.07, 0.40, 0, 1.02, -1.98, paint);     // spoiler blade
  // Neon trim: the silhouette drawn in light. Underglow along the rockers
  // and a shoulder line down the flanks is what makes a car readable
  // against the dark instead of a shadow with headlights.
  const trim = new StandardMaterial('trim', scene);
  trim.emissiveColor = trimCol || new Color3(0.55, 0.55, 0.65);
  trim.disableLighting = true;
  part(0.05, 0.05, 3.6, -0.98, 0.24, -0.2, trim);    // rocker underglow
  part(0.05, 0.05, 3.6, 0.98, 0.24, -0.2, trim);
  part(0.05, 0.05, 2.5, -1.00, 0.79, -0.95, trim);   // shoulder line
  part(0.05, 0.05, 2.5, 1.00, 0.79, -0.95, trim);
  part(1.20, 0.05, 0.05, 0, 0.44, 2.26, trim);       // nose bar
  const ind = new StandardMaterial('ind', scene);
  ind.emissiveColor = new Color3(1.5, 0.75, 0.1);
  ind.disableLighting = true;
  const indL = part(0.10, 0.10, 0.44, -1.01, 0.60, 1.5, ind);
  const indR = part(0.10, 0.10, 0.44, 1.01, 0.60, 1.5, ind);
  const wm = new PBRMaterial('wm', scene);
  wm.albedoColor = new Color3(0.03, 0.03, 0.03); wm.roughness = 0.9;
  // Fat rears, slimmer fronts - a rear-drive stance.
  for (const [wx, wz, dia, wid] of [[-0.93, 1.45, 0.74, 0.26], [0.93, 1.45, 0.74, 0.26],
                                    [-0.95, -1.35, 0.86, 0.34], [0.95, -1.35, 0.86, 0.34]]) {
    const w = MeshBuilder.CreateCylinder('w', { diameter: dia, height: wid, tessellation: 16 }, scene);
    w.rotation.z = Math.PI / 2; w.position.set(wx, dia / 2, wz); w.parent = root; w.material = wm;
    parts.push(w);
  }
  // Twenty-odd boxes is twenty-odd draw calls, and there are two dozen cars
  // on the map. Nothing on a car moves relative to the car except the two
  // indicators, so everything else is welded together per material while the
  // root is still sitting at the origin - about seven draws a car instead.
  const loose = new Set([indL, indR]);
  const byMat = new Map();
  for (const b of parts) {
    if (loose.has(b)) continue;
    const k = b.material.uniqueId;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k).push(b);
  }
  const finalParts = [indL, indR];
  for (const arr of byMat.values()) {
    const m = arr.length > 1
      ? Mesh.MergeMeshes(arr, true, true, undefined, false, false) : arr[0];
    if (!m) continue;
    m.name = 'p';
    m.parent = root;
    finalParts.push(m);
  }
  for (const m of finalParts) mirror.renderList.push(m);
  return { root, indL, indR, paint };
}

// The player starts on an avenue that runs toward the sun (+z). It is the
// attract camera's boulevard - the menu plays over the car cruising it with
// the sunset dead ahead - and a fine place to begin a run.
const sunward = net.edges
  .filter(e => e.cls === 'avenue' && e.axis === 1 &&
               !e.a.isle && !e.a.sea && !e.b.sea)
  .sort((a, b) => a.a.j - b.a.j);
const startEdge = sunward[0] || net.edges.find(e => e.cls === 'avenue') || net.edges[0];
const player = new Driver(net, startEdge, 1, 0, Math.min(20, startEdge.len * 0.4));
// Only the player may cross the centre line to pass: AI keeps its lane.
// And only the player owns a reverse gear - hold S at a standstill.
player.overtake = true;
player.canReverse = true;
const playerCar = buildCar(new Color3(0.8, 0.83, 0.9), true, new Color3(0.25, 1.3, 1.6));
// A certain talking Trans Am's scanner, waiting on its codeword.
const kittBar = (() => {
  const m = new StandardMaterial('kittm', scene);
  m.emissiveColor = new Color3(2.2, 0.08, 0.06);
  m.disableLighting = true;
  const b = MeshBuilder.CreateBox('p', { width: 0.3, height: 0.08, depth: 0.07 }, scene);
  b.material = m;
  b.parent = playerCar.root;
  b.position.set(0, 0.5, 2.3);
  b.setEnabled(false);
  return b;
})();

// Ambient traffic: the same Driver, piloted by ten lines of AI. This is the
// exact code path the target car and the police will use.
const TRAFFIC_COLOURS = [
  new Color3(0.15, 0.3, 0.85), new Color3(0.75, 0.62, 0.1),
  new Color3(0.6, 0.12, 0.65), new Color3(0.1, 0.6, 0.5),
  new Color3(0.65, 0.66, 0.7), new Color3(0.8, 0.25, 0.1),
];
const traffic = [];
for (let k = 0; k < 14; k++) {
  // The first two cars live on the crossings - bridges nobody drives
  // read as closed.
  const e = (k < 2 && net.bridges && net.bridges[k * 2])
    ? net.bridges[k * 2]
    : net.edges[(k * 37) % net.edges.length];
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
// Difficulty: how tough the marks are, how hard the police drive, how much
// bullets hurt, what petrol costs. The choice persists between visits.
const DIFFS = [
  { name: 'EASY',   v: { hp: 0.7, police: 0.85, hurt: 0.6, petrol: 0.5 } },
  { name: 'NORMAL', v: { hp: 1,   police: 1,    hurt: 1,   petrol: 1 } },
  { name: 'HARD',   v: { hp: 1.3, police: 1.1,  hurt: 1.3, petrol: 1.5 } },
];
let diffIdx = 1;
try {
  const d = parseInt(localStorage.getItem('neoncity_diff'), 10);
  if (d >= 0 && d < DIFFS.length) diffIdx = d;
} catch (e) { /* stays NORMAL */ }

const hud = new Hud(net, cityBits.stations);
const mission = new Mission(scene, net, buildCar, hud, player);
mission.diff = DIFFS[diffIdx].v;
// The boot spawn ran on defaults; respawn so the first coupe is priced
// for the chosen difficulty too.
if (diffIdx !== 1) mission.spawnTarget();
// The briefing names the quarter, not a compass point.
mission.districtAt = cityBits.districtAt;
const signals = new Signals(scene, net);
{
  // The signals arrive after the district pass, so they get their own.
  // Poles all share one material and never change, so they merge; the
  // heads swap material every frame with the phase, so they only join a
  // district and get culled with it.
  const byTile = new Map();
  for (const msh of scene.meshes) {
    if (msh.name !== 'sigp' && msh.name !== 'sigh' && msh.name !== 'sigd') continue;
    const k = msh.material.uniqueId + '|' + Math.floor(msh.position.x / TILE) +
              '|' + Math.floor(msh.position.z / TILE);
    let b = byTile.get(k);
    if (!b) { b = { arr: [], x: 0, z: 0 }; byTile.set(k, b); }
    b.arr.push(msh); b.x += msh.position.x; b.z += msh.position.z;
  }
  for (const b of byTile.values()) {
    const merged = b.arr.length > 1
      ? Mesh.MergeMeshes(b.arr, true, true, undefined, false, false) : b.arr[0];
    if (!merged) continue;
    merged.name = 'static';
    merged.freezeWorldMatrix();
    merged.doNotSyncBoundingInfo = true;
    tileAt(b.x / b.arr.length, b.z / b.arr.length).meshes.push(merged);
    mirror.renderList.push(merged);
  }

}
const peds = new Peds(scene, net, 42);
const pickups = new Pickups(scene, net, hud);

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
// The other end of the same afternoon.
function sunsetSkyTexture() {
  const dt = new DynamicTexture('ssky', { width: 64, height: 512 }, scene, true);
  const x = dt.getContext();
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#2a1147'); g.addColorStop(0.45, '#8c2a5e');
  g.addColorStop(0.72, '#ff7a3c'); g.addColorStop(0.9, '#ffc95e');
  g.addColorStop(1, '#ffe9b0');
  x.fillStyle = g; x.fillRect(0, 0, 64, 512);
  dt.update();
  return dt;
}
// What the coast morph fades toward, per mode: additive targets over the
// night values already in the code below.
const MOODS = {
  day:    { hemi: 0.5,  dif: [0.30, 0.37, 0.10], gnd: [0.30, 0.26, 0.10],
            clear: [0.09, 0.31, 0.52], fog: [0.36, 0.47, 0.52],
            expo: 0.22, con: 0.12, sunT: [0.25, 0.05, -0.25] },
  sunset: { hemi: 0.34, dif: [0.45, 0.18, -0.05], gnd: [0.40, 0.15, 0.02],
            clear: [0.28, 0.07, 0.20], fog: [0.42, 0.16, 0.22],
            expo: 0.15, con: 0.06, sunT: [0.35, -0.15, -0.5] },
};
// One cylinder, not four walls: a box of sky planes has four corners, and
// out on the open coast where nothing occludes the horizon you can see
// every one of them as a hard vertical seam. A cylinder has none, is one
// mesh instead of four, and takes the same gradient.
const daySkies = [];
let daySkyMat = null, daySkyTex = null, sunsetSkyTex = null;
{
  const p = MeshBuilder.CreateCylinder('dsky', {
    diameter: 2560, height: 820, tessellation: 40,
    cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE,
  }, scene);
  p.position.set(mid, 270, mid);
  const dm = new StandardMaterial('dskym', scene);
  daySkyTex = coastSkyTexture();
  dm.emissiveTexture = daySkyTex;
  dm.disableLighting = true;
  dm.fogEnabled = false;
  p.material = dm;
  p.visibility = 0;
  p.setEnabled(false);
  daySkies.push(p);
  daySkyMat = dm;
}
// ---- rain: two streak layers riding the camera --------------------------
// Cheap the 1986 way: scrolling streak textures on planes parented to the
// camera, two depths for parallax. Created after the district pass so the
// tiler never captures them.
const rainPlanes = [];
{
  const mkTex = (n) => {
    const dt = new DynamicTexture('rain' + n, { width: 256, height: 256 }, scene, true);
    const x = dt.getContext();
    x.clearRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(205, 222, 255, 0.55)';
    for (let k = 0; k < 90; k++) {
      const h = Math.sin(k * 12.9898 + n * 78.233) * 43758.5453;
      const rx = (h - Math.floor(h)) * 256;
      const ry = (k * 37 + n * 91) % 256;
      x.lineWidth = 0.8 + (k % 3) * 0.4;
      x.beginPath();
      x.moveTo(rx, ry);
      x.lineTo(rx - 3, ry + 13 + (k % 5) * 3);
      x.stroke();
    }
    dt.update();
    dt.hasAlpha = true;
    return dt;
  };
  for (const [dist, w, speed, alpha] of [[2.1, 4.6, 2.2, 0.5], [3.6, 8, 1.4, 0.35]]) {
    const tex = mkTex(dist);
    const p = MeshBuilder.CreatePlane('rainp', { width: w, height: w * 0.62 }, scene);
    p.parent = cam;
    p.position.set(0, 0, dist);
    const m = new StandardMaterial('rainm' + dist, scene);
    m.emissiveTexture = tex;
    m.opacityTexture = tex;
    m.disableLighting = true;
    m.fogEnabled = false;
    m.alpha = alpha;
    p.material = m;
    p.setEnabled(false);
    rainPlanes.push({ p, tex, speed });
  }
}

// Swap the coast cylinder's gradient to match the chosen mood.
function setCoastSky() {
  if (!daySkyMat) return;
  if (coast2.mode === 'sunset') {
    if (!sunsetSkyTex) sunsetSkyTex = sunsetSkyTexture();
    daySkyMat.emissiveTexture = sunsetSkyTex;
  } else {
    daySkyMat.emissiveTexture = daySkyTex;
  }
}
let vibe = 0;
let vibeStep = 0;
// The coast morph: off by default (it was once suspected of costing
// frames; measured at two to four per cent of a coast frame). B cycles
// NEON NIGHT -> DAYLIGHT -> SUNSET; the OUTRUN codeword goes straight to
// sunset, as is right and proper.
const coast2 = { mode: CITY.coast || 'off' };
setCoastSky();                       // sunset towns get their sky at boot

// The run: score, health, and how it ends.
const run = { score: 0, health: 100, over: false, reason: '', time: 0, started: false, saved: false };
// The ledger the game-over screen reads out: the good, the bad, the miles.
const stats = { coupes: 0, vans: 0, cases: 0, tapes: 0, cleanBonuses: 0,
                resprays: 0, redsRun: 0, rams: 0, pedsHit: 0, shots: 0,
                distance: 0, topSpeed: 0, maxWanted: 0, stunts: 0 };
// Easter eggs: each fires once a run.
const egg = { lotus: false, mph88: false, y1986: false,
              kitt: false, outrun: false, h55: false,
              vhs: false, goonies: false };
let h55T = 0;
const playerPrev = { e: null, dir: 0, s: 0 };
let speedTattleT = 0;
mission.onScore = (n) => { run.score += n; };
coast.onScore = (n) => { run.score += n; };
// Pickups: the tape deck and the briefcase.
pickups.onCassette = (left) => {
  run.score += 120;
  stats.tapes += 1;
  // A chime, not a track change: skipping the song mid-flow every time
  // you grabbed a tape ruined whatever was playing. X still skips by hand.
  sound.chime();
  hud.say(left ? `CASSETTE FOUND · +120 · ${left} STILL OUT THERE`
                : 'EVERY CASSETTE FOUND · +120 · SIDE B FOREVER', true);
};
pickups.onCase = () => {
  run.score += 250;
  stats.cases += 1;
  sound.chime();
  hud.say('BRIEFCASE RECOVERED · +250', true);
};
pickups.onCaseLost = () => hud.say('THE LAW GOT TO THE BRIEFCASE FIRST');
pickups.onScram = () => {
  mission.scramble();
  sound.fanfare();
  bigWord('SCRAMBLED', 'THE FLEET IS BLIND — RUN THEM DOWN');
};
pickups.onTreasure = () => {
  run.score += 500;
  sound.fanfare();
  bigWord('THE RICH STUFF', 'HEY YOU GUYS · +500');
};
mission.onDrop = (x, y, z) => pickups.dropCase(x, y, z);
// A fresh six every level, somewhere new - and a proper cheer, because a
// line of HUD text is no way to be told you have won a level.
mission.onLevel = (level) => {
  pickups.scatter(level);
  stats.coupes += 1;
  sound.fanfare();
  bigWord('LEVEL ' + level, 'THE HUNT GOES ON');
  rollWeather(true);                 // the sky rolls with each contract
};
// Kills explode. A van that silently winks out reads as a bug, not a win.
// ---- town-hopping: the four towns are one campaign ----------------------
// Two contracts per town, then the trail crosses the water. The mission
// flips to 'travel', the arrow points at the island, and reaching it
// carries the whole run - score, level, hull, tank, ledger, paint - into
// the next town through a reload.
mission.travelPoint = (() => {
  const isle = net.isleAt ? net.isleAt(1, 1) : null;
  return isle ? { x: isle.x, z: isle.z } : null;
})();
mission.onTravel = (level) => {
  stats.coupes += 1;
  sound.fanfare();
  const next = CITIES[(cityIdx + 1) % CITIES.length];
  bigWord('LEVEL ' + level, 'THE TRAIL LEAVES TOWN');
  hud.say(`THE COUPE'S PAYMASTERS ARE IN ${next.name} — TAKE THE BRIDGE TO THE ISLAND`, true);
};
function hopTown() {
  const packed = btoa(JSON.stringify({
    score: Math.round(run.score), level: mission.level, health: run.health,
    fuel: tank.fuel, time: run.time, stats, resprayIdx,
    upgrades, tankMax: tank.max,
  }));
  // Belt, braces, and the hash itself: storage can be blocked inside the
  // artifact sandbox, and a hop that loses the run dumps the player onto
  // the front door mid-campaign - which reads as "the game ended". The
  // fragment survives a reload with no storage at all.
  try { sessionStorage.setItem('neoncity_hop', packed); } catch (e) { /* blocked */ }
  try { localStorage.setItem('neoncity_hop', packed); } catch (e) { /* blocked */ }
  location.hash = 'city' + ((cityIdx + 1) % CITIES.length) + '.' + packed;
  location.reload();
}

// From level five the van's mass is a weapon: its rams land on the hull.
mission.onVanRam = (hurt) => {
  run.health -= hurt * (upgrades.plate ? 0.75 : 1);
  shake = Math.max(shake, 0.6);
};
mission.onBoom = (x, y, z, kind, clean) => {
  boom(x, y, z);
  if (kind === 'van') {
    stats.vans += 1;
    bigWord('DROP STOPPED', 'THE COUPE IS ON ITS OWN');
  } else if (kind === 'rival') {
    bigWord('RIVAL DOWN', 'THE MARK IS YOURS ALONE');
  } else if (kind === 'rivalkill') {
    bigWord('MARK LOST', 'THE RIVAL GOT THERE FIRST');
  } else if (kind === 'runner') {
    // The HUD line carries it; a runner is not a headline.
  } else if (kind === 'cruiser') {
    // The HUD line carries it; the boom is the point.
  } else if (kind === 'paymaster') {
    stats.campaignDone = true;
    sound.fanfare();
    bigWord('CAMPAIGN COMPLETE', 'THE PAYMASTER IS DOWN · THE COAST IS YOURS');
  } else {
    // A spotless takedown earns the line every plan-lover knows.
    bigWord('TARGET DOWN', clean
      ? 'I LOVE IT WHEN A PLAN COMES TOGETHER'
      : 'GRAB THE BRIEFCASE');
  }
};

// ---- the big word: kills and level-ups, announced properly --------------
const bigwordEl = document.getElementById('bigword');
function bigWord(main, sub) {
  document.getElementById('bwmain').textContent = main;
  document.getElementById('bwsub').textContent = sub || '';
  bigwordEl.classList.remove('go');
  void bigwordEl.offsetWidth;               // restart the CSS animation
  bigwordEl.classList.add('go');
  clearTimeout(bigWord._t);
  bigWord._t = setTimeout(() => bigwordEl.classList.remove('go'), 3100);
}

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
// ---- explosions: a pooled burst of glowing shards ----------------------
// Created after the district pass on purpose, so the tiler never captures
// them; they spray out, tumble, fall, and switch themselves off.
const shards = [];
{
  const sm = new StandardMaterial('shardm', scene);
  sm.emissiveColor = new Color3(1.9, 0.85, 0.2);
  sm.disableLighting = true;
  for (let i = 0; i < 26; i++) {
    const b = MeshBuilder.CreateBox('shard', { size: 0.34 }, scene);
    b.material = sm;
    b.setEnabled(false);
    shards.push({ mesh: b, life: 0, vx: 0, vy: 0, vz: 0 });
  }
}
function boom(x, y, z) {
  sound.boom();
  shake = Math.min(1.4, shake + 0.9);
  let n = 0;
  for (const s of shards) {
    if (s.life > 0) continue;
    if (++n > 13) break;
    s.life = 0.9 + Math.random() * 0.5;
    const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 12;
    s.vx = Math.sin(a) * v; s.vz = Math.cos(a) * v;
    s.vy = 5 + Math.random() * 9;
    s.mesh.setEnabled(true);
    s.mesh.position.set(x, y + 0.8, z);
    s.mesh.scaling.setAll(0.7 + Math.random() * 1.2);
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
  stats.shots += 1;
  sound.gun();
  const fx = Math.sin(player.pos.yaw), fz = Math.cos(player.pos.yaw);
  const mx = player.pos.x + fx * 2.4, mz = player.pos.z + fz * 2.4;
  // Nearest thing inside a tight forward cone, out to 65 m.
  let best = null, bestD = 65, bestKind = null;
  const consider = (obj, x, z, kind, y) => {
    if (Math.abs((y || 0) - player.pos.y) > 3) return;   // not on your level
    const dx = x - mx, dz = z - mz;
    const d = Math.hypot(dx, dz);
    if (d > bestD || d < 1) return;
    const ang = Math.abs(wrapA(Math.atan2(dx, dz) - player.pos.yaw));
    // A five degree cone was tight enough that two moving cars almost
    // never lined up; eight is still aiming.
    if (ang < 0.14) { best = obj; bestD = d; bestKind = kind; }
  };
  const T = mission.target;
  if (mission.state !== 'done') consider(T, T.pos.x, T.pos.z, 'target', T.pos.y);
  if (mission.van) {
    const V = mission.van;
    consider(V, V.pos.x, V.pos.z, 'van', V.pos.y);
  }
  for (const p of mission.police) consider(p, p.pos.x, p.pos.z, 'police', p.pos.y);
  if (mission.rival) {
    const R = mission.rival;
    consider(R, R.pos.x, R.pos.z, 'rival', R.pos.y);
  }
  for (const r of mission.runners) {
    if (r.live) consider(r, r.pos.x, r.pos.z, 'runner', r.pos.y);
  }
  for (const d of traffic) consider(d, d.pos.x, d.pos.z, 'traffic', d.pos.y);
  for (const p of peds.list) {
    if (p.state === 'down') continue;
    const pp = peds.posOf(p);
    consider(p, pp.x, pp.z, 'ped', 0);
  }
  const hx = mx + fx * bestD, hz = mz + fz * bestD;
  showTracer(mx, mz, hx, hz, player.pos.y + 0.8);
  if (!best) return;
  if (bestKind === 'van') {
    mission.damageVan(0.5, player);
    run.score += 25;
  } else if (bestKind === 'target') {
    mission.damageTarget(0.5, player);
    run.score += 25;
  } else if (bestKind === 'rival') {
    mission.damageRival(0.5);
    run.score += 25;
  } else if (bestKind === 'runner') {
    mission.damageRunner(best, 1);
    run.score += 25;
  } else if (bestKind === 'police') {
    const o = OFFENCES.shooting;
    mission.bumpWanted(o.stars, o.why, o.cap);
  } else if (bestKind === 'traffic') {
    best.gunHp = (best.gunHp ?? 3) - 1;
    if (best.gunHp <= 0 && !best.shotOut) { best.shotOut = true; best.speed = 0; }
    mission.witnessed('gunfire', player, true);
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
  // The reckoning: what this run was actually like, both columns.
  const km = (stats.distance / 1000).toFixed(1);
  const ledger =
    `THE GOOD — COUPES ${stats.coupes} · VANS ${stats.vans} · CASES ${stats.cases}` +
    ` · TAPES ${stats.tapes}\n` +
    `           CLEAN BONUSES ${stats.cleanBonuses} · RESPRAYS ${stats.resprays}` +
    ` · STUNTS ${stats.stunts}\n` +
    `THE BAD  — REDS RUN ${stats.redsRun} · CARS RAMMED ${stats.rams}` +
    ` · PEDESTRIANS HIT ${stats.pedsHit}\n` +
    `           SHOTS FIRED ${stats.shots} · WORST HEAT ` +
    `${stats.maxWanted ? '★'.repeat(stats.maxWanted) : 'SPOTLESS'}\n` +
    `THE MILES — ${km} KM · TOP SPEED ${Math.round(stats.topSpeed * 2.237)} MPH`;
  document.getElementById('ovtext').textContent =
    `${run.reason}\n\nSCORE ${s} · LEVEL ${mission.level}` +
    (stats.campaignDone ? ' · CAMPAIGN COMPLETE' : '') + '\n' +
    `SURVIVED ${Math.round(run.time)}s IN ${CITY.name}\n\n${ledger}\n\n` +
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
  // A vanished wreck is not a wall: once the dead coupe burns off, it
  // leaves the physical world too.
  const everyone = [player, ...traffic, ...mission.police];
  if (!mission.targetGone) everyone.push(mission.target);
  if (mission.van) everyone.push(mission.van);
  if (mission.rival) everyone.push(mission.rival);
  for (const r of mission.runners) if (r.live) everyone.push(r);
  for (let i = 0; i < everyone.length; i++) {
    for (let j = i + 1; j < everyone.length; j++) {
      const a = everyone[i], b = everyone[j];
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      // Nine metres of fresh air is not a collision: the deck and the street
      // below it share every x and z in the city.
      if (Math.abs(a.pos.y - b.pos.y) > 3) continue;
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
        // Longer gate on anything involving the player. Two or three
        // cruisers taking turns at four tenths of a second apart could hold
        // you at a dead stop indefinitely - not a bust, not an escape, just
        // a stall you could not drive out of.
        const gate = (a === player || b === player) ? 1.1 : 0.4;
        if ((hitCooldown.get(key) || 0) <= clock) {
          hitCooldown.set(key, clock + gate);
          const rel = Math.abs(back.speed - front.speed) + 2;
          front.speed = Math.min(front.speed + rel * 0.65, front.speed + 16);
          // The bounce: the rammer is thrown back off the contact, hard.
          back.speed = Math.max(0, front.speed * 0.2);
          if (back.mode === 'edge') back.s = Math.max(0, back.s - rel * 0.14);
          shake = Math.min(1, rel / 11);
          sound.crash(Math.min(1, rel / 16));
          if ((a === player || b === player) && run.started) {
            // Who ran into whom matters: at three stars the police ram you
            // on purpose, and every one of those was being booked as your
            // assault, which walked you to four stars and a shooting in
            // under a minute for doing nothing.
            if (back === player && rel > 8) stats.rams += 1;
            mission.onPlayerImpact(a === player ? b : a, rel, player, true,
                                   back === player);
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
// Measured on the coast, the glow layer was a third of the whole frame: it
// was rendering every emissive surface at half screen and blurring it twice
// with a 32-tap kernel. Glow is a blurry effect by definition, so a smaller
// buffer and a shorter kernel cost a third as much and look the same.
const glowLayer = new GlowLayer('glow', scene,
  { intensity: 0.55, mainTextureRatio: 0.3, blurKernelSize: 24 });
// The glow layer redraws every emissive surface into a blur target. The neon
// wants that; the sky walls, the ridges, the beach AND THE SUN do not - they
// are the biggest surfaces in the game and they were being drawn a second
// time, full screen, every frame. The sun was the one left behind: a 420 m
// emissive quad re-rendered into the blur target whenever you faced the
// sunset, for a halo the bloom pass already provides.
for (const p of [...nightSkies, ...daySkies, sun]) glowLayer.addExcludedMesh(p);
for (const rp of rainPlanes) glowLayer.addExcludedMesh(rp.p);
for (const msh of scene.meshes) {
  const mn = msh.material && msh.material.name;
  if (mn === 'sand' || mn === 'sea') glowLayer.addExcludedMesh(msh);
}
const pipe = new DefaultRenderingPipeline('pp', true, scene, [cam]);
pipe.bloomEnabled = true; pipe.bloomThreshold = 0.8; pipe.bloomWeight = 0.4;
pipe.bloomScale = 0.4;
pipe.chromaticAberrationEnabled = true; pipe.chromaticAberration.aberrationAmount = 14;
pipe.grainEnabled = true; pipe.grain.intensity = 8; pipe.grain.animated = true;
pipe.fxaaEnabled = true;
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
// ---- cameras ------------------------------------------------------------
// Four ways to watch the same car. Chase is the game's own; close is for
// threading traffic, bonnet is for the road ahead and nothing else, and
// far is for looking at the city you are driving through.
const VIEWS = [
  { name: 'CHASE',  back: 8.4, rise: 0.16, high: 4.4, lift: 0.05, ahead: 7,  eye: 1.2, lag: 5.5, fov: 0.95 },
  { name: 'CLOSE',  back: 5.4, rise: 0.08, high: 2.5, lift: 0.02, ahead: 9,  eye: 1.0, lag: 8.5, fov: 1.02 },
  { name: 'BONNET', back: -1.9, rise: 0,   high: 1.05, lift: 0,   ahead: 24, eye: 1.0, lag: 40,  fov: 1.06 },
  { name: 'FAR',    back: 15,  rise: 0.3,  high: 9.5, lift: 0.09, ahead: 4,  eye: 1.6, lag: 3.2, fov: 0.86 },
];
let view = 0;
function updateCamera(dt) {
  const v = VIEWS[view];
  const fx = Math.sin(player.pos.yaw), fz = Math.cos(player.pos.yaw);
  const back = v.back + player.speed * v.rise;
  const cx = player.pos.x - fx * back;
  const cz = player.pos.z - fz * back;
  const k = Math.min(1, dt * v.lag);
  cam.position.x += (cx - cam.position.x) * k;
  cam.position.z += (cz - cam.position.z) * k;
  cam.position.y += (player.pos.y + v.high + player.speed * v.lift - cam.position.y) * k;
  if (shake > 0) {
    cam.position.x += (Math.random() - 0.5) * shake * 0.7;
    cam.position.y += (Math.random() - 0.5) * shake * 0.5;
  }
  cam.setTarget(new Vector3(
    player.pos.x + fx * v.ahead,
    player.pos.y + v.eye,
    player.pos.z + fz * v.ahead));
}

// The menu's camera: the poster shot. Low, behind the car, swinging through
// a slow arc so the wordmark hangs over the boulevard with the sun dead
// ahead, breathing rather than orbiting.
function updateAttractCam(dt) {
  const a = player.pos.yaw + Math.PI + Math.sin(clock * 0.10) * 0.8;
  const r = 8.6 + Math.sin(clock * 0.063) * 1.8;
  const tx = player.pos.x + Math.sin(a) * r;
  const tz = player.pos.z + Math.cos(a) * r;
  const ty = player.pos.y + 1.7 + Math.sin(clock * 0.045) * 0.5;
  const k = Math.min(1, dt * 1.8);
  cam.position.x += (tx - cam.position.x) * k;
  cam.position.y += (ty - cam.position.y) * k;
  cam.position.z += (tz - cam.position.z) * k;
  const fx = Math.sin(player.pos.yaw), fz = Math.cos(player.pos.yaw);
  cam.setTarget(new Vector3(player.pos.x + fx * 9, player.pos.y + 1.3,
                            player.pos.z + fz * 9));
}

// ---- the garage ---------------------------------------------------------
// Pull onto a service spur and stop, and a man comes out of the hut and
// works down the list: fills the tank, gives it a coat of paint - which is
// the respray, so it is also how you lose the police - and beats the panels
// back out. Then he waves you off and you U-turn back onto the street.
const attendant = (() => {
  const skin = new StandardMaterial('attS', scene);
  skin.emissiveColor = new Color3(0.55, 0.42, 0.3);
  skin.disableLighting = true;
  const overalls = new StandardMaterial('attO', scene);
  overalls.emissiveColor = new Color3(0.2, 0.45, 0.32);
  overalls.disableLighting = true;
  const root = new TransformNode('att', scene);
  const body = MeshBuilder.CreateBox('atb', { width: 0.5, height: 1.15, depth: 0.34 }, scene);
  body.position.y = 0.58; body.material = overalls; body.parent = root;
  const head = MeshBuilder.CreateBox('atb', { width: 0.3, height: 0.3, depth: 0.3 }, scene);
  head.position.y = 1.32; head.material = skin; head.parent = root;
  const arm = MeshBuilder.CreateBox('atb', { width: 0.16, height: 0.75, depth: 0.16 }, scene);
  arm.position.set(0.34, 0.72, 0.1); arm.material = overalls; arm.parent = root;
  root.setEnabled(false);
  return { root, arm };
})();

const SERVICE = [
  { key: 'fuel',   say: 'FILLING HER UP',        secs: 0 },
  { key: 'paint',  say: 'A COAT OF PAINT',       secs: 3.2 },
  { key: 'repair', say: 'BEATING THE PANELS OUT', secs: 0 },
];
// You do not come out of a respray the colour you went in.
const RESPRAY = [
  ['PEARL', new Color3(0.80, 0.83, 0.90)],
  ['OXBLOOD', new Color3(0.42, 0.05, 0.08)],
  ['MIDNIGHT', new Color3(0.06, 0.10, 0.30)],
  ['SAND', new Color3(0.62, 0.52, 0.28)],
  ['JADE', new Color3(0.06, 0.38, 0.26)],
  ['SLATE', new Color3(0.20, 0.22, 0.26)],
  ['VIOLET', new Color3(0.30, 0.10, 0.42)],
];
let resprayIdx = 0;
const garage = { at: null, stage: -1, t: 0, said: '' };

// Getting IN was the hard part: a spur is easy to miss at speed, so the
// junction before one says so, and says which way to indicate.
let signT = 0, signedNode = null;
function signpostGarage(dt) {
  signT -= dt;
  if (player.mode !== 'edge' || player.e.cls === 'service') return;
  const node = nodeAhead(player.e, player.dir);
  const togo = player.dir > 0 ? player.e.len - player.s : player.s;
  if (togo > 75 || togo < 12) { if (togo > 90) signedNode = null; return; }
  if (signedNode === node || signT > 0) return;
  const opts = turnOptions(node, headingSlot(player.e, player.dir));
  for (const [side, o] of Object.entries(opts)) {
    if (!o || o.e.cls !== 'service') continue;
    signedNode = node;
    signT = 6;
    hud.say(side === 'straight'
      ? 'GARAGE STRAIGHT ON'
      : `GARAGE ${side.toUpperCase()} — INDICATE ${side === 'left' ? 'Q' : 'E'}`, true);
    break;
  }
}

function updateGarage(dt, clock) {
  const onSpur = player.mode === 'edge' && player.e.cls === 'service';
  const st = onSpur ? cityBits.stations.find(s2 => s2.edge === player.e) : null;
  if (!st || player.speed > 1.4) {
    if (garage.at) {
      garage.at = null; garage.stage = -1; garage.said = '';
      attendant.root.setEnabled(false);
    }
    return;
  }
  if (garage.at !== st) {
    garage.at = st; garage.stage = 0; garage.t = 0; garage.said = '';
    attendant.root.setEnabled(true);
  }
  // He stands at the driver's door and works.
  const ax = st.x + st.ax * 2.6, az = st.z + st.az * 2.6;
  const k = Math.min(1, dt * 3);
  attendant.root.position.x += (ax - attendant.root.position.x) * k;
  attendant.root.position.z += (az - attendant.root.position.z) * k;
  attendant.root.rotation.y = Math.atan2(player.pos.x - ax, player.pos.z - az);
  attendant.arm.rotation.x = Math.sin(clock * 7) * 0.6 - 0.5;

  if (garage.stage >= SERVICE.length) return;
  const job = SERVICE[garage.stage];
  let done = false;
  if (job.key === 'fuel') {
    // Petrol is priced by reputation: half a point a unit clean, half
    // again more per star. A hot car pays for the pump's discretion.
    const add = Math.min(34 * dt, tank.max - tank.fuel);
    tank.fuel += add;
    run.score = Math.max(0, run.score -
      add * 0.5 * (1 + mission.wanted) * mission.diff.petrol);
    done = tank.fuel > tank.max - 0.5;
  } else if (job.key === 'paint') {
    garage.t += dt;
    if (garage.t > job.secs) {
      // The respray only fools the police if nobody in blue is watching -
      // but the paint is fresh either way, and it is a different colour,
      // because a car that goes into a paint shop and comes out the same
      // shade has not been resprayed.
      const fooled = mission.tryDisguise(player, clock);
      stats.resprays += 1;
      resprayIdx = (resprayIdx + 1) % RESPRAY.length;
      const [name, col] = RESPRAY[resprayIdx];
      playerCar.paint.albedoColor.copyFrom(col);
      playerCar.paint.emissiveColor.copyFrom(col.scale(0.16));
      if (!fooled) hud.say('RESPRAYED ' + name);
      done = true;
    }
  } else {
    run.health = Math.min(100, run.health + 30 * dt);
    done = run.health > 99.5;
  }
  if (garage.said !== job.key) {
    garage.said = job.key;
    hud.say(job.say +
      (job.key === 'fuel' && mission.wanted ? ' — HOT CARS PAY MORE' : '') + '…');
  }
  if (done) {
    garage.stage += 1;
    garage.t = 0;
    if (garage.stage >= SERVICE.length) {
      sound.chime();
      hud.say('ALL DONE' + upgradeOffer() +
        ' — OR HOLD THE INDICATOR TO SWING HER ROUND', true);
    }
  }
}

// The tank and the turbo: Turbo Esprit's two pressures. Fuel burns with
// distance and speed; the turbo drains fast, recharges slow, and shoves.
const tank = { fuel: 100, max: 100, low: false };
// Upgrades: bought with SCORE at a serviced garage, which is the gamble -
// spend the high score to chase a higher one.
const upgrades = { tank: false, plate: false, turbo: false };
const UPGRADE_PRICES = { tank: 800, plate: 1000, turbo: 1200 };
function buyUpgrade(key) {
  if (upgrades[key]) { hud.say('ALREADY FITTED'); return; }
  const price = UPGRADE_PRICES[key];
  if (run.score < price) {
    hud.say(`${key.toUpperCase()} COSTS ${price} — YOU ARE ${Math.ceil(price - run.score)} SHORT`);
    return;
  }
  run.score -= price;
  upgrades[key] = true;
  if (key === 'tank') { tank.max = 135; tank.fuel = tank.max; }
  sound.chime();
  hud.say((key === 'tank' ? 'LONG-RANGE TANK FITTED — 135 LITRES'
        : key === 'plate' ? 'PLATING FITTED — HITS LAND SOFTER'
        : 'TURBO REBUILT — SPOOLS QUICKER') + ` · -${price}`, true);
}
function upgradeOffer() {
  const bits = [];
  if (!upgrades.tank) bits.push('1 TANK 800');
  if (!upgrades.plate) bits.push('2 PLATE 1000');
  if (!upgrades.turbo) bits.push('3 TURBO 1200');
  return bits.length ? ' · ' + bits.join(' · ') : '';
}
const turbo = { charge: 1, active: false };
const holdT = { q: 0, e: 0 };
const clean = { t: 0 };          // seconds of tidy driving toward the bonus
let overT = 0, overSaid = false; // time spent out in the oncoming lane

// ---- air: bumps taken fast, ramps taken faster --------------------------
// A jump is a vertical arc over the road the car is already on: the lane
// grammar keeps steering the ground path, so you can clear cones and roof
// a passing car but never land anywhere you cannot drive out of.
const air = { y: 0, v: 0, prevE: null, prevDir: 0, prevS: 0 };
function updateAir(dt) {
  if (air.y > 0 || air.v !== 0) {
    air.v -= 30 * dt;
    air.y += air.v * dt;
    if (air.y <= 0) {
      air.y = 0; air.v = 0;
      shake = Math.max(shake, 0.22);
      sound.clunk();
    }
  }
  if (player.mode !== 'edge') { air.prevE = null; return; }
  if (air.prevE === player.e && air.prevDir === player.dir && air.y === 0) {
    for (const b of cityBits.bumps) {
      if (b.e !== player.e) continue;
      const sT = player.dir > 0 ? b.sA : player.e.len - b.sA;
      if (air.prevS < sT && player.s >= sT) {
        if (player.speed > 15) {
          air.v = Math.min(10, player.speed * 0.34);   // launched
          sound.clunk();
        } else if (player.speed > 6) {
          player.speed *= 0.72;                        // thumped
          shake = Math.max(shake, 0.2);
          sound.clunk();
        }
      }
    }
  }
  air.prevE = player.e; air.prevDir = player.dir; air.prevS = player.s;
}

// ---- weather ------------------------------------------------------------
const weather = { rain: false, thunderT: 12, flash: 0 };
function applyWeather(quiet) {
  player.wet = weather.rain;
  for (const d of traffic) d.wet = weather.rain;
  mirror.level = weather.rain ? 1.0 : 0.8;
  for (const rp of rainPlanes) rp.p.setEnabled(weather.rain);
  if (!quiet) hud.say(weather.rain ? 'RAIN MOVING IN — LONGER STOPPING'
                                   : 'THE RAIN HAS PASSED');
}
function rollWeather(announce) {
  const was = weather.rain;
  weather.rain = Math.random() < 0.3;
  applyWeather(!(announce && weather.rain !== was));
}
const carFeel = { roll: 0, pitch: 0, lastV: 0 };

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
    turbo.charge + (turbo.active ? (upgrades.turbo ? -0.23 : -0.28)
      : (egg.lotus ? 0.105 : 0.07) * (upgrades.turbo ? 1.45 : 1)) * dt));
  if (turbo.active && player.mode === 'edge') player.speed += 16 * dt;

  // Fuel: burns with speed, faster on turbo; empty means a crawl. The
  // attract car burns nothing - a menu must never eat the tank.
  if (live) {
    tank.fuel = Math.max(0, tank.fuel -
      (0.06 + player.speed * 0.014 + (turbo.active ? 0.5 : 0)) * dt);
    if (tank.fuel < 25 && !tank.low) { tank.low = true;
      hud.say('FUEL LOW — FOLLOW THE GREEN ARROW'); }
    if (tank.fuel > 40) tank.low = false;
  }
  let cap = CLASSES[player.e.cls].limit * (turbo.active ? 3.2 : 2.2);
  if (tank.fuel <= 0) cap = 5;
  if (live) {
    player.update(dt, { throttle, steer, maxSpeed: cap });
  } else {
    // Attract mode: while the menu is up, the car cruises the sunward
    // boulevard on its own - and when it runs out of boulevard (or gets
    // turned off it), it cuts back to the top and comes down again.
    player.intent = 'straight';
    player.update(dt, { throttle: 0.5, steer: 0, maxSpeed: 6.5 });
    if (player.mode === 'edge' &&
        (player.e.cls !== 'avenue' || player.e.axis !== 1 ||
         player.pos.z > net.zs[net.zs.length - 1] - 80)) {
      player.e = startEdge; player.dir = 1; player.lane = 0; player.s = 6;
      player.lat = 0; player.latV = 0; player.speed = 5; player.mode = 'edge';
      player.place();
    }
  }

  if (live) { updateAir(dt); player.pos.y += air.y; }

  if (live) {
    updateGarage(dt, clock);
    signpostGarage(dt);
    stats.distance += player.speed * dt;
    stats.topSpeed = Math.max(stats.topSpeed, player.speed);
    stats.maxWanted = Math.max(stats.maxWanted, mission.wanted);
    // 88 on the dial has meant something since 1985.
    if (!egg.mph88 && player.speed * 2.237 >= 88) {
      egg.mph88 = true;
      bigWord('88 MPH', 'TEMPORAL VELOCITY ACHIEVED');
    }
    if (!egg.y1986 && run.score >= 1986) {
      egg.y1986 = true;
      sound.chime();
      hud.say('SCORE 1986 — A FINE YEAR', true);
    }
    // The oncoming lane pays: nerve is worth money in 1986. Eight points a
    // second while committed past the centre line at speed.
    if (player.mode === 'edge' && player.lat < -1.8 && player.speed > 12) {
      overT += dt;
      run.score += dt * 8;
      if (overT > 1.5 && !overSaid) {
        overSaid = true;
        hud.say('IN THE ONCOMING — NERVE PAYS');
      }
    } else { overT = 0; overSaid = false; }
    // Hold 55 on the nose for eight seconds and 1984 has a song about it.
    if (!egg.h55) {
      const mph = player.speed * 2.237;
      h55T = (mph > 53 && mph < 57) ? h55T + dt : 0;
      if (h55T > 8) {
        egg.h55 = true;
        bigWord("I CAN'T DRIVE 55", 'AND YET HERE YOU ARE');
      }
    }
  }
  // The scanner sweeps whether you are driving or admiring the menu.
  if (egg.kitt) kittBar.position.x = Math.sin(clock * 5) * 0.5;

  playerCar.root.position.set(player.pos.x, player.pos.y, player.pos.z);
  playerCar.root.rotation.y = player.pos.yaw;
  // Body language: lean into lane changes, squat on the throttle, dip on
  // the brakes, nose-up off a ramp.
  {
    const a = (player.speed - carFeel.lastV) / Math.max(dt, 1e-3);
    carFeel.lastV = player.speed;
    carFeel.roll += ((-player.latV * 0.045) - carFeel.roll) * Math.min(1, dt * 7);
    const pitchGoal = Math.max(-0.07, Math.min(0.05, -a * 0.004)) +
      (air.y > 0 ? Math.max(-0.1, -air.v * 0.01) : 0);
    carFeel.pitch += (pitchGoal - carFeel.pitch) * Math.min(1, dt * 6);
    playerCar.root.rotation.z = Math.max(-0.14, Math.min(0.14, carFeel.roll));
    playerCar.root.rotation.x = carFeel.pitch;
  }
  const blink = safe.reduceFlash || Math.sin(clock * 9) > 0;
  playerCar.indL.setEnabled(player.indicator === -1 && blink);
  playerCar.indR.setEnabled(player.indicator === 1 && blink);

  for (const d of traffic) {
    d.update(dt, aiInput(d, dt, clock));
    if (d.blocked) d.beginUTurn();
    d.car.root.position.set(d.pos.x, d.pos.y, d.pos.z);
    d.car.root.rotation.y = d.pos.yaw;
    const b2 = safe.reduceFlash || Math.sin(clock * 9 + d.ai.cruise * 20) > 0;
    d.car.indL.setEnabled(d.indicator === -1 && b2);
    d.car.indR.setEnabled(d.indicator === 1 && b2);
  }

  if (run.over) { hud.update(dt, player, [...traffic, ...mission.mapEntries()]); return; }
  if (live) {
    run.time += dt;
    run.score += dt * 2 * (1 + mission.wanted * 0.5);
    // Turbo Esprit paid you for car control, not just for contact: a whole
    // minute with no heat, no shunt and no red run is worth money here too.
    if (mission.wanted === 0 && shake < 0.25) clean.t += dt; else clean.t = 0;
    if (clean.t >= 60) {
      clean.t = 0;
      run.score += 100;
      stats.cleanBonuses += 1;
      hud.say('CLEAN DRIVING BONUS · +100');
    }
  }

  if (keys.Space && live) firePlayerGun(dt); else gunT = Math.min(gunT, 0.05);
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.setEnabled(false); }
  }
  for (const s of shards) {
    if (s.life <= 0) continue;
    s.life -= dt;
    s.vy -= 26 * dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y = Math.max(0.15, s.mesh.position.y + s.vy * dt);
    s.mesh.position.z += s.vz * dt;
    s.mesh.rotation.x += dt * 7;
    s.mesh.rotation.y += dt * 9;
    if (s.life <= 0) s.mesh.setEnabled(false);
  }

  signals.update(clock);
  peds.update(dt);
  if ((Math.floor(clock) % 5) === 0) peds.recycle();

  // Player over a pedestrian at speed: the city notices. Not in attract
  // mode - nothing the menu's self-driving car does can be held against
  // the player.
  if (live && player.speed > 4) {
    const victim = player.pos.y < 2 ? peds.hitCheck(player.pos.x, player.pos.z) : null;
    if (victim) {
      run.score = Math.max(0, run.score - 150);
      shake = Math.max(shake, 0.5);
      stats.pedsHit += 1;
      mission.onPedHit(player, true);
    }
  }

  // Red light running: witnessed if the wrong eyes are close.
  if (player.mode === 'edge') {
    if (live && playerPrev.e === player.e && playerPrev.dir === player.dir &&
        signals.ranRed(player.e, player.dir, playerPrev.s, player.s, clock)) {
      // Running a red used to PAY 15 points, which argued with everything
      // else the game says about driving well. Now it just costs you the
      // clean-driving clock, plus whatever the witnesses make of it.
      clean.t = 0;
      stats.redsRun += 1;
      mission.witnessed('redLight', player, true);
    }
    playerPrev.e = player.e; playerPrev.dir = player.dir; playerPrev.s = player.s;
  }
  // Speeding right past a cruiser is a star on its own.
  if (live && player.speed > CLASSES[player.e.cls].limit * 1.5 &&
      mission.nearestPoliceDist(player) < 22 && clock > speedTattleT) {
    speedTattleT = clock + 12;
    const o = OFFENCES.speeding;
    mission.bumpWanted(o.stars, o.why, o.cap);
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
      if (rw.ramp && player.speed > 18 && air.y === 0 && clock > (rw.stuntT || 0)) {
        // The contractor's plank: fast enough and the cones are somebody
        // else's problem.
        rw.stuntT = clock + 3;
        air.v = Math.min(13, player.speed * 0.42);
        run.score += 100;
        stats.stunts += 1;
        hud.say('STUNT · +100');
        sound.chime();
      } else if (air.y === 0) {
        player.speed *= Math.max(0, 1 - 2.4 * dt);
        shake = Math.max(shake, 0.25);
      }
    }
  }

  // AI shots land as health damage, dodgeable by speed.
  // In the garage you are off the board: the doors are shut, and a
  // gunfight in a paint shop is nobody's idea of a good time.
  mission.playerSafe = !!garage.at;
  mission.update(dt, player, clock);
  // Travelling, and made landfall: a street with BOTH ends on the island
  // counts as arriving. (The descent ramp touches an island node, and
  // firing there cut the crossing short mid-flight.)
  if (mission.state === 'travel' && player.mode === 'edge' &&
      player.e.a.isle && player.e.b.isle) {
    hopTown();
    return;
  }
  for (const sh of mission.shots) {
    showTracer(sh.from.x, sh.from.z, sh.to.x, sh.to.z, player.pos.y + 0.9);
    const dodge = Math.min(0.75, player.speed / 45);
    if (Math.random() > dodge) {
      run.health -= sh.hurt * (upgrades.plate ? 0.75 : 1);
      shake = Math.max(shake, 0.3);
    }
  }
  if (run.health <= 0) gameOver('WRECKED BY GUNFIRE');
  if (mission.busted) gameOver('BUSTED');
  updateCollisions(dt, clock);
  if (shake > 0.005) shake *= Math.exp(-dt * 5); else shake = 0;

  if (live) updateCamera(dt); else updateAttractCam(dt);
  // The car paint's planar reflection is worth its cost among neon towers.
  // Out on the ring it reflects sky and sea, so it can crawl - and that is
  // true whether or not the coast is in daylight.
  {
    const want = (player.e && player.e.cls === 'highway') ? 4 : 2;
    if (mirror.refreshRate !== want) mirror.refreshRate = want;
  }

  // ---- the morph: city night <-> the chosen coast mood -----------------
  const mood = MOODS[coast2.mode] || MOODS.day;
  const wantVibe = (coast2.mode !== 'off' && player.e && player.e.cls === 'highway') ? 1
    : (player.mode === 'turn' ? vibe : 0);
  vibe += (wantVibe - vibe) * Math.min(1, dt * 0.55);
  // An exponential fade never arrives, so snap the last hair of it. Without
  // this the coast sits at vibe 0.999... forever and everything below keeps
  // being treated as a change.
  if (Math.abs(wantVibe - vibe) < 0.005) vibe = wantVibe;
  // Free per frame: these are plain uniforms, nothing downstream rebuilds.
  hemi.intensity = 0.22 + vibe * mood.hemi + weather.flash * 1.4;
  hemi.diffuse.set(0.45 + vibe * mood.dif[0], 0.35 + vibe * mood.dif[1],
                   0.75 + vibe * mood.dif[2]);
  hemi.groundColor.set(0.05 + vibe * mood.gnd[0], 0.02 + vibe * mood.gnd[1],
                       0.1 + vibe * mood.gnd[2]);
  scene.clearColor.set(0.012 + vibe * mood.clear[0], 0.006 + vibe * mood.clear[1],
                       0.035 + vibe * mood.clear[2], 1);
  sunM.emissiveColor.set(1 + vibe * mood.sunT[0], 1 + vibe * mood.sunT[1],
                         1 + vibe * mood.sunT[2]);
  sun.scaling.setAll(1 + vibe * 0.4);

  // Expensive per frame: touching the image processing configuration flags
  // EVERY submesh in the scene as image-processing-dirty, so the next frame
  // re-prepares ~850 define sets before it can draw. Mesh enable and
  // visibility flags cost a state pass of their own. Those only move on a
  // sixteenth of the fade, which is invisible over a three second morph and
  // stops dead the moment the fade lands on 0 or 1.
  const step = Math.round(vibe * 16);
  if (step !== vibeStep) {
    vibeStep = step;
    const v = step / 16;
    // Only pay for the sky you can actually see: outside the short morph,
    // one full set of sky walls is switched off entirely.
    const dayOn = v > 0.02, nightOn = v < 0.98;
    for (const p of daySkies) {
      p.setEnabled(dayOn);
      p.visibility = v >= 0.98 ? 1 : v;
    }
    for (const p of nightSkies) p.setEnabled(nightOn);
    scene.fogColor.set(0.05 + v * mood.fog[0], 0.03 + v * mood.fog[1],
                       0.11 + v * mood.fog[2]);
    scene.fogDensity = (0.0017 - v * 0.0006) * fogScale * (safe.reduceFlash ? 1.6 : 1);
    pipe.imageProcessing.exposure = 1.05 + v * mood.expo;
    pipe.imageProcessing.contrast = 1.3 - v * mood.con;

  }

  // The surf marches at the sand. Only worth paying for when you can see
  // it, so it stops dead while the city is dark.
  // The sea still moves at night; it is the light that changes, not the tide.
  if (vibe > 0.02 || (player.e && player.e.cls === 'highway')) {
    for (const b of cityBits.surf) {
      if (b.alongX) b.tex.vOffset = (b.tex.vOffset + b.speed * dt) % 1;
      else b.tex.uOffset = (b.tex.uOffset + b.speed * dt) % 1;
    }
  }
  // Rain falls, and now and then the sky goes off like a flashbulb.
  if (weather.rain) {
    for (const rp of rainPlanes) {
      rp.tex.vOffset -= rp.speed * dt;
      rp.tex.uOffset += rp.speed * 0.12 * dt;
    }
    weather.thunderT -= dt;
    if (weather.thunderT <= 0) {
      weather.thunderT = 14 + Math.random() * 26;
      sound.thunder();
      if (!safe.reduceFlash) weather.flash = 0.9;
    }
  }
  if (weather.flash > 0.01) weather.flash *= Math.exp(-dt * 5);
  pickups.update(dt, player);
  if (live) pickups.updateScram(dt, player, mission.wanted);
  updateDistricts(player.pos.x, player.pos.z);
  coast.update(dt, player, clock, mission.wanted);
  // The siren carries by distance: nothing until a cruiser is within
  // ninety metres, full (quiet) wail with one on your bumper.
  {
    const copD = mission.wanted > 0 ? mission.nearestPoliceDist(player) : 1e9;
    const siren01 = Math.max(0, Math.min(1, (90 - copD) / 70));
    sound.update(dt, Math.min(1, player.speed / 55), turbo.active, siren01);
  }

  // Lightbars: 1.9 Hz in pursuit, well under the three-per-second the
  // photosensitivity guidelines draw the line at, and a steady lilac glow
  // with no alternation at all when reduced flashing is on.
  const strobing = mission.wanted > 0;
  for (let bi = 0; bi < beaconMats.length; bi++) {
    if (safe.reduceFlash) {
      beaconMats[bi].emissiveColor.set(1.1, 0.3, 1.4);
      continue;
    }
    const on = strobing ? Math.sin(clock * 12 + bi * 2) > 0 : Math.sin(clock * 4 + bi) > 0.85;
    beaconMats[bi].emissiveColor.set(on ? 0.4 : 1.8, on ? 0.6 : 0.15, on ? 2.2 : 0.15);
  }
  // The turn cue: as the junction closes in, show which ways peel off and
  // which button asks for them; the indicated side lights up. On touch the
  // key letters vanish and the real Q/E buttons take the highlight.
  {
    const inLane = player.mode === 'edge';
    const togo = inLane ? player.e.len - player.s : 1e9;
    const opts = inLane && togo < 75
      ? turnOptions(nodeAhead(player.e, player.dir), headingSlot(player.e, player.dir))
      : null;
    const setCue = (chip, btn, avail, on) => {
      chip.className = 'cuechip' + (avail ? ' avail' : '') + (on ? ' on' : '');
      btn.classList.toggle('cuehint', avail && !on);
      btn.classList.toggle('cueon', on);
    };
    setCue(cueLEl, touchQ, !!(opts && opts.left),
           !!(opts && opts.left) && player.intent === 'left');
    setCue(cueREl, touchE, !!(opts && opts.right),
           !!(opts && opts.right) && player.intent === 'right');
  }
  starsEl.textContent = mission.wanted > 0 ? '★'.repeat(mission.wanted) : '';
  // Say what the stars are FOR, for as long as you have them.
  whyEl.textContent = mission.wanted > 0 ? (mission.lastReason || '') : '';
  scoreEl.textContent = String(Math.round(run.score)).padStart(6, '0');
  healthBar.style.width = Math.max(0, run.health) + '%';

  hud.update(dt, player, [...traffic, ...mission.mapEntries(),
                          ...coast.mapEntries(), ...pickups.mapEntries()]);
  fuelBar.style.width = (tank.fuel / tank.max * 100).toFixed(0) + '%';
  fuelBar.style.background = tank.fuel < 25 ? '#ff5a4d' : '#ffd34d';
  turboBar.style.width = (turbo.charge * 100).toFixed(0) + '%';
  const bp = mission.bearingPoint();
  if (bp) {
    const ang = Math.atan2(bp.x - player.pos.x, bp.z - player.pos.z) - player.pos.yaw;
    tgtEl.style.transform = 'rotate(' + ang.toFixed(2) + 'rad)';
    const dTgt = Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z);
    const secs = pickups.caseSeconds();
    const lead = mission.state === 'travel' ? 'THE BRIDGE '
      : mission.state !== 'locate' ? ''
      : mission.lastSeen ? 'LAST SEEN ' : 'SEARCH ';
    tgtdEl.textContent = secs
      ? 'BRIEFCASE · ' + secs + 's'
      : lead + Math.round(dTgt) + 'm';
    tgtBox.style.opacity = mission.state === 'done' ? 0 : 1;
    tgtBox.style.color = mission.state === 'locate' ? '#ff9a8a' : '#ff5a4d';
  } else {
    tgtBox.style.opacity = 0.35;
    tgtEl.style.transform = 'none';
    tgtdEl.textContent = 'NO FIX';
  }

  // The armoured van gets its own arrow: amber, under the target line,
  // saying whether it is still rolling or already parked at the meet.
  if (mission.van && live) {
    const v = mission.van;
    const angV = Math.atan2(v.pos.x - player.pos.x, v.pos.z - player.pos.z)
      - player.pos.yaw;
    vanTgtEl.style.transform = 'rotate(' + angV.toFixed(2) + 'rad)';
    const dV = Math.round(Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z));
    const parked = Math.hypot(v.pos.x - mission.meet.x, v.pos.z - mission.meet.z) < 32
      && v.speed < 2;
    vandEl.textContent = (parked ? 'VAN AT THE MEET · ' : 'VAN · ') + dV + 'm';
    vanBoxEl.style.display = 'flex';
  } else {
    vanBoxEl.style.display = 'none';
  }

  // Below a quarter tank, the nearest pumps get a green arrow of their
  // own - the island's included, which matters mid-crossing.
  if (tank.low && live) {
    let bestSt = null, bd = 1e9;
    for (const st of cityBits.stations) {
      const d2 = Math.hypot(st.x - player.pos.x, st.z - player.pos.z);
      if (d2 < bd) { bd = d2; bestSt = st; }
    }
    if (bestSt) {
      const angF = Math.atan2(bestSt.x - player.pos.x, bestSt.z - player.pos.z)
        - player.pos.yaw;
      fuelTgtEl.style.transform = 'rotate(' + angF.toFixed(2) + 'rad)';
      fueldEl.textContent = 'PETROL · ' + Math.round(bd) + 'm';
      fuelBoxEl.style.display = 'flex';
    }
  } else {
    fuelBoxEl.style.display = 'none';
  }
};
scene.onBeforeRenderObservable.add(() =>
  tick(Math.min(0.05, engine.getDeltaTime() / 1000)));

// Handles for tests and the console.
// The handle tests and the console drive the game through. Everything a
// bot needs to play it without reaching into module scope.
window.game = {
  player, traffic, net, hud, tick, mission, coast, tiles, pickups,
  run, tank, turbo, garage, peds, signals, coast2, city: CITY, clean, stats, sound,
  air, weather, bumps: cityBits.bumps, roadworks: cityBits.roadworks,
  zones: cityBits.zones, districtAt: cityBits.districtAt,
  stations: cityBits.stations,
  nav: { nodeAhead, headingSlot, turnOptions },
};

// ---- the front door -----------------------------------------------------
// Two screens over the attract camera, in the first game's style: the
// title, then a menu - W/S chooses, A/D changes, Enter picks.
const menuEls = {
  prompt: document.getElementById('prompt'),
  menu: document.getElementById('menu'),
  hint: document.getElementById('hint'),
  panel: document.getElementById('panel'),
  town: document.getElementById('townline'),
};
const menuPrefs = { music: true };
let menuScreen = 'title';
let menuSel = 0;
let menuTyped = '';
// The handler's briefing: delivered the way a certain agency delivers
// them - measured, unhurried, and quietly certain you will manage.
const RULES_TEXT =
  'GOOD EVENING, DRIVER.\n\n' +
  'YOUR TARGET IS A BLACK COUPE, RUNNING COURIER WORK SOMEWHERE\n' +
  'IN THIS TOWN. THE RADIO WILL TELL YOU WHERE IT WAS LAST SEEN.\n' +
  'GO THERE. FIND IT. RAM IT OR SHOOT IT UNTIL IT STOPS MOVING.\n\n' +
  'BE ADVISED: FROM YOUR SECOND CONTRACT, AN ARMOURED VAN BRINGS\n' +
  'THE TARGET ITS DROP. TAKE THE VAN BEFORE THE MEETING — LET\n' +
  'THEM MEET, AND YOU WILL BE CHASING ARMOUR PLATE. THE CREWS\n' +
  'LEARN, TOO: THE FIRST SIT AND WAIT. LATER ONES RUN WHEN THEY\n' +
  'SEE YOU. THE LAST ONES COME FOR YOU.\n\n' +
  'A STOPPED COUPE GIVES UP ITS BRIEFCASE. RETRIEVE IT BEFORE\n' +
  'THE POLICE DO.\n\n' +
  'FROM YOUR THIRD CONTRACT YOU HAVE COMPETITION: A RIVAL HUNTER,\n' +
  'WHITE CAR, RED TRIM. THE AGENCY PAYS NOTHING FOR A MARK IT\n' +
  'STOPS FIRST. LATER, EXTRA RUNNERS FEED THE DROP — EACH ONE\n' +
  'STOPPED IS PAID, EACH ONE THROUGH HARDENS THE COUPE.\n\n' +
  'ON THE AUTHORITIES: THEY ACT ONLY ON WHAT THEY SEE. TRAFFIC\n' +
  'OFFENCES WILL COST YOU TWO STARS AT MOST. VIOLENCE COSTS MORE,\n' +
  'AND ONLY A KILLING BUYS ALL FIVE. AT THREE STARS THEY RAM, AND\n' +
  'WILL TAKE YOU WHERE YOU STAND. AT FOUR, THEY SHOOT.\n\n' +
  'SHOULD YOU ATTRACT ATTENTION, DISAPPEAR. LIE LOW — OR HAVE THE\n' +
  'CAR RESPRAYED WHERE NOBODY IN BLUE IS WATCHING. THE GREEN\n' +
  'SQUARES ARE GARAGES: PETROL, PAINT, PANEL WORK — AND PETROL\n' +
  'IS PRICED BY YOUR REPUTATION.\n\n' +
  'DRIVE CLEANLY AND YOU WILL BE PAID FOR IT. AND SHOULD YOU COME\n' +
  'ACROSS THE SIX CASSETTES — CONSIDER THEM A PERK OF THE TRADE.\n\n' +
  'ONE LAST THING. EIGHT CONTRACTS ACROSS THE FOUR TOWNS BUY YOU\n' +
  'THE FINAL JOB: THE PAYMASTER HIMSELF, RIDING THE RING ROAD\n' +
  'BEHIND HEAVY PLATE. END IT, AND THE COAST IS YOURS.\n\n' +
  'I WILL BE IN TOUCH. GOOD HUNTING.';
const CONTROLS_TEXT =
  'W/S DRIVE · A/D CHANGE LANE · Q/E INDICATE (HOLD FOR U-TURN)\n' +
  'HOLD S AT A STANDSTILL TO REVERSE · HOLD D TO PASS IN THE ONCOMING\n' +
  'H HONKS THE HORN · SPEED BUMPS AND WORKS PLANKS JUMP AT SPEED\n' +
  'SPACE FIRE · SHIFT TURBO · SLOW INTO A GARAGE SPUR TO BE SERVED\n' +
  'THE RING ROAD IS THE COAST — GO SEE IT\n\n' +
  'IN GAME: C CAMERA · G QUALITY · F REDUCED FLASHING\n' +
  'B COAST MOOD (NIGHT/DAY/SUNSET) · M MUSIC · X NEXT TRACK';
function fameText() {
  const t = loadScores();
  return t.length
    ? 'HALL OF FAME\n\n' + t.slice(0, 8).map((r, i) => `${i + 1}. ${r.n}  ${r.s}`).join('\n')
    : 'NO SCORES YET — BE FIRST';
}
function readSave() {
  try { return JSON.parse(localStorage.getItem('neoncity_save') || 'null'); }
  catch (e) { return null; }
}
function menuItems() {
  const items = [
    { id: 'drive', label: 'DRIVE', hint: 'find the black coupe · dodge the law' },
  ];
  const sv = readSave();
  if (sv && CITIES[sv.city]) {
    items.push({ id: 'continue', label: `CONTINUE  ·  ${CITIES[sv.city].name}`,
      hint: 'pick the campaign up at your last town arrival' });
  }
  items.push(
    { id: 'rules', label: 'THE BRIEFING', hint: 'your handler explains the job' },
    { id: 'town', label: `TOWN  <  ${CITY.name}  >`,
      hint: 'four towns, four maps — switching rebuilds the city' },
    { id: 'diff', label: `DIFFICULTY  <  ${DIFFS[diffIdx].name}  >`,
      hint: 'marks, police, bullets and petrol all scale' },
    { id: 'camera', label: `CAMERA  <  ${VIEWS[view].name}  >`,
      hint: 'chase · close · bonnet · far' },
    { id: 'graphics', label: `GRAPHICS  <  ${QNAME[scaleStep]}  >`,
      hint: 'eases off on its own when the frame rate sags' },
    { id: 'music', label: `MUSIC  <  ${menuPrefs.music ? 'ON' : 'OFF'}  >`,
      hint: 'the licensed tape deck · X skips in game' },
    { id: 'flash', label: `REDUCED FLASHING  <  ${safe.reduceFlash ? 'ON' : 'OFF'}  >`,
      hint: 'steadier lights for photosensitive players' },
    { id: 'controls', label: 'CONTROLS' },
    { id: 'fame', label: 'HALL OF FAME' },
  );
  return items;
}
function renderMenu() {
  const title = menuScreen === 'title';
  menuEls.town.textContent = title ? 'TOWN · ' + CITY.name : '';
  menuEls.prompt.style.display = title ? '' : 'none';
  menuEls.menu.style.display = title ? 'none' : '';
  if (title) { menuEls.hint.textContent = ''; menuEls.panel.textContent = ''; return; }
  const items = menuItems();
  menuEls.menu.textContent = '';
  items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'mi' + (i === menuSel ? ' sel' : '');
    d.textContent = i === menuSel ? `▸ ${it.label} ◂` : it.label;
    // Thumbs: a tap selects; a tap on the selected row picks it.
    d.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (menuSel === i) menuKey('Enter');
      else { menuSel = i; menuEls.panel.textContent = ''; renderMenu(); }
    });
    menuEls.menu.appendChild(d);
  });
  menuEls.hint.textContent = items[menuSel].hint || 'W/S CHOOSE · A/D CHANGE · ENTER PICKS · ESC BACK';
}
function menuAdjust(id, dir) {
  if (id === 'town') {
    // The city is baked at boot, so another seed means building it again
    // from the ground: the choice rides the hash through a reload.
    location.hash = 'city' + ((cityIdx + dir + CITIES.length) % CITIES.length);
    location.reload();
    return;
  }
  if (id === 'camera') cycleView(dir);
  else if (id === 'diff') {
    diffIdx = (diffIdx + dir + DIFFS.length) % DIFFS.length;
    try { localStorage.setItem('neoncity_diff', String(diffIdx)); }
    catch (e) { /* the choice just does not persist */ }
    mission.diff = DIFFS[diffIdx].v;
    mission.spawnTarget();           // reprice the waiting coupe at once
  }
  else if (id === 'graphics') { quality.manual = true; scaleStep = (scaleStep + dir + 4) % 4; applyQuality(); }
  else if (id === 'music') { menuPrefs.music = !menuPrefs.music; applyMusicPref(); }
  else if (id === 'flash') toggleFlash();
  menuEls.panel.textContent = '';
  renderMenu();
}
function applyMusicPref() {
  if (sound.started && sound.on !== menuPrefs.music) sound.toggle();
}
function startGame() {
  run.started = true;
  document.getElementById('intro').style.display = 'none';
  document.body.classList.remove('attract');   // the HUD comes back on
  if (touchDev) document.body.classList.add('touchmode');
  sound.start();
  applyMusicPref();
  mission.announce();
}
document.body.classList.add('attract');

// ---- thumbs on glass ----------------------------------------------------
// A phone has no Enter key. Every touch surface speaks the keyboard's
// language instead: taps on the menu are selections, the on-screen buttons
// dispatch the same KeyboardEvents the keys would, so indicators, U-turn
// holds and the camera cycle all come along for free.
let touchDev = false;
try { touchDev = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; }
catch (e) { /* no matchMedia, no touch */ }
if (touchDev) {
  document.getElementById('prompt').textContent = 'TAP TO START';
}
document.getElementById('intro').addEventListener('click', () => {
  if (!run.started && menuScreen === 'title') menuKey('Enter');
});
document.getElementById('over').addEventListener('click', () => {
  if (run.over) location.reload();
});
{
  const fake = (type, code) =>
    dispatchEvent(new KeyboardEvent(type, { code }));
  for (const b of document.querySelectorAll('#touch .tbtn')) {
    const code = b.dataset.k;
    const down = (ev) => { ev.preventDefault(); b.classList.add('on'); fake('keydown', code); };
    const up = (ev) => { ev.preventDefault(); b.classList.remove('on'); fake('keyup', code); };
    b.addEventListener('pointerdown', (ev) => { b.setPointerCapture(ev.pointerId); down(ev); });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
}

// ---- arriving from another town -----------------------------------------
// A hop record means this boot is the far side of a bridge: skip the front
// door, restore the run, and pick the trail up at the next contract.
{
  let packed = null;
  try {
    packed = sessionStorage.getItem('neoncity_hop');
    sessionStorage.removeItem('neoncity_hop');
  } catch (e) { /* blocked */ }
  if (!packed) {
    try { packed = localStorage.getItem('neoncity_hop'); } catch (e) { /* blocked */ }
  }
  try { localStorage.removeItem('neoncity_hop'); } catch (e) { /* blocked */ }
  if (!packed) {
    // Storage failed on the far side of the bridge: the hash carried it.
    const mh = /city\d\.([A-Za-z0-9+/=]+)/.exec(location.hash || '');
    if (mh) packed = mh[1];
  }
  let hop = null;
  if (packed) {
    try { hop = JSON.parse(atob(packed)); }
    catch (e) {
      try { hop = JSON.parse(packed); } catch (e2) { /* not a hop record */ }
    }
  }
  if (hop) {
    // Strip the payload off the hash so a manual refresh replays cleanly.
    try {
      history.replaceState(null, '', location.pathname + location.search + '#city' + cityIdx);
    } catch (e) { /* sandboxed history: the payload just stays */ }
    run.score = hop.score || 0;
    run.health = hop.health ?? 100;
    run.time = hop.time || 0;
    Object.assign(upgrades, hop.upgrades || {});
    tank.max = hop.tankMax || (upgrades.tank ? 135 : 100);
    // You fuelled up on the way over. Arriving in a strange town with a
    // dry tank and no idea where the garages are is nobody's idea of fun.
    tank.fuel = tank.max;
    Object.assign(stats, hop.stats || {});
    resprayIdx = hop.resprayIdx || 0;
    const [, col] = RESPRAY[resprayIdx];
    playerCar.paint.albedoColor.copyFrom(col);
    playerCar.paint.emissiveColor.copyFrom(col.scale(0.16));
    mission.level = hop.level || 1;
    mission.spawnTarget();
    startGame();
    bigWord(CITY.name, 'FUELLED UP ON THE WAY · THE TRAIL PICKS UP HERE');
    // A town arrival is the campaign's checkpoint: CONTINUE on the menu
    // picks up from here even after a bust or a closed tab.
    try {
      localStorage.setItem('neoncity_save',
        JSON.stringify({ city: cityIdx, packed }));
    } catch (e) { /* no persistence: CONTINUE just will not appear */ }
  }
}
// Music as early as the browser will let it happen: an autoplay attempt on
// load (some browsers permit it), and a retry on the very first gesture of
// any kind - key, mouse or touch - which unsticks whatever was held back.
function tryMusic() {
  if (!menuPrefs.music) return;
  if (!sound.started) sound.start();
  sound.resume();
}
tryMusic();
for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
  addEventListener(ev, tryMusic, { capture: true });
}

function menuKey(code) {
  // Codewords typed anywhere on the front door. The decade obliges.
  if (/^Key[A-Z]$/.test(code)) {
    menuTyped = (menuTyped + code[3]).slice(-8);
    if (!egg.lotus && menuTyped.endsWith('TURBO')) {
      egg.lotus = true;
      playerCar.paint.albedoColor.set(0.92, 0.92, 0.95);
      playerCar.paint.emissiveColor.set(0.16, 0.16, 0.17);
      bigWord('TURBO', 'THE WHITE LOTUS · QUICKER SPOOL');
      return;
    }
    if (!egg.kitt && menuTyped.endsWith('KITT')) {
      egg.kitt = true;
      kittBar.setEnabled(true);
      bigWord('KITT', 'ONE MAN CAN MAKE A DIFFERENCE');
      return;
    }
    if (!egg.outrun && menuTyped.endsWith('OUTRUN')) {
      egg.outrun = true;
      coast2.mode = 'sunset';
      setCoastSky();
      vibeStep = -1;
      bigWord('OUTRUN', 'MAGICAL SOUND SHOWER — SUNSET ON THE COAST');
      return;
    }
    if (!egg.vhs && menuTyped.endsWith('VHS')) {
      egg.vhs = true;
      document.body.classList.add('vhs');
      bigWord('VHS', 'BE KIND · REWIND');
      return;
    }
    if (!egg.goonies && menuTyped.endsWith('GOONIES')) {
      egg.goonies = true;
      pickups.buryTreasure(player);
      bigWord('NEVER SAY DIE', 'X MARKS THE RICH STUFF — CHECK THE MAP');
      return;
    }
  }
  if (menuScreen === 'title') {
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      menuScreen = 'menu'; menuSel = 0; renderMenu();
    }
    return;
  }
  const items = menuItems();
  if (code === 'ArrowUp' || code === 'KeyW') {
    menuSel = (menuSel + items.length - 1) % items.length;
    menuEls.panel.textContent = ''; renderMenu();
  } else if (code === 'ArrowDown' || code === 'KeyS') {
    menuSel = (menuSel + 1) % items.length;
    menuEls.panel.textContent = ''; renderMenu();
  } else if (code === 'ArrowLeft' || code === 'KeyA') menuAdjust(items[menuSel].id, -1);
  else if (code === 'ArrowRight' || code === 'KeyD') menuAdjust(items[menuSel].id, 1);
  else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
    const id = items[menuSel].id;
    if (id === 'drive') startGame();
    else if (id === 'continue') {
      const sv = readSave();
      if (sv && CITIES[sv.city]) {
        location.hash = 'city' + sv.city + '.' + sv.packed;
        location.reload();
      }
    }
    else if (id === 'rules') menuEls.panel.textContent = RULES_TEXT;
    else if (id === 'controls') menuEls.panel.textContent = CONTROLS_TEXT;
    else if (id === 'fame') menuEls.panel.textContent = fameText();
    else menuAdjust(id, 1);
  } else if (code === 'Escape') { menuScreen = 'title'; renderMenu(); }
}
renderMenu();

// The horn: pedestrians mid-road hurry up, and the car dawdling ahead in
// your lane tucks over a lane if it has one. Tiny, tactile, very 1986.
function hornBlast() {
  sound.horn();
  for (const q of peds.list) {
    if (q.state !== 'cross') continue;
    const qp = peds.posOf(q);
    if (Math.hypot(qp.x - player.pos.x, qp.z - player.pos.z) < 22) {
      q.speed = Math.max(q.speed, 2.6);
    }
  }
  for (const d of traffic) {
    if (d.mode !== 'edge' || d.e !== player.e || d.dir !== player.dir) continue;
    const gap = (d.s - player.s) * player.dir;
    if (gap > 0 && gap < 30 && d.lane < d.lanesPer() - 1) {
      d.lane += 1;
      d.lat -= CLASSES[d.e.cls].laneW;
    }
  }
}

function cycleView(dir) {
  view = (view + dir + VIEWS.length) % VIEWS.length;
  cam.fov = VIEWS[view].fov;
  // From the bonnet you are the car, so the car itself gets out of the way.
  playerCar.root.setEnabled(VIEWS[view].name !== 'BONNET');
  if (run.started) hud.say('CAMERA · ' + VIEWS[view].name);
}
function toggleFlash() {
  safe.reduceFlash = !safe.reduceFlash;
  hud.reduceFlash = safe.reduceFlash;
  vibeStep = -1;                       // forces the fog to be re-applied
  applyQuality();
  if (run.started) hud.say(safe.reduceFlash ? 'REDUCED FLASHING — ON' : 'REDUCED FLASHING — OFF');
}

addEventListener('keydown', (e) => {
  if (!run.started) { menuKey(e.code); return; }
  if (e.code === 'KeyM' && sound.started) {
    hud.say(sound.toggle() ? 'SOUND ON' : 'SOUND OFF');
  }
  if (e.code === 'KeyX' && sound.started) sound.next();
  if (e.code === 'KeyF') toggleFlash();
  if (e.code === 'KeyB') {
    coast2.mode = coast2.mode === 'off' ? 'day'
      : coast2.mode === 'day' ? 'sunset' : 'off';
    setCoastSky();
    vibeStep = -1;                     // re-applies fog/exposure at once
    hud.say('COAST — ' + (coast2.mode === 'off' ? 'NEON NIGHT'
      : coast2.mode === 'day' ? 'DAYLIGHT' : 'SUNSET'));
  }
  if (e.code === 'KeyC') cycleView(1);
  if (e.code === 'KeyH' && !e.repeat) hornBlast();
  // Parked and serviced: the workshop sells go-faster parts for score.
  if (garage.at && garage.stage >= SERVICE.length) {
    if (e.code === 'Digit1') buyUpgrade('tank');
    if (e.code === 'Digit2') buyUpgrade('plate');
    if (e.code === 'Digit3') buyUpgrade('turbo');
  }
  if (e.code === 'KeyG') {
    quality.manual = true;
    scaleStep = (scaleStep + 1) % 4;
    applyQuality();
    hud.say('GRAPHICS · ' + QNAME[scaleStep]);
  }
});

// Auto quality: when the frame rate sags, render smaller and stretch -
// the neon look survives a soft frame far better than a 9 fps one.
// Three rungs, because a fill-bound frame is not only about resolution: the
// grain and the chromatic aberration are two more full-screen passes, and
// on a struggling machine they cost more than they are worth.
// MEDIUM by default: softer, less busy, and the look preferred over the
// full-fat rung. The ladder may drop below it on a struggling machine and
// climb back to it, but only G takes it above.
const AUTO_BEST = 2;
let scaleStep = AUTO_BEST, scaleGoodT = 0, scaleBadT = 0;
// G pins a rung by hand. Once you have pinned one the ladder stops moving,
// so what you chose is what you get.
const quality = { manual: false };
const applyQuality = () => {
  engine.setHardwareScalingLevel(1 + scaleStep * 0.4);
  drawRange = DRAW_RANGE[scaleStep];
  // Pull the haze in with the draw range so the edge of the world stays
  // hidden rather than becoming a line of towers popping in.
  fogScale = 820 / drawRange;
  vibeStep = -1;
  // FXAA stays on when reduced flashing is asked for: smoothing sub-pixel
  // edges is exactly what stops thin bright lines strobing.
  pipe.fxaaEnabled = safe.reduceFlash || scaleStep < 3;
  pipe.grainEnabled = !safe.reduceFlash && scaleStep < 2;
  pipe.chromaticAberrationEnabled = scaleStep < 2;
  // The two most expensive things in the frame, shed last: at the bottom
  // rung the bloom carries the neon on its own.
  glowLayer.intensity = scaleStep >= 2 ? 0.35 : 0.55;
  glowLayer.isEnabled = scaleStep < 3;
  pipe.bloomWeight = scaleStep >= 3 ? 0.55 : 0.4;
};
setInterval(() => {
  if (quality.manual) return;
  const f = engine.getFps();
  if (f < 26 && scaleStep < 3) {
    scaleBadT += 0.5;
    if (scaleBadT > 1.5) {
      scaleStep++; scaleBadT = 0; scaleGoodT = 0;
      applyQuality();
      hud.say('PERFORMANCE MODE — RESOLUTION EASED');
    }
  } else if (f > 52 && scaleStep > AUTO_BEST) {
    scaleGoodT += 0.5;
    if (scaleGoodT > 6) {
      scaleStep--; scaleGoodT = 0;
      applyQuality();
      if (scaleStep === AUTO_BEST) hud.say('QUALITY RESTORED — ' + QNAME[scaleStep]);
    }
  } else { scaleBadT = 0; }
}, 500);

// If the browser already said this viewer wants reduced motion, honour it
// from the first frame rather than waiting for someone to press F.
hud.reduceFlash = safe.reduceFlash;
applyQuality();
rollWeather(false);                  // the town decides its own first sky

const fpsEl = document.getElementById('fps');
const cueLEl = document.getElementById('cueL');
const cueREl = document.getElementById('cueR');
const vanBoxEl = document.getElementById('vanbox');
const vanTgtEl = document.getElementById('vantgt');
const vandEl = document.getElementById('vand');
const fuelBoxEl = document.getElementById('fuelbox');
const fuelTgtEl = document.getElementById('fueltgt');
const fueldEl = document.getElementById('fueld');
const touchQ = document.getElementById('tQ');
const touchE = document.getElementById('tE');
const fuelBar = document.getElementById('fuel');
const turboBar = document.getElementById('turbo');
const tgtEl = document.getElementById('tgt');
const tgtdEl = document.getElementById('tgtd');
const tgtBox = document.getElementById('tgtbox');
const starsEl = document.getElementById('stars');
const whyEl = document.getElementById('whywanted');
const scoreEl = document.getElementById('score');
const healthBar = document.getElementById('health');
// The counter says what KIND of slow it is, not just that it is slow: draw
// calls and active meshes point at the CPU, the render scale at the pixels.
const QNAME = ['HIGH', 'HIGH−', 'MED', 'LOW'];
let lastDraws = 0, prevDrawCount = 0;
scene.onAfterRenderObservable.add(() => {
  const c = engine._drawCalls ? engine._drawCalls.current : 0;
  lastDraws = c - prevDrawCount; prevDrawCount = c;
});
setInterval(() => {
  if (egg.vhs) {
    const t = Math.floor(run.time);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    document.getElementById('vhstime').textContent =
      `SP 0:${mm}:${ss} · MAY 08 1986`;
  }
  const f = engine.getFps();
  fpsEl.textContent = f.toFixed(0) + ' FPS  ' + lastDraws + ' DRAW  ' +
    scene.getActiveMeshes().length + ' MESH  ' + QNAME[scaleStep] +
    (quality.manual ? ' (G)' : '');
  fpsEl.style.color = f > 50 ? '#7dfcf3' : f > 30 ? '#ffd34d' : '#ff5a4d';
}, 400);

engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
scene.executeWhenReady(() => {
  report('');
  setTimeout(() => { window.ready = true; }, 400);
});
