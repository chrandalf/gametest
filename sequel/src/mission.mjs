// The hunt: Turbo Esprit's game, distilled. A black coupe is somewhere in
// the city driving like anybody else. Find it, and it notices you; stay on
// it, and it runs; ram it enough, and it is disabled. A police cruiser
// patrols on its own copy of the same lane grammar and takes a dim view of
// you hitting things.
'use strict';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CLASSES, nodeAhead, headingSlot, turnOptions } from './network.mjs';
import { Driver } from './driver.mjs';

const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

// Steer a Driver toward / away from a world point by choosing indicators.
// The grammar does the driving; the AI only chooses turns - which is
// exactly what makes chases fair.
function chooseTurn(d, tx, tz, flee) {
  const node = nodeAhead(d.e, d.dir);
  const opts = turnOptions(node, headingSlot(d.e, d.dir));
  let best = null, bestD = null;
  for (const [name, o] of Object.entries(opts)) {
    if (!o) continue;
    const far = o.dir > 0 ? o.e.b : o.e.a;
    const s = Math.hypot(far.x - tx, far.z - tz);
    if (bestD === null || (flee ? s > bestD : s < bestD)) { best = name; bestD = s; }
  }
  return best || 'straight';
}

function quadrantName(x, z, ext) {
  const ns = z > ext.z / 2 ? 'NORTH' : 'SOUTH';
  const ew = x > ext.x / 2 ? 'EAST' : 'WEST';
  return `${ns}-${ew}`;
}

export class Mission {
  constructor(scene, net, buildCar, hud) {
    this.net = net;
    this.hud = hud;
    this.buildCar = buildCar;
    this.state = 'locate';           // locate | intercept | done
    this.doneT = 0;
    this.cleanHands = true;          // no police involvement = bonus line
    this.spawnTarget();
    this.spawnPolice();
    this.announce();
  }

  spawnTarget() {
    const net = this.net;
    // Far from the centre, on a street, driving like a citizen.
    const streets = net.edges.filter(e => e.cls === 'street');
    const e = streets[(streets.length * 0.73) | 0];
    const d = new Driver(net, e, 1, 0, e.len * 0.3);
    d.suspicion = 0;
    d.health = 3;
    d.stateName = 'cruise';
    d.thinkT = 0;
    if (!this.targetCar) this.targetCar = this.buildCar(new Color3(0.015, 0.015, 0.02), true);
    this.target = d;
  }

  spawnPolice() {
    const net = this.net;
    const aves = net.edges.filter(e => e.cls === 'avenue');
    const e = aves[(aves.length * 0.4) | 0];
    const d = new Driver(net, e, -1, 0, e.len * 0.5);
    d.thinkT = 0;
    d.pursuit = 0;                   // 0 calm, 1 chasing
    d.evadeT = 0;
    this.policeCar = this.buildCar(new Color3(0.82, 0.85, 0.92), true);
    this.police = d;
  }

  announce() {
    const t = this.target;
    const q = quadrantName(t.pos.x, t.pos.z, this.net.extent);
    this.hud.say(`LOCATE TARGET · BLACK COUPE · LAST SEEN ${q}`, true);
  }

  // Player rammed something: the mission hears about every impact.
  onPlayerImpact(other, speed) {
    if (other === this.target && this.state !== 'done') {
      if (speed > 6) {
        other.health -= 1;
        this.hud.say(other.health > 0
          ? `TARGET HIT · ${other.health} MORE`
          : 'TARGET DISABLED — MISSION COMPLETE', other.health > 0 ? false : true);
        if (other.health <= 0) {
          this.state = 'done';
          this.doneT = 0;
          if (this.cleanHands) setTimeout(() =>
            this.hud.say('MISSION COMPLETE · NO POLICE — BONUS', true), 1600);
        }
      }
    } else if (this.police && dist({ pos: this.police.pos }, { pos: other.pos }) < 80) {
      // Hitting civilians in front of the law.
      this.police.pursuit = 1;
      this.cleanHands = false;
      this.hud.say('POLICE PURSUIT — LOSE THEM');
    }
  }

  update(dt, player, clock) {
    const t = this.target, p = this.police;

    // ---------------- target brain ------------------------------------
    if (this.state !== 'done') {
      const dp = dist(t, player);
      if (this.state === 'locate' && dp < 45) {
        this.state = 'intercept';
        this.hud.say('TARGET LOCATED — INTERCEPT', true);
      }
      if (t.stateName === 'cruise') {
        if (dp < 26) {
          t.suspicion += dt;
          if (t.suspicion > 4) { t.stateName = 'suspicious'; }
        } else t.suspicion = Math.max(0, t.suspicion - dt);
      } else if (t.stateName === 'suspicious') {
        if (dp < 16 || t.suspicion > 8) {
          t.stateName = 'fleeing';
          this.hud.say('TARGET IS RUNNING');
        }
        t.suspicion += dt * (dp < 26 ? 1 : -0.5);
        if (t.suspicion < 1.5) t.stateName = 'cruise';
      } else if (t.stateName === 'fleeing' && dp > 220) {
        t.stateName = 'cruise'; t.suspicion = 0;
        this.state = 'locate';
        this.hud.say('TARGET LOST — RELOCATE', true);
      }
    }
    const fleeing = t.stateName === 'fleeing' && this.state !== 'done';
    t.thinkT -= dt;
    let tInd;
    if (t.thinkT <= 0) {
      t.thinkT = fleeing ? 0.6 : 3.5;
      tInd = fleeing
        ? chooseTurn(t, player.pos.x, player.pos.z, true)
        : (Math.random() < 0.5 ? 'straight' : Math.random() < 0.5 ? 'left' : 'right');
    }
    const tCap = this.state === 'done' ? 0
      : fleeing ? CLASSES[t.e.cls].limit * 1.45
      : t.stateName === 'suspicious' ? CLASSES[t.e.cls].limit * 1.1
      : CLASSES[t.e.cls].limit * 0.85;
    t.update(dt, { throttle: this.state === 'done' ? -1 : 1, steer: 0,
                   indicate: tInd, maxSpeed: tCap });
    if (t.blocked) t.uTurn();

    // ---------------- police brain ------------------------------------
    p.thinkT -= dt;
    let pInd;
    const dPolice = dist(p, player);
    if (p.pursuit > 0) {
      if (p.thinkT <= 0) { p.thinkT = 0.5;
        pInd = chooseTurn(p, player.pos.x, player.pos.z, false); }
      if (dPolice > 170) { p.evadeT += dt; } else p.evadeT = 0;
      if (p.evadeT > 8) {
        p.pursuit = 0;
        this.hud.say('PURSUIT LOST — STAY CLEAN');
      }
    } else if (p.thinkT <= 0) {
      p.thinkT = 4;
      pInd = Math.random() < 0.6 ? 'straight' : Math.random() < 0.5 ? 'left' : 'right';
    }
    const pCap = p.pursuit > 0 ? CLASSES[p.e.cls].limit * 1.6
                               : CLASSES[p.e.cls].limit * 0.9;
    p.update(dt, { throttle: 1, steer: 0, indicate: pInd, maxSpeed: pCap });
    if (p.blocked) p.uTurn();

    // Busted check: pinned close and slow while pursued.
    if (p.pursuit > 0 && dPolice < 7 && player.speed < 3) {
      p.bustT = (p.bustT || 0) + dt;
      if (p.bustT > 2.5) {
        p.pursuit = 0; p.bustT = 0;
        this.hud.say('BUSTED — FINE PAID, DRIVE ON', true);
        setTimeout(() => this.announce(), 3200);
      }
    } else p.bustT = 0;

    // ---------------- mission loop ------------------------------------
    if (this.state === 'done') {
      this.doneT += dt;
      if (this.doneT > 9) {
        this.state = 'locate';
        this.cleanHands = true;
        this.spawnTarget();
        this.announce();
      }
    }

    // Cars follow their drivers.
    this.targetCar.root.position.set(t.pos.x, 0, t.pos.z);
    this.targetCar.root.rotation.y = t.pos.yaw;
    this.policeCar.root.position.set(p.pos.x, 0, p.pos.z);
    this.policeCar.root.rotation.y = p.pos.yaw;
    // Police roof strobe: the lightbar material flashes while pursuing.
    if (this.beacon) {
      const on = p.pursuit > 0 ? Math.sin(clock * 18) > 0 : Math.sin(clock * 4) > 0.85;
      this.beacon.emissiveColor = on
        ? new Color3(0.4, 0.6, 2.2) : new Color3(1.8, 0.15, 0.15);
    }
  }

  // Map colouring: the target only appears once located; police always.
  mapEntries() {
    const out = [{ pos: this.police.pos, mapColour: 'rgba(90, 160, 255, 0.95)' }];
    if (this.state !== 'locate') {
      out.push({ pos: this.target.pos, mapColour: 'rgba(255, 70, 70, 0.95)' });
    }
    return out;
  }
}
