// Traffic control: junction signals and the rush-hour population.
//
// Ideas taken from chrandalf/unity-traffic-simulation (VehicleAI.cs,
// Intersection.cs): vehicles run a GO / SLOW / STOP state machine rather than
// just steering at a waypoint; they look ahead with a fan of rays instead of a
// single ahead test; they match the speed of a slower vehicle in front rather
// than tailgating it; they anticipate the *next* waypoint to slow for a turn
// before reaching it; and junctions hold a queue, releasing vehicles by light
// phase or first-come-first-served.
'use strict';

const LIGHT_CYCLE = 14;        // seconds for a full green/green cycle
// The fleet lives in a ring around the player: near enough to meet, far enough
// that nothing pops into existence in the mirror.
const SPAWN_NEAR = 95, SPAWN_FAR = 300, RETIRE_FAR = 380;
const AMBER = 2.6;             // seconds of amber at the end of each green

// Junction signals. Only the busiest junctions are signalled; quieter ones are
// give-way, which the vehicles handle between themselves.
class TrafficLights {
  constructor(city) {
    this.city = city;
    this.nodes = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        if (city.roadRank(i, j) < 5) continue;
        if (city.isMotorway(i, j)) continue;   // a motorway has no red lights
        // Offset phases so the whole city does not change together.
        this.nodes.push({ i, j, x: roadCenter(i), z: roadCenter(j),
                          offset: ((i * 7 + j * 5) % 10) / 10 * LIGHT_CYCLE });
      }
    }
    this.time = 0;
  }

  update(dt) { this.time += dt; }

  at(i, j) {
    for (const n of this.nodes) if (n.i === i && n.j === j) return n;
    return null;
  }

  // 'green' | 'amber' | 'red' for a vehicle travelling along the given axis.
  // Northbound and southbound share a phase, as do east and west.
  phaseFor(node, alongX) {
    const t = (this.time + node.offset) % LIGHT_CYCLE;
    const half = LIGHT_CYCLE / 2;
    const mine = alongX ? t < half : t >= half;
    if (!mine) return 'red';
    const into = alongX ? t : t - half;
    return into > half - AMBER ? 'amber' : 'green';
  }

  // What a vehicle approaching (i, j) should do: null, or the stop line.
  stopLineFor(i, j, dirX, dirZ) {
    const node = this.at(i, j);
    if (!node) return null;
    const p = this.phaseFor(node, dirX !== 0);
    if (p === 'green') return null;
    return { x: node.x - dirX * (ROAD / 2 + 1.5), z: node.z - dirZ * (ROAD / 2 + 1.5),
             amber: p === 'amber' };
  }
}

// How busy the roads are at a given hour: two peaks, a lull in the middle of
// the day and an empty city at 4am.
function trafficDemand(hour) {
  const peak = (centre, width, height) =>
    height * Math.exp(-((hour - centre) ** 2) / (2 * width * width));
  const base = 0.16 + 0.42 * smoothstep(5.5, 8, hour) * smoothstep(23.5, 20.5, hour);
  return clamp(base + peak(8.2, 1.1, 0.62) + peak(17.4, 1.4, 0.72) +
               peak(12.8, 1.6, 0.22), 0.05, 1.4);
}

// Keeps the number of cars on the road matching the hour, spawning them out of
// sight and retiring the ones furthest away.
class TrafficPopulation {
  constructor(city, rand, maxCars) {
    this.city = city;
    this.rand = rand;
    this.max = maxCars;
    // Weighted by how built-up the junction is, by listing a busy one several
    // times. A flat list spreads rush hour evenly over the whole map, which is
    // the opposite of rush hour: the city should be solid and the lanes empty.
    this.cells = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const rank = city.roadRank(i, j);
        if (rank < 2) continue;
        // Only where a car could actually be. A junction with every road round
        // it deleted is a field corner, not a place to spawn traffic.
        if (city.degree && city.degree(i, j) < 2) continue;
        const weight = rank >= 5 ? 6 : rank === 4 ? 4 : rank === 3 ? 2 : 1;
        for (let k = 0; k < weight; k++) this.cells.push([i, j, roadCenter(i), roadCenter(j)]);
      }
    }
    this.near = [];
    this.timer = 0;
  }

  target(hour) {
    return Math.round(clamp(trafficDemand(hour) * this.max, 4, this.max));
  }

  // Called a few times a second, not every frame.
  update(dt, hour, list, player) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.55;
    const want = this.target(hour);
    if (!this.cells.length) return;

    // Spawn in a ring around the player rather than anywhere on the map. A
    // fleet spread over a square kilometre and a half is a fleet you never
    // meet: the same hundred and ninety cars kept within a few streets is the
    // difference between a quiet grid and a city at half past eight.
    this.near.length = 0;
    for (const c of this.cells) {
      const d = Math.hypot(c[2] - player.x, c[3] - player.z);
      if (d > SPAWN_NEAR && d < SPAWN_FAR) this.near.push(c);
    }
    const pool = this.near.length ? this.near : this.cells;

    if (list.length < want) {
      // Enough per tick that a rush hour actually arrives rather than
      // trickling in over the first two minutes of play.
      for (let n = 0; n < 10 && list.length < want; n++) {
        const [i, j] = pool[(this.rand() * pool.length) | 0];
        // Head off down a road that exists.
        const ways = DIRS4.filter(([dx, dz]) => this.city.canGo(i, j, dx, dz));
        if (!ways.length) continue;
        const d = ways[(this.rand() * ways.length) | 0];
        // A car is placed half a cell *before* the junction it is heading for,
        // so it must be aimed at the far end of the road we just checked —
        // aiming at this junction would drop it on the segment behind, which
        // is quite possibly one of the ones that no longer exists.
        const car = new TrafficCar(i + d[0], j + d[1], d[0], d[1],
          CAR_COLORS[(this.rand() * CAR_COLORS.length) | 0], this.rand, this.city);
        // Never appear in front of the player.
        if (Math.hypot(car.x - player.x, car.z - player.z) < SPAWN_NEAR) continue;
        list.push(car);
      }
    }
    // Retire anything that has driven out of the neighbourhood, and thin the
    // fleet from the far end when the peak passes. Several a tick, or it takes
    // minutes to settle.
    const order = list.map((c, k) => [Math.hypot(c.x - player.x, c.z - player.z), k])
                      .sort((a, b) => b[0] - a[0]);
    let drop = Math.max(0, list.length - want);
    let gone = 0;
    for (const [d, k] of order) {
      if (gone >= 8) break;
      if (d > RETIRE_FAR || drop > 0) { list[k] = null; gone++; if (drop > 0) drop--; }
      else break;
    }
    if (gone) for (let k = list.length - 1; k >= 0; k--) if (!list[k]) list.splice(k, 1);
  }
}
