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

const cityBits = buildCity(scene, net, mirror);
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
                         'cone', 'barr', 'pole', 'dk', 'prp', 'dd', 'pier',
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
// One cylinder, not four walls: a box of sky planes has four corners, and
// out on the open coast where nothing occludes the horizon you can see
// every one of them as a hard vertical seam. A cylinder has none, is one
// mesh instead of four, and takes the same gradient.
const daySkies = [];
{
  const p = MeshBuilder.CreateCylinder('dsky', {
    diameter: 2560, height: 820, tessellation: 40,
    cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE,
  }, scene);
  p.position.set(mid, 270, mid);
  const dm = new StandardMaterial('dskym', scene);
  dm.emissiveTexture = coastSkyTexture();
  dm.disableLighting = true;
  dm.fogEnabled = false;
  p.material = dm;
  p.visibility = 0;
  p.setEnabled(false);
  daySkies.push(p);
}
let vibe = 0;
let vibeStep = 0;
// The coast used to turn to daylight when you got on the ring road. It is
// off by default now because it was suspected of costing frames. Measured
// here it is worth two to four per cent of a coast frame - which is not
// much - so B puts it back, and the honest way to settle it is to fly the
// coast with it on and off and read the counter.
const coast2 = { daylight: false };

// The run: score, health, and how it ends.
const run = { score: 0, health: 100, over: false, reason: '', time: 0, started: false, saved: false };
const playerPrev = { e: null, dir: 0, s: 0 };
let speedTattleT = 0;
mission.onScore = (n) => { run.score += n; };
coast.onScore = (n) => { run.score += n; };
// Pickups: the tape deck and the briefcase.
pickups.onCassette = (left) => {
  run.score += 120;
  sound.next();
  hud.say(left ? `CASSETTE FOUND · +120 · ${left} STILL OUT THERE`
                : 'EVERY CASSETTE FOUND · +120 · SIDE B FOREVER', true);
};
pickups.onCase = () => {
  run.score += 250;
  sound.chime();
  hud.say('BRIEFCASE RECOVERED · +250', true);
};
pickups.onCaseLost = () => hud.say('THE LAW GOT TO THE BRIEFCASE FIRST');
mission.onDrop = (x, y, z) => pickups.dropCase(x, y, z);
// A fresh six every level, somewhere new.
mission.onLevel = (level) => pickups.scatter(level);

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
  consider(T, T.pos.x, T.pos.z, 'target', T.pos.y);
  if (mission.van) {
    const V = mission.van;
    consider(V, V.pos.x, V.pos.z, 'van', V.pos.y);
  }
  for (const p of mission.police) consider(p, p.pos.x, p.pos.z, 'police', p.pos.y);
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
  if (mission.van) everyone.push(mission.van);
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
          if (a === player || b === player) {
            // Who ran into whom matters: at three stars the police ram you
            // on purpose, and every one of those was being booked as your
            // assault, which walked you to four stars and a shooting in
            // under a minute for doing nothing.
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
// wants that; the sky walls, the ridges and the beach do not - they are the
// four biggest surfaces in the game and they were being drawn a second time,
// full screen, every frame. Their emissive is flat lift, not neon.
for (const p of [...nightSkies, ...daySkies]) glowLayer.addExcludedMesh(p);
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
    tank.fuel = Math.min(100, tank.fuel + 34 * dt);
    done = tank.fuel > 99.5;
  } else if (job.key === 'paint') {
    garage.t += dt;
    if (garage.t > job.secs) {
      // The respray only fools the police if nobody in blue is watching -
      // but the paint is fresh either way, and it is a different colour,
      // because a car that goes into a paint shop and comes out the same
      // shade has not been resprayed.
      const fooled = mission.tryDisguise(player, clock);
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
    hud.say(job.say + '…');
  }
  if (done) {
    garage.stage += 1;
    garage.t = 0;
    if (garage.stage >= SERVICE.length) {
      sound.chime();
      hud.say('ALL DONE — HOLD THE INDICATOR TO SWING HER ROUND', true);
    }
  }
}

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

  updateGarage(dt, clock);
  signpostGarage(dt);

  playerCar.root.position.set(player.pos.x, player.pos.y, player.pos.z);
  playerCar.root.rotation.y = player.pos.yaw;
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
    const victim = player.pos.y < 2 ? peds.hitCheck(player.pos.x, player.pos.z) : null;
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
      mission.witnessed('redLight', player, true);
    }
    playerPrev.e = player.e; playerPrev.dir = player.dir; playerPrev.s = player.s;
  }
  // Speeding right past a cruiser is a star on its own.
  if (player.speed > CLASSES[player.e.cls].limit * 1.5 &&
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
      player.speed *= Math.max(0, 1 - 2.4 * dt);
      shake = Math.max(shake, 0.25);
    }
  }

  // AI shots land as health damage, dodgeable by speed.
  // In the garage you are off the board: the doors are shut, and a
  // gunfight in a paint shop is nobody's idea of a good time.
  mission.playerSafe = !!garage.at;
  mission.update(dt, player, clock);
  for (const sh of mission.shots) {
    showTracer(sh.from.x, sh.from.z, sh.to.x, sh.to.z, player.pos.y + 0.9);
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

  updateCamera(dt);
  // The car paint's planar reflection is worth its cost among neon towers.
  // Out on the ring it reflects sky and sea, so it can crawl - and that is
  // true whether or not the coast is in daylight.
  {
    const want = (player.e && player.e.cls === 'highway') ? 4 : 2;
    if (mirror.refreshRate !== want) mirror.refreshRate = want;
  }

  // ---- the morph: city night <-> coast daylight ------------------------
  const wantVibe = (coast2.daylight && player.e && player.e.cls === 'highway') ? 1
    : (player.mode === 'turn' ? vibe : 0);
  vibe += (wantVibe - vibe) * Math.min(1, dt * 0.55);
  // An exponential fade never arrives, so snap the last hair of it. Without
  // this the coast sits at vibe 0.999... forever and everything below keeps
  // being treated as a change.
  if (Math.abs(wantVibe - vibe) < 0.005) vibe = wantVibe;
  // Free per frame: these are plain uniforms, nothing downstream rebuilds.
  hemi.intensity = 0.22 + vibe * 0.5;
  hemi.diffuse.set(0.45 + vibe * 0.3, 0.35 + vibe * 0.37, 0.75 + vibe * 0.1);
  hemi.groundColor.set(0.05 + vibe * 0.3, 0.02 + vibe * 0.26, 0.1 + vibe * 0.1);
  scene.clearColor.set(0.012 + vibe * 0.09, 0.006 + vibe * 0.31,
                       0.035 + vibe * 0.52, 1);
  sunM.emissiveColor.set(1 + vibe * 0.25, 1 + vibe * 0.05, 1 - vibe * 0.25);
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
    scene.fogColor.set(0.05 + v * 0.36, 0.03 + v * 0.47, 0.11 + v * 0.52);
    scene.fogDensity = (0.0017 - v * 0.0006) * fogScale * (safe.reduceFlash ? 1.6 : 1);
    pipe.imageProcessing.exposure = 1.05 + v * 0.22;
    pipe.imageProcessing.contrast = 1.3 - v * 0.12;

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
  pickups.update(dt, player);
  updateDistricts(player.pos.x, player.pos.z);
  coast.update(dt, player, clock, mission.wanted);
  sound.update(dt, Math.min(1, player.speed / 55), turbo.active, mission.wanted > 0);

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
  starsEl.textContent = mission.wanted > 0 ? '★'.repeat(mission.wanted) : '';
  // Say what the stars are FOR, for as long as you have them.
  whyEl.textContent = mission.wanted > 0 ? (mission.lastReason || '') : '';
  scoreEl.textContent = String(Math.round(run.score)).padStart(6, '0');
  healthBar.style.width = Math.max(0, run.health) + '%';

  hud.update(dt, player, [...traffic, ...mission.mapEntries(),
                          ...coast.mapEntries(), ...pickups.mapEntries()]);
  fuelBar.style.width = tank.fuel.toFixed(0) + '%';
  fuelBar.style.background = tank.fuel < 25 ? '#ff5a4d' : '#ffd34d';
  turboBar.style.width = (turbo.charge * 100).toFixed(0) + '%';
  const bp = mission.bearingPoint();
  if (bp) {
    const ang = Math.atan2(bp.x - player.pos.x, bp.z - player.pos.z) - player.pos.yaw;
    tgtEl.style.transform = 'rotate(' + ang.toFixed(2) + 'rad)';
    const dTgt = Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z);
    const secs = pickups.caseSeconds();
    const van = mission.van
      ? ' · VAN ' + Math.round(Math.hypot(mission.van.pos.x - player.pos.x,
                                          mission.van.pos.z - player.pos.z)) + 'm'
      : '';
    const lead = mission.state !== 'locate' ? ''
      : mission.lastSeen ? 'LAST SEEN ' : 'SEARCH ';
    tgtdEl.textContent = secs
      ? 'BRIEFCASE · ' + secs + 's'
      : lead + Math.round(dTgt) + 'm' + van;
    tgtBox.style.opacity = mission.state === 'done' ? 0 : 1;
    tgtBox.style.color = mission.state === 'locate' ? '#ff9a8a' : '#ff5a4d';
  } else {
    tgtBox.style.opacity = 0.35;
    tgtEl.style.transform = 'none';
    tgtdEl.textContent = 'NO FIX';
  }
};
scene.onBeforeRenderObservable.add(() =>
  tick(Math.min(0.05, engine.getDeltaTime() / 1000)));

// Handles for tests and the console.
// The handle tests and the console drive the game through. Everything a
// bot needs to play it without reaching into module scope.
window.game = {
  player, traffic, net, hud, tick, mission, coast, tiles, pickups,
  run, tank, turbo, garage, peds, signals, coast2,
  zones: cityBits.zones, districtAt: cityBits.districtAt,
  stations: cityBits.stations,
  nav: { nodeAhead, headingSlot, turnOptions },
};

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
    'THE RING ROAD IS THE COAST — GO SEE IT\n' +
    'M MUSIC · X TRACK · C CAMERA · B COAST DAYLIGHT · G GRAPHICS · F FLASHING\n\n' + rows;
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
  if (e.code === 'KeyF') {
    safe.reduceFlash = !safe.reduceFlash;
    hud.reduceFlash = safe.reduceFlash;
    vibeStep = -1;                       // forces the fog to be re-applied
    applyQuality();
    hud.say(safe.reduceFlash ? 'REDUCED FLASHING — ON' : 'REDUCED FLASHING — OFF');
  }
  if (e.code === 'KeyB') {
    coast2.daylight = !coast2.daylight;
    hud.say(coast2.daylight ? 'COAST DAYLIGHT — ON' : 'COAST DAYLIGHT — OFF (NEON)');
  }
  if (e.code === 'KeyC') {
    view = (view + 1) % VIEWS.length;
    cam.fov = VIEWS[view].fov;
    // From the bonnet you are the car, so the car itself gets out of the way.
    playerCar.root.setEnabled(VIEWS[view].name !== 'BONNET');
    hud.say('CAMERA · ' + VIEWS[view].name);
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

const fpsEl = document.getElementById('fps');
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
