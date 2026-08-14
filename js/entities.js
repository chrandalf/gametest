// Vehicles, traffic AI, pedestrians and the on-foot character.
'use strict';

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

function buildCarMeshes(gl) {
  const paint = new MeshBuilder();
  paint.style(TEX.METAL, [1, 1, 1], 0);
  loft(paint, CAR_SECTIONS, { steps: 4 });
  paint.style(TEX.PLAIN, [0.13, 0.13, 0.15], 0);
  paint.chamferBox(0, 0.52, 2.18, 0.90, 0.17, 0.14, 0.10, { perUnit: 1 });   // front bumper
  paint.chamferBox(0, 0.52, -2.20, 0.88, 0.17, 0.13, 0.10, { perUnit: 1 });  // rear bumper
  paint.style(TEX.PLAIN, [0.9, 0.9, 0.92], 0);
  paint.chamferBox(0, 0.40, 2.28, 0.40, 0.10, 0.03, 0.03, { perUnit: 1 });   // plate
  // Wing mirrors — small, but their absence is very noticeable.
  paint.style(TEX.METAL, [1, 1, 1], 0);
  for (const s of [-1, 1]) {
    paint.chamferBox(s * 1.02, 1.18, 0.42, 0.13, 0.07, 0.10, 0.05, { perUnit: 1 });
  }

  const glass = new MeshBuilder();
  glass.style(TEX.PLAIN, [0.11, 0.15, 0.21], 0);
  loft(glass, CABIN_SECTIONS, { steps: 4 });

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
    glass: glass.upload(gl),
    lights: lights.upload(gl),
    tail: tail.upload(gl),
    wheel: wheel.upload(gl),
  };
}

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
    this.crashImpulse = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }

  // throttle: -1..1, steerIn: -1..1, handbrake: bool
  drive(dt, throttle, steerIn, handbrake, city) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = fz, rz = -fx;
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;

    const MAX = 46;
    const powerCurve = 1 - clamp(Math.abs(vf) / MAX, 0, 1) * 0.75;
    if (throttle > 0) vf += throttle * 26 * powerCurve * dt;
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
    const targetSteer = steerIn * (0.55 - clamp(sp / MAX, 0, 1) * 0.30);
    this.steer += (targetSteer - this.steer) * clamp(dt * 9, 0, 1);
    const yawRate = this.steer * authority * 2.7 * Math.sign(vf || 1);
    this.yaw += yawRate * dt;

    // Rebuild the basis from the *new* heading. Thrust has to follow the nose as
    // it points now — using the pre-steer basis makes the car crab sideways.
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    const nrx = nfz, nrz = -nfx;

    // Lateral grip. Tyres scrub sideways motion away almost at once; only the
    // handbrake lets the tail step out and hold a slide.
    const grip = handbrake ? 1.8 : 17.0;
    vr += yawRate * vf * dt * (handbrake ? 0.9 : 0.12);
    vr *= Math.exp(-grip * dt);
    if (handbrake) vf -= vf * 1.2 * dt;

    this.vx = nfx * vf + nrx * vr;
    this.vz = nfz * vf + nrz * vr;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Body attitude for a bit of weight transfer.
    const targetRoll = clamp(-vr * 0.02 - yawRate * Math.abs(vf) * 0.012, -0.16, 0.16);
    const targetPitch = clamp((throttle > 0 ? -0.03 : 0) + (this.braking ? 0.05 : 0), -0.1, 0.1);
    this.roll += (targetRoll - this.roll) * clamp(dt * 6, 0, 1);
    this.pitch += (targetPitch - this.pitch) * clamp(dt * 6, 0, 1);

    this.wheelSpin += vf * dt / 0.4;
    this.slip = Math.abs(vr);

    if (city) this.collide(city);
  }

  collide(city) {
    const p = { x: this.x, z: this.z };
    const hit = city.resolveCircle(p, this.radius);
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
      }
    }
  }

  modelMatrix(out) {
    return M4.compose(out, this.x, 0, this.z, this.yaw, this.pitch, this.roll, 1, 1, 1);
  }
}

// ------------------------------------------------------------- traffic ------

const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

function laneTarget(i, j, dx, dz) {
  // Offset to the correct side of the road for the travel direction.
  const ox = dz * LANE, oz = -dx * LANE;
  return { x: roadCenter(i) + ox, z: roadCenter(j) + oz };
}

class TrafficCar extends Vehicle {
  constructor(i, j, dx, dz, color, rand) {
    const t = laneTarget(i, j, dx, dz);
    super(t.x - dx * CELL * 0.5, t.z - dz * CELL * 0.5, Math.atan2(dx, dz), color);
    this.node = { i, j };
    this.dir = { x: dx, z: dz };
    this.target = t;
    this.maxSpeed = 16 + rand() * 9;
    this.rand = rand;
    this.stopTimer = 0;
  }

  pickNext() {
    const rand = this.rand;
    const options = [];
    for (const [dx, dz] of DIRS) {
      if (dx === -this.dir.x && dz === -this.dir.z) continue;   // no U-turns
      const ni = this.node.i + dx, nj = this.node.j + dz;
      if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
      const straight = (dx === this.dir.x && dz === this.dir.z);
      options.push({ dx, dz, w: straight ? 5 : 1 });
    }
    if (!options.length) { this.dir.x *= -1; this.dir.z *= -1; return; }
    let total = 0;
    for (const o of options) total += o.w;
    let r = rand() * total;
    let chosen = options[0];
    for (const o of options) { r -= o.w; if (r <= 0) { chosen = o; break; } }
    this.dir.x = chosen.dx; this.dir.z = chosen.dz;
    this.node = { i: this.node.i + chosen.dx, j: this.node.j + chosen.dz };
    this.target = laneTarget(this.node.i, this.node.j, this.dir.x, this.dir.z);
  }

  update(dt, world) {
    const dx = this.target.x - this.x, dz = this.target.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 7) this.pickNext();

    const desired = Math.atan2(dx, dz);
    const steerErr = angDelta(this.yaw, desired);
    const steerIn = clamp(steerErr * 1.9, -1, 1);

    // Slow for whatever is directly ahead: traffic, the player, or a tight turn.
    let limit = this.maxSpeed * (1 - Math.min(0.55, Math.abs(steerErr) * 0.9));
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const other of world.blockers) {
      if (other === this) continue;
      const ox = other.x - this.x, oz = other.z - this.z;
      const ahead = ox * fx + oz * fz;
      const side = Math.abs(ox * fz - oz * fx);
      if (ahead > 0 && ahead < 16 && side < 3.2) {
        limit = Math.min(limit, Math.max(0, (ahead - 6) * 2.2));
      }
    }

    const vf = this.forwardSpeed;
    const throttle = vf < limit ? 1 : (vf > limit + 2 ? -1 : 0);
    this.drive(dt, throttle, steerIn, false, world.city);
  }
}

// ---------------------------------------------------------- pedestrians -----

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
  }

  update(dt, world) {
    if (this.knocked > 0) {
      this.knocked -= dt;
      this.y += this.vy * dt;
      this.vy -= 22 * dt;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.vx *= 0.97; this.vz *= 0.97;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.vx *= 0.6; this.vz *= 0.6; }
      if (this.knocked <= 0) { this.y = 0; this.vy = 0; }
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
    this.vx = vx * 0.55; this.vz = vz * 0.55; this.vy = 4 + Math.hypot(vx, vz) * 0.12;
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
    this.phase += dt * (2 + this.speed * 2.6);
  }
}
