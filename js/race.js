// Racing: a circuit of waypoints, AI opponents, laps and finishing positions.
'use strict';

class Racer extends Vehicle {
  constructor(x, z, yaw, color, circuit, rand, name) {
    super(x, z, yaw, color);
    this.circuit = circuit;
    this.rand = rand;
    this.name = name;
    this.wp = 0;
    this.lap = 0;
    this.finished = false;
    this.finishTime = 0;
    // A little spread in ability so the pack does not drive as one block.
    this.skill = 0.86 + rand() * 0.2;
    // Kept inside the lane: wide enough and they clip the parked cars.
    this.wander = (rand() - 0.5) * 3;
    this.stuck = 0;
    this.stuckSteer = rand() < 0.5 ? -1 : 1;
  }

  target() {
    const c = this.circuit;
    return c[this.wp % c.length];
  }

  // How sharply the circuit turns at the gate being approached.
  cornerAngle() {
    const c = this.circuit;
    const a = c[this.wp % c.length];
    const b = c[(this.wp + 1) % c.length];
    const inAng = Math.atan2(a.x - this.x, a.z - this.z);
    const outAng = Math.atan2(b.x - a.x, b.z - a.z);
    return Math.abs(angDelta(inAng, outAng));
  }

  // Aim a little beyond the next gate, which stops the AI sawing at the wheel.
  // Into a corner it aims at the gate itself: looking through the turn early
  // is what sent them wide into the buildings on the outside of every bend.
  aimPoint(turn) {
    const c = this.circuit;
    const a = c[this.wp % c.length];
    const b = c[(this.wp + 1) % c.length];
    const t = turn > 0.6 ? 0.03 : 0.35;
    return { x: lerp(a.x, b.x, t) + this.wander, z: lerp(a.z, b.z, t) + this.wander };
  }

  update(dt, world) {
    if (this.finished) { this.drive(dt, 0, 0, false, world.city); return; }

    // Wedged on something — a kerb, a lamp post, another racer. Back off and
    // try again, or one bad corner parks a car there for the whole race.
    this.stuck = this.speed < 1.5 ? this.stuck + dt : 0;
    if (this.stuck > 0.8) {
      this.drive(dt, -0.85, this.stuckSteer, false, world.city);
      if (this.stuck > 1.9) { this.stuck = 0; this.stuckSteer *= -1; }
      return;
    }

    const t = this.target();
    const gate = Math.hypot(t.x - this.x, t.z - this.z);
    if (gate < 26) {
      this.wp++;
      if (this.wp % this.circuit.length === 0) this.lap++;
    }
    const turn = this.cornerAngle();
    const aim = this.aimPoint(turn);
    const desired = Math.atan2(aim.x - this.x, aim.z - this.z);
    const err = angDelta(this.yaw, desired);
    // Positive steer increases yaw — the AI convention that drive() expects.
    // Negating it here (the player's mapping) sent every racer into the cushion.
    const steer = clamp(err * 2.2, -1, 1);

    // Brake for a corner before reaching it, from a braking distance that
    // scales with speed. Waiting for the heading error to grow is too late —
    // by then the car is already committed and ends up in the outside wall.
    const brakeZone = turn > 0.6 && gate < 12 + this.speed * this.speed * 0.045;
    const straight = 1 - Math.min(1, Math.abs(err) * 1.4);
    const throttle = brakeZone ? (this.speed > 18 ? -0.6 : 0.25)
                   : Math.abs(err) > 1.5 ? 0.45 : 1;
    const pace = this.pace || 1;
    const boost = !brakeZone && straight > 0.75 && pace > 0.97 &&
                  this.speed < 40 * this.skill * pace;
    // The band has to bite top speed, not just throttle — a half-open tap
    // still fills the same bath on a long straight. Under pace 1 the racer
    // lifts above a proportional ceiling; at the floor that is ~105 km/h.
    let thr = throttle * this.skill * pace;
    if (pace < 1 && this.speed > 45 * pace) thr = Math.min(thr, -0.1);
    this.drive(dt, thr, steer, false, world.city, boost);
  }
}

// Progress along the circuit, used for ordering the field.
function raceProgress(entry, circuit) {
  const t = circuit[entry.wp % circuit.length];
  const d = Math.hypot(t.x - entry.x, t.z - entry.z);
  return entry.lap * 10000 + entry.wp * 100 - Math.min(d, 99) / 100;
}

class Race {
  constructor(gl, world, rand, laps) {
    this.circuit = world.circuit;
    this.laps = laps || 3;
    this.rand = rand;
    this.state = 'countdown';
    this.countdown = 3.6;
    this.time = 0;
    this.racers = [];
    this.banner = '';
    this.bannerT = 0;
    this.finishOrder = [];

    const names = ['RUST', 'BOLT', 'PIP', 'SCUFF', 'NIPPER'];
    const colours = [
      [0.15, 0.35, 0.85], [0.95, 0.75, 0.10], [0.15, 0.65, 0.30],
      [0.85, 0.35, 0.10], [0.60, 0.20, 0.70],
    ];
    // Grid: staggered behind the first gate, facing the second.
    const a = this.circuit[0], b = this.circuit[1];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (let i = 0; i < 4; i++) {
      const back = 14 + Math.floor(i / 2) * 16;
      // Half a lane either side of the racing line: any wider and the outside
      // of the grid starts inside the kerb.
      const side = (i % 2 ? 1 : -1) * 4.2;
      this.racers.push(new Racer(
        a.x - Math.sin(yaw) * back + rx * side,
        a.z - Math.cos(yaw) * back + rz * side,
        yaw, colours[i % colours.length], this.circuit, rand, names[i % names.length]));
    }
    // The player lines up on pole.
    this.playerGrid = { x: a.x - Math.sin(yaw) * 8, z: a.z - Math.cos(yaw) * 8, yaw };
    this.player = { wp: 0, lap: 0, finished: false, finishTime: 0, name: 'YOU' };
  }

  say(msg, secs) { this.banner = msg; this.bannerT = secs || 2.4; }

  update(dt, world, car) {
    if (this.bannerT > 0) this.bannerT -= dt;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      car.vx = 0; car.vz = 0;
      for (const r of this.racers) { r.vx = 0; r.vz = 0; }
      if (this.countdown <= 0) { this.state = 'running'; this.say('GO!', 1.4); }
      return;
    }
    if (this.state !== 'running') return;

    this.time += dt;
    // Rubber band, the arcade way. The field's raw pace laps a mid player —
    // the AI corners on rails and boosts on every straight for free — and
    // running 5th for three laps with no way back is a race nobody restarts.
    // Gap is measured in gates: a racer well ahead of the player breathes
    // (and loses the free boost), one well behind pushes a little. The factor
    // is gentle enough that a clean lap still beats the band.
    const p = this.player;
    p.x = car.x; p.z = car.z;
    const pp = raceProgress(p, this.circuit);
    for (const r of this.racers) {
      const gap = (raceProgress(r, this.circuit) - pp) / 100;
      // Steep enough to matter: the AI's raw pace comes from perfect lines,
      // so a mild trim reads as no trim at all. Two gates clear costs them
      // a tenth; eight or more and they sit at the floor until you catch up.
      r.pace = clamp(1 - gap * 0.05, 0.55, 1.06);
    }
    for (const r of this.racers) {
      if (!r.finished) {
        r.update(dt, world);
        if (r.lap >= this.laps) {
          r.finished = true; r.finishTime = this.time;
          this.finishOrder.push(r.name);
        }
      } else r.update(dt, world);
    }

    // Player progress against the same gates.
    if (!p.finished) {
      const t = this.circuit[p.wp % this.circuit.length];
      if (Math.hypot(t.x - car.x, t.z - car.z) < 26) {
        p.wp++;
        if (p.wp % this.circuit.length === 0) {
          p.lap++;
          if (p.lap >= this.laps) {
            p.finished = true; p.finishTime = this.time;
            this.finishOrder.push('YOU');
            this.state = 'done';
            this.say(`FINISHED ${this.placeLabel()}  ${this.time.toFixed(1)}s`, 8);
          } else {
            this.say(`LAP ${p.lap + 1} / ${this.laps}`, 2);
          }
        }
      }
    }
  }

  // Live ordering: finishers first in the order they crossed, then the rest.
  standings() {
    const field = [{ ...this.player, x: this.player.x || 0, z: this.player.z || 0, isPlayer: true },
                   ...this.racers];
    return field.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return raceProgress(b, this.circuit) - raceProgress(a, this.circuit);
    });
  }

  position() {
    const order = this.standings();
    return order.findIndex((e) => e.isPlayer) + 1;
  }

  placeLabel() {
    const n = this.finishOrder.indexOf('YOU') + 1;
    return ['', '1st', '2nd', '3rd', '4th', '5th'][n] || `${n}th`;
  }
}
