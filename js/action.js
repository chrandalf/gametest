// Stunt ramps, air time scoring, and rooftop snipers.
'use strict';

// ---------------------------------------------------------------- ramps -----

// Ramps are triggers, not collision geometry: while the car is over one it is
// lifted along the wedge, and it leaves the lip with whatever speed it had.
class RampSet {
  constructor() {
    this.ramps = [];
  }

  add(x, z, yaw, length, width, height) {
    this.ramps.push({ x, z, yaw, length, width, height });
  }

  // Build the visible wedges into a chunk mesh and register the triggers.
  emit(b, x, z, yaw, length, width, height) {
    this.add(x, z, yaw, length, width, height);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
    const hw = width / 2, hl = length / 2;
    b.style(TEX.METAL, [0.62, 0.55, 0.32], 0);
    // Deck, wound so the face points up.
    b.quad(P(-hw, height, hl), P(hw, height, hl), P(hw, 0, -hl), P(-hw, 0, -hl), 3, 3);
    // Triangular sides: a quad with its last two corners doubled up, so the
    // normal still comes from three distinct points.
    b.quad(P(hw, 0, -hl), P(hw, height, hl), P(hw, 0, hl), P(hw, 0, hl), 1, 1);
    b.quad(P(-hw, 0, -hl), P(-hw, 0, hl), P(-hw, height, hl), P(-hw, height, hl), 1, 1);
    // Vertical face at the lip.
    b.quad(P(-hw, 0, hl), P(hw, 0, hl), P(hw, height, hl), P(-hw, height, hl), 2, 1);
    b.style(TEX.MARK, [1.0, 0.75, 0.1], 0.35);
    b.quad(P(-hw, height + 0.02, hl - 0.5), P(hw, height + 0.02, hl - 0.5),
           P(hw, height + 0.04, hl), P(-hw, height + 0.04, hl), 2, 1);
  }

  // Returns the deck height under a point, or null when it is off the ramp.
  heightAt(x, z) {
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) > r.width / 2 || Math.abs(lz) > r.length / 2) continue;
      const t = clamp((lz + r.length / 2) / r.length, 0, 1);
      return { y: t * r.height, exiting: t > 0.92, slope: r.height / r.length, ramp: r };
    }
    return null;
  }
}

// ---------------------------------------------------------------- stunts ----

// Watches the car while it is off the ground and scores what it did.
class StuntTracker {
  constructor() {
    this.airTime = 0;
    this.spin = 0;
    this.flip = 0;
    this.score = 0;
    this.best = 0;
    this.banner = '';
    this.bannerT = 0;
    this.wasAir = false;
  }

  update(dt, car) {
    if (car.airborne) {
      this.airTime += dt;
      this.spin += Math.abs(car.spinRollRate) * dt;
      this.flip += Math.abs(car.spinPitchRate) * dt;
      this.wasAir = true;
      return;
    }
    if (!this.wasAir) return;
    this.wasAir = false;
    if (this.airTime < 0.35) { this.reset(); return; }

    const rolls = Math.floor(this.spin / (Math.PI * 2));
    const flips = Math.floor(this.flip / (Math.PI * 2));
    let points = Math.round(this.airTime * 120) + rolls * 500 + flips * 800;
    const parts = [`${this.airTime.toFixed(1)}s AIR`];
    if (rolls) parts.push(`${rolls}x BARREL ROLL`);
    if (flips) parts.push(`${flips}x FLIP`);
    // Landing on the wheels is worth a lot more than landing on the roof.
    const upright = Math.cos(car.roll) > 0.35 && Math.cos(car.pitch) > 0.35;
    if (!upright) { points = Math.round(points * 0.3); parts.push('SLOPPY LANDING'); }
    this.score += points;
    this.best = Math.max(this.best, points);
    this.banner = `${parts.join('  ·  ')}   +${points}`;
    this.bannerT = 3.2;
    this.reset();
  }

  reset() { this.airTime = 0; this.spin = 0; this.flip = 0; }

  tick(dt) { if (this.bannerT > 0) this.bannerT -= dt; }
}

// --------------------------------------------------------------- snipers ----

// Rooftop marksmen: they track the car with a laser, then take a shot. A hit
// rocks the car and shatters your concentration; it does not end the game.
class Snipers {
  constructor(gl, city, rand) {
    this.list = [];
    this.mesh = new DynamicMesh(gl, 64, 96);
    this.builder = new MeshBuilder();
    this.hitFlash = 0;

    const tall = city.buildings.filter((b) => b.h > 34);
    for (let i = 0; i < Math.min(5, tall.length); i++) {
      const b = tall[(rand() * tall.length) | 0];
      this.list.push({
        x: lerp(b.x0 + 2, b.x1 - 2, rand()),
        y: b.h + 1.1,
        z: lerp(b.z0 + 2, b.z1 - 2, rand()),
        aim: [0, 0, 0],
        state: 'idle',
        timer: 1 + rand() * 4,
        heat: 0,
      });
    }
  }

  update(dt, target) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.2);
    const b = this.builder;
    b.v.length = 0; b.i.length = 0;
    b.min = [Infinity, Infinity, Infinity];
    b.max = [-Infinity, -Infinity, -Infinity];

    for (const s of this.list) {
      const dx = target.x - s.x, dz = target.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 190) { s.state = 'idle'; s.timer = 1.5; continue; }

      s.timer -= dt;
      // The laser lags the car, so it only connects if you hold a steady line.
      const lag = s.state === 'aiming' ? 1 - Math.exp(-dt * 2.6) : 1;
      s.aim[0] += (target.x - s.aim[0]) * lag;
      s.aim[1] += (0.9 - s.aim[1]) * lag;
      s.aim[2] += (target.z - s.aim[2]) * lag;

      if (s.state === 'idle' && s.timer <= 0) { s.state = 'aiming'; s.timer = 1.8; }
      else if (s.state === 'aiming' && s.timer <= 0) {
        s.state = 'idle';
        s.timer = 3.5 + Math.random() * 4;
        const miss = Math.hypot(s.aim[0] - target.x, s.aim[2] - target.z);
        if (miss < 2.6) {
          this.hitFlash = 1;
          game.shake = Math.min(1.4, game.shake + 0.75);
          if (game.car) {
            // A hit shoves the car sideways — enough to spoil a clean line.
            const nx = (target.x - s.x) / (dist || 1), nz = (target.z - s.z) / (dist || 1);
            game.car.vx += nz * 5.5;
            game.car.vz -= nx * 5.5;
          }
          playThud(0.7);
        }
      }

      if (s.state === 'aiming') {
        // Thin laser from the roof to the aim point.
        const w = 0.05;
        const ax = s.aim[0], ay = s.aim[1], az = s.aim[2];
        let ux = az - s.z, uz = -(ax - s.x);
        const ul = Math.hypot(ux, uz) || 1;
        ux = ux / ul * w; uz = uz / ul * w;
        const hot = s.timer < 0.5 ? 1 : 0.45;
        b.style(TEX.PLAIN, [1.6 * hot, 0.12, 0.10], 1.6 * hot);
        const i0 = b.vertex(s.x - ux, s.y, s.z - uz, 0, 1, 0, 0, 0);
        const i1 = b.vertex(s.x + ux, s.y, s.z + uz, 0, 1, 0, 1, 0);
        const i2 = b.vertex(ax + ux, ay, az + uz, 0, 1, 0, 1, 1);
        const i3 = b.vertex(ax - ux, ay, az - uz, 0, 1, 0, 0, 1);
        b.i.push(i0, i1, i2, i0, i2, i3);
        b.i.push(i0, i2, i1, i0, i3, i2);
      }
    }
    this.mesh.update(b);
  }
}
