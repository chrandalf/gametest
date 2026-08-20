// Stunt ramps, air time scoring, and rooftop snipers.
'use strict';

// ---------------------------------------------------------------- ramps -----

// Ramps are triggers, not collision geometry: while the car is over one it is
// lifted along the wedge, and it leaves the lip with whatever speed it had.
class RampSet {
  constructor() {
    this.ramps = [];
  }

  add(x, z, yaw, length, width, height, base, kind) {
    this.ramps.push({ x, z, yaw, length, width, height, base: base || 0,
                      kind: kind || 'plain' });
  }

  // Build the visible wedges into a chunk mesh and register the triggers. The
  // wedge is built about y=0; `base` is the height of the road under it, and
  // is reported back through heightAt so the car rides the right one.
  emit(b, x, z, yaw, length, width, height, base, kind) {
    this.add(x, z, yaw, length, width, height, base, kind);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
    const hw = width / 2, hl = length / 2;
    const deckY = (lz) => height * (0.5 + lz / (2 * hl)) + 0.03;
    // Both windings, for the thin panels a driver sees from either side.
    const dq = (p0, p1, p2, p3, u, v) => { b.quad(p0, p1, p2, p3, u, v)
                                            .quad(p3, p2, p1, p0, u, v); };
    // Deck: dark grip-plate steel, wound so the face points up.
    b.style(TEX.METAL, [0.30, 0.31, 0.34], 0);
    b.quad(P(-hw, height, hl), P(hw, height, hl), P(hw, 0, -hl), P(-hw, 0, -hl), 3, 3);
    // Triangular side plates: a quad with its last two corners doubled up, so
    // the normal still comes from three distinct points.
    b.style(TEX.METAL, [0.20, 0.21, 0.23], 0);
    b.quad(P(hw, 0, -hl), P(hw, height, hl), P(hw, 0, hl), P(hw, 0, hl), 1, 1);
    b.quad(P(-hw, 0, -hl), P(-hw, 0, hl), P(-hw, height, hl), P(-hw, height, hl), 1, 1);
    // The lip face wears hazard chevrons — alternating yellow and near-black
    // panels — which is what tells a driver at speed that this is equipment.
    const nCh = Math.max(4, Math.round(width / 0.75));
    for (let i = 0; i < nCh; i++) {
      const x0 = -hw + width * i / nCh, x1 = -hw + width * (i + 1) / nCh;
      b.style(TEX.PLAIN, i % 2 ? [1.25, 0.85, 0.12] : [0.07, 0.07, 0.08], i % 2 ? 0.45 : 0);
      b.quad(P(x0, 0, hl), P(x1, 0, hl), P(x1, height, hl), P(x0, height, hl), 1, 1);
    }
    // Boost decks wear green go-faster chevrons pointing up the slope —
    // the universal arcade sign for "hit this flat out".
    if (kind === 'boost') {
      b.style(TEX.PLAIN, [0.25, 1.30, 0.35], 0.9);
      for (let lz = -hl + 1.1; lz < hl - 0.9; lz += 1.4) {
        for (const sd of [-1, 1]) {
          dq(P(sd * (hw - 0.5), deckY(lz), lz), P(sd * 0.15, deckY(lz + 0.55), lz + 0.55),
             P(sd * 0.15, deckY(lz + 0.85), lz + 0.85), P(sd * (hw - 0.5), deckY(lz + 0.3), lz + 0.3), 1, 1);
        }
      }
    }
    // A wings ramp hangs a white wing pair over the lip — you can see the
    // prize from down the street, which is the whole invitation.
    if (kind === 'wings') {
      b.style(TEX.PLAIN, [1.0, 1.0, 1.05], 0.9);
      for (const sd of [-1, 1]) {
        dq(P(sd * 0.15, height + 1.65, hl - 0.3), P(sd * 1.55, height + 2.45, hl - 0.3),
           P(sd * 1.55, height + 2.15, hl - 0.3), P(sd * 0.15, height + 1.35, hl - 0.3), 1, 1);
      }
    }
    // Neon guard rails up both edges of the deck: cyan like the road edging,
    // pink on a wings ramp so the two read as different offers at night.
    b.style(TEX.PLAIN, kind === 'wings' ? [1.45, 0.30, 0.95] : [0.30, 0.95, 1.40], 1.0);
    for (const sd of [-1, 1]) {
      dq(P(sd * hw, height + 0.34, hl), P(sd * hw, 0.40, -hl),
         P(sd * hw, 0.28, -hl), P(sd * hw, height + 0.22, hl), 3, 1);
    }
    // Scaffold legs under the lip and a cross-brace, so the wedge stands on
    // something instead of being a solid triangle of nothing.
    b.style(TEX.METAL, [0.16, 0.17, 0.19], 0);
    for (const sd of [-1, 1]) {
      const lx = sd * (hw - 0.35), lz = hl - 0.45;
      dq(P(lx - 0.07, height, lz), P(lx + 0.07, height, lz),
         P(lx + 0.07, 0, lz), P(lx - 0.07, 0, lz), 1, 2);
      dq(P(lx, height, lz - 0.07), P(lx, height, lz + 0.07),
         P(lx, 0, lz + 0.07), P(lx, 0, lz - 0.07), 1, 2);
    }
    dq(P(-hw + 0.2, height * 0.45, hl - 0.45), P(hw - 0.2, height * 0.45, hl - 0.45),
       P(hw - 0.2, height * 0.32, hl - 0.45), P(-hw + 0.2, height * 0.32, hl - 0.45), 3, 1);
    // Painted arrow up the middle of the deck, laid flush along the slope.
    b.style(TEX.MARK, [1.0, 0.75, 0.1], 0.35);
    b.quad(P(-0.35, deckY(hl * 0.1), hl * 0.1), P(0.35, deckY(hl * 0.1), hl * 0.1),
           P(0, deckY(hl * 0.55), hl * 0.55), P(0, deckY(hl * 0.55), hl * 0.55), 1, 1);
    b.quad(P(-0.18, deckY(-hl * 0.5), -hl * 0.5), P(0.18, deckY(-hl * 0.5), -hl * 0.5),
           P(0.18, deckY(hl * 0.28), hl * 0.28), P(-0.18, deckY(hl * 0.28), hl * 0.28), 1, 1);
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
      return { y: r.base + t * r.height, base: r.base, exiting: t > 0.92,
               slope: r.height / r.length, ramp: r };
    }
    return null;
  }
}

// ---------------------------------------------------------------- stunts ----

// Watches the car and scores what it did — in the air, and on the ground.
//
// The ground half is lifted from chrandalf/dethrace (pedestrn.c, crush.c):
// every hit is worth a base value multiplied by how it was done, and a run of
// hits inside a second raises a combo multiplier that caps at five. The way a
// hit is scored is the same taxonomy: rolling or upside down when it lands is
// "artistic impression", a side-swipe or a hit in reverse is "extra style",
// several at once is "nice shot sir", and a nose-to-nose is a "head on". Each
// one also buys seconds, which is the whole engine of that game: the clock
// only ever runs down, and mayhem is how you keep it off zero.
const COMBO_WINDOW = 1.2;       // seconds; a later hit starts the count again
const MAX_COMBO = 5;

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
    this.combo = 1;
    this.comboT = 0;
    this.timeWon = 0;       // seconds earned since last collected
    this.creditsWon = 0;    // ...and credits, likewise
    this.queue = [];
  }

  // Every bonus goes through here so they cannot stomp on one another: a
  // splatter, its combo and the head-on that caused it all get their moment.
  award(text, points, seconds) {
    this.score += points;
    this.best = Math.max(this.best, points);
    this.timeWon += seconds || 0;
    // Credits as well as points: they are what pays for repairs and for being
    // fished out of a field, so mayhem funds the recovery from mayhem.
    this.creditsWon += Math.round(points / 10);
    const line = `${text}   +${points}${seconds ? `  +${seconds}s` : ''}`;
    if (this.bannerT > 0) this.queue.push(line);
    else { this.banner = line; this.bannerT = 2.4; }
  }

  // A pedestrian went under the wheels. `car` is whoever did it, `others` is
  // how many went down in the same instant.
  splat(car, others) {
    this.comboT = COMBO_WINDOW;
    let points = 100, label = 'SPLAT';
    const upright = Math.cos(car.roll) > 0.35 && Math.cos(car.pitch) > 0.35;
    const spinning = Math.abs(car.spinRollRate || 0) + Math.abs(car.spinPitchRate || 0) > 3;
    if (others > 1) {
      points *= 4; label = 'NICE SHOT SIR';
    } else if (!upright || spinning || car.airborne) {
      points *= 4; label = 'ARTISTIC IMPRESSION';
    } else if (Math.abs(car.forwardSpeed) < car.speed * 0.72 || car.forwardSpeed < -1) {
      // Going sideways or backwards into them rather than straight over.
      points *= 2; label = 'EXTRA STYLE BONUS';
    }
    points *= this.combo;
    const secs = 1 + Math.round(points / 300);
    this.award(this.combo > 1 ? `${label}  ${this.combo}x COMBO` : label, points, secs);
    if (this.combo < MAX_COMBO) this.combo++;
  }

  // Two cars meeting nose to nose. `closing` is the speed they met at.
  headOn(closing) {
    if (closing < 16) return;
    const points = Math.round(closing * 40);
    this.award('HEAD ON BONUS', points, 2 + Math.round(closing / 12));
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
    // A big jump landed on its wheels is worth time as well as points.
    this.award(parts.join('  ·  '), points, upright ? Math.round(this.airTime * 2) : 0);
    this.reset();
  }

  reset() { this.airTime = 0; this.spin = 0; this.flip = 0; }

  // Seconds banked since the last call, so the run timer can collect them.
  collectTime() { const t = this.timeWon; this.timeWon = 0; return t; }
  collectCredits() { const c = this.creditsWon; this.creditsWon = 0; return c; }

  tick(dt) {
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 1;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0 && this.queue.length) {
        this.banner = this.queue.shift();
        this.bannerT = 2.4;
      }
    }
  }
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
