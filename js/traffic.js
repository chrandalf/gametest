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
    this.cells = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) if (city.roadRank(i, j) >= 2) this.cells.push([i, j]);
    }
    this.timer = 0;
  }

  target(hour) {
    return Math.round(clamp(trafficDemand(hour) * this.max, 4, this.max));
  }

  // Called a few times a second, not every frame.
  update(dt, hour, list, player) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.9;
    const want = this.target(hour);
    if (!this.cells.length) return;

    if (list.length < want) {
      for (let n = 0; n < 3 && list.length < want; n++) {
        const [i, j] = this.cells[(this.rand() * this.cells.length) | 0];
        const horiz = this.rand() < 0.5;
        const d = horiz ? [this.rand() < 0.5 ? 1 : -1, 0] : [0, this.rand() < 0.5 ? 1 : -1];
        const car = new TrafficCar(i, j, d[0], d[1],
          CAR_COLORS[(this.rand() * CAR_COLORS.length) | 0], this.rand);
        // Never appear in front of the player.
        if (Math.hypot(car.x - player.x, car.z - player.z) < 90) continue;
        list.push(car);
      }
    } else if (list.length > want) {
      let worst = -1, worstD = 0;
      for (let k = 0; k < list.length; k++) {
        const d = Math.hypot(list[k].x - player.x, list[k].z - player.z);
        if (d > worstD) { worstD = d; worst = k; }
      }
      if (worst >= 0 && worstD > 160) list.splice(worst, 1);
    }
  }
}
