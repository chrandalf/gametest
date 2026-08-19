// Vehicles, traffic AI, pedestrians and the on-foot character.
'use strict';

// Earth gravity, in metres per second squared. Everything in this file works in
// real units: metres, seconds, metres per second.
const GRAVITY = 9.81;

// ------------------------------------------------------------- geometry -----

// The body is a lofted shell: a series of cross-sections down the length of the
// car, each a rounded rectangle, skinned together with smooth normals. That is
// what gives it a waistline, tapered nose and curved roof instead of a stack of
// boxes. Sections are (z, halfWidth, yBottom, yTop, cornerRound).
const CAR_SECTIONS = [
  [-2.30, 0.60, 0.46, 0.86, 0.30],
  [-2.10, 0.83, 0.38, 0.99, 0.34],
  [-1.70, 0.94, 0.34, 1.06, 0.32],
  [-1.20, 0.97, 0.33, 1.10, 0.30],
  [-0.55, 0.98, 0.33, 1.12, 0.30],
  [ 0.10, 0.97, 0.33, 1.10, 0.30],
  [ 0.75, 0.94, 0.34, 1.05, 0.30],
  [ 1.35, 0.90, 0.36, 0.99, 0.32],
  [ 1.85, 0.83, 0.40, 0.93, 0.34],
  [ 2.18, 0.66, 0.48, 0.84, 0.30],
  [ 2.30, 0.50, 0.56, 0.78, 0.20],
];

// The greenhouse (cabin) sits on top, narrower and swept back.
const CABIN_SECTIONS = [
  [-1.62, 0.62, 1.06, 1.16, 0.08],
  [-1.45, 0.78, 1.06, 1.38, 0.16],
  [-1.00, 0.83, 1.08, 1.50, 0.18],
  [-0.30, 0.84, 1.09, 1.53, 0.18],
  [ 0.25, 0.82, 1.08, 1.50, 0.18],
  [ 0.62, 0.78, 1.06, 1.38, 0.16],
  [ 0.80, 0.66, 1.04, 1.16, 0.08],
];

// One ring of a rounded-rectangle cross-section, walked anticlockwise.
function sectionRing(hw, y0, y1, round, steps) {
  const cy = (y0 + y1) / 2, hy = (y1 - y0) / 2;
  const r = Math.min(round, hw * 0.95, hy * 0.95);
  const ax = hw - r, ay = hy - r;
  const pts = [];
  const corners = [[ax, ay], [-ax, ay], [-ax, -ay], [ax, -ay]];
  for (let c = 0; c < 4; c++) {
    const [ox, oy] = corners[c];
    const base = c * Math.PI / 2;
    for (let s = 0; s <= steps; s++) {
      const a = base + (s / steps) * (Math.PI / 2);
      pts.push([ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r]);
    }
  }
  return pts;
}

// Skin consecutive rings into a closed shell with averaged (smooth) normals.
function loft(b, sections, opt) {
  opt = opt || {};
  const steps = opt.steps || 3;
  const rings = sections.map(([z, hw, y0, y1, round]) => ({
    z, pts: sectionRing(hw, y0, y1, round, steps),
  }));
  const n = rings[0].pts.length;

  // Vertex normal = average of the two adjacent in-ring edge normals, tilted by
  // the lengthwise taper so the nose and tail shade smoothly too.
  const normalFor = (ri, pi) => {
    const ring = rings[ri].pts;
    const prev = ring[(pi - 1 + n) % n], cur = ring[pi], next = ring[(pi + 1) % n];
    let nx = next[1] - prev[1], ny = -(next[0] - prev[0]);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const a = rings[Math.max(0, ri - 1)], c = rings[Math.min(rings.length - 1, ri + 1)];
    const dz = c.z - a.z || 1;
    const spread = (c.pts[pi][0] - a.pts[pi][0]) * nx + (c.pts[pi][1] - a.pts[pi][1]) * ny;
    const nz = -spread / dz;
    const l2 = Math.hypot(nx, ny, nz) || 1;
    return [nx / l2, ny / l2, nz / l2];
  };

  const grid = [];
  for (let ri = 0; ri < rings.length; ri++) {
    const row = [];
    for (let pi = 0; pi < n; pi++) {
      const p = rings[ri].pts[pi];
      const nrm = normalFor(ri, pi);
      row.push(b.vertex(p[0], p[1], rings[ri].z, nrm[0], nrm[1], nrm[2],
                        pi / n * 2, ri / rings.length * 2));
    }
    grid.push(row);
  }
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let pi = 0; pi < n; pi++) {
      const q = (pi + 1) % n;
      const a = grid[ri][pi], bb = grid[ri][q], c = grid[ri+1][q], d = grid[ri+1][pi];
      b.i.push(a, bb, c, a, c, d);
    }
  }
  // Flat end caps.
  for (const [ri, dir] of [[0, -1], [rings.length - 1, 1]]) {
    const ring = rings[ri];
    const cx = ring.pts.reduce((s, p) => s + p[0], 0) / n;
    const cy = ring.pts.reduce((s, p) => s + p[1], 0) / n;
    const center = b.vertex(cx, cy, ring.z, 0, 0, dir, 0.5, 0.5);
    const idx = ring.pts.map((p) => b.vertex(p[0], p[1], ring.z, 0, 0, dir, 0.5, 0.5));
    for (let pi = 0; pi < n; pi++) {
      const q = (pi + 1) % n;
      if (dir > 0) b.i.push(center, idx[pi], idx[q]);
      else b.i.push(center, idx[q], idx[pi]);
    }
  }
}

// Crumple a finished builder in place: every vertex is shoved by a hash of
// its position, biased hard toward the nose and tail, so the same body shell
// comes out a second time as a wreck — stoved-in bonnet, rippled panels. One
// mesh per body style covers every car, because the hash has no seed.
function crumpleMesh(mb, amt) {
  const fr = (v) => v - Math.floor(v);
  for (let i = 0; i < mb.v.length; i += VERT_FLOATS) {
    const x = mb.v[i], y = mb.v[i + 1], z = mb.v[i + 2];
    const h = (n) => fr(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + n) * 43758.5453) - 0.5;
    const bias = 0.55 + 0.9 * Math.min(1, Math.abs(z) / 2.3);
    mb.v[i]     += h(1) * amt * bias;
    mb.v[i + 1] += h(2) * amt * 0.8 * bias;
    mb.v[i + 2] += h(3) * amt * bias
                 - Math.sign(z) * Math.max(0, Math.abs(z) - 1.85) * amt * 2.6;
  }
}

// Front and rear number plates as their own little mesh, drawn per car with a
// UV window into the 4x4 plate sheet — which is how every car gets its own
// registration without every car getting its own geometry.
function buildPlateMesh(gl, frontZ, rearZ, frontY, rearY) {
  const b = new MeshBuilder();
  b.style(TEX.PLATE, [1.35, 1.35, 1.32], 0.10);
  b.quad([-0.50, frontY, frontZ], [0.50, frontY, frontZ],
         [0.50, frontY + 0.25, frontZ], [-0.50, frontY + 0.25, frontZ], 1, 1);
  b.style(TEX.PLATE, [1.5, 1.24, 0.26], 0.12);   // rear plates are yellow here
  b.quad([0.50, rearY, rearZ], [-0.50, rearY, rearZ],
         [-0.50, rearY + 0.25, rearZ], [0.50, rearY + 0.25, rearZ], 1, 1);
  return b.upload(gl);
}

function buildCarMeshes(gl) {
  const buildPaint = () => {
    const paint = new MeshBuilder();
    paint.style(TEX.METAL, [1, 1, 1], -0.001);   // negative emissive = glossy material
    loft(paint, CAR_SECTIONS, { steps: 4 });
    paint.style(TEX.PLAIN, [0.13, 0.13, 0.15], 0);
    paint.chamferBox(0, 0.52, 2.18, 0.90, 0.17, 0.14, 0.10, { perUnit: 1 });   // front bumper
    paint.chamferBox(0, 0.52, -2.20, 0.88, 0.17, 0.13, 0.10, { perUnit: 1 });  // rear bumper
    // Wing mirrors — small, but their absence is very noticeable.
    paint.style(TEX.METAL, [1, 1, 1], 0);
    for (const s of [-1, 1]) {
      paint.chamferBox(s * 1.02, 1.18, 0.42, 0.13, 0.07, 0.10, 0.05, { perUnit: 1 });
    }
    return paint;
  };
  const paint = buildPaint();
  const paintWreck = buildPaint();
  crumpleMesh(paintWreck, 0.075);

  const buildGlass = () => {
    const glass = new MeshBuilder();
    glass.style(TEX.PLAIN, [0.11, 0.15, 0.21], -0.001);
    loft(glass, CABIN_SECTIONS, { steps: 4 });
    return glass;
  };
  const glass = buildGlass();
  const glassWreck = buildGlass();
  crumpleMesh(glassWreck, 0.05);

  const lights = new MeshBuilder();
  lights.style(TEX.PLAIN, [1.0, 0.96, 0.85], 0);
  for (const s of [-1, 1]) {
    lights.chamferBox(s * 0.50, 0.74, 2.14, 0.22, 0.09, 0.06, 0.05, { perUnit: 1 });
  }

  const tail = new MeshBuilder();
  tail.style(TEX.PLAIN, [0.95, 0.12, 0.10], 0);
  for (const s of [-1, 1]) {
    tail.chamferBox(s * 0.56, 0.82, -2.20, 0.21, 0.09, 0.05, 0.04, { perUnit: 1 });
  }

  const wheel = new MeshBuilder();
  wheel.style(TEX.PLAIN, [0.09, 0.09, 0.10], 0);
  wheel.cylinder(0, 0, 0, 0.40, 0.30, 20, { axis: 'x', uRepeat: 6, vRepeat: 1 });
  wheel.style(TEX.METAL, [0.78, 0.79, 0.82], 0);
  wheel.cylinder(0, 0, 0, 0.235, 0.315, 16, { axis: 'x', uRepeat: 6, vRepeat: 1 });

  return {
    paint: paint.upload(gl),
    paintWreck: paintWreck.upload(gl),
    glass: glass.upload(gl),
    glassWreck: glassWreck.upload(gl),
    lights: lights.upload(gl),
    tail: tail.upload(gl),
    wheel: wheel.upload(gl),
    plates: buildPlateMesh(gl, 2.315, -2.335, 0.30, 0.33),
  };
}

// The van. Boxier and taller than the cars, and carrying a certain novelty
// advertising prop on the nose — a sight gag borrowed from The IT Crowd.
function buildVanMeshes(gl) {
  const buildPaint = () => {
    const paint = new MeshBuilder();
    paint.style(TEX.METAL, [1, 1, 1], -0.001);
    paint.chamferBox(0, 1.30, -0.55, 1.05, 0.92, 1.95, 0.38, { perUnit: 0.5 });   // box body
    paint.chamferBox(0, 0.86, 1.62, 1.00, 0.50, 0.70, 0.30, { perUnit: 0.5 });    // stubby bonnet
    paint.chamferBox(0, 1.34, 1.05, 1.02, 0.56, 0.30, 0.26, { perUnit: 0.5 });    // cab front
    paint.style(TEX.PLAIN, [0.13, 0.13, 0.15], 0);
    paint.chamferBox(0, 0.50, 2.22, 0.98, 0.18, 0.14, 0.10, { perUnit: 1 });      // front bumper
    paint.chamferBox(0, 0.50, -2.42, 0.98, 0.18, 0.13, 0.10, { perUnit: 1 });     // rear bumper
    paint.chamferBox(0, 0.30, 0, 0.86, 0.10, 2.1, 0.08, { perUnit: 1 });          // underbody
    return paint;
  };
  const paint = buildPaint();
  const paintWreck = buildPaint();
  crumpleMesh(paintWreck, 0.085);

  const glass = new MeshBuilder();
  glass.style(TEX.PLAIN, [0.11, 0.15, 0.21], -0.001);
  glass.chamferBox(0, 1.52, 1.32, 0.92, 0.36, 0.10, 0.07, { perUnit: 1 });      // windscreen
  glass.chamferBox(1.02, 1.50, 0.55, 0.05, 0.30, 0.55, 0.05, { perUnit: 1 });
  glass.chamferBox(-1.02, 1.50, 0.55, 0.05, 0.30, 0.55, 0.05, { perUnit: 1 });

  // The prop itself: a big cartoon dome bolted to the front, exactly as daft as
  // it was on television.
  const prop = new MeshBuilder();
  prop.style(TEX.PLAIN, [0.96, 0.76, 0.70], 0);
  prop.sphere(0, 1.55, 2.05, 1.02, 16, 12, 0.86);
  prop.style(TEX.PLAIN, [0.80, 0.42, 0.40], 0);
  prop.sphere(0, 1.60, 2.92, 0.26, 10, 8, 0.9);
  prop.style(TEX.METAL, [0.55, 0.56, 0.58], 0);
  for (const s of [-1, 1]) prop.cylinder(s * 0.55, 1.05, 2.0, 0.05, 0.9, 5, { axis: 'y' });

  const lights = new MeshBuilder();
  lights.style(TEX.PLAIN, [1.0, 0.96, 0.85], 0);
  for (const s of [-1, 1]) lights.chamferBox(s * 0.72, 0.80, 2.18, 0.20, 0.10, 0.06, 0.05, { perUnit: 1 });

  const tail = new MeshBuilder();
  tail.style(TEX.PLAIN, [0.95, 0.12, 0.10], 0);
  for (const s of [-1, 1]) tail.chamferBox(s * 0.82, 0.90, -2.44, 0.16, 0.16, 0.05, 0.04, { perUnit: 1 });

  return {
    paint: paint.upload(gl), paintWreck: paintWreck.upload(gl),
    glass: glass.upload(gl), glassWreck: glass.upload(gl), prop: prop.upload(gl),
    lights: lights.upload(gl), tail: tail.upload(gl),
    plates: buildPlateMesh(gl, 2.33, -2.46, 0.52, 0.32),
  };
}

const VAN_WHEELS = [
  [ 0.95, 0.45,  1.45, true],
  [-0.95, 0.45,  1.45, true],
  [ 0.95, 0.45, -1.60, false],
  [-0.95, 0.45, -1.60, false],
];

// A hollow glowing tube you drive through — the delivery marker.
function buildMarkerMesh(gl, rOut, rIn, h) {
  const b = new MeshBuilder();
  b.style(TEX.PLAIN, [1.0, 0.82, 0.18], 1.0);
  const seg = 26;
  const ring = (r, flip) => {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = (a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      if (flip) b.quad(p(a0, 0), p(a1, 0), p(a1, h), p(a0, h), 1, 1);
      else b.quad(p(a1, 0), p(a0, 0), p(a0, h), p(a1, h), 1, 1);
    }
  };
  ring(rOut, false);
  ring(rIn, true);
  // Cap the top and bottom rims so the tube looks solid edge-on.
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const o0 = [Math.cos(a0)*rOut, h, Math.sin(a0)*rOut];
    const o1 = [Math.cos(a1)*rOut, h, Math.sin(a1)*rOut];
    const i0 = [Math.cos(a0)*rIn, h, Math.sin(a0)*rIn];
    const i1 = [Math.cos(a1)*rIn, h, Math.sin(a1)*rIn];
    b.quad(o0, o1, i1, i0, 1, 1);
    b.quad([i0[0],0,i0[2]], [i1[0],0,i1[2]], [o1[0],0,o1[2]], [o0[0],0,o0[2]], 1, 1);
  }
  return b.upload(gl);
}

function buildCubeMesh(gl) {
  const b = new MeshBuilder();
  b.style(TEX.PLAIN, [1, 1, 1], 0);
  b.box(0, 0, 0, 0.5, 0.5, 0.5, { perUnit: 1, bottom: true, uvU: 1, uvV: 1, topU: 1, topV: 1 });
  return b.upload(gl);
}

// Unit body parts for pedestrians: an ellipsoid torso/head and capsule limbs,
// scaled per person. Boxes made everyone look like a filing cabinet.
function buildBodyMeshes(gl) {
  const ball = new MeshBuilder();
  ball.style(TEX.PLAIN, [1, 1, 1], 0);
  ball.sphere(0, 0, 0, 0.5, 12, 8, 1);
  const limb = new MeshBuilder();
  limb.style(TEX.PLAIN, [1, 1, 1], 0);
  limb.capsule(0, 0, 0, 0.5, 2, 10, 3);
  return { ball: ball.upload(gl), limb: limb.upload(gl) };
}

// -------------------------------------------------------------- vehicle -----

const WHEELS = [
  [ 0.88, 0.40,  1.38, true],
  [-0.88, 0.40,  1.38, true],
  [ 0.88, 0.40, -1.42, false],
  [-0.88, 0.40, -1.42, false],
];

class Vehicle {
  constructor(x, z, yaw, color) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0;
    this.steer = 0; this.wheelSpin = 0;
    this.roll = 0; this.pitch = 0;
    this.color = color;
    this.braking = false;
    this.ai = null;
    this.radius = 1.7;
    // Kerb weight. A van shunting a hatchback should move the hatchback, and
    // the hatchback should come off worse; without a mass everything hits
    // everything else like two identical shopping trolleys.
    this.mass = 1400;
    this.halfLen = 2.30; this.halfWid = 0.95;
    // Spin left over from an impact, in radians per second.
    this.yawKick = 0;
    // Seconds of lost grip after a heavy shunt: a car that has just been hit
    // slides where the impulse sent it instead of gripping instantly.
    this.skid = 0;
    // Which of the sixteen registrations this car wears.
    Vehicle.plateCounter = ((Vehicle.plateCounter || 0) + 7) & 15;
    this.plate = Vehicle.plateCounter;
    this.crashImpulse = 0;
    this.y = 0; this.vy = 0; this.surfaceY = 0;
    this.airborne = false;
    this.spinPitch = 0; this.spinRoll = 0;
    this.spinPitchRate = 0; this.spinRollRate = 0;
    // Damage, in the spirit of dethrace's DamageSystems(): an impact is
    // attributed to the face it landed on, and each face wrecks something
    // different. Nose-on kills the engine, a side-swipe pulls the steering,
    // a landing on the roof shakes the wheels loose. 0..1 each.
    this.damage = { engine: 0, steering: 0, wheels: 0, body: 0 };
    this.lastHit = '';        // what was hit, so the game can say so
    this.lastHitT = 0;
    this.wrecked = false;
  }

  // Overall condition, 0 (mint) to 1 (scrap).
  get wreckage() {
    const d = this.damage;
    return clamp((d.engine + d.steering + d.wheels + d.body) / 4, 0, 1);
  }

  // Attribute an impact to a face of the car and wreck what that face
  // protects. `nx, nz` is the outward surface normal of whatever was hit, so
  // the dot with the nose tells us where it landed.
  takeHit(force, nx, nz, what) {
    // Armour plate, power-ups, plot armour: whatever scales what gets through.
    if (this.damageScale !== undefined) force *= this.damageScale;
    if (force <= 0.02) return;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const along = -(nx * fx + nz * fz);          // +1 nose-on, -1 rear-ended
    const d = this.damage;
    const side = 1 - Math.abs(along);
    d.body = clamp(d.body + force * 0.55, 0, 1);
    if (along > 0.55) {
      d.engine = clamp(d.engine + force * 0.85, 0, 1);
      d.steering = clamp(d.steering + force * 0.30, 0, 1);
    } else if (along < -0.55) {
      d.wheels = clamp(d.wheels + force * 0.35, 0, 1);
    } else {
      d.steering = clamp(d.steering + force * 0.70 * side, 0, 1);
      d.wheels = clamp(d.wheels + force * 0.35 * side, 0, 1);
    }
    if (what) { this.lastHit = what; this.lastHitT = 2.2; }
    if (this.wreckage > 0.985) this.wrecked = true;
  }

  // Hold the repair button: everything comes back at once, slowly. Returns how
  // much condition was recovered, which is what it gets charged for.
  repair(dt) {
    const before = this.wreckage;
    for (const k of ['engine', 'steering', 'wheels', 'body']) {
      this.damage[k] = Math.max(0, this.damage[k] - dt * 0.22);
    }
    if (this.wreckage < 0.99) this.wrecked = false;
    return before - this.wreckage;
  }

  // How far the body reaches from its centre along a direction. This is the
  // exact support function of the rectangle, so two cars touch bumper to
  // bumper at four and a half metres and door to door at under two, instead
  // of everything keeping a circle's worth of space from everything else.
  extentAlong(nx, nz) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return Math.abs(nx * fx + nz * fz) * this.halfLen +
           Math.abs(nx * fz - nz * fx) * this.halfWid;
  }

  // Moment of inertia about the vertical axis, for a slab of this size.
  get inertia() {
    return this.mass * (this.halfLen * this.halfLen + this.halfWid * this.halfWid) / 3;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }

  // throttle: -1..1, steerIn: -1..1, handbrake: bool. `nitro` adds thrust on
  // top of the engine and is what gets a car high enough to land on a roof.
  drive(dt, throttle, steerIn, handbrake, city, nitro) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = fz, rz = -fx;
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;

    // Damage you can feel: a wrecked engine will not pull, wrecked steering
    // wanders, wrecked wheels will not hold the road. This is the whole point
    // of tracking it — the gauge only confirms what the car is already doing.
    const dmg = this.damage;
    const MAX = 46 * (1 - dmg.engine * 0.45);
    const powerCurve = 1 - clamp(Math.abs(vf) / MAX, 0, 1) * 0.75;
    if (throttle > 0) vf += throttle * 26 * (1 - dmg.engine * 0.62) * powerCurve * dt;
    if (nitro) vf += 34 * dt * (1 - clamp(Math.abs(vf) / 78, 0, 1));
    else if (throttle < 0) {
      // Brake first, then reverse.
      if (vf > 0.5) vf -= 34 * dt;
      else vf += throttle * 12 * dt;
    }
    this.braking = throttle < 0 && vf > 0.5;

    // Drag + rolling resistance.
    vf -= vf * Math.abs(vf) * 0.0016 * dt * 60 / 60 * 1.0;
    vf -= vf * 0.5 * dt;
    if (Math.abs(vf) < 0.05 && throttle === 0) vf = 0;

    // Steering authority peaks at moderate speed and fades when very fast.
    const sp = Math.abs(vf);
    const authority = clamp(sp / 6, 0, 1) * (1 - clamp((sp - 26) / 46, 0, 0.45));
    let targetSteer = steerIn * (0.55 - clamp(sp / MAX, 0, 1) * 0.30);
    // Bent steering pulls to one side and answers less. The pull is constant
    // for a given car, so you can learn to hold against it.
    if (dmg.steering > 0.15) {
      if (this.steerBias === undefined) this.steerBias = (this.rand ? this.rand() : Math.random()) < 0.5 ? -1 : 1;
      targetSteer = targetSteer * (1 - dmg.steering * 0.45) + this.steerBias * dmg.steering * 0.10;
    }
    this.steer += (targetSteer - this.steer) * clamp(dt * 9, 0, 1);
    const yawRate = this.steer * authority * 2.7 * Math.sign(vf || 1);
    this.yaw += yawRate * dt;

    // Spin left over from being hit off-centre. It decays quickly — a car is
    // not a spinning top — but it is what makes a corner impact read as one
    // rather than as a shove in a straight line.
    if (this.yawKick) {
      this.yaw += this.yawKick * dt;
      this.yawKick *= Math.exp(-3.4 * dt);
      if (Math.abs(this.yawKick) < 0.012) this.yawKick = 0;
    }

    // Rebuild the basis from the *new* heading. Thrust has to follow the nose as
    // it points now — using the pre-steer basis makes the car crab sideways.
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    const nrx = nfz, nrz = -nfx;

    // Lateral grip. Tyres scrub sideways motion away almost at once; only the
    // handbrake lets the tail step out and hold a slide — and a car that has
    // just been shunted has no grip at all until it stops sliding, which is
    // what lets an impact actually throw it rather than shoving it a foot.
    if (this.skid > 0) this.skid = Math.max(0, this.skid - dt);
    // Oil slicks: drive over one and the tyres have nothing to say for a
    // moment — the car goes light and the tail wanders on its own.
    if (typeof game !== 'undefined' && game.slicks && game.slicks.length && !this.airborne) {
      for (const s of game.slicks) {
        const sdx = this.x - s.x, sdz = this.z - s.z;
        if (sdx * sdx + sdz * sdz < s.r * s.r) {
          this.skid = Math.max(this.skid, 0.35);
          if (Math.abs(vf) > 6) this.yawKick += Math.sin(this.x * 12.9 + this.z * 7.7) * 0.09;
          break;
        }
      }
    }
    const grip = ((handbrake || this.skid > 0) ? 1.8 : 17.0) * (1 - dmg.wheels * 0.55);
    vr += yawRate * vf * dt * (handbrake ? 0.9 : 0.12);
    vr *= Math.exp(-grip * dt);
    if (handbrake) vf -= vf * 1.2 * dt;

    this.vx = nfx * vf + nrx * vr;
    this.vz = nfz * vf + nrz * vr;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Vertical: ramps push the car up, gravity brings it back.
    const ramps = game.ramps;
    const deck = (ramps && !this.airborne) ? ramps.heightAt(this.x, this.z) : null;
    if (deck && !this.airborne) {
      this.y = deck.y;
      this.onRamp = deck;
      this.surfaceY = deck.base || 0;
    } else if (!this.airborne && this.onRamp) {
      // Left the ramp footprint: launch from wherever it was on the wedge. This
      // triggers on exit rather than inside a narrow window at the lip, which a
      // fast car can skip over entirely in one frame.
      const launched = this.onRamp;
      this.onRamp = null;
      if (this.y > (launched.base || 0) + 0.25 && vf > 6) {
        this.airborne = true;
        this.vy = Math.abs(vf) * launched.slope * 1.35;   // m/s straight up
        this.spinPitchRate = 0; this.spinRollRate = 0;
      } else {
        this.y = launched.base || 0;
      }
    } else if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      // In the air the driver can pitch and roll the car for style.
      this.spinPitchRate += (steerIn === 0 ? -this.spinPitchRate * 2.5 : 0) * dt;
      if (throttle !== 0) this.spinPitchRate = clamp(this.spinPitchRate + throttle * 5.5 * dt, -7, 7);
      if (steerIn !== 0) this.spinRollRate = clamp(this.spinRollRate + steerIn * 6.5 * dt, -8, 8);
      this.spinPitch += this.spinPitchRate * dt;
      this.spinRoll += this.spinRollRate * dt;
      // Land on whatever is underneath: a rooftop counts.
      const surface = city ? city.topAt(this.x, this.z) : 0;
      if (this.y <= surface) {
        this.y = surface;
        this.surfaceY = surface;
        this.airborne = false;
        this.crashImpulse = Math.max(this.crashImpulse, Math.min(1, -this.vy / 22));
        this.vy = 0;
        // Straighten up on landing, losing speed if it was badly judged.
        const messy = Math.abs(Math.sin(this.spinRoll)) + Math.abs(Math.sin(this.spinPitch));
        this.vx *= 1 - clamp(messy * 0.3, 0, 0.6);
        this.vz *= 1 - clamp(messy * 0.3, 0, 0.6);
        this.spinPitch = 0; this.spinRoll = 0;
        this.spinPitchRate = 0; this.spinRollRate = 0;
      }
    } else {
      // Grounded: follow the surface, and drop off the edge of a roof.
      const surface = city ? city.topAt(this.x, this.z) : 0;
      // Tolerance enough that the roll of open country does not throw the car
      // into the air over every crest; a roof edge is a much bigger drop.
      if (surface < this.y - 0.6) {
        this.airborne = true;
        this.vy = 0;
      } else {
        this.y = surface;
        this.surfaceY = surface;
      }
    }

    // Body attitude for a bit of weight transfer.
    // Both terms lean the body outward through a corner; the yaw term used to
    // fight the slip term because it was tuned against a mirrored model matrix.
    const targetRoll = clamp(-vr * 0.02 + yawRate * Math.abs(vf) * 0.012, -0.16, 0.16);
    const targetPitch = clamp((throttle > 0 ? -0.03 : 0) + (this.braking ? 0.05 : 0), -0.1, 0.1);
    this.roll += (targetRoll - this.roll) * clamp(dt * 6, 0, 1);
    this.pitch += (targetPitch - this.pitch) * clamp(dt * 6, 0, 1);

    this.wheelSpin += vf * dt / 0.4;
    this.slip = Math.abs(vr);
    this.steerRate = yawRate;

    if (city && !this.airborne) this.collide(city);
  }

  collide(city) {
    const p = { x: this.x, z: this.z };
    const hit = city.resolveCircle(p, this.radius, this.y);
    if (hit) {
      const before = this.speed;
      this.x = p.x; this.z = p.z;
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        // Reflect a little, kill most of the energy.
        this.vx -= hit.nx * vn * 1.25;
        this.vz -= hit.nz * vn * 1.25;
        this.vx *= 0.55; this.vz *= 0.55;
        // A scrape leaves the car moving sideways; the tyres bite immediately,
        // so cut what is left of the lateral component rather than sliding on.
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        const vfwd = this.vx * fx + this.vz * fz;
        const vlat = (this.vx * fz - this.vz * fx) * 0.35;
        this.vx = fx * vfwd + fz * vlat;
        this.vz = fz * vfwd - fx * vlat;
        this.crashImpulse = Math.max(this.crashImpulse, Math.min(1, before / 22));
        // How hard it landed, and on which face. A gentle kerb scrape is not
        // damage; anything from a walking pace upwards starts to be.
        const bite = Math.max(0, -vn) / 26;
        this.takeHit(bite * bite * 1.15, hit.nx, hit.nz, hit.what);
      }
    }
  }

  modelMatrix(out) {
    return M4.compose(out, this.x, this.y, this.z, this.yaw,
                      this.pitch + this.spinPitch, this.roll + this.spinRoll, 1, 1, 1);
  }
}

// ------------------------------------------------------------- traffic ------

const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

function laneTarget(i, j, dx, dz, city) {
  // Offset to the correct side of the road for the travel direction. How far
  // over depends on how wide the road is: a country lane is not a boulevard,
  // and sitting a boulevard's distance from its centre puts a car in a hedge.
  if (city && city.laneTarget) return city.laneTarget(i, j, dx, dz);
  const ox = dz * LANE, oz = -dx * LANE;
  return { x: roadCenter(i) + ox, z: roadCenter(j) + oz };
}

class TrafficCar extends Vehicle {
  constructor(i, j, dx, dz, color, rand, city) {
    const t = laneTarget(i, j, dx, dz, city);
    super(t.x - dx * CELL * 0.5, t.z - dz * CELL * 0.5, Math.atan2(dx, dz), color);
    this.node = { i, j };
    this.dir = { x: dx, z: dz };
    this.target = t;
    // Spread wide enough that a driver can actually make use of a 70 limit;
    // in town the posted limit governs instead.
    this.maxSpeed = 19 + rand() * 15;
    this.rand = rand;
    this.stopTimer = 0;
    // Some drivers sit on the limit, some drift over it.
    this.lawAbiding = 0.88 + rand() * 0.3;
    this.status = 'go';
    this.jam = 0;
    this.jamSteer = rand() < 0.5 ? -0.6 : 0.6;
  }

  pickNext() {
    const rand = this.rand;
    const city = this.world && this.world.city;
    const options = [];
    for (const [dx, dz] of DIRS) {
      if (dx === -this.dir.x && dz === -this.dir.z) continue;   // no U-turns
      const ni = this.node.i + dx, nj = this.node.j + dz;
      if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
      // Not every pair of junctions has a road between them any more.
      if (city && city.canGo && !city.canGo(this.node.i, this.node.j, dx, dz)) continue;
      const straight = (dx === this.dir.x && dz === this.dir.z);
      // Traffic already on the motorway stays on it: the whole point of the
      // corridor is that it carries through-traffic between the two cities.
      const onMway = this.world && this.world.city.isMotorway &&
                     this.world.city.isMotorway(this.node.i, this.node.j) &&
                     this.world.city.onMotorway(this.x, this.z);
      let w = straight ? (onMway ? 60 : 5) : 1;
      // Nobody drives up a cul-de-sac unless they live there. Without this a
      // sixth of the fleet ends up nose to tail in dead ends, turning round.
      if (city && city.degree && city.degree(ni, nj) < 2) w *= 0.08;
      options.push({ dx, dz, w });
    }
    // A cul-de-sac. Turning round is the only thing left to do, and it is the
    // one place a U-turn is right rather than a sign the AI has got lost.
    // Swinging straight at a target behind you carves a wide arc across the
    // verge, so it is done as a three-point turn: back up, swing the nose.
    if (!options.length) {
      this.dir.x *= -1; this.dir.z *= -1;
      this.node = { i: this.node.i + this.dir.x, j: this.node.j + this.dir.z };
      this.target = laneTarget(this.node.i, this.node.j, this.dir.x, this.dir.z, city);
      this.jam = 1.3;
      return;
    }
    let total = 0;
    for (const o of options) total += o.w;
    let r = rand() * total;
    let chosen = options[0];
    for (const o of options) { r -= o.w; if (r <= 0) { chosen = o; break; } }
    this.dir.x = chosen.dx; this.dir.z = chosen.dz;
    this.node = { i: this.node.i + chosen.dx, j: this.node.j + chosen.dz };
    this.target = laneTarget(this.node.i, this.node.j, this.dir.x, this.dir.z,
                             this.world && this.world.city);
  }

  // A car that might be turning at the junction it is approaching slows down
  // before it gets there, rather than scrubbing speed off mid-corner.
  approaching(dist) { return dist < 26; }

  // A fan of look-ahead probes rather than one straight test: a single ray
  // down the nose misses the car drifting across the junction in front.
  scan(world) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let nearest = null, nearestDist = Infinity;
    for (const other of world.blockers) {
      if (other === this) continue;
      const ox = other.x - this.x, oz = other.z - this.z;
      const ahead = ox * fx + oz * fz;
      if (ahead <= 0 || ahead > 26) continue;
      // The fan widens with distance, so it covers the lane, not a line.
      const side = Math.abs(ox * fz - oz * fx);
      if (side > 2.2 + ahead * 0.12) continue;
      if (ahead < nearestDist) { nearestDist = ahead; nearest = other; }
    }
    return nearest ? { car: nearest, dist: nearestDist } : null;
  }

  update(dt, world) {
    this.world = world;
    // The freeze pickup: every AI driver slams the brakes and sits there.
    if (typeof game !== 'undefined' && game.power && game.power.freeze > 0 &&
        !this.isPlayer && !this.ambulance) {
      this.drive(dt, 0, 0, true, world.city);
      return;
    }
    // Written off. It stops where it is and becomes an obstacle, which is what
    // a written-off car does and what makes a pile-up build on itself.
    if (this.wreckage > 0.7) {
      this.status = 'stop';
      this.drive(dt, 0, 0, true, world.city);
      return;
    }
    // Just been hit: no braking, no steering. The driver is carried wherever
    // the impulse sent them until the tyres bite again — which is the whole
    // difference between shunting a car and shoving a wall.
    if (this.skid > 0) {
      this.drive(dt, 0, 0, false, world.city);
      return;
    }
    const dx = this.target.x - this.x, dz = this.target.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 7) this.pickNext();

    // Steer at a point further down the driver's own lane rather than straight
    // at the junction: roads bow between their junctions, and aiming at the far
    // end of a bend is how a car ends up cutting across the verge on the inside.
    const aim = world.city.aimPoint
      ? world.city.aimPoint(this.node.i, this.node.j, this.dir.x, this.dir.z,
                            this.x, this.z, Math.max(12, this.speed * 1.1))
      : this.target;
    const desired = Math.atan2(aim.x - this.x, aim.z - this.z);
    const steerErr = angDelta(this.yaw, desired);
    let steerIn = clamp(steerErr * 1.9, -1, 1);

    // Posted limit for the road being driven, and the driver's own habits.
    const posted = world.city.speedLimitAt ? world.city.speedLimitAt(this.x, this.z)
                                           : this.maxSpeed;
    let limit = Math.min(this.maxSpeed, posted * this.lawAbiding);
    this.status = 'go';

    // Ease off for the corner that is coming, not the one already begun.
    if (Math.abs(steerErr) > 0.25 || this.approaching(dist)) {
      limit = Math.min(limit, Math.abs(steerErr) > 0.25 ? 7.5 : 10.5);
      this.status = 'slow';
    }

    // Signals. Amber is treated as red unless the car is too close to stop.
    // An ambulance on a shout goes through on blues.
    if (world.lights && !this.ignoreLights) {
      const stop = world.lights.stopLineFor(this.node.i, this.node.j, this.dir.x, this.dir.z);
      if (stop) {
        const toLine = (stop.x - this.x) * Math.sin(this.yaw) +
                       (stop.z - this.z) * Math.cos(this.yaw);
        const stopping = this.speed * this.speed / 11;
        if (toLine > 0 && toLine < 34 && !(stop.amber && toLine < stopping)) {
          limit = Math.min(limit, Math.max(0, (toLine - 2.4) * 1.7));
          this.status = toLine < 6 ? 'stop' : 'slow';
        }
      }
    }

    // Follow the vehicle in front instead of driving into it: match its speed
    // at a headway, brake hard inside it, and nudge out of a nose-to-nose.
    const seen = this.scan(world);
    if (seen) {
      const other = seen.car;
      const heading = Math.sin(this.yaw) * Math.sin(other.yaw) +
                      Math.cos(this.yaw) * Math.cos(other.yaw);
      const gap = seen.dist - 5.4;
      if (heading > 0.6) {
        limit = Math.min(limit, Math.max(0, other.forwardSpeed + gap * 0.85));
        if (gap < 1.6) this.status = 'stop';
        else if (gap < 6) this.status = 'slow';
      } else if (seen.dist < 7) {
        // Facing each other. Back off and pull to one side to break the lock.
        this.jam = 1.1;
      } else {
        limit = Math.min(limit, Math.max(0, gap * 1.4));
      }
    }

    if (this.jam > 0) {
      this.jam -= dt;
      this.drive(dt, -0.55, this.jamSteer, false, world.city);
      return;
    }

    const vf = this.forwardSpeed;
    const throttle = vf < limit - 0.4 ? 1 : (vf > limit + 1.2 ? -1 : 0);
    this.drive(dt, throttle, steerIn, this.status === 'stop' && vf > 6, world.city);
  }
}

class Pedestrian {
  constructor(x, z, yaw, rand) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.speed = 1.3 + rand() * 0.9;
    this.phase = rand() * 10;
    this.shirt = [0.2 + rand()*0.7, 0.2 + rand()*0.7, 0.2 + rand()*0.7];
    this.pants = [0.15 + rand()*0.3, 0.15 + rand()*0.3, 0.2 + rand()*0.35];
    this.skin = [0.95, 0.78 - rand()*0.35, 0.62 - rand()*0.35];
    this.height = 0.92 + rand() * 0.2;
    this.knocked = 0;
    this.vx = 0; this.vz = 0; this.y = 0;
    this.rand = rand;
    this.turnTimer = 0;
    // Panic. A pedestrian who sees a car coming at them does not carry on
    // strolling; they bolt, and they do not care that they are stepping off
    // the kerb to do it. That is the whole reason a city street feels alive
    // rather than like a diorama of people on rails.
    this.panic = 0;
    this.screamed = 0;
    this.fleeYaw = 0;
  }

  // Is that car about to run me over? Distance alone is not enough — a car
  // parked beside you is not frightening, and one doing fifty across the far
  // side of the junction is not either. It has to be quick and pointed at you.
  senses(car) {
    if (!car) return 0;
    const dx = this.x - car.x, dz = this.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d > 26 || d < 0.001) return 0;
    const sp = car.speed;
    if (sp < 4) return 0;
    // How squarely the car is coming at them.
    const aim = (dx * car.vx + dz * car.vz) / (d * sp);
    // A near miss is frightening even when it was never going to hit you: a
    // car passing a metre away at forty gets a reaction from anybody.
    if (d < 10 && sp > 8) return clamp((1 - d / 10) * clamp(sp / 12, 0, 1) * 1.6, 0, 1);
    if (aim < 0.3) return 0;
    // Closer, faster and more head-on all raise the alarm.
    return clamp((1 - d / 26) * clamp(sp / 14, 0, 1) * aim * 2.2, 0, 1);
  }

  update(dt, world) {
    // The pavement has a height now, so "the floor" is wherever they stand.
    const floor = world.city && world.city.groundY ? world.city.groundY(this.x, this.z) : 0;
    if (this.knocked > 0) {
      // Hit hard enough and they do not get up: they lie where they landed
      // until the ambulance comes for them. That is what the hospital count
      // is made of.
      if (this.downed) this.knocked = Math.max(this.knocked, 0.5);
      this.knocked -= dt;
      this.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.vx *= 0.97; this.vz *= 0.97;
      if (this.y <= floor) { this.y = floor; this.vy = 0; this.vx *= 0.6; this.vz *= 0.6; }
      if (this.knocked <= 0) { this.y = floor; this.vy = 0; }
      return;
    }
    this.y = floor;

    // --- panic ---
    const alarm = this.senses(world.threat);
    if (alarm > 0.28) {
      this.panic = Math.max(this.panic, 1.4 + alarm * 1.6);
      const car = world.threat;
      // Straight away from the car, but biased sideways: running down the road
      // in front of a car is how you get run over, and they know it.
      const dx = this.x - car.x, dz = this.z - car.z;
      const away = Math.atan2(dx, dz);
      const side = ((this.x * 7 + this.z * 13) | 0) % 2 ? 1 : -1;
      this.fleeYaw = away + side * 0.7;
      if (this.screamed <= 0) {
        this.screamed = 2.4;
        if (world.onScream) world.onScream(this);
      }
    }
    if (this.screamed > 0) this.screamed -= dt;
    if (this.panic > 0) {
      this.panic -= dt;
      this.yaw += angDelta(this.yaw, this.fleeYaw) * clamp(dt * 7, 0, 1);
      // Sprinting, and off the kerb if that is where away happens to be.
      const run = this.speed * 2.5;
      const nx = this.x + Math.sin(this.yaw) * run * dt;
      const nz = this.z + Math.cos(this.yaw) * run * dt;
      const q = { x: nx, z: nz };
      world.city.resolveCircle(q, 0.45);
      this.x = q.x; this.z = q.z;
      this.phase += dt * run * 3.4;
      this.turnTimer = 0.6;                 // wander somewhere new afterwards
      return;
    }

    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = 2 + this.rand() * 5;
      this.targetYaw = this.yaw + (this.rand() - 0.5) * 2.4;
    }
    if (this.targetYaw !== undefined) {
      this.yaw += angDelta(this.yaw, this.targetYaw) * clamp(dt * 2.5, 0, 1);
    }

    const nx = this.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.z + Math.cos(this.yaw) * this.speed * dt;
    // Stay off the road: pedestrians turn around at the kerb.
    if (onRoad(nx, nz) || Math.abs(nx) > WORLD || Math.abs(nz) > WORLD) {
      this.yaw += Math.PI * (0.5 + this.rand() * 0.5);
      this.targetYaw = this.yaw;
      this.turnTimer = 1 + this.rand() * 2;
    } else {
      this.x = nx; this.z = nz;
    }
    const p = { x: this.x, z: this.z };
    if (world.city.resolveCircle(p, 0.45)) {
      this.x = p.x; this.z = p.z;
      this.yaw += Math.PI * 0.6;
      this.targetYaw = this.yaw;
    }
    this.phase += dt * this.speed * 3.4;
  }

  knock(vx, vz) {
    if (this.knocked > 0) return;
    this.knocked = 2.2 + this.rand();
    const impact = Math.hypot(vx, vz);
    // A glancing bump is a bruise; anything over a jog is a stretcher case.
    if (impact > 6.5) this.downed = true;
    this.vx = vx * 0.55; this.vz = vz * 0.55; this.vy = 4 + impact * 0.12;
  }
}

// ------------------------------------------------------- on-foot player -----

class Walker {
  constructor(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.phase = 0;
    this.speed = 0;
    this.shirt = [0.85, 0.25, 0.2];
    this.pants = [0.18, 0.2, 0.28];
    this.skin = [0.95, 0.76, 0.6];
    this.height = 1.0;
    this.y = 0;
    this.vy = 0;
    this.knocked = 0;
  }

  update(dt, moveX, moveZ, sprint, city) {
    const len = Math.hypot(moveX, moveZ);
    const target = len > 0.01 ? (sprint ? 8.2 : 3.6) : 0;
    this.speed += (target - this.speed) * clamp(dt * 8, 0, 1);
    if (len > 0.01) {
      const want = Math.atan2(moveX, moveZ);
      this.yaw += angDelta(this.yaw, want) * clamp(dt * 12, 0, 1);
    }
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
    const p = { x: this.x, z: this.z };
    city.resolveCircle(p, 0.42);
    this.x = p.x; this.z = p.z;
    this.y = city.topAt ? city.topAt(this.x, this.z) : 0;
    this.phase += dt * (2 + this.speed * 2.6);
  }
}
