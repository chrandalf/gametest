// The director: targets, the law, and how much trouble you are in.
//
// Wanted works the 1986-street way: it is not what you did, it is who saw
// you do it. Police witnesses raise stars on the spot; civilian witnesses
// take a while to find a phone box. More stars, more cruisers. One or two
// stars they tail you and wait; three and they ram; four and they shoot.
// You get clean by staying unseen most of a minute per star, or by buying
// a respray where nobody is looking.
'use strict';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CLASSES, nodeAhead, headingSlot, turnOptions } from './network.mjs';
import { Driver } from './driver.mjs';

// Distance that knows about the deck: a cruiser on the expressway is not
// nine metres from a car on the street below it, it is out of reach.
const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) +
                       Math.abs((a.pos.y || 0) - (b.pos.y || 0)) * 6;

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

// The middle of the quadrant a point is in - somewhere to send a driver who
// has been told a district and nothing more.
function quadrantPoint(x, z, ext) {
  return { x: (x > ext.x / 2 ? 0.72 : 0.28) * ext.x,
           z: (z > ext.z / 2 ? 0.72 : 0.28) * ext.z };
}

// Every way to earn a star, what it is called, and how far it can take you.
export const OFFENCES = {
  speeding: { stars: 1, cap: 2, why: 'SPEEDING PAST A PATROL' },
  redLight: { stars: 1, cap: 2, why: 'RAN A RED LIGHT' },
  ramming:  { stars: 1, cap: 4, why: 'RAMMING CARS OFF THE ROAD' },
  assault:  { stars: 1, cap: 4, why: 'RAMMED A PATROL CAR' },
  shooting: { stars: 2, cap: 4, why: 'SHOOTING IN THE STREET' },
  gunfire:  { stars: 1, cap: 4, why: 'SHOOTING AT TRAFFIC' },
  killing:  { stars: 3, cap: 5, why: 'KILLED A PEDESTRIAN' },
};

export class Mission {
  constructor(scene, net, buildCar, hud, player) {
    this.scene = scene;
    this.net = net;
    this.hud = hud;
    this.buildCar = buildCar;
    this.playerRef = player || null;
    this.level = 1;
    this.state = 'locate';           // locate | intercept | done
    this.doneT = 0;
    this.cleanHands = true;
    this.wanted = 0;
    this.lastReason = '';
    this.witness = 0;                // civilian heat: boils over into a star
    this.witnessT = 0;
    this.unseenT = 0;
    this.sprayCooldown = 0;
    this.busted = false;
    this.shots = [];                 // AI shots for main to render/apply
    this.police = [];
    // The exchange: from level two the coupe is not merely running, it is
    // going somewhere. An armoured van is bringing the drop, and if the two
    // of them meet the coupe leaves the meeting stronger than it arrived.
    this.van = null;
    this.exchangeT = 0;
    this.dropDone = false;
    this.spawnTarget();
    this.ensurePolice();
    this.announce();
  }

  // ------------------------------------------------------------ spawns ----
  // A spawn is a place to hunt toward, so it must never be beside the
  // player: a van that dies and "reappears next to you" is the same van
  // formula landing on your street next level. Walk the deterministic
  // list from its usual start and take the first edge far enough away.
  farEdge(list, frac) {
    const start = ((list.length * frac) | 0) % list.length;
    const p = this.playerRef;
    for (let k = 0; k < list.length; k++) {
      const e = list[(start + k) % list.length];
      const mx = (e.a.x + e.b.x) / 2, mz = (e.a.z + e.b.z) / 2;
      if (!p || Math.hypot(mx - p.pos.x, mz - p.pos.z) > 260) return e;
    }
    return list[start];
  }

  spawnTarget() {
    const net = this.net;
    const streets = net.edges.filter(e => e.cls === 'street');
    const e = this.farEdge(streets, 0.37 + this.level * 0.19);
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
    this.targetGone = false;
    this.targetCar.root.setEnabled(true);
    this.lastSeen = null;
    this.searchPoint = null;
    this.sightingT = 6;              // the radio's first report comes early
    this.spawnVan();
  }

  spawnVan() {
    this.exchangeT = 0;
    this.dropDone = false;
    if (this.level < 2) { this.van = null; if (this.vanCar) this.vanCar.root.setEnabled(false); return; }
    const net = this.net;
    const roads = net.edges.filter(e => e.cls === 'avenue' || e.cls === 'highway');
    const e = this.farEdge(roads, 0.61 + this.level * 0.13);
    const d = new Driver(net, e, -1, 0, e.len * 0.6);
    // The exchange is a PLACE. The van used to steer at wherever the coupe
    // happened to be while the coupe steered at the van, so the pair
    // orbited each other and the van read as wandering at random. Now the
    // meet is picked when the van sets out - a junction a couple of blocks
    // from the coupe and not next to the player - and the van drives there
    // and waits like a vehicle with a job.
    {
      const t = this.target;
      let best = null, bd = 1e9;
      for (const n of net.nodes) {
        if (n.sea || n.forecourt || n.edges.filter(Boolean).length < 3) continue;
        const dc = Math.hypot(n.x - t.pos.x, n.z - t.pos.z);
        const dp = this.playerRef
          ? Math.hypot(n.x - this.playerRef.pos.x, n.z - this.playerRef.pos.z) : 1e9;
        const score = Math.abs(dc - 170) + (dp < 220 ? (220 - dp) * 2 : 0);
        if (score < bd) { bd = score; best = n; }
      }
      this.meet = best ? { x: best.x, z: best.z } : { x: t.pos.x, z: t.pos.z };
    }
    d.thinkT = 0;
    d.health = 4 + this.level;
    d.maxHealth = d.health;
    if (!this.vanCar) {
      this.vanCar = this.buildCar(new Color3(0.06, 0.10, 0.07), true,
                                  new Color3(0.9, 0.75, 0.15));
    }
    this.vanCar.root.setEnabled(true);
    this.van = d;
  }

  damageVan(n, player) {
    const v = this.van;
    if (!v) return;
    v.health -= n;
    if (v.health > 0) {
      v.spooked = true;              // a runner crew bolts at the first hit
      this.hud.say(`VAN HIT · ${v.health} MORE`);
      return;
    }
    // The drop never arrives. That is worth more than the coupe is - and
    // it goes out with a bang, because a van that silently winks out reads
    // as a bug, not a kill.
    const bonus = 300 * this.level;
    if (this.onScore) this.onScore(bonus);
    this.hud.say(`DROP STOPPED · +${bonus} — THE COUPE IS ON ITS OWN`, true);
    if (this.onBoom) this.onBoom(v.pos.x, v.pos.y, v.pos.z, 'van');
    this.van = null;
    this.vanCar.root.setEnabled(false);
    // A courier with nothing to collect runs for its life.
    this.target.stateName = 'fleeing';
    this.target.suspicion = 9;
    if (this.state === 'locate') this.state = 'intercept';
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
    const q = this.districtAt
      ? this.districtAt(this.target.pos.x, this.target.pos.z)
      : quadrantName(this.target.pos.x, this.target.pos.z, this.net.extent);
    const vanLine = !this.van ? ''
      : this.level <= 2 ? ' · A VAN IS BRINGING THE DROP'
      : this.level <= 4 ? ' · THE VAN RUNS IF IT SEES YOU'
      : ' · THE VAN CREW FIGHTS BACK';
    this.hud.say(`LEVEL ${this.level} · LOCATE BLACK COUPE · LAST SEEN ${q}` +
      (this.target.armoured ? ' · ARMOURED' : '') + vanLine, true);
  }

  // ------------------------------------------------------------ wanted ----
  nearestPoliceDist(player) {
    let d = 1e9;
    for (const p of this.police) d = Math.min(d, dist(p, player));
    return d;
  }

  // What you did, how far it can take you, and what the HUD calls it.
  // Traffic offences are traffic offences: they will never make you a
  // five-star problem. Violence will, but only killing goes all the way.
  bumpWanted(n, reason, cap) {
    const before = this.wanted;
    let next = this.wanted + n;
    if (n > 0 && cap !== undefined) next = Math.min(next, Math.max(this.wanted, cap));
    this.wanted = Math.max(0, Math.min(5, next));
    if (this.wanted !== before) {
      this.ensurePolice();
      if (n > 0) {
        this.lastReason = reason;
        const atCap = cap !== undefined && this.wanted >= cap;
        this.hud.say(`${reason} · WANTED ${'★'.repeat(this.wanted)}` +
                     (atCap ? ` · ${cap}★ IS THE MOST THIS EARNS` : ''));
      }
      this.unseenT = 0;
    } else if (n > 0 && cap !== undefined && this.wanted >= cap) {
      // Say why nothing happened, so the ceiling is legible rather than a
      // bug the player has to guess at.
      this.hud.say(`${reason} · NO EXTRA HEAT — THAT TOPS OUT AT ${cap}★`);
    }
  }

  // Something naughty happened. Police eyes act now; civilians phone it in,
  // which is slower and never quite as damning.
  witnessed(kind, player, pedsNear) {
    const o = OFFENCES[kind];
    if (this.nearestPoliceDist(player) < 55) {
      this.bumpWanted(o.stars, `POLICE SAW IT · ${o.why}`, o.cap);
      this.cleanHands = false;
    } else if (pedsNear) {
      this.witness += o.stars;
      this.witnessCap = Math.max(this.witnessCap || 0, o.cap);
      this.witnessWhy = o.why;
      if (this.witnessT <= 0) this.witnessT = 12;
    }
  }

  // ------------------------------------------------------------ impacts ----
  // `atFault` is true only when the player was the one doing the running
  // into. Contact you did not start is not an offence - otherwise a cruiser
  // that rams you on purpose books you for it.
  onPlayerImpact(other, speed, player, pedsNear, atFault) {
    if (other === this.target) {
      // A live target takes the hit; a dead one is a wreck, and clipping
      // the wreck you just earned must never read as ramming traffic -
      // that was handing out stars for winning.
      if (this.state !== 'done' && speed > 6) this.damageTarget(1, player);
    } else if (other === this.van) {
      // Loaded and armoured: ramming it hurts you more than it. And from
      // level five it is the van doing the ramming - its mass lands on
      // your hull, whoever started the contact.
      if (speed > 6) this.damageVan(0.6, player);
      if (this.level >= 5 && speed > 8 && this.onVanRam) {
        this.onVanRam(Math.min(16, speed * 1.1));
      }
    } else if (this.police.includes(other)) {
      // Same bar as ramming a civilian: it has to be a hit, not a nudge.
      // Cruisers on surveillance crowd you on purpose, and brushing one at
      // parking speed must not be the assault that starts the shooting.
      if (!atFault || speed <= 8) return;
      const o = OFFENCES.assault;
      this.bumpWanted(o.stars, o.why, o.cap);
      this.cleanHands = false;
    } else if (speed > 8 && atFault) {
      this.witnessed('ramming', player, pedsNear);
    }
  }

  onPedHit(player, byPlayer) {
    if (!byPlayer) return;
    // The only thing in the city that can make you a five-star problem.
    const o = OFFENCES.killing;
    if (this.nearestPoliceDist(player) < 55) {
      this.bumpWanted(o.stars, o.why, o.cap);
      this.cleanHands = false;
    } else {
      this.witness += 2;
      this.witnessCap = Math.max(this.witnessCap || 0, o.cap);
      this.witnessWhy = o.why;
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
      if (this.onBoom) this.onBoom(t.pos.x, t.pos.y, t.pos.z, 'target', this.cleanHands);
      this.hud.say(`TARGET DISABLED · +${base}${bonus ? ' · CLEAN +250' : ''}`, true);
      // Whatever it was carrying is now lying in the road.
      if (this.onDrop) this.onDrop(t.pos.x, t.pos.y, t.pos.z);
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
        this.bumpWanted(Math.min(2, Math.ceil(this.witness / 3)),
                        `A WITNESS CALLED IT IN · ${this.witnessWhy || 'SOMETHING YOU DID'}`,
                        this.witnessCap);
        this.witness = 0;
        this.witnessCap = 0;
      }
    }
    // Lying low: a long minute out of police sight sheds a star.
    if (this.wanted > 0) {
      if (this.nearestPoliceDist(player) > 65) {
        this.unseenT += dt;
        if (this.unseenT > 45) {
          this.bumpWanted(-1, '');
          this.hud.say(this.wanted > 0
            ? `HEAT FADING · WANTED ${'★'.repeat(this.wanted)}` : 'HEAT GONE — CLEAN', false);
          this.unseenT = 25;      // each further star drops faster
        }
      } else this.unseenT = Math.max(0, this.unseenT - dt * 2);
    }

    // ---------------- target ------------------------------------------
    // The radio: while you are hunting, somebody phones in roughly where
    // the coupe is every so often. Without this the briefing's one fixed
    // "last seen" goes stale the moment the coupe drives off, and the
    // search is an orbit round an empty district that only luck ends -
    // the bot proved it by never finding the target in two whole runs.
    // Turbo Esprit did it with police radio reports; so does this.
    if (this.state === 'locate') {
      this.sightingT = (this.sightingT ?? 6) - dt;
      if (this.sightingT <= 0) {
        this.sightingT = 14;
        // A neighbourhood, not a grid reference: the jitter keeps the last
        // fifty metres a hunt.
        this.lastSeen = { x: t.pos.x + (Math.random() - 0.5) * 90,
                          z: t.pos.z + (Math.random() - 0.5) * 90 };
        const q = this.districtAt ? this.districtAt(t.pos.x, t.pos.z) : '';
        if (q && q !== this.calledQ) {
          this.calledQ = q;
          this.hud.say(`RADIO · COUPE SPOTTED ${q}`);
        }
      }
    } else this.calledQ = null;
    if (this.state !== 'done') {
      const dp = dist(t, player);
      if (this.state === 'locate' && dp < 55) {
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
        : this.van
          ? chooseTurn(t, this.meet.x, this.meet.z, false)
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

    // ---------------- the van, and the exchange -------------------------
    if (this.van) {
      const v = this.van;
      v.thinkT -= dt;
      let vInd;
      // The van grows teeth as the levels climb. The first crew (level 2)
      // sits at the meet and takes what comes - the easy round. The next
      // crews (3-4) are runners: spooked by the player closing in or by
      // taking a hit, they bolt at speed and only settle when you back
      // right off - the chase. From level 5 the crew defends itself: see
      // the player near the meet and the van comes for YOU, and its mass
      // hurts (onVanRam, in the impact handler).
      const role = this.level <= 2 ? 'settled' : this.level <= 4 ? 'runner' : 'hunter';
      const dpv = dist(v, player);
      const toMeet = Math.hypot(v.pos.x - this.meet.x, v.pos.z - this.meet.z);
      let goal = this.meet, fleeing2 = false, hunting = false;
      if (role === 'runner') {
        if (dpv < 45) v.spooked = true;
        if (dpv > 170) v.spooked = false;
        if (v.spooked) { goal = player.pos; fleeing2 = true; }
      } else if (role === 'hunter' && dpv < 85 && !this.playerSafe) {
        goal = player.pos; hunting = true;
        // A hunter pointing the wrong way swings round on the spot rather
        // than looping the block - the chase must come TO you.
        v.swingT = (v.swingT || 0) - dt;
        if (v.mode === 'edge' && v.swingT <= 0 && dpv > 14) {
          const fx = Math.sin(v.pos.yaw), fz = Math.cos(v.pos.yaw);
          const dx = player.pos.x - v.pos.x, dz = player.pos.z - v.pos.z;
          if ((fx * dx + fz * dz) / Math.max(1, Math.hypot(dx, dz)) < -0.4) {
            v.beginUTurn();
            v.swingT = 5;
          }
        }
      }
      const arrived = !fleeing2 && !hunting && toMeet < 30;
      if (v.thinkT <= 0) {
        v.thinkT = (fleeing2 || hunting) ? 0.6 : 2.2;
        vInd = arrived ? 'straight' : chooseTurn(v, goal.x, goal.z, fleeing2);
      }
      const vCap = arrived ? 3
        : CLASSES[v.e.cls].limit * (fleeing2 ? 1.35 : hunting ? 1.5 : 0.8);
      v.update(dt, { throttle: arrived ? -1 : 1, steer: 0, indicate: vInd,
                     maxSpeed: vCap });
      if (v.blocked) v.beginUTurn();
      this.vanCar.root.position.set(v.pos.x, v.pos.y, v.pos.z);
      this.vanCar.root.rotation.y = v.pos.yaw;

      // Close enough for long enough and the drop goes through.
      const meet = dist(t, v);
      if (meet < 26 && this.state !== 'done') {
        this.exchangeT += dt;
        if (this.exchangeT > 1 && this.exchangeT - dt <= 1) {
          this.hud.say('THEY ARE MAKING THE EXCHANGE — BREAK IT UP', true);
        }
        if (this.exchangeT > 4 && !this.dropDone) {
          this.dropDone = true;
          this.cleanHands = false;
          t.armoured = true;
          t.health = t.maxHealth = t.health + 3 + this.level;
          t.stateName = 'fleeing';
          t.suspicion = 9;
          this.hud.say('THE DROP WENT THROUGH — THE COUPE IS ARMOURED NOW', true);
          this.van = null;
          this.vanCar.root.setEnabled(false);
        }
      } else {
        this.exchangeT = Math.max(0, this.exchangeT - dt * 0.6);
      }
    }

    // ---------------- the fleet ----------------------------------------
    for (const p of this.police) {
      p.thinkT -= dt;
      let pInd;
      const dp = dist(p, player);
      if (this.wanted > 0) {
        if (p.thinkT <= 0) {
          p.thinkT = this.wanted >= 3 ? 0.3 : 0.9;
          pInd = chooseTurn(p, player.pos.x, player.pos.z, false);
        }
      } else if (p.thinkT <= 0) {
        p.thinkT = 4;
        pInd = Math.random() < 0.6 ? 'straight' : Math.random() < 0.5 ? 'left' : 'right';
      }
      // One or two stars is surveillance, not a demolition derby: they
      // shadow you at a civil pace and wait for you to stop somewhere
      // stupid. Only from three stars do they drive THROUGH you - which is
      // what the ladder has promised all along.
      const aggr = this.wanted >= 3 ? 1.85 : this.wanted > 0 ? 1.12 : 0.9;
      p.update(dt, { throttle: 1, steer: 0, indicate: pInd,
                     maxSpeed: CLASSES[p.e.cls].limit * aggr });
      if (p.blocked) p.beginUTurn();
      // Four stars: they shoot - but not at a car in a garage.
      if (this.wanted >= 4 && !this.playerSafe) {
        p.fireT -= dt;
        if (p.fireT <= 0 && dp < 30) {
          p.fireT = 1.1;
          this.shots.push({ from: p.pos, to: player.pos, hurt: 6, kind: 'police' });
        }
      }
      // Busted: pinned slow at three stars or more. Stopped in a garage is
      // not pinned - and neither is waiting at a red on two stars, because
      // obeying the law must never be what hands you to it. Traffic
      // offences cap at two stars, so a bust always traces back to
      // violence.
      if (this.wanted >= 3 && dp < 7 && player.speed < 3 && !this.playerSafe) {
        p.bustT += dt;
        if (p.bustT > 2.5) this.busted = true;
      } else p.bustT = 0;
      p.car.root.position.set(p.pos.x, p.pos.y, p.pos.z);
      p.car.root.rotation.y = p.pos.yaw;
    }

    // ---------------- loop ---------------------------------------------
    if (this.state === 'done') {
      this.doneT += dt;
      // The wreck burns for a moment, then it is gone - a dead coupe
      // sitting solid in the road for nine seconds was a wall you could
      // be booked for driving into.
      if (this.doneT > 2.5 && !this.targetGone) {
        this.targetGone = true;
        this.targetCar.root.setEnabled(false);
      }
      if (this.doneT > 9) {
        this.level += 1;
        this.state = 'locate';
        this.cleanHands = true;
        this.spawnTarget();
        if (this.onLevel) this.onLevel(this.level);
        this.announce();
      }
    }
    this.targetCar.root.position.set(t.pos.x, t.pos.y, t.pos.z);
    this.targetCar.root.rotation.y = t.pos.yaw;
  }

  // The marks that matter carry `big`: the van, the coupe and the last
  // sighting must read at a glance, not hide among the traffic dots.
  mapEntries() {
    const out = this.police.map(p => ({ pos: p.pos, mapColour: 'rgba(90, 160, 255, 0.95)' }));
    if (this.van) out.push({ pos: this.van.pos, mapColour: 'rgba(255, 190, 60, 0.98)', big: true });
    if (this.state !== 'locate' && !this.targetGone) {
      out.push({ pos: this.target.pos, mapColour: 'rgba(255, 70, 70, 0.95)', big: true });
    } else if (this.state === 'locate' && this.lastSeen) {
      out.push({ pos: this.lastSeen, mapColour: 'rgba(255, 130, 130, 0.6)', big: true });
    }
    return out;
  }

  // Something to steer at, always. With a fix, the target; without one, the
  // last place it was seen; and failing that the middle of the district the
  // briefing named - because "NO FIX, SEARCH THE DISTRICT" with the arrow
  // pointing nowhere is not a direction, it is a shrug.
  bearingPoint() {
    if (this.state !== 'locate') return this.target.pos;
    if (this.lastSeen) return this.lastSeen;
    if (!this.searchPoint) {
      this.searchPoint = quadrantPoint(this.target.pos.x, this.target.pos.z,
                                       this.net.extent);
    }
    return this.searchPoint;
  }
}
