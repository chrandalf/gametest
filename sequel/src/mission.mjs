// The director: targets, the law, and how much trouble you are in.
//
// Wanted works the 1986-street way: it is not what you did, it is who saw
// you do it. Police witnesses raise stars on the spot; civilian witnesses
// take a while to find a phone box. More stars, more cruisers; three stars
// and they ram; four and they shoot. You get clean by staying unseen for a
// long minute per star, or by buying a respray where nobody is looking.
'use strict';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CLASSES, nodeAhead, headingSlot, turnOptions } from './network.mjs';
import { Driver } from './driver.mjs';

const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

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
  return `${z > ext.z / 2 ? 'NORTH' : 'SOUTH'}-${x > ext.x / 2 ? 'EAST' : 'WEST'}`;
}

export class Mission {
  constructor(scene, net, buildCar, hud) {
    this.scene = scene;
    this.net = net;
    this.hud = hud;
    this.buildCar = buildCar;
    this.level = 1;
    this.state = 'locate';           // locate | intercept | done
    this.doneT = 0;
    this.cleanHands = true;
    this.wanted = 0;
    this.witness = 0;                // civilian heat: boils over into a star
    this.witnessT = 0;
    this.unseenT = 0;
    this.sprayCooldown = 0;
    this.busted = false;
    this.shots = [];                 // AI shots for main to render/apply
    this.police = [];
    this.spawnTarget();
    this.ensurePolice();
    this.announce();
  }

  // ------------------------------------------------------------ spawns ----
  spawnTarget() {
    const net = this.net;
    const streets = net.edges.filter(e => e.cls === 'street');
    const e = streets[((streets.length * (0.37 + this.level * 0.19)) | 0) % streets.length];
    const d = new Driver(net, e, 1, 0, e.len * 0.3);
    d.suspicion = 0;
    d.armoured = this.level >= 3;
    d.health = 2 + this.level + (d.armoured ? 2 : 0);
    d.maxHealth = d.health;
    d.stateName = 'cruise';
    d.thinkT = 0;
    d.fireT = 0;
    if (!this.targetCar) {
      this.targetCar = this.buildCar(new Color3(0.015, 0.015, 0.02), true,
                                     new Color3(0.75, 0.06, 0.05));
    }
    this.target = d;
  }

  policeWanted() { return Math.min(1 + this.wanted, 5); }

  ensurePolice() {
    const want = this.policeWanted();
    const net = this.net;
    while (this.police.length < want) {
      const k = this.police.length;
      const aves = net.edges.filter(e => e.cls !== 'street');
      const e = aves[(k * 29 + 11) % aves.length];
      const d = new Driver(net, e, k % 2 ? 1 : -1, 0, e.len * 0.5);
      d.thinkT = 0; d.fireT = 0; d.bustT = 0;
      d.car = this.buildCar(new Color3(0.82, 0.85, 0.92), true,
                            new Color3(0.25, 0.55, 2.0));
      // Lightbar per cruiser; main styles the strobe via this.beaconMats.
      this.police.push(d);
      if (this.onPoliceSpawn) this.onPoliceSpawn(d);
    }
    while (this.police.length > want) {
      const d = this.police.pop();
      d.car.root.setEnabled(false);
      d.retired = true;
    }
  }

  announce() {
    const q = quadrantName(this.target.pos.x, this.target.pos.z, this.net.extent);
    this.hud.say(`LEVEL ${this.level} · LOCATE BLACK COUPE · LAST SEEN ${q}` +
      (this.target.armoured ? ' · ARMOURED' : ''), true);
  }

  // ------------------------------------------------------------ wanted ----
  nearestPoliceDist(player) {
    let d = 1e9;
    for (const p of this.police) d = Math.min(d, dist(p, player));
    return d;
  }

  bumpWanted(n, reason) {
    const before = this.wanted;
    this.wanted = Math.max(0, Math.min(5, this.wanted + n));
    if (this.wanted !== before) {
      this.ensurePolice();
      if (n > 0) this.hud.say(`${reason} · WANTED ${'★'.repeat(this.wanted)}`);
      this.unseenT = 0;
    }
  }

  // Something naughty happened. Police eyes act now; civilians phone it in.
  witnessed(severity, player, pedsNear) {
    if (this.nearestPoliceDist(player) < 55) {
      this.bumpWanted(severity, severity >= 3 ? 'THEY SAW THAT' : 'POLICE SAW YOU');
      this.cleanHands = false;
    } else if (pedsNear) {
      this.witness += severity;
      if (this.witnessT <= 0) this.witnessT = 12;
    }
  }

  // ------------------------------------------------------------ impacts ----
  onPlayerImpact(other, speed, player, pedsNear) {
    if (other === this.target && this.state !== 'done') {
      if (speed > 6) this.damageTarget(1, player);
    } else if (this.police.includes(other)) {
      this.bumpWanted(1, 'ASSAULT ON AN OFFICER');
      this.cleanHands = false;
    } else if (speed > 8) {
      this.witnessed(1, player, pedsNear);
    }
  }

  onPedHit(player, byPlayer) {
    if (!byPlayer) return;
    // Running someone over in front of the law is a three-star crime.
    if (this.nearestPoliceDist(player) < 55) {
      this.bumpWanted(3, 'HIT AND RUN, WITNESSED');
      this.cleanHands = false;
    } else {
      this.witness += 2;
      if (this.witnessT <= 0) this.witnessT = 10;
    }
  }

  damageTarget(n, player) {
    const t = this.target;
    t.health -= n;
    if (t.health > 0) {
      this.hud.say(`TARGET HIT · ${t.health} MORE`);
      if (t.stateName !== 'fleeing') { t.stateName = 'fleeing'; t.suspicion = 9; }
      if (this.state === 'locate') { this.state = 'intercept'; }
    } else if (this.state !== 'done') {
      this.state = 'done';
      this.doneT = 0;
      const base = 500 * this.level;
      const bonus = this.cleanHands ? 250 : 0;
      if (this.onScore) this.onScore(base + bonus);
      this.hud.say(`TARGET DISABLED · +${base}${bonus ? ' · CLEAN +250' : ''}`, true);
    }
  }

  // Refuelling stop doubles as a respray when nobody in blue is watching.
  tryDisguise(player, clock) {
    if (this.wanted === 0 || clock < this.sprayCooldown) return false;
    if (this.nearestPoliceDist(player) < 70) return false;
    this.wanted = 0;
    this.witness = 0;
    this.sprayCooldown = clock + 90;
    this.ensurePolice();
    this.hud.say('RESPRAYED — THEY ARE LOOKING FOR A DIFFERENT CAR', true);
    setTimeout(() => this.announce(), 2600);
    return true;
  }

  // ------------------------------------------------------------ update ----
  update(dt, player, clock) {
    const t = this.target;
    this.shots.length = 0;

    // Civilian witnesses find their phone box.
    if (this.witnessT > 0) {
      this.witnessT -= dt;
      if (this.witnessT <= 0 && this.witness > 0) {
        this.bumpWanted(Math.min(2, Math.ceil(this.witness / 3)), 'SOMEONE CALLED IT IN');
        this.witness = 0;
      }
    }
    // Lying low: a long minute out of police sight sheds a star.
    if (this.wanted > 0) {
      if (this.nearestPoliceDist(player) > 65) {
        this.unseenT += dt;
        if (this.unseenT > 60) {
          this.bumpWanted(-1, '');
          this.hud.say(this.wanted > 0
            ? `HEAT FADING · WANTED ${'★'.repeat(this.wanted)}` : 'HEAT GONE — CLEAN', false);
          this.unseenT = 30;      // each further star drops faster
        }
      } else this.unseenT = Math.max(0, this.unseenT - dt * 2);
    }

    // ---------------- target ------------------------------------------
    if (this.state !== 'done') {
      const dp = dist(t, player);
      if (this.state === 'locate' && dp < 45) {
        this.state = 'intercept';
        this.hud.say('TARGET LOCATED — INTERCEPT', true);
      }
      if (t.stateName === 'cruise') {
        if (dp < 26) {
          t.suspicion += dt * (1 + this.level * 0.12);
          if (t.suspicion > 4) t.stateName = 'suspicious';
        } else t.suspicion = Math.max(0, t.suspicion - dt);
      } else if (t.stateName === 'suspicious') {
        if (dp < 16 || t.suspicion > 8) {
          t.stateName = 'fleeing';
          this.hud.say('TARGET IS RUNNING');
        }
        t.suspicion += dt * (dp < 26 ? 1 : -0.5);
        if (t.suspicion < 1.5) t.stateName = 'cruise';
      } else if (t.stateName === 'fleeing' && dist(t, player) > 240) {
        t.stateName = 'cruise'; t.suspicion = 0;
        this.state = 'locate';
        this.hud.say('TARGET LOST — RELOCATE', true);
      }
    }
    if (this.state !== 'locate') this.lastSeen = { x: t.pos.x, z: t.pos.z };

    const fleeing = t.stateName === 'fleeing' && this.state !== 'done';
    t.thinkT -= dt;
    let tInd;
    if (t.thinkT <= 0) {
      t.thinkT = fleeing ? 0.55 : 3.5;
      tInd = fleeing
        ? chooseTurn(t, player.pos.x, player.pos.z, true)
        : (Math.random() < 0.5 ? 'straight' : Math.random() < 0.5 ? 'left' : 'right');
    }
    const fleeMult = 1.45 + this.level * 0.07;
    const tCap = this.state === 'done' ? 0
      : fleeing ? CLASSES[t.e.cls].limit * fleeMult
      : t.stateName === 'suspicious' ? CLASSES[t.e.cls].limit * 1.1
      : CLASSES[t.e.cls].limit * 0.85;
    t.update(dt, { throttle: this.state === 'done' ? -1 : 1, steer: 0,
                   indicate: tInd, maxSpeed: tCap });
    if (t.blocked) t.beginUTurn();
    // From level 4, a cornered coupe shoots back.
    if (this.level >= 4 && fleeing) {
      t.fireT -= dt;
      const dp = dist(t, player);
      if (t.fireT <= 0 && dp < 34) {
        t.fireT = 0.9;
        this.shots.push({ from: t.pos, to: player.pos, hurt: 4, kind: 'target' });
      }
    }

    // ---------------- the fleet ----------------------------------------
    for (const p of this.police) {
      p.thinkT -= dt;
      let pInd;
      const dp = dist(p, player);
      if (this.wanted > 0) {
        if (p.thinkT <= 0) {
          p.thinkT = this.wanted >= 3 ? 0.3 : 0.55;
          pInd = chooseTurn(p, player.pos.x, player.pos.z, false);
        }
      } else if (p.thinkT <= 0) {
        p.thinkT = 4;
        pInd = Math.random() < 0.6 ? 'straight' : Math.random() < 0.5 ? 'left' : 'right';
      }
      const aggr = this.wanted >= 3 ? 1.85 : this.wanted > 0 ? 1.6 : 0.9;
      p.update(dt, { throttle: 1, steer: 0, indicate: pInd,
                     maxSpeed: CLASSES[p.e.cls].limit * aggr });
      if (p.blocked) p.beginUTurn();
      // Four stars: they shoot.
      if (this.wanted >= 4) {
        p.fireT -= dt;
        if (p.fireT <= 0 && dp < 30) {
          p.fireT = 1.1;
          this.shots.push({ from: p.pos, to: player.pos, hurt: 6, kind: 'police' });
        }
      }
      // Busted: pinned slow at two stars or more.
      if (this.wanted >= 2 && dp < 7 && player.speed < 3) {
        p.bustT += dt;
        if (p.bustT > 2.5) this.busted = true;
      } else p.bustT = 0;
      p.car.root.position.set(p.pos.x, 0, p.pos.z);
      p.car.root.rotation.y = p.pos.yaw;
    }

    // ---------------- loop ---------------------------------------------
    if (this.state === 'done') {
      this.doneT += dt;
      if (this.doneT > 7) {
        this.level += 1;
        this.state = 'locate';
        this.cleanHands = true;
        this.spawnTarget();
        this.announce();
      }
    }
    this.targetCar.root.position.set(t.pos.x, 0, t.pos.z);
    this.targetCar.root.rotation.y = t.pos.yaw;
  }

  mapEntries() {
    const out = this.police.map(p => ({ pos: p.pos, mapColour: 'rgba(90, 160, 255, 0.95)' }));
    if (this.state !== 'locate') {
      out.push({ pos: this.target.pos, mapColour: 'rgba(255, 70, 70, 0.95)' });
    } else if (this.lastSeen) {
      out.push({ pos: this.lastSeen, mapColour: 'rgba(255, 130, 130, 0.45)' });
    }
    return out;
  }

  bearingPoint() {
    if (this.state !== 'locate') return this.target.pos;
    return this.lastSeen || null;
  }
}
