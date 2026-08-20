import { Mesh } from '@babylonjs/core/Meshes/mesh';
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
// NEON DRIVE // 2 — engine tech demo.
//
// The sequel experiment: same fantasy, different engine. Babylon.js gives us
// the things the hand-rolled WebGL2 renderer fakes — a true planar mirror in
// the road, PBR paint, a glow layer — and this demo exists to find out what
// they are worth before any real commitment. It is a drive, not a game:
// an endless highway, palms, towers, the banded sun, and a car that answers
// the same W/A/S/D as Neon Drive 1.
'use strict';

const canvas = document.getElementById('c');
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.012, 0.006, 0.035, 1);

const cam = new FreeCamera('cam', new Vector3(0, 4.6, -11), scene);
cam.rotation.x = 0.10;
cam.fov = 0.95;

const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.22;
hemi.diffuse = new Color3(0.45, 0.35, 0.75);
hemi.groundColor = new Color3(0.05, 0.02, 0.1);

// ------------------------------------------------------------ textures ----
function windowTexture() {
  const dt = new DynamicTexture('win', { width: 256, height: 512 }, scene, true);
  const x = dt.getContext();
  x.fillStyle = '#05050a'; x.fillRect(0, 0, 256, 512);
  for (let r = 0; r < 24; r++) for (let c2 = 0; c2 < 8; c2++) {
    if (Math.random() < 0.6) continue;
    x.fillStyle = Math.random() < 0.8 ? '#ffd9a0' : '#9fd8ff';
    x.fillRect(c2 * 32 + 9, r * 21 + 5, 16, 11);
  }
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
  dt.update();
  dt.hasAlpha = true;
  return dt;
}
function ridgeTexture(seed, dark) {
  const dt = new DynamicTexture('ridge' + seed, { width: 1024, height: 256 }, scene, true);
  const x = dt.getContext();
  x.clearRect(0, 0, 1024, 256);
  x.fillStyle = dark;
  x.beginPath();
  x.moveTo(0, 256);
  for (let px = 0; px <= 1024; px += 8) {
    const t = px / 1024 * Math.PI * 2;
    const h = 120 + Math.sin(t * 3.1 + seed) * 45 + Math.sin(t * 7.3 + seed * 2.7) * 26
                  + Math.sin(t * 13.7 + seed * 5.1) * 14;
    x.lineTo(px, 256 - h);
  }
  x.lineTo(1024, 256);
  x.closePath(); x.fill();
  dt.update();
  dt.hasAlpha = true;
  return dt;
}
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
function palmTexture() {
  const dt = new DynamicTexture('palm', { width: 256, height: 512 }, scene, true);
  const x = dt.getContext();
  x.clearRect(0, 0, 256, 512);
  x.strokeStyle = '#0a0512'; x.lineWidth = 14; x.lineCap = 'round';
  x.beginPath(); x.moveTo(120, 512); x.quadraticCurveTo(150, 300, 138, 170); x.stroke();
  x.lineWidth = 9;
  for (let i = 0; i < 7; i++) {
    const a = -2.6 + i * 0.75;
    x.beginPath(); x.moveTo(138, 170);
    x.quadraticCurveTo(138 + Math.cos(a) * 70, 170 + Math.sin(a) * 50 - 30,
                       138 + Math.cos(a) * 120, 170 + Math.sin(a) * 85 + 8);
    x.stroke();
  }
  dt.update();
  dt.hasAlpha = true;
  return dt;
}

// -------------------------------------------------------------- backdrop ----
const skyP = MeshBuilder.CreatePlane('sky', { width: 2600, height: 700 }, scene);
skyP.position.set(0, 240, 900);
const skyM = new StandardMaterial('skym', scene);
skyM.emissiveTexture = skyTexture(); skyM.disableLighting = true;
skyP.material = skyM;

const sun = MeshBuilder.CreatePlane('sun', { size: 340 }, scene);
sun.position.set(0, 120, 860);
const sunM = new StandardMaterial('sunm', scene);
sunM.emissiveTexture = sunTexture(); sunM.opacityTexture = sunM.emissiveTexture;
sunM.disableLighting = true;
sun.material = sunM;

for (const [seed, z, y, col] of [[1.7, 820, 55, '#241040'], [4.2, 780, 40, '#160a2b']]) {
  const r = MeshBuilder.CreatePlane('r' + z, { width: 2400, height: 170 }, scene);
  r.position.set(0, y, z);
  const m = new StandardMaterial('rm' + z, scene);
  m.emissiveTexture = ridgeTexture(seed, col); m.opacityTexture = m.emissiveTexture;
  m.disableLighting = true;
  r.material = m;
}

// ------------------------------------------------------------ the road ----
const ROADW = 22, VIEW = 460;
const ground = MeshBuilder.CreateGround('g', { width: 260, height: VIEW + 80 }, scene);
ground.position.z = VIEW / 2 - 40;
const gm = new PBRMaterial('gm', scene);
gm.albedoColor = new Color3(0.012, 0.012, 0.022);
gm.metallic = 0.8; gm.roughness = 0.3;
const mirror = new MirrorTexture('mir', 1024, scene, true);
mirror.mirrorPlane = new Plane(0, -1, 0, 0);
mirror.level = 0.85;
gm.reflectionTexture = mirror;
ground.material = gm;
mirror.renderList.push(sun, skyP);

const neonMat = (r, g2, b) => {
  const m = new StandardMaterial('nm', scene);
  m.emissiveColor = new Color3(r, g2, b);
  m.disableLighting = true;
  return m;
};
const cyan = neonMat(0.15, 1.05, 1.5), pink = neonMat(1.5, 0.2, 0.95),
      amber = neonMat(1.5, 0.75, 0.1), red = neonMat(1.7, 0.07, 0.05),
      white = neonMat(1.2, 1.15, 1.05);

// Everything that streams past lives in `movers` and wraps around VIEW.
const movers = [];
function mover(mesh, respawn) { movers.push({ mesh, respawn }); return mesh; }

// Edge neon: long pieces so the line reads continuous.
for (let z = 0; z < VIEW; z += 46) {
  for (const sd of [-1, 1]) {
    const p = MeshBuilder.CreateBox('e', { width: 0.22, height: 0.06, depth: 46 }, scene);
    p.position.set(sd * (ROADW / 2), 0.03, z + 23);
    p.material = cyan; mover(p); mirror.renderList.push(p);
  }
  const c2 = MeshBuilder.CreateBox('cl', { width: 0.16, height: 0.06, depth: 46 }, scene);
  c2.position.set(0, 0.03, z + 23);
  c2.material = pink; mover(c2); mirror.renderList.push(c2);
}
// Lane dashes.
for (let z = 0; z < VIEW; z += 14) {
  for (const sd of [-1, 1]) {
    const d = MeshBuilder.CreateBox('d', { width: 0.24, height: 0.055, depth: 3.4 }, scene);
    d.position.set(sd * (ROADW / 4), 0.028, z);
    d.material = amber; mover(d); mirror.renderList.push(d);
  }
}
// Palms, alternating with towers beyond them.
const palmTex = palmTexture();
for (let z = 0; z < VIEW; z += 38) {
  for (const sd of [-1, 1]) {
    const pl = MeshBuilder.CreatePlane('p', { width: 9, height: 18 }, scene);
    pl.position.set(sd * (ROADW / 2 + 6 + Math.random() * 3), 9, z + (sd > 0 ? 19 : 0));
    const m = new StandardMaterial('pm', scene);
    m.emissiveTexture = palmTex; m.opacityTexture = palmTex;
    m.emissiveColor = new Color3(0.35, 0.9, 0.85);
    m.disableLighting = true; m.backFaceCulling = false;
    pl.material = m;
    pl.billboardMode = Mesh.BILLBOARDMODE_Y;
    mover(pl, (msh) => { msh.position.x = sd * (ROADW / 2 + 6 + Math.random() * 3); });
  }
}
const winTex = windowTexture();
for (let z = 0; z < VIEW; z += 90) {
  for (const sd of [-1, 1]) {
    const h = 40 + Math.random() * 55;
    const t = MeshBuilder.CreateBox('t', { width: 18, height: h, depth: 18 }, scene);
    t.position.set(sd * (44 + Math.random() * 30), h / 2 - 0.5, z + Math.random() * 60);
    const m = new PBRMaterial('tm', scene);
    m.albedoColor = new Color3(0.02, 0.02, 0.04);
    m.metallic = 0.1; m.roughness = 0.8;
    m.emissiveTexture = winTex;
    m.emissiveColor = new Color3(0.6, 0.55, 0.47);
    t.material = m; mirror.renderList.push(t);
    mover(t, (msh) => {
      const nh = 40 + Math.random() * 55;
      msh.scaling.y = nh / h;
      msh.position.x = sd * (44 + Math.random() * 30);
      msh.position.y = nh / 2 - 0.5;
    });
  }
}

// ------------------------------------------------------------- the car ----
function buildCar(paintCol, taillit) {
  const root = new TransformNode('car', scene);
  const paint = new PBRMaterial('paint', scene);
  paint.albedoColor = paintCol;
  paint.metallic = 0.85; paint.roughness = 0.24;
  paint.reflectionTexture = mirror;
  const blk = new PBRMaterial('blk', scene);
  blk.albedoColor = new Color3(0.02, 0.02, 0.025);
  blk.metallic = 0.3; blk.roughness = 0.6;
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
  part(1.72, 0.24, 0.1, 0, 0.72, -2.24, taillit ? red : blk);
  const wm = new PBRMaterial('wm', scene);
  wm.albedoColor = new Color3(0.03, 0.03, 0.03); wm.roughness = 0.9;
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.35], [0.95, -1.35]]) {
    const w = MeshBuilder.CreateCylinder('w', { diameter: 0.76, height: 0.3, tessellation: 14 }, scene);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.38, wz); w.parent = root; w.material = wm;
    mirror.renderList.push(w);
  }
  return root;
}
const car = buildCar(new Color3(0.55, 0.02, 0.03), true);
car.position.set(0, 0, 0);

// A little traffic for depth: same-direction cruisers and oncomers.
const traffic = [];
for (let i = 0; i < 6; i++) {
  const oncoming = i % 2 === 0;
  const t = buildCar(new Color3(0.06 + Math.random() * 0.4, 0.05 + Math.random() * 0.3,
                                        0.25 + Math.random() * 0.5), !oncoming);
  t.position.set((oncoming ? -1 : 1) * (2.7 + Math.random() * 5.5),
                 0, 60 + i * 70);
  if (oncoming) t.rotation.y = Math.PI;
  traffic.push({ node: t, oncoming, speed: oncoming ? 26 : 14 + Math.random() * 6 });
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

// ---------------------------------------------------------------- drive ----
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });

let speed = 26, lat = 0, latV = 0;
const hud = document.getElementById('hud');
scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  const accel = (keys.KeyW || keys.ArrowUp) ? 26 : 0;
  const brake = (keys.KeyS || keys.ArrowDown) ? 42 : 0;
  speed = Math.max(8, Math.min(72, speed + (accel - brake - 3.5) * dt));
  const steer = ((keys.KeyA || keys.ArrowLeft) ? -1 : 0) + ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
  latV += (steer * 26 - latV * 5.2) * dt;
  lat = Math.max(-ROADW / 2 + 1.4, Math.min(ROADW / 2 - 1.4, lat + latV * dt));
  car.position.x = lat;
  car.rotation.y = latV * 0.022;
  car.rotation.z = -latV * 0.012;
  cam.position.x = lat * 0.82;
  cam.position.y = 4.6;
  cam.rotation.y = latV * 0.006;

  // The world streams past the car.
  const dz = speed * dt;
  for (const m of movers) {
    m.mesh.position.z -= dz;
    if (m.mesh.position.z < -50) {
      m.mesh.position.z += VIEW + 30;
      if (m.respawn) m.respawn(m.mesh);
    }
  }
  for (const t of traffic) {
    t.node.position.z -= (t.oncoming ? speed + t.speed : speed - t.speed) * dt;
    if (t.node.position.z < -45) t.node.position.z += 480 + Math.random() * 60;
    if (t.node.position.z > 480) t.node.position.z -= 500;
  }
  hud.textContent = `${Math.round(speed * 3.6)} km/h`;
});

engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
scene.executeWhenReady(() => { setTimeout(() => { window.ready = true; }, 400); });
