// Missions, in the spirit of Turbo Esprit: proper jobs with a win and a lose,
// dealt out in an escalating chain. Four flavours rotate as the level climbs:
//
//   STREET RACE   — the circuit race, but now you have to WIN it.
//   WRECK THE GANG — hunters that come for you; destroy every one.
//   STOP THE ARMOURED CAR — it is making for the edge of the map, it is
//                   plated like a safe, and at higher levels it has friends.
//   HOSPITAL RUSH — put a quota of pedestrians on stretchers before the
//                   clock runs out. The ambulances will be busy.
//
// Rewards scale with level; failure just means pressing J and going again.
'use strict';

// A gang car that hunts the player: full throttle at your predicted position,
// no lane discipline, no respect for red lights. Wreck it before it wrecks you.
class HunterCar extends TrafficCar {
  constructor(i, j, dx, dz, rand, city) {
    super(i, j, dx, dz, [0.62, 0.08, 0.10], rand, city);
    this.hunter = true;
    this.noRetire = true;
    this.ignoreLights = true;
    this.maxSpeed = 27;
    this.lawAbiding = 3;         // the limit is somebody else's problem
    this.stuckT = 0;
  }

  update(dt, world) {
    this.world = world;
    const car = game.car;
    const d = Math.hypot(car.x - this.x, car.z - this.z);
    // Wrecked, sliding, frozen or out of range: behave like ordinary traffic.
    if (this.wreckage > 0.7 || this.skid > 0 || d > 170 || !game.player.inCar ||
        (game.power && game.power.freeze > 0)) {
      super.update(dt, world);
      return;
    }
    // Wedged on street furniture: back out and swing the nose.
    this.stuckT = this.speed < 1.2 ? this.stuckT + dt : 0;
    if (this.stuckT > 0.9) {
      this.drive(dt, -0.8, this.stuckSteer || 0.7, false, world.city);
      if (this.stuckT > 2.0) { this.stuckT = 0; this.stuckSteer = -(this.stuckSteer || 0.7); }
      return;
    }
    // Ram the point the player is about to be, not the point they are at.
    const lead = clamp(d / 18, 0.15, 1.3);
    const tx = car.x + car.vx * lead, tz = car.z + car.vz * lead;
    const desired = Math.atan2(tx - this.x, tz - this.z);
    const err = angDelta(this.yaw, desired);
    this.drive(dt, Math.abs(err) > 2.3 ? -0.5 : 1, clamp(err * 2.4, -1, 1), false, world.city);
  }
}

// The armoured car. Heavy, plated (damage scaled right down), and single-
// minded: it has a route to the edge of the map and it is taking it.
class ArmouredCar extends CommuterCar {
  constructor(city, startNode, route, exit, rand, level) {
    super(city, null, { x: exit.x, z: exit.z, yaw: 0, kind: 'kerb' }, route, startNode,
          [0.30, 0.31, 0.36], rand);
    this.armoured = true;
    this.van = true;
    this.noRetire = true;
    this.ignoreLights = true;
    this.mass = 3400;
    this.halfLen = 2.55; this.halfWid = 1.05;
    this.maxSpeed = Math.min(24, 15 + level * 0.8);
    this.lawAbiding = 3;
    // The plating: how little of every hit gets through.
    this.damageScale = clamp(0.5 - level * 0.02, 0.22, 0.5);
  }

  update(dt, world) {
    if (game.power && game.power.freeze > 0) {
      this.drive(dt, 0, 0, true, world.city);
      return;
    }
    super.update(dt, world);
  }
}

const MISSION_ORDER = ['race', 'wreck', 'chase', 'blood'];

// Junctions in a distance band from a point, for spawning gangs and targets.
function junctionsInRing(city, x, z, near, far) {
  const out = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      if (city.degree(i, j) < 2) continue;
      const d = Math.hypot(roadCenter(i) - x, roadCenter(j) - z);
      if (d > near && d < far) out.push({ i, j, d });
    }
  }
  return out;
}

class MissionControl {
  constructor() {
    this.level = 1;
    this.m = null;
  }

  // J: start the next job, or abandon the one running.
  toggle() {
    if (game.isMap) { say('No jobs on imported maps yet'); return; }
    if (this.m) { this.cleanup(); this.m = null; say('MISSION ABANDONED'); return; }
    this.start();
  }

  start() {
    const L = this.level;
    const type = MISSION_ORDER[(L - 1) % MISSION_ORDER.length];
    const rand = game.rand;
    const city = game.city;
    const player = game.car;

    if (type === 'race') {
      if (!city.circuit) { this.level++; return this.start(); }
      if (!game.race) startRace();
      this.m = { type, label: `MISSION ${L}: STREET RACE`, goal: 'win the race' };
    } else if (type === 'wreck') {
      const n = Math.min(6, 2 + ((L / 4) | 0));
      const ring = junctionsInRing(city, player.x, player.z, 120, 300);
      const hunters = [];
      for (let k = 0; k < n && ring.length; k++) {
        const { i, j } = ring[(rand() * ring.length) | 0];
        const ways = DIRS4.filter(([dx, dz]) => city.canGo(i, j, dx, dz));
        if (!ways.length) continue;
        const dir = ways[(rand() * ways.length) | 0];
        const h = new HunterCar(i + dir[0], j + dir[1], dir[0], dir[1], rand, city);
        game.traffic.push(h);
        hunters.push(h);
      }
      this.m = { type, hunters, total: hunters.length,
                 timeLeft: 90 + hunters.length * 35,
                 label: `MISSION ${L}: WRECK THE GANG`,
                 goal: `${hunters.length} hunters are coming for you` };
    } else if (type === 'chase') {
      // The armoured car starts a few streets away and runs for the edge of
      // the map farthest from the player.
      const ring = junctionsInRing(city, player.x, player.z, 180, 340);
      let start = null, exit = null, route = null;
      for (let tries = 0; tries < 24 && !route; tries++) {
        if (!ring.length) break;
        start = ring[(rand() * ring.length) | 0];
        // Edge junctions, farthest first.
        const edges = [];
        for (let i = 0; i < GRID; i++) {
          for (let j = 0; j < GRID; j++) {
            if (i !== 0 && j !== 0 && i !== GRID - 1 && j !== GRID - 1) continue;
            if (!city.degree(i, j)) continue;
            edges.push({ i, j, d: Math.hypot(roadCenter(i) - player.x, roadCenter(j) - player.z) });
          }
        }
        edges.sort((a, b) => b.d - a.d);
        for (const e of edges.slice(0, 6)) {
          route = findRoute(city, { i: start.i, j: start.j }, { i: e.i, j: e.j });
          if (route) { exit = { x: roadCenter(e.i), z: roadCenter(e.j) }; break; }
        }
      }
      if (!route) { this.level++; return this.start(); }
      const target = new ArmouredCar(city, { i: start.i, j: start.j }, route, exit, rand, L);
      game.traffic.push(target);
      // At higher levels it travels with muscle.
      const escorts = [];
      const guards = L >= 9 ? 2 : L >= 5 ? 1 : 0;
      for (let k = 0; k < guards; k++) {
        const g = new HunterCar(start.i, start.j,
          (route[0][0] - start.i) || 0, (route[0][1] - start.j) || ((route[0][0] - start.i) ? 0 : 1),
          rand, city);
        g.x = target.x - Math.sin(target.yaw) * (8 + k * 7);
        g.z = target.z - Math.cos(target.yaw) * (8 + k * 7);
        game.traffic.push(g);
        escorts.push(g);
      }
      this.m = { type, target, escorts, exit, timeLeft: 160,
                 label: `MISSION ${L}: STOP THE ARMOURED CAR`,
                 goal: guards ? `it has ${guards} escort${guards > 1 ? 's' : ''}` : 'before it leaves town' };
    } else {
      const quota = 4 + L;
      this.m = { type, quota, base: game.stats.flattened,
                 timeLeft: 75 + L * 6,
                 label: `MISSION ${L}: HOSPITAL RUSH`,
                 goal: `flatten ${quota} pedestrians` };
    }
    say(this.m.label);
    playThud(0.25);
  }

  win() {
    const reward = 200 + this.level * 120;
    game.credits += reward;
    say(`MISSION ${this.level} COMPLETE — +${reward} cr`);
    playChime(3);
    this.level++;
    this.cleanup();
    this.m = null;
  }

  fail(msg) {
    say(msg);
    playThud(0.6);
    this.cleanup();
    this.m = null;
  }

  // Mission cars stop being special: wrecks stay as scenery, survivors melt
  // back into traffic and eventually retire out of range.
  cleanup() {
    const m = this.m;
    if (!m) return;
    for (const h of (m.hunters || []).concat(m.escorts || [])) h.noRetire = false;
    if (m.target) m.target.noRetire = false;
    game.missionTarget = null;
  }

  update(dt) {
    const m = this.m;
    if (!m) return;

    if (m.type === 'race') {
      const r = game.race;
      if (!r) { this.m = null; return; }               // abandoned with K
      if (r.state === 'done') {
        if (r.placeLabel() === '1st') this.win();
        else this.fail(`MISSION FAILED — ${r.placeLabel()} is not first`);
      }
      return;
    }

    m.timeLeft -= dt;
    if (m.timeLeft <= 0) return this.fail('MISSION FAILED — out of time');

    if (m.type === 'wreck') {
      let alive = null, down = 0;
      for (const h of m.hunters) {
        if (h.wreckage > 0.7 || !game.traffic.includes(h)) { down++; continue; }
        if (!alive || Math.hypot(h.x - game.car.x, h.z - game.car.z) <
                      Math.hypot(alive.x - game.car.x, alive.z - game.car.z)) alive = h;
      }
      m.progress = `${down} / ${m.total} wrecked`;
      game.missionTarget = alive ? { x: alive.x, z: alive.z } : null;
      if (down >= m.total) this.win();
      return;
    }

    if (m.type === 'chase') {
      const t = m.target;
      game.missionTarget = { x: t.x, z: t.z };
      const armour = Math.round((1 - t.wreckage / 0.7) * 100);
      m.progress = `armour ${Math.max(0, armour)}%`;
      if (t.wreckage > 0.7) return this.win();
      if (!game.traffic.includes(t)) return this.fail('MISSION FAILED — lost it');
      if (Math.hypot(t.x - m.exit.x, t.z - m.exit.z) < 26 ||
          t.phase === 'done' || t.phase === 'failed') {
        return this.fail('MISSION FAILED — it got away');
      }
      return;
    }

    if (m.type === 'blood') {
      const got = game.stats.flattened - m.base;
      m.progress = `${got} / ${m.quota} flattened`;
      if (got >= m.quota) this.win();
    }
  }
}
