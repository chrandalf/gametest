// City life: the census that ties everything the generator built to everything
// else. The city hands over homes (front doors, room for a family), workplaces
// (job counts) and parking spots (a position and a yaw to park at); the census
// deals people out of that ledger. Every person has a home; most have a job;
// about two thirds keep a car, and that car exists — parked in a real spot,
// solid enough to crash into, stealable, and driven to work and back at the
// hours its owner keeps.
//
// Nobody could simulate three thousand commutes at once and nobody needs to:
//  - Parked cars materialise as real vehicles in a ring around the player, in
//    exactly the spots the ledger says are taken.
//  - A journey that starts near the player is acted out in full: the owner
//    walks out of the door to the car, reverses off the drive, drives the
//    route, parks at the far end — reversing into the bay — and walks the
//    rest of the way to work.
//  - Everyone else commutes silently. The ledger flips, the spots swap, and
//    the parked cars are simply elsewhere the next time you look.
'use strict';

const LIVE_RADIUS = 280;      // journeys starting inside this ring are acted out
const PARKED_RADIUS = 230;    // parked cars materialise inside this
const MAX_PARKED = 120;       // draw-call budget for sleeping metal
const MAX_LIVE = 9;           // journeys acted out at once
const CENSUS_CAP = 1400;      // people the ledger tracks

// ------------------------------------------------------------ parked cars ---

// A car with nobody in it. Asleep until something hits it; then it is just a
// car with no foot on the brake, and it slides wherever the impact sends it.
class ParkedCar extends Vehicle {
  constructor(spot, color, city) {
    super(spot.x, spot.z, spot.yaw, color);
    this.spot = spot;
    this.parked = true;
    this.disturbed = false;
    this.y = city.groundY(spot.x, spot.z);
    this.surfaceY = this.y;
  }
}

// ---------------------------------------------------------------- routing ---

// Nearest junction with at least one road, in the 3x3 around a position.
function nearestJunction(city, x, z) {
  const ci = Math.round(x / CELL), cj = Math.round(z / CELL);
  let best = null, bd = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      if (!city.degree(i, j)) continue;
      const d = Math.hypot(roadCenter(i) - x, roadCenter(j) - z);
      if (d < bd) { bd = d; best = { i, j }; }
    }
  }
  return best;
}

// Breadth-first route over the junction grid, honouring which roads exist.
// Returns [[i, j], ...] from just after the start to the goal, or null.
function findRoute(city, a, b) {
  if (!a || !b) return null;
  const key = (i, j) => j * GRID + i;
  const prev = new Map([[key(a.i, a.j), -1]]);
  const q = [[a.i, a.j]];
  let qi = 0;
  while (qi < q.length) {
    const [i, j] = q[qi++];
    if (i === b.i && j === b.j) {
      const path = [];
      let k = key(i, j);
      while (k !== -1) {
        path.push([k % GRID, (k / GRID) | 0]);
        k = prev.get(k);
      }
      path.reverse();
      path.shift();                       // drop the start junction itself
      return path;
    }
    for (const [dx, dz] of DIRS4) {
      if (!city.canGo(i, j, dx, dz)) continue;
      const nk = key(i + dx, j + dz);
      if (prev.has(nk)) continue;
      prev.set(nk, key(i, j));
      q.push([i + dx, j + dz]);
    }
  }
  return null;
}

// Where a car manoeuvres from when entering or leaving a spot: a few metres
// out behind the parked pose — the aisle of a car park, the road outside a
// driveway, the lane behind a kerbside space.
function stageFor(spot) {
  return { x: spot.x - Math.sin(spot.yaw) * 7.5, z: spot.z - Math.cos(spot.yaw) * 7.5 };
}

// The nearest point on an existing road's centre line. The approach drives
// here first, so it enters a car park through its frontage instead of
// beelining from the junction through somebody's garden.
function roadPointNear(city, x, z) {
  let best = null, bd = Infinity;
  for (let axis = 0; axis < 2; axis++) {
    const across = axis ? x : z, along = axis ? z : x;
    const li = Math.round(across / CELL);
    if (li < 0 || li >= GRID) continue;
    const k = clamp(Math.floor(along / CELL), 0, GRID - 2);
    if (!city.edgeOpen(axis, li, k)) continue;
    const c = roadCenter(li) + city.bowAt(along, li, axis);
    const p = axis ? { x: c, z: along } : { x: along, z: c };
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ----------------------------------------------------------- the commuter ---

// A traffic car with somewhere to be: it follows a planned route rather than
// wandering, and at each end of the trip it actually parks — reversing off
// the drive on the way out, reversing into the bay on the way in.
class CommuterCar extends TrafficCar {
  constructor(city, fromSpot, toSpot, route, startNode, color, rand) {
    const dir = route.length
      ? { x: Math.sign(route[0][0] - startNode.i), z: Math.sign(route[0][1] - startNode.j) }
      : { x: 0, z: 1 };
    super(startNode.i, startNode.j, dir.x || 0, dir.z || (dir.x ? 0 : 1),
          CAR_COLORS[(rand() * CAR_COLORS.length) | 0], rand, city);
    this.color = color || this.color;
    this.noRetire = true;                 // the population manager leaves it be
    this.route = route;
    this.routeIdx = 0;
    this.fromSpot = fromSpot;
    this.toSpot = toSpot;
    this.phaseTime = 0;
    this.shunt = 0;
    this.reversed = false;                // test hook: did it actually reverse?
    if (fromSpot) {
      // Start parked in the old spot, nose where the owner left it.
      this.x = fromSpot.x; this.z = fromSpot.z; this.yaw = fromSpot.yaw;
      this.vx = 0; this.vz = 0;
      this.phase = 'out';
    } else {
      this.phase = 'drive';
    }
    // The first routed junction is the startNode itself, driven to normally.
    this.node = { i: startNode.i, j: startNode.j };
    this.target = laneTarget(this.node.i, this.node.j, this.dir.x, this.dir.z, city);
  }

  // Route following: pickNext pops the plan instead of rolling dice. When the
  // plan runs out the car is at the junction nearest its spot, and switches
  // to the approach.
  pickNext() {
    // A failed journey demotes the car to ordinary wandering traffic.
    if (this.wander) return super.pickNext();
    if (this.routeIdx < this.route.length) {
      const [ni, nj] = this.route[this.routeIdx++];
      this.dir = { x: Math.sign(ni - this.node.i), z: Math.sign(nj - this.node.j) };
      this.node = { i: ni, j: nj };
      this.target = laneTarget(ni, nj, this.dir.x, this.dir.z, this.world && this.world.city);
      return;
    }
    this.phase = 'stage';
    this.phaseTime = 0;
    // Approach in two legs: along the road to the point abreast of the spot,
    // then off the road to the manoeuvring position itself.
    const stage = stageFor(this.toSpot);
    const city = this.world && this.world.city;
    const rp = city ? roadPointNear(city, stage.x, stage.z) : null;
    this.wps = rp && Math.hypot(rp.x - stage.x, rp.z - stage.z) > 6 ? [rp, stage] : [stage];
    this.wpIdx = 0;
  }

  update(dt, world) {
    this.world = world;
    // The freeze pickup stops commuters mid-manoeuvre too. Not the ambulance:
    // freezing the ambulance would be a step too mean even for this game.
    if (typeof game !== 'undefined' && game.power && game.power.freeze > 0 &&
        !this.isPlayer && !this.ambulance) {
      this.drive(dt, 0, 0, true, world.city);
      return;
    }
    this.phaseTime += dt;
    const spot = this.toSpot;

    if (this.phase === 'out') {
      // Reverse from the parked pose to the staging point, rear first.
      const stage = stageFor(this.fromSpot);
      const dx = stage.x - this.x, dz = stage.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.2 || this.phaseTime > 7) {
        this.phase = 'drive';
        this.phaseTime = 0;
        return;
      }
      // Reversing flips the steering sign, exactly as it does in a real car.
      const desired = Math.atan2(dx, dz) + Math.PI;
      const err = angDelta(this.yaw, desired);
      this.reversed = true;
      this.drive(dt, -0.45, clamp(-err * 2.0, -1, 1), false, world.city);
      return;
    }

    if (this.phase === 'stage') {
      // Creep along the waypoints to the manoeuvring position.
      if (!this.wps) { this.wps = [stageFor(spot)]; this.wpIdx = 0; }
      const wp = this.wps[Math.min(this.wpIdx, this.wps.length - 1)];
      const last = this.wpIdx >= this.wps.length - 1;
      const dx = wp.x - this.x, dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (!last && d < 4.5) { this.wpIdx++; return; }
      if (last && d < 3.2 && this.speed < 5) {
        this.phase = spot.kind === 'kerb' ? 'in' : 'reverse';
        this.phaseTime = 0;
        return;
      }
      if (this.phaseTime > 30) { this.phase = 'failed'; return; }
      // Pinned against something: back straight off it and try again.
      if (this.unstick > 0) {
        this.unstick -= dt;
        this.drive(dt, -0.5, 0, false, world.city);
        return;
      }
      if (this.speed < 0.4) this.stuckT = (this.stuckT || 0) + dt;
      else this.stuckT = 0;
      if (this.stuckT > 1.3) { this.unstick = 1.1; this.stuckT = 0; return; }
      const desired = Math.atan2(dx, dz);
      const err = angDelta(this.yaw, desired);
      // Overshot — the point is behind us. Back up to it rather than driving
      // a full circle round the car park.
      if (Math.abs(err) > Math.PI * 0.6 && d < 11) {
        const rerr = angDelta(this.yaw, desired + Math.PI);
        this.reversed = true;
        this.drive(dt, -0.4, clamp(-rerr * 2, -1, 1), false, world.city);
        return;
      }
      const vf = this.forwardSpeed;
      const limit = Math.min(6.5, d * 1.2);
      this.drive(dt, vf < limit - 0.3 ? 0.5 : (vf > limit + 0.8 ? -0.4 : 0),
                 clamp(err * 1.8, -1, 1), false, world.city);
      return;
    }

    if (this.phase === 'reverse') {
      // Back into the bay: aim the tail at the spot, then square up on the
      // spot's own yaw for the last car length.
      const dx = spot.x - this.x, dz = spot.z - this.z;
      const d = Math.hypot(dx, dz);
      const aligned = Math.abs(angDelta(this.yaw, spot.yaw));
      if (d < 1.1 && aligned < 0.5) {
        this.phase = 'done';
        return;
      }
      if (this.phaseTime > 26) { this.phase = d < 3.2 ? 'done' : 'failed'; return; }
      // Drifted right away from the bay: go back to the aisle and have
      // another go. Two goes, then give up and drive off.
      if (d > 12) {
        this.attempts = (this.attempts || 0) + 1;
        if (this.attempts > 2) { this.phase = 'failed'; return; }
        this.phase = 'stage';
        this.phaseTime = 0;
        this.wpIdx = Math.max(0, this.wps ? this.wps.length - 1 : 0);
        return;
      }
      const desired = d > 2.4 ? Math.atan2(dx, dz) + Math.PI : spot.yaw;
      const err = angDelta(this.yaw, desired);
      // Tail pointing nowhere near the bay: take a shunt forward to swing the
      // nose, exactly the three-point shuffle a driver does in a tight aisle.
      if (this.shunt > 0) {
        this.shunt -= dt;
        this.drive(dt, 0.35, clamp(err * 2.0, -1, 1), false, world.city);
        return;
      }
      if (Math.abs(err) > 1.1 && this.speed < 1.5) { this.shunt = 1.4; return; }
      this.reversed = true;
      this.drive(dt, -0.4, clamp(-err * 2.2, -1, 1), false, world.city);
      return;
    }

    if (this.phase === 'in') {
      // A kerbside space is taken nose first, in line with the traffic.
      const dx = spot.x - this.x, dz = spot.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.1 || this.phaseTime > 12) { this.phase = 'done'; return; }
      const desired = d > 3 ? Math.atan2(dx, dz) : spot.yaw;
      const err = angDelta(this.yaw, desired);
      const vf = this.forwardSpeed;
      this.drive(dt, vf < Math.min(4, d) ? 0.45 : -0.3, clamp(err * 2, -1, 1),
                 false, world.city);
      return;
    }

    if (this.phase === 'done' || this.phase === 'failed') {
      this.drive(dt, 0, 0, true, world.city);
      return;
    }

    super.update(dt, world);   // 'drive': ordinary traffic AI along the route
  }
}

// ------------------------------------------------------ walking somewhere ---

// A pedestrian with a destination: the stretch of every journey done on foot,
// front door to driver's door, car park to office. Panics and gets run over
// exactly like anyone else.
class Strider extends Pedestrian {
  constructor(x, z, goal, rand) {
    super(x, z, Math.atan2(goal.x - x, goal.z - z), rand);
    this.goal = goal;
    this.arrived = false;
    this.stuck = 0;
    this.lastD = Infinity;
  }

  update(dt, world) {
    if (this.knocked > 0 || this.panic > 0) return super.update(dt, world);
    this.y = world.city.groundY(this.x, this.z);
    const dx = this.goal.x - this.x, dz = this.goal.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) { this.arrived = true; return; }
    // Going nowhere for a couple of seconds means a wall between here and
    // there; give up gracefully rather than walking on the spot forever.
    if (d > this.lastD - 0.05) this.stuck += dt; else this.stuck = 0;
    this.lastD = d;
    if (this.stuck > 2.5) { this.arrived = true; return; }
    const want = Math.atan2(dx, dz);
    this.yaw += angDelta(this.yaw, want) * clamp(dt * 5, 0, 1);
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
    const p = { x: this.x, z: this.z };
    const hit = world.city.resolveCircle(p, 0.45);
    this.x = p.x; this.z = p.z;
    if (hit) {
      // Slide along the obstacle: walk perpendicular to its normal, whichever
      // way points more toward the goal.
      const t1 = Math.atan2(hit.nz, -hit.nx), t2 = Math.atan2(-hit.nz, hit.nx);
      this.yaw = Math.abs(angDelta(t1, want)) < Math.abs(angDelta(t2, want)) ? t1 : t2;
    }
    this.phase += dt * this.speed * 3.4;
  }
}

// ------------------------------------------------------------- ambulance ----

// Dispatched from the hospital to anyone left lying in the road, loads them,
// and takes them in. The game's hospital counter ticks on pickup.
class Ambulance extends CommuterCar {
  constructor(city, startNode, route, dest, rand) {
    // The "spot" it is parking at is wherever the casualty is lying: the
    // commuter machinery then drives it right up to them, pavement included.
    super(city, null, { x: dest.x, z: dest.z, yaw: 0, kind: 'kerb' }, route, startNode,
          [0.97, 0.97, 1.0], rand);
    this.van = true;
    this.ambulance = true;
    this.ignoreLights = true;
    this.siren = true;
    this.mass = 2500;
    this.halfLen = 2.55; this.halfWid = 1.05;
    this.maxSpeed = 23;
    this.lawAbiding = 1.6;      // the limit does not apply
    this.mode = 'go';           // go -> load -> return
    this.loadTimer = 0;
  }

  update(dt, world) {
    // The approach and pull-up come from the commuter machinery; only the
    // terminal states are handled here — stop and hold.
    if (this.phase === 'done' || this.phase === 'failed') {
      this.drive(dt, this.speed > 1 ? -0.6 : 0, 0, this.speed < 1, world.city);
      return;
    }
    super.update(dt, world);
  }

  // Point it at somewhere new (the casualty, or home) with a fresh route.
  redirect(city, route, startNode, dest) {
    this.route = route;
    this.routeIdx = 0;
    this.toSpot = { x: dest.x, z: dest.z, yaw: 0, kind: 'kerb' };
    this.phase = 'drive';
    this.phaseTime = 0;
    this.wps = null;
    this.attempts = 0;
    this.node = { i: startNode.i, j: startNode.j };
    this.target = laneTarget(startNode.i, startNode.j, this.dir.x, this.dir.z, city);
  }
}

// ------------------------------------------------------------ the census ----

class CityLife {
  constructor(city, rand) {
    this.city = city;
    this.rand = rand;
    this.people = [];
    this.parkedBySpot = new Map();     // spot index -> ParkedCar entity
    this.live = [];                    // journeys being acted out
    this.tickTimer = 0;
    this.cursor = 0;
    this.ambulance = null;
    this.ambulanceCool = 0;
    this.sirenTimer = 0;
    this.buildCensus();
  }

  // Deal people into homes, jobs and cars.
  buildCensus() {
    const city = this.city, rand = this.rand;
    const spots = city.spots;
    const takeSpotNear = (x, z, reach, homeId) => {
      let best = -1, bd = reach * reach;
      for (let k = 0; k < spots.length; k++) {
        const s = spots[k];
        if (s.taken) continue;
        // A family's own driveway is only ever theirs.
        if (s.kind === 'drive' && s.home !== -1 && s.home !== homeId) continue;
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        // Prefer the family driveway outright.
        const score = s.home === homeId && s.kind === 'drive' ? 0 : d;
        if (score < bd) { bd = score; best = k; }
      }
      if (best >= 0) spots[best].taken = 1;
      return best;
    };

    const startHour = 9.5;   // the game clock at world build
    let withCar = 0, employed = 0;
    for (let hi = 0; hi < city.homes.length && this.people.length < CENSUS_CAP; hi++) {
      const h = city.homes[hi];
      for (let c = 0; c < h.cap && this.people.length < CENSUS_CAP; c++) {
        const p = {
          home: hi,
          work: -1,
          goWork: 7.2 + rand() * 2.4,
          goHome: 16.4 + rand() * 2.6,
          state: 'home',
          spot: -1,            // where their car is parked right now (-1: none)
        };
        // A job, preferably not on the far side of the map.
        if (rand() < 0.86 && city.works.length) {
          let bestW = -1, bd = Infinity;
          for (let t = 0; t < 3; t++) {
            const wi = (rand() * city.works.length) | 0;
            const w = city.works[wi];
            if (w.filled >= w.jobs) continue;
            const d = (w.x - h.x) ** 2 + (w.z - h.z) ** 2;
            if (d < bd) { bd = d; bestW = wi; }
          }
          if (bestW >= 0) {
            p.work = bestW;
            city.works[bestW].filled = (city.works[bestW].filled || 0) + 1;
            employed++;
          }
        }
        const working = p.work >= 0 && p.goWork < startHour && startHour < p.goHome;
        p.state = working ? 'work' : 'home';
        // A car for most, parked wherever they are at half past nine.
        if (rand() < 0.62) {
          const at = working ? city.works[p.work] : h;
          p.spot = takeSpotNear(at.x, at.z, working ? 110 : 60, hi);
          if (p.spot >= 0) withCar++;
        }
        this.people.push(p);
      }
    }
    this.censusSummary = {
      people: this.people.length, employed, withCar,
      spots: spots.length, taken: spots.filter((s) => s.taken).length,
    };
  }

  // ------------------------------------------------------------- commuting --

  // Flip a person's state without ceremony: their car dematerialises from one
  // spot and turns up in another. Used far from the player, and as the
  // fallback when an acted-out journey goes wrong.
  silentFlip(person, dest) {
    const city = this.city;
    if (person.spot >= 0) {
      const ns = this.claimSpotNear(dest.x, dest.z, 140, person.home);
      if (ns >= 0) {
        city.spots[person.spot].taken = 0;
        const entity = this.parkedBySpot.get(person.spot);
        if (entity && !entity.disturbed) this.removeParked(person.spot);
        person.spot = ns;
      }
      // No room at the far end: the car stays put and they take the bus.
    }
    person.state = person.state === 'home' ? 'work' : 'home';
  }

  claimSpotNear(x, z, reach, homeId) {
    const spots = this.city.spots;
    let best = -1, bd = reach * reach;
    for (let k = 0; k < spots.length; k++) {
      const s = spots[k];
      if (s.taken) continue;
      if (s.kind === 'drive' && s.home !== -1 && s.home !== homeId) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      const score = s.home === homeId && s.kind === 'drive' ? 0 : d;
      if (score < bd) { bd = score; best = k; }
    }
    if (best >= 0) spots[best].taken = 1;
    return best;
  }

  // Try to act a journey out in front of the player. Returns false if it
  // cannot be (no route, no free spot, too many already running).
  startLiveJourney(person, from, destPlace) {
    const city = this.city;
    if (this.live.length >= MAX_LIVE) return false;
    const fromSpot = city.spots[person.spot];
    const destSpotId = this.claimSpotNear(destPlace.x, destPlace.z, 140, person.home);
    if (destSpotId < 0) return false;
    const toSpot = city.spots[destSpotId];
    const a = nearestJunction(city, fromSpot.x, fromSpot.z);
    const b = nearestJunction(city, toSpot.x, toSpot.z);
    const route = findRoute(city, a, b);
    if (!route) { toSpot.taken = 0; return false; }

    // The owner walks from the door to the car first; the car sets off when
    // they arrive. `from` is the door they leave from.
    const walker = new Strider(from.x, from.z, { x: fromSpot.x, z: fromSpot.z }, this.rand);
    walker.y = city.groundY(from.x, from.z);
    walker.sheet = (this.rand() * TOWNSFOLK.length) | 0;
    game.peds.push(walker);

    this.live.push({
      person, stage: 'walk-out', walker,
      fromSpotId: person.spot, destSpotId,
      startNode: a, route,
      destDoor: { x: destPlace.x, z: destPlace.z },
      timer: 0,
    });
    return true;
  }

  finishJourney(j, silently) {
    const city = this.city;
    const person = j.person;
    // Ledger: the car has left its old spot whatever else happened.
    if (person.spot >= 0) {
      city.spots[person.spot].taken = 0;
      this.removeParked(person.spot);
    }
    person.spot = j.destSpotId;
    person.state = person.state === 'home' ? 'work' : 'home';
    if (j.car) {
      const idx = game.traffic.indexOf(j.car);
      if (idx >= 0) game.traffic.splice(idx, 1);
      if (!silently && j.car.phase === 'done') {
        // Leave the car exactly as it came to rest, tied to its spot.
        const spot = city.spots[j.destSpotId];
        const rest = new ParkedCar(spot, j.car.color, city);
        rest.x = j.car.x; rest.z = j.car.z; rest.yaw = j.car.yaw;
        rest.y = j.car.y;
        rest.plate = j.car.plate;
        rest.damage = j.car.damage;
        game.parked.push(rest);
        this.parkedBySpot.set(j.destSpotId, rest);
      }
    }
  }

  // ----------------------------------------------------- parked cars ring ---

  // The player has walked up and taken somebody's car. The ledger lets it
  // go: the spot frees, and the owner simply no longer has a car.
  onStolen(car) {
    for (const [k, e] of this.parkedBySpot) {
      if (e !== car) continue;
      this.parkedBySpot.delete(k);
      this.city.spots[k].taken = 0;
      for (const p of this.people) if (p.spot === k) p.spot = -1;
    }
  }

  removeParked(spotId) {
    const e = this.parkedBySpot.get(spotId);
    if (!e) return;
    const idx = game.parked.indexOf(e);
    if (idx >= 0) game.parked.splice(idx, 1);
    this.parkedBySpot.delete(spotId);
  }

  refreshParked(player) {
    const city = this.city;
    // Retire sleepers that drifted out of the ring; disturbed or damaged cars
    // stay much longer, because a wreck vanishing in the mirror is noticeable.
    for (const [spotId, e] of [...this.parkedBySpot]) {
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      const limit = e.disturbed || e.wreckage > 0.05 ? 520 : PARKED_RADIUS + 70;
      if (d > limit) this.removeParked(spotId);
      else if (!city.spots[spotId].taken && !e.disturbed) this.removeParked(spotId);
    }
    if (game.parked.length >= MAX_PARKED) return;
    // Materialise the nearest taken spots that have no car standing in them.
    const cand = [];
    for (let k = 0; k < city.spots.length; k++) {
      const s = city.spots[k];
      if (!s.taken || this.parkedBySpot.has(k)) continue;
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      if (d < PARKED_RADIUS) cand.push([d, k]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, k] of cand) {
      if (game.parked.length >= MAX_PARKED) break;
      const s = city.spots[k];
      // Not under the player or a live car.
      if (Math.hypot(s.x - player.x, s.z - player.z) < 12) continue;
      const car = new ParkedCar(s, CAR_COLORS[(this.rand() * CAR_COLORS.length) | 0], city);
      game.parked.push(car);
      this.parkedBySpot.set(k, car);
    }
  }

  // -------------------------------------------------------------- the loop --

  update(dt, hour, player, world) {
    this.tickTimer -= dt;
    this.updateLive(dt, player, world);
    this.updateAmbulance(dt, player, world);
    if (this.tickTimer > 0) return;
    this.tickTimer = 0.5;

    this.refreshParked(player);

    // Walk a slice of the census each tick, flipping whoever's hour has come.
    const n = this.people.length;
    if (!n) return;
    const slice = 140;
    for (let c = 0; c < slice; c++) {
      const p = this.people[(this.cursor + c) % n];
      if (p.work < 0) continue;
      const wantsWork = hour > p.goWork && hour < p.goHome;
      const desired = wantsWork ? 'work' : 'home';
      if (p.state === desired) continue;
      if (this.live.some((j) => j.person === p)) continue;
      const city = this.city;
      const destPlace = desired === 'work' ? city.works[p.work] : city.homes[p.home];
      const fromPlace = desired === 'work' ? city.homes[p.home] : city.works[p.work];
      if (p.spot < 0) { p.state = desired; continue; }     // no car: quiet flip
      const s = city.spots[p.spot];
      const near = Math.hypot(s.x - player.x, s.z - player.z) < LIVE_RADIUS;
      if (!near || !this.startLiveJourney(p, fromPlace, destPlace)) {
        this.silentFlip(p, destPlace);
      }
    }
    this.cursor = (this.cursor + slice) % n;
  }

  updateLive(dt, player, world) {
    const city = this.city;
    for (let k = this.live.length - 1; k >= 0; k--) {
      const j = this.live[k];
      j.timer += dt;
      const abort = j.timer > 120 ||
        Math.hypot((j.car ? j.car.x : j.walker.x) - player.x,
                   (j.car ? j.car.z : j.walker.z) - player.z) > 430;

      if (j.stage === 'walk-out') {
        if (abort || j.walker.knocked > 0 && j.walker.downed) {
          // Run over on their own doorstep. The journey dies with them.
          if (!j.walker.arrived) this.despawnWalker(j.walker, j.walker.downed);
          city.spots[j.destSpotId].taken = 0;
          this.live.splice(k, 1);
          continue;
        }
        if (j.walker.arrived) {
          this.despawnWalker(j.walker, false);
          // Into the car. The parked entity gives way to a live one.
          const fromSpot = city.spots[j.fromSpotId];
          this.removeParked(j.fromSpotId);
          const car = new CommuterCar(city, fromSpot, city.spots[j.destSpotId],
                                      j.route, j.startNode, null, this.rand);
          game.traffic.push(car);
          j.car = car;
          j.stage = 'drive';
          // The driveway is free the moment the car is off it.
          fromSpot.taken = 0;
          j.person.spot = -1;
        }
        continue;
      }

      if (j.stage === 'drive') {
        const car = j.car;
        if (abort || car.isPlayer || car.wreckage > 0.7 || car.phase === 'failed') {
          // Stolen, wrecked or hopelessly stuck: the ledger flips and the car
          // is left to fate — a failed parker just becomes ordinary traffic
          // and wanders off, which reads far better than vanishing.
          if (!car.isPlayer && car.phase === 'failed') {
            car.wander = true;
            car.phase = 'drive';
            car.noRetire = false;
          }
          city.spots[j.destSpotId].taken = 0;
          j.person.state = j.person.state === 'home' ? 'work' : 'home';
          j.person.spot = -1;
          this.live.splice(k, 1);
          continue;
        }
        if (car.phase === 'done') {
          this.finishJourney(j, false);
          // And walk the rest of the way.
          const spot = city.spots[j.destSpotId];
          const walker = new Strider(spot.x, spot.z, j.destDoor, this.rand);
          walker.y = city.groundY(spot.x, spot.z);
          walker.sheet = (this.rand() * TOWNSFOLK.length) | 0;
          game.peds.push(walker);
          j.walker = walker;
          j.stage = 'walk-in';
          j.car = null;
        }
        continue;
      }

      if (j.stage === 'walk-in') {
        if (j.walker.arrived || abort || j.walker.downed) {
          if (!j.walker.arrived) this.despawnWalker(j.walker, j.walker.downed);
          else this.despawnWalker(j.walker, false);
          this.live.splice(k, 1);
        }
        continue;
      }
    }
    void world;
  }

  despawnWalker(walker, leaveBody) {
    if (leaveBody) return;               // the ambulance will want the body
    const idx = game.peds.indexOf(walker);
    if (idx >= 0) game.peds.splice(idx, 1);
  }

  // ------------------------------------------------------------- ambulance --

  updateAmbulance(dt, player, world) {
    const city = this.city;
    this.ambulanceCool = Math.max(0, this.ambulanceCool - dt);
    // Casualties written off to an off-screen rescue fade out after a while.
    for (let k = game.peds.length - 1; k >= 0; k--) {
      const ped = game.peds[k];
      if (ped.fadeOut === undefined) continue;
      ped.fadeOut -= dt;
      if (ped.fadeOut <= 0) {
        game.peds.splice(k, 1);
        game.stats.hospitalised = (game.stats.hospitalised || 0) + 1;
      }
    }
    const amb = this.ambulance;

    // Anyone left lying in the road?
    let victim = null;
    for (const ped of game.peds) {
      if (ped.downed && !ped.claimed) { victim = ped; break; }
    }

    if (!amb) {
      if (!victim || !city.hospital || this.ambulanceCool > 0) return;
      const a = nearestJunction(city, city.hospital.bay.x, city.hospital.bay.z);
      const b = nearestJunction(city, victim.x, victim.z);
      const route = findRoute(city, a, b);
      if (!route) {
        // Unreachable: the casualty is collected off-screen after a while.
        victim.claimed = true;
        victim.fadeOut = 18;
        return;
      }
      const unit = new Ambulance(city, a, route, victim, this.rand);
      unit.x = city.hospital.bay.x; unit.z = city.hospital.bay.z;
      unit.yaw = city.hospital.bay.yaw;
      unit.y = city.groundY(unit.x, unit.z);
      unit.victim = victim;
      victim.claimed = true;
      game.traffic.push(unit);
      this.ambulance = unit;
      if (Math.hypot(player.x - unit.x, player.z - unit.z) < 300) {
        say('AMBULANCE DISPATCHED');
      }
      return;
    }

    // Siren, while it is running hot and near enough to hear.
    const pd = Math.hypot(amb.x - player.x, amb.z - player.z);
    if (amb.siren && pd < 260) {
      this.sirenTimer -= dt;
      if (this.sirenTimer <= 0) {
        this.sirenTimer = 0.62;
        playSiren(clamp(1 - pd / 260, 0.1, 1));
      }
    }

    // Too far to matter: finish the errand off-screen.
    if (pd > 450) {
      this.collectAround(amb, 1e9);
      this.retireAmbulance();
      return;
    }

    if (amb.mode === 'go') {
      const v = amb.victim;
      const gone = !v || !game.peds.includes(v);
      const d = gone ? 0 : Math.hypot(amb.x - v.x, amb.z - v.z);
      if (gone) { amb.mode = 'return'; this.routeAmbulanceHome(amb); return; }
      if (d < 11 || amb.phase === 'done' || amb.phase === 'failed') {
        amb.mode = 'load';
        amb.loadTimer = 2.6;
      }
      return;
    }

    if (amb.mode === 'load') {
      amb.loadTimer -= dt;
      if (amb.loadTimer <= 0) {
        const got = this.collectAround(amb, 18);
        if (!got && amb.victim && game.peds.includes(amb.victim)) {
          // Could not pull up close enough: the crew go the last stretch on
          // foot, off-screen, and the casualty still reaches hospital.
          amb.victim.fadeOut = 12;
        }
        amb.mode = 'return';
        this.routeAmbulanceHome(amb);
      }
      return;
    }

    if (amb.mode === 'return') {
      const home = city.hospital.bay;
      if (Math.hypot(amb.x - home.x, amb.z - home.z) < 24 ||
          amb.phase === 'done' || amb.phase === 'failed') {
        this.retireAmbulance();
      }
    }
    void world;
  }

  // Everyone down within reach goes in the back. This is where the hospital
  // count — the score the player is chasing — actually ticks.
  collectAround(amb, reach) {
    let got = 0;
    for (let k = game.peds.length - 1; k >= 0; k--) {
      const ped = game.peds[k];
      if (!ped.downed) continue;
      if (Math.hypot(ped.x - amb.x, ped.z - amb.z) > reach) continue;
      game.peds.splice(k, 1);
      got++;
    }
    if (got) {
      game.stats.hospitalised = (game.stats.hospitalised || 0) + got;
      say(`${got} CASUALT${got > 1 ? 'IES' : 'Y'} TO HOSPITAL — total ${game.stats.hospitalised}`);
    }
    return got;
  }

  routeAmbulanceHome(amb) {
    const city = this.city;
    const a = nearestJunction(city, amb.x, amb.z);
    const b = nearestJunction(city, city.hospital.bay.x, city.hospital.bay.z);
    const route = findRoute(city, a, b);
    amb.siren = false;
    if (!route) { this.retireAmbulance(); return; }
    amb.redirect(city, route, a, city.hospital.bay);
  }

  retireAmbulance() {
    const amb = this.ambulance;
    if (!amb) return;
    const idx = game.traffic.indexOf(amb);
    if (idx >= 0) game.traffic.splice(idx, 1);
    this.ambulance = null;
    this.ambulanceCool = 6;
  }
}
