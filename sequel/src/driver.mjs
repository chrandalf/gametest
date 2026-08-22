// The lane grammar: how everything drives in Neon City.
//
// Turbo Esprit's insight, modernised. A vehicle is always in one of two
// states: ON an edge (in a lane, free to slide between lanes) or IN a
// junction (committed to an arc it cannot leave). Steering inside a lane is
// analog but magnetised to the lane centre; pushing hard enough requests a
// lane change; a junction turn is committed in advance - by indicator - and
// executed on rails with the speed auto-braked to something the arc can
// hold. The scenery is therefore unhittable; traffic is not. That is the
// game.
//
// Conventions (Babylon left-handed, forward = (sin yaw, 0, cos yaw)):
//   left vector = (-cos yaw, 0, sin yaw)
//   positive steer input = left; positive lat = displaced left of lane centre
//   lane 0 = centre-most (overtaking); higher = kerbward. Left-hand traffic.
'use strict';
import { CLASSES, halfWidth, lanePos, nodeAhead, headingSlot, turnOptions }
  from './network.mjs';

const CORNER_SPEED = 11;          // m/s through a 90° arc
const BRAKE = 14;                 // m/s^2 comfortable auto-brake

export class Driver {
  constructor(net, e, dir, lane, s) {
    this.net = net;
    this.mode = 'edge';           // 'edge' | 'turn'
    this.e = e; this.dir = dir; this.lane = lane; this.s = s;
    this.lat = 0;
    this.latV = 0;
    this.speed = 0;
    this.intent = 'straight';     // what the pilot indicated
    this.indicator = 0;           // -1 left, 1 right, 0 off (lights + HUD)
    this.turn = null;
    this.pos = { x: 0, y: 0, z: 0, yaw: 0 };
    this.blocked = false;
    this.place();
  }

  cls() { return CLASSES[this.e.cls]; }
  lanesPer() { return this.cls().lanesPer; }

  // The intent that will actually happen at the node ahead: the pilot's,
  // unless the road forces a choice (T-junction, corner).
  effectiveIntent() {
    const opts = turnOptions(nodeAhead(this.e, this.dir), headingSlot(this.e, this.dir));
    let want = this.intent;
    if (!opts[want]) want = 'straight';
    if (want === 'straight' && !opts.straight) {
      if (opts.left && !opts.right) want = 'left';
      else if (opts.right && !opts.left) want = 'right';
      else if (opts.left && opts.right) want = this.lane === 0 ? 'right' : 'left';
    }
    return { want, opts };
  }

  update(dt, input) {
    if (input.indicate !== undefined) this.intent = input.indicate;

    if (this.mode === 'turn') { this.updateTurn(dt, input); return; }

    const c = this.cls();
    const { want, opts } = this.effectiveIntent();
    this.indicator = want === 'left' ? -1 : want === 'right' ? 1 : 0;
    const turning = want !== 'straight' && opts[want];
    const deadEnd = !turning && !opts.straight;

    // --- speed ---------------------------------------------------------
    const maxSpeed = input.maxSpeed || 999;
    let accel = input.throttle > 0 ? 12 : (input.throttle < 0 ? -22 : -4.5);
    // Auto-brake for the corner (or the wall at a dead end).
    const commitDist = turning ? this.turnStartDist(opts[want]) : 0;
    const stopAt = deadEnd
      ? this.e.len - halfWidth(this.e.cls) - 3       // stop line
      : this.e.len - commitDist;
    const goal = deadEnd ? 0 : (turning ? CORNER_SPEED : 999);
    if (goal < this.speed) {
      const dist = Math.max(0, stopAt - this.s);
      const need = (this.speed * this.speed - goal * goal) / (2 * BRAKE);
      if (dist - 1.5 < need) accel = Math.min(accel, -BRAKE);
    }
    // A red light (or any hold point the pilot's world knows about): brake
    // to the line and wait. Only applies while still short of it, so a car
    // that entered the box on amber sails on.
    const hold = input.stopAt;
    if (hold !== undefined && hold !== null && this.s < hold) {
      const dist = hold - this.s;
      const need = (this.speed * this.speed) / (2 * BRAKE);
      if (dist - 1 < need) accel = Math.min(accel, -BRAKE);
      if (dist < 1.4 && this.speed < 2.5) { this.speed = 0; accel = Math.min(accel, 0); }
    }
    this.speed = Math.max(0, this.speed + accel * dt);
    if (input.throttle > 0) this.speed = Math.min(this.speed, maxSpeed);

    // --- lateral: analog in lane, magnetised, quantised changes --------
    const st = input.steer || 0;
    // The lane magnet relaxes while the pilot is genuinely steering, or the
    // spring wins every arm-wrestle and no lane change can ever happen.
    // Stiffer numbers than the first cut: a tap should read as a decision,
    // not the opening bid in a negotiation.
    const spring = 10 * (1 - Math.min(1, Math.abs(st)) * 0.85);
    this.latV += (st * 16 - this.latV * 5 - this.lat * spring) * dt;
    this.lat += this.latV * dt * Math.min(1, this.speed / 4 + 0.15);
    const half = c.laneW * 0.5;
    // A third of a second of held steer commits the change.
    if (this.lat > half * 0.5 && st > 0.3 && this.lane < this.lanesPer() - 1) {
      this.lane += 1; this.lat -= c.laneW;           // slid left, kerbward
    } else if (this.lat < -half * 0.5 && st < -0.3 && this.lane > 0) {
      this.lane -= 1; this.lat += c.laneW;           // slid right, centreward
    }
    // Soft wall at the lane envelope: the assist never leaves the tarmac.
    // A pilot flagged `overtake` (the player) may push past the centre
    // line from lane 0 into the oncoming side - the single-lane pass, done
    // the way 1986 did it: hold the wheel over, live with what's coming
    // the other way, and the magnet tucks you home when you let go. The
    // limit is the oncoming lane's far edge, so the pass uses their
    // tarmac, never their pavement.
    const lim = half * 1.1;
    const inLim = this.overtake && this.lane === 0
      ? -(1.8 + c.laneW * 1.15)
      : -lim;
    if (this.lat > lim) { this.lat = lim; this.latV = Math.min(this.latV, 0); }
    if (this.lat < inLim) { this.lat = inLim; this.latV = Math.max(this.latV, 0); }

    // --- advance -------------------------------------------------------
    this.s += this.speed * dt;
    this.blocked = false;

    if (turning && this.s >= this.e.len - commitDist) {
      this.commitTurn(opts[want], want);
    } else if (this.s >= this.e.len) {
      if (opts.straight) {
        // Seamless continuation: same heading, next edge, keep the lane.
        const over = this.s - this.e.len;
        this.e = opts.straight.e; this.dir = opts.straight.dir;
        this.lane = Math.min(this.lane, this.lanesPer() - 1);
        this.s = over;
      } else {
        this.s = this.e.len;
        this.speed = 0;
        this.blocked = true;
      }
    } else if (deadEnd && this.s >= stopAt) {
      this.s = Math.min(this.s, stopAt);
      if (this.speed < 0.5) { this.speed = 0; this.blocked = true; }
    }
    // Blocked at a dead end: holding brake spins the car round - the 1986
    // answer to every cul-de-sac. (A real reverse gear can come later.)
    if (this.blocked && input.throttle < 0) this.uTurn();
    this.place();
  }

  uTurn() {
    this.dir = -this.dir;
    this.s = Math.max(0, this.e.len - this.s);
    this.lane = 0;
    this.lat = 0; this.latV = 0;
    this.speed = 0;
    this.intent = 'straight';
    this.blocked = false;
  }

  // The smooth version: swing through 180° on the same bezier rails as a
  // junction turn, crossing the oncoming side, and come back the other way.
  // Right-hand swing, as a left-hand-traffic U-turn should be.
  beginUTurn() {
    if (this.mode !== 'edge') return false;
    const e = this.e;
    const backS = Math.min(Math.max(e.len - this.s, 5), e.len - 5);
    const to = lanePos(e, -this.dir, 0, backS);
    const fyaw = lanePos(e, this.dir, this.lane, this.s).yaw;
    const fx = Math.sin(fyaw), fz = Math.cos(fyaw);
    const rx = Math.cos(fyaw), rz = -Math.sin(fyaw);   // right of travel
    this.turn = {
      x0: this.pos.x, z0: this.pos.z, yaw0: fyaw,
      x1: to.x, z1: to.z,
      cx: this.pos.x + fx * 6.5 + rx * 3.2,
      cz: this.pos.z + fz * 6.5 + rz * 3.2,
      y0: this.pos.y, y1: to.y,
      dyaw: Math.PI,
      t: 0,
      len: 19,
      next: { e, dir: -this.dir }, targetLane: 0, entryS: backS,
      dirn: 1,
    };
    this.mode = 'turn';
    this.lat = 0; this.latV = 0;
    this.speed = Math.max(Math.min(this.speed, 7), 3.5);
    this.intent = 'straight';
    this.blocked = false;
    return true;
  }

  // How far before the node centre the arc begins: at the crossing road's
  // kerb line, plus a little.
  turnStartDist(next) { return halfWidth(next.e.cls) + 2; }

  commitTurn(next, want) {
    const targetLane = Math.min(this.lane, CLASSES[next.e.cls].lanesPer - 1);
    const entryS = halfWidth(this.e.cls) + 2;
    const from = { x: this.pos.x, z: this.pos.z };
    const fromYaw = lanePos(this.e, this.dir, this.lane, this.s).yaw;
    const to = lanePos(next.e, next.dir, targetLane, entryS);
    // Bezier apex: the corner where the two lane lines would cross.
    const alongX = Math.abs(Math.sin(fromYaw)) > 0.5;
    const cx = alongX ? to.x : from.x;
    const cz = alongX ? from.z : to.z;
    this.turn = {
      x0: from.x, z0: from.z, yaw0: fromYaw,
      x1: to.x, z1: to.z, cx, cz,
      y0: this.pos.y, y1: to.y,
      dyaw: wrapAngle(to.yaw - fromYaw),
      t: 0,
      len: Math.hypot(to.x - from.x, to.z - from.z) * 1.22,
      next, targetLane, entryS,
      dirn: want === 'left' ? -1 : 1,
    };
    this.mode = 'turn';
    this.lat = 0; this.latV = 0;
    this.speed = Math.min(this.speed, CORNER_SPEED);
  }

  updateTurn(dt, input) {
    const T = this.turn;
    const want = input.throttle > 0 ? CORNER_SPEED : CORNER_SPEED * 0.65;
    this.speed += (want - this.speed) * Math.min(1, dt * 3);
    T.t += (this.speed / Math.max(T.len, 1)) * dt;
    if (T.t >= 1) {
      this.mode = 'edge';
      this.e = T.next.e; this.dir = T.next.dir;
      this.lane = T.targetLane;
      this.s = T.entryS;
      this.lat = 0; this.latV = 0;
      this.intent = 'straight';
      this.indicator = 0;
      this.turn = null;
      this.place();
      return;
    }
    const u = 1 - T.t, t = T.t;
    this.pos.x = u * u * T.x0 + 2 * u * t * T.cx + t * t * T.x1;
    this.pos.z = u * u * T.z0 + 2 * u * t * T.cz + t * t * T.z1;
    this.pos.y = T.y0 + (T.y1 - T.y0) * smooth01(T.t);
    this.pos.yaw = T.yaw0 + T.dyaw * smooth01(T.t);
  }

  place() {
    if (this.mode !== 'edge') return;
    const p = lanePos(this.e, this.dir, this.lane, this.s);
    const lx = -Math.cos(p.yaw), lz = Math.sin(p.yaw);   // left of travel
    this.pos.x = p.x + lx * this.lat;
    this.pos.y = p.y;
    this.pos.z = p.z + lz * this.lat;
    // Steering left noses the car left: yaw decreases toward -x at yaw 0.
    this.pos.yaw = p.yaw - Math.max(-0.3, Math.min(0.3, this.latV * 0.06));
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
const smooth01 = (t) => t * t * (3 - 2 * t);
