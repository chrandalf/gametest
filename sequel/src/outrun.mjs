// The coast: what the ring road really is. Out here the game changes key -
// OutRun, not Turbo Esprit. Sometimes a pack of hot coupes pulls up and
// wants to race you to an interchange; sometimes nothing happens at all
// except the sun, the sea, and a cruise bonus for keeping your foot in.
'use strict';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CLASSES } from './network.mjs';
import { Driver } from './driver.mjs';

const RACER_COLOURS = [
  [new Color3(0.9, 0.15, 0.1), new Color3(1.6, 0.5, 0.2)],
  [new Color3(0.95, 0.75, 0.08), new Color3(1.6, 1.2, 0.2)],
  [new Color3(0.15, 0.5, 0.95), new Color3(0.3, 0.9, 1.7)],
];
const RACE_DIST = 380;              // metres to the "interchange"

export class Coast {
  constructor(net, buildCar, hud) {
    this.net = net;
    this.hud = hud;
    this.state = 'idle';            // idle | race | cruise
    this.nextEventT = 20;
    this.cruiseT = 0;
    this.racers = [];
    for (let k = 0; k < 3; k++) {
      const car = buildCar(RACER_COLOURS[k][0], true, RACER_COLOURS[k][1]);
      car.root.setEnabled(false);
      this.racers.push({ car, d: null, progress: 0 });
    }
    this.playerProgress = 0;
  }

  onHighway(player) { return player.e && player.e.cls === 'highway'; }

  startRace(player, clock) {
    const e = player.e, dir = player.dir;
    for (let k = 0; k < this.racers.length; k++) {
      const r = this.racers[k];
      const d = new Driver(this.net, e, dir, Math.min(k, CLASSES.highway.lanesPer - 1),
                           Math.max(4, player.s - 10 - k * 7));
      d.thinkT = 0;
      r.d = d;
      r.progress = 0;
      r.car.root.setEnabled(true);
    }
    this.playerProgress = 0;
    this.state = 'race';
    this.hud.say('THEY WANT TO RACE — FIRST TO THE INTERCHANGE', true);
    this.raceStartClock = clock;
  }

  endRace(won) {
    for (const r of this.racers) { r.d = null; r.car.root.setEnabled(false); }
    this.state = 'idle';
    this.nextEventT = 40 + Math.random() * 50;
    if (won === true) {
      this.hud.say('YOU TOOK THEM · +400', true);
      if (this.onScore) this.onScore(400);
    } else if (won === false) {
      this.hud.say('THEY GOT YOU — NEXT TIME', true);
    } else {
      this.hud.say('RACE OFF — THEY PEELED AWAY');
    }
    setTimeout(() => { if (this.announceBack) this.announceBack(); }, 3000);
  }

  update(dt, player, clock, wanted) {
    const on = this.onHighway(player) || player.mode === 'turn';

    if (this.state === 'idle') {
      if (on && wanted === 0) {
        this.nextEventT -= dt;
        // The quiet reward: cruising the coast fast pays on its own.
        if (player.speed > 24) {
          this.cruiseT += dt;
          if (this.onScore) this.onScore(dt * 6);
          if (this.cruiseT > 6 && this.cruiseT < 6.1) {
            this.hud.say('COAST CRUISE — SPEED PAYS');
          }
        } else this.cruiseT = Math.max(0, this.cruiseT - dt);
        if (this.nextEventT <= 0 && player.speed > 18) {
          this.startRace(player, clock);
        }
      } else {
        this.cruiseT = 0;
      }
      return;
    }

    // ---- racing -------------------------------------------------------
    if (this.state === 'race') {
      // Leaving the coast abandons the race.
      if (!on) { this.endRace(null); return; }
      this.playerProgress += player.speed * dt;
      let bestRacer = 0;
      for (const r of this.racers) {
        if (!r.d) continue;
        const d = r.d;
        d.thinkT -= dt;
        // Rubber-banded pace: behind the player they charge, ahead they ease.
        const gap = r.progress - this.playerProgress;
        const pace = gap > 25 ? 0.86 : gap < -25 ? 1.35 : 1.12;
        d.update(dt, { throttle: 1, steer: 0,
                       maxSpeed: CLASSES.highway.limit * pace });
        if (d.blocked) d.beginUTurn();
        r.progress += d.speed * dt;
        bestRacer = Math.max(bestRacer, r.progress);
        r.car.root.position.set(d.pos.x, 0, d.pos.z);
        r.car.root.rotation.y = d.pos.yaw;
      }
      if (this.playerProgress >= RACE_DIST) this.endRace(true);
      else if (bestRacer >= RACE_DIST) this.endRace(false);
    }
  }

  mapEntries() {
    if (this.state !== 'race') return [];
    return this.racers.filter(r => r.d)
      .map(r => ({ pos: r.d.pos, mapColour: 'rgba(255, 200, 80, 0.95)' }));
  }
}
