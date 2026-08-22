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
for (const [rx, rz, ry] of [[mid, mid + 1250, 0], [mid, mid - 1250, Math.PI],
                            [mid + 1250, mid, -Math.PI / 2], [mid - 1250, mid, Math.PI / 2]]) {
  const p = MeshBuilder.CreatePlane('sky', { width: 3400, height: 800 }, scene);
  p.position.set(rx, 260, rz);
  p.rotation.y = ry;
  const m = new StandardMaterial('skym', scene);
  m.emissiveTexture = skyTexture(); m.disableLighting = true;
  p.material = m;
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
  }
}

// ------------------------------------------------------------- the city ----
const mirror = new MirrorTexture('mir', 1024, scene, true);
mirror.mirrorPlane = new Plane(0, -1, 0, 0);
mirror.level = 0.8;
mirror.renderList.push(sun);

buildCity(scene, net, mirror);
report('city built — starting traffic…');

// ------------------------------------------------------------- vehicles ----
function buildCar(paintCol, taillit) {
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
const playerCar = buildCar(new Color3(0.55, 0.02, 0.03), true);

// Ambient traffic: the same Driver, piloted by ten lines of AI. This is the
// exact code path the target car and the police will use.
const TRAFFIC_COLOURS = [
  new Color3(0.08, 0.15, 0.5), new Color3(0.4, 0.35, 0.05),
  new Color3(0.3, 0.05, 0.35), new Color3(0.06, 0.3, 0.25),
  new Color3(0.35, 0.35, 0.38), new Color3(0.45, 0.12, 0.05),
];
const traffic = [];
for (let k = 0; k < 14; k++) {
  const e = net.edges[(k * 37) % net.edges.length];
  const lane = k % CLASSES[e.cls].lanesPer;
  const d = new Driver(net, e, k % 2 ? 1 : -1, lane, (k * 19) % Math.max(24, e.len - 12));
  d.ai = { nextThink: 2 + k, cruise: 0.5 + (k % 5) * 0.09 };
  d.car = buildCar(TRAFFIC_COLOURS[k % TRAFFIC_COLOURS.length], true);
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
           maxSpeed: CLASSES[d.e.cls].limit * a.cruise };
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
  if (e.code === 'KeyQ') player.intent = player.intent === 'left' ? 'straight' : 'left';
  if (e.code === 'KeyE') player.intent = player.intent === 'right' ? 'straight' : 'right';
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// -------------------------------------------------------------- the loop ----
const hud = new Hud(net);
let clock = 0;
hud.say('NEON CITY — Q/E indicate, junctions drive themselves', true);
setTimeout(() => hud.say(''), 6000);

const tick = (dt) => {
  clock += dt;

  const throttle = (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0;
  const steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + ((keys.KeyD || keys.ArrowRight) ? -1 : 0);
  player.update(dt, { throttle, steer, maxSpeed: CLASSES[player.e.cls].limit * 2.2 });

  playerCar.root.position.set(player.pos.x, 0, player.pos.z);
  playerCar.root.rotation.y = player.pos.yaw;
  const blink = Math.sin(clock * 9) > 0;
  playerCar.indL.setEnabled(player.indicator === -1 && blink);
  playerCar.indR.setEnabled(player.indicator === 1 && blink);

  for (const d of traffic) {
    d.update(dt, aiInput(d, dt, clock));
    d.car.root.position.set(d.pos.x, 0, d.pos.z);
    d.car.root.rotation.y = d.pos.yaw;
    const b2 = Math.sin(clock * 9 + d.ai.cruise * 20) > 0;
    d.car.indL.setEnabled(d.indicator === -1 && b2);
    d.car.indR.setEnabled(d.indicator === 1 && b2);
  }

  // Chase camera: behind and above, leaning with speed, looking through.
  const back = 8.4 + player.speed * 0.16;
  const cx = player.pos.x - Math.sin(player.pos.yaw) * back;
  const cz = player.pos.z - Math.cos(player.pos.yaw) * back;
  const k = Math.min(1, dt * 5.5);
  cam.position.x += (cx - cam.position.x) * k;
  cam.position.z += (cz - cam.position.z) * k;
  cam.position.y += (4.4 + player.speed * 0.05 - cam.position.y) * k;
  cam.setTarget(new Vector3(
    player.pos.x + Math.sin(player.pos.yaw) * 7,
    1.2,
    player.pos.z + Math.cos(player.pos.yaw) * 7));

  hud.update(dt, player, traffic);
};
scene.onBeforeRenderObservable.add(() =>
  tick(Math.min(0.05, engine.getDeltaTime() / 1000)));

// Handles for tests and the console.
window.game = { player, traffic, net, hud, tick };

engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
scene.executeWhenReady(() => {
  report('');
  setTimeout(() => { window.ready = true; }, 400);
});
