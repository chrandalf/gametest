// Car props and road wear: the nodding dog on the parcel shelf, the toilet roll
// streaming out of the back door, and the skid marks the tyres leave behind.
'use strict';

// ------------------------------------------------------------ nodding dog ---

function buildDogMeshes(gl) {
  const body = new MeshBuilder();
  body.style(TEX.PLAIN, [0.86, 0.68, 0.42], 0);
  body.sphere(0, 0.10, -0.02, 0.115, 12, 8, 0.85);          // haunches
  body.sphere(0, 0.13, 0.07, 0.085, 10, 7, 0.9);            // chest
  body.style(TEX.PLAIN, [0.96, 0.93, 0.88], 0);
  for (const s of [-1, 1]) body.sphere(s * 0.06, 0.035, 0.07, 0.035, 8, 6, 1);  // front paws
  body.style(TEX.PLAIN, [0.86, 0.68, 0.42], 0);
  body.capsule(0, 0.14, -0.14, 0.055, 0.20, 8, 3);          // tail stub

  // The head is a separate mesh so it can nod on its own spring.
  const head = new MeshBuilder();
  head.style(TEX.PLAIN, [0.88, 0.71, 0.45], 0);
  head.sphere(0, 0, 0, 0.10, 12, 9, 1);
  head.sphere(0, -0.025, 0.085, 0.062, 10, 7, 0.85);        // muzzle
  head.style(TEX.PLAIN, [0.13, 0.11, 0.10], 0);
  head.sphere(0, -0.018, 0.142, 0.028, 8, 6, 1);            // nose
  for (const s of [-1, 1]) head.sphere(s * 0.042, 0.03, 0.075, 0.017, 6, 5, 1);  // eyes
  head.style(TEX.PLAIN, [0.62, 0.44, 0.26], 0);
  for (const s of [-1, 1]) head.sphere(s * 0.085, 0.02, -0.01, 0.05, 8, 6, 0.45); // ears
  return { body: body.upload(gl), head: head.upload(gl) };
}

// A bobblehead is a damped spring driven by the car's own acceleration.
class NoddingDog {
  constructor() {
    this.angle = 0;
    this.vel = 0;
    this.yawAngle = 0;
    this.yawVel = 0;
    this.prevSpeed = 0;
  }

  update(dt, car) {
    if (dt <= 0) return;
    const fwd = car.forwardSpeed;
    const accel = clamp((fwd - this.prevSpeed) / dt, -60, 60);
    this.prevSpeed = fwd;
    // Lateral load makes it wag sideways as well as nod.
    const lateral = clamp((car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw)) * 0.9, -25, 25);

    const K = 62, C = 3.4;
    this.vel += (-K * this.angle - C * this.vel - accel * 0.55) * dt;
    this.angle = clamp(this.angle + this.vel * dt, -0.85, 0.85);
    this.yawVel += (-K * 0.7 * this.yawAngle - C * this.yawAngle * 0 - C * this.yawVel + lateral * 0.5) * dt;
    this.yawAngle = clamp(this.yawAngle + this.yawVel * dt, -0.7, 0.7);
  }
}

// --------------------------------------------------------- toilet streamer ---

// A strip of paper trailing from the back door: Verlet points with drag and a
// length that grows with speed, so it unrolls the faster you go.
class ToiletStreamer {
  constructor(gl) {
    this.N = 16;
    this.pts = [];
    this.prev = [];
    this.spin = 0;
    this.unroll = 1.2;
    this.detached = false;
    this.detachT = 0;
    this.mesh = new DynamicMesh(gl, this.N * 4 + 8, this.N * 12 + 24);
    this.builder = new MeshBuilder();
    this.ready = false;
  }

  anchorWorld(car) {
    // Local (right side, just behind the rear door) -> world.
    const lx = 0.92, ly = 0.86, lz = -1.55;
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
    return [car.x + lx * c + lz * s, ly, car.z - lx * s + lz * c];
  }

  reset(car) {
    const a = this.anchorWorld(car);
    for (let i = 0; i < this.N; i++) {
      this.pts[i] = [a[0], Math.max(0.05, a[1] - i * 0.05), a[2]];
      this.prev[i] = this.pts[i].slice();
    }
    this.ready = true;
  }

  update(dt, car) {
    if (!this.ready) this.reset(car);
    if (dt <= 0) return;
    const speed = car.speed;
    // Unrolled length chases the speed, and never winds back up.
    const MAXLEN = 17.0;
    const target = clamp(1.0 + speed * 0.62, 1.0, MAXLEN);
    this.unroll = Math.max(this.unroll, target);
    this.unroll += (Math.max(target, this.unroll * 0.995) - this.unroll) * Math.min(1, dt * 0.8);
    this.spin += speed * dt * 1.6;

    // Once the whole roll is out and you are still going, it tears off the door
    // and tumbles away; a fresh roll is on the parcel shelf a few seconds later.
    if (!this.detached && this.unroll >= MAXLEN - 0.05 && speed > 16) {
      this.detached = true;
      this.detachT = 0;
      this.torn = true;
    }
    if (this.detached) {
      this.detachT += dt;
      if (this.detachT > 6) {
        this.detached = false;
        this.unroll = 1.0;
        this.reset(car);
        this.torn = false;
      }
    }

    const seg = this.unroll / (this.N - 1);
    const a = this.anchorWorld(car);
    const drag = Math.exp(-2.6 * dt);
    // Paper is light: it barely falls, and the wake behind a moving car lifts it
    // and shakes it about. Lift fades out above head height so it cannot balloon.
    const GRAV = -GRAVITY * 0.35;   // paper falls slowly through air
    const wake = Math.min(speed * 0.5, 13);

    for (let i = 1; i < this.N; i++) {
      const p = this.pts[i], q = this.prev[i];
      const vx = (p[0] - q[0]) * drag, vy = (p[1] - q[1]) * drag, vz = (p[2] - q[2]) * drag;
      q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
      const ph = game.time * 8.5 + i * 1.25;
      const flut = (1.2 + speed * 0.58) * (0.35 + 0.65 * (i / this.N));
      const ceiling = clamp(2.6 - p[1], 0, 1);
      const ax = Math.cos(ph * 0.8) * flut;
      const ay = GRAV + wake * ceiling * (0.55 + 0.45 * Math.sin(ph * 0.55));
      const az = Math.sin(ph * 0.8 + 1.7) * flut;
      p[0] += vx + ax * dt * dt;
      p[1] += vy + ay * dt * dt;
      p[2] += vz + az * dt * dt;
      if (p[1] < 0.05) { p[1] = 0.05; p[0] -= vx * 0.4; p[2] -= vz * 0.4; }
    }
    if (!this.detached) {
      this.pts[0][0] = a[0]; this.pts[0][1] = a[1]; this.pts[0][2] = a[2];
      this.prev[0][0] = a[0]; this.prev[0][1] = a[1]; this.prev[0][2] = a[2];
    } else {
      const p0 = this.pts[0], q0 = this.prev[0];
      const vx0 = (p0[0]-q0[0]) * drag, vy0 = (p0[1]-q0[1]) * drag, vz0 = (p0[2]-q0[2]) * drag;
      q0[0] = p0[0]; q0[1] = p0[1]; q0[2] = p0[2];
      p0[0] += vx0; p0[1] += vy0 - GRAVITY * 0.5 * dt * dt; p0[2] += vz0;
      if (p0[1] < 0.05) p0[1] = 0.05;
    }

    // Keep the segments a fixed distance apart.
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < this.N - 1; i++) {
        const p = this.pts[i], q = this.pts[i + 1];
        let dx = q[0]-p[0], dy = q[1]-p[1], dz = q[2]-p[2];
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const diff = (d - seg) / d * 0.5;
        const mp = (i === 0 && !this.detached) ? 0 : 1;
        p[0] += dx * diff * mp; p[1] += dy * diff * mp; p[2] += dz * diff * mp;
        q[0] -= dx * diff; q[1] -= dy * diff; q[2] -= dz * diff;
      }
    }
    this.rebuild();
  }

  rebuild() {
    const b = this.builder;
    b.v.length = 0; b.i.length = 0;
    b.min = [Infinity, Infinity, Infinity];
    b.max = [-Infinity, -Infinity, -Infinity];
    b.style(TEX.PLAIN, [0.98, 0.97, 0.95], 0);
    const halfW = 0.062;
    let prevSide = null;
    const rows = [];
    for (let i = 0; i < this.N; i++) {
      const p = this.pts[i];
      const n = this.pts[Math.min(this.N - 1, i + 1)];
      const q = this.pts[Math.max(0, i - 1)];
      let dx = n[0]-q[0], dy = n[1]-q[1], dz = n[2]-q[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx/=dl; dy/=dl; dz/=dl;
      // Side vector: perpendicular to the run, kept as flat as possible.
      let sx = dz, sy = 0, sz = -dx;
      let sl = Math.hypot(sx, sy, sz);
      if (sl < 0.05 && prevSide) { sx = prevSide[0]; sy = prevSide[1]; sz = prevSide[2]; sl = 1; }
      else if (sl < 0.05) { sx = 1; sy = 0; sz = 0; sl = 1; }
      sx/=sl; sy/=sl; sz/=sl;
      prevSide = [sx, sy, sz];
      // Twist along the length so it catches the light like real paper.
      const tw = Math.sin(game.time * 4.4 + i * 1.15) * 1.05;
      const upy = Math.cos(tw), side = Math.sin(tw);
      const ox = sx * halfW * upy, oy = halfW * side, oz = sz * halfW * upy;
      const nx = -sx * side, ny = upy, nz = -sz * side;
      const v = i / (this.N - 1) * 3;
      rows.push([
        b.vertex(p[0]-ox, p[1]-oy, p[2]-oz, nx, ny, nz, 0, v),
        b.vertex(p[0]+ox, p[1]+oy, p[2]+oz, nx, ny, nz, 1, v),
      ]);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const [a0, a1] = rows[i], [b0, b1] = rows[i + 1];
      b.i.push(a0, a1, b1, a0, b1, b0);
      b.i.push(a0, b1, a1, a0, b0, b1);   // back faces, so it is visible either side
    }
    this.mesh.update(b);
  }
}

// -------------------------------------------------------------- skid marks ---

// A ring buffer of dark quads laid under the tyres while they are sliding.
class SkidMarks {
  constructor(gl, capacity) {
    this.capacity = capacity || 420;
    this.quads = new Array(this.capacity);
    this.next = 0;
    this.live = 0;
    this.dirty = false;
    this.mesh = new DynamicMesh(gl, this.capacity * 4, this.capacity * 6);
    this.builder = new MeshBuilder();
    this.lastPos = [null, null, null, null];
  }

  // Emit a strip segment between where a wheel was and where it is now.
  add(x0, z0, x1, z1, width, strength, groundY) {
    let dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    if (d < 0.05 || d > 6) return;
    dx /= d; dz /= d;
    const sx = -dz * width * 0.5, sz = dx * width * 0.5;
    const y = (groundY || 0) + 0.045;
    this.quads[this.next] = [
      x0 - sx, y, z0 - sz, x0 + sx, y, z0 + sz,
      x1 + sx, y, z1 + sz, x1 - sx, y, z1 - sz,
      clamp(strength, 0.25, 1),
    ];
    this.next = (this.next + 1) % this.capacity;
    this.live = Math.min(this.live + 1, this.capacity);
    this.dirty = true;
  }

  rebuild() {
    if (!this.dirty) return;
    this.dirty = false;
    const b = this.builder;
    b.v.length = 0; b.i.length = 0;
    b.min = [Infinity, Infinity, Infinity];
    b.max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < this.live; k++) {
      const q = this.quads[(this.next - 1 - k + this.capacity * 2) % this.capacity];
      if (!q) continue;
      const shade = 0.18 + (1 - q[12]) * 0.25;
      b.style(TEX.ASPHALT, [shade, shade, shade * 1.02], 0);
      const base = b.vertex(q[0], q[1], q[2], 0, 1, 0, 0, 0);
      b.vertex(q[3], q[4], q[5], 0, 1, 0, 1, 0);
      b.vertex(q[6], q[7], q[8], 0, 1, 0, 1, 1);
      b.vertex(q[9], q[10], q[11], 0, 1, 0, 0, 1);
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.mesh.update(b);
  }

  // Lay rubber whenever a tyre is sliding sideways or locked under braking.
  track(car, slip, braking) {
    const laying = slip > 2.6 || (braking && car.speed > 14 && slip > 1.2);
    const strength = clamp(slip / 9, 0, 1);
    for (let i = 0; i < WHEELS.length; i++) {
      const [wx, , wz] = WHEELS[i];
      const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
      const px = car.x + wx * c + wz * s;
      const pz = car.z - wx * s + wz * c;
      const last = this.lastPos[i];
      if (laying && last) this.add(last[0], last[1], px, pz, 0.34, strength, car.y);
      this.lastPos[i] = laying ? [px, pz] : null;
    }
    this.rebuild();
  }
}
