// Pickups: spinning toys floating over the tarmac, in the spirit of a certain
// plumber. Drive through one and something good (or at least funny) happens.
// They spawn in a ring around the player on roads that exist, so there is
// always one glittering down the street you happen to be on.
'use strict';

const PICKUP_REACH = 2.6;        // collect radius, widened by a grown car
const PICKUP_COUNT = 9;          // live at once
const PICKUP_NEAR = 60, PICKUP_FAR = 260, PICKUP_GONE = 330;

// What each one does is applied in applyPickup(); here is the look and the
// spawn weight. Weights are why you trip over wrenches but earn your stars.
const PICKUP_TYPES = [
  { key: 'wrench', name: 'FULL REPAIR', weight: 3 },
  { key: 'cash',   name: '+150 CREDITS', weight: 3 },
  { key: 'can',    name: 'TURBO CAN', weight: 3 },
  { key: 'oil',    name: 'OIL DRUM — Q to drop slicks', weight: 2 },
  { key: 'ram',    name: 'RAM PLATE — hit things harder', weight: 2 },
  { key: 'freeze', name: 'FREEZE — traffic stops dead', weight: 2 },
  { key: 'magnet', name: 'PEDESTRIAN MAGNET', weight: 1.5 },
  { key: 'big',    name: 'BIG BOY — you are enormous', weight: 1.5 },
  { key: 'star',   name: 'DISCO STAR — untouchable', weight: 1 },
];

// One little mesh per type, built once. All emissive: a pickup you cannot see
// at night is a pickup that does not exist.
function buildPickupMeshes(gl) {
  const M = {};
  const mk = (fn) => {
    const b = new MeshBuilder();
    fn(b);
    return b.upload(gl);
  };
  M.wrench = mk((b) => {
    b.style(TEX.METAL, [1.0, 0.85, 0.25], 0.55);
    b.box(0, 0, 0, 0.14, 0.55, 0.14, { perUnit: 1 });
    b.box(0, 0.62, 0, 0.34, 0.14, 0.14, { perUnit: 1 });
    b.box(0, -0.62, 0, 0.34, 0.14, 0.14, { perUnit: 1 });
  });
  M.cash = mk((b) => {
    b.style(TEX.PLAIN, [0.25, 0.95, 0.40], 0.5);
    for (let k = 0; k < 3; k++) b.chamferBox(0, -0.3 + k * 0.3, 0, 0.55, 0.11, 0.34, 0.05, { perUnit: 1 });
  });
  M.can = mk((b) => {
    b.style(TEX.PLAIN, [0.95, 0.22, 0.18], 0.5);
    b.cylinder(0, 0, 0, 0.32, 1.0, 10, { vRepeat: 1 });
    b.style(TEX.METAL, [0.9, 0.9, 0.95], 0.4);
    b.cylinder(0, 0.55, 0, 0.14, 0.18, 8);
  });
  M.oil = mk((b) => {
    b.style(TEX.PLAIN, [0.12, 0.12, 0.14], 0.25);
    b.cylinder(0, 0, 0, 0.4, 1.0, 10);
    b.style(TEX.PLAIN, [0.9, 0.75, 0.2], 0.6);
    b.cylinder(0, 0.2, 0, 0.42, 0.1, 10);
    b.cylinder(0, -0.2, 0, 0.42, 0.1, 10);
  });
  M.ram = mk((b) => {
    b.style(TEX.METAL, [0.75, 0.78, 0.85], 0.45);
    b.chamferBox(0, 0, 0, 0.62, 0.5, 0.16, 0.1, { perUnit: 1 });
    b.style(TEX.PLAIN, [1.0, 0.4, 0.15], 0.7);
    for (const s of [-1, 1]) b.box(s * 0.35, 0, -0.14, 0.09, 0.34, 0.06, { perUnit: 1 });
  });
  M.freeze = mk((b) => {
    b.style(TEX.PLAIN, [0.55, 0.85, 1.0], 0.8);
    b.sphere(0, 0, 0, 0.42, 4, 2, 1);     // low-poly: reads as a crystal
    b.sphere(0, 0, 0, 0.30, 4, 2, 1);
  });
  M.magnet = mk((b) => {
    b.style(TEX.PLAIN, [0.95, 0.25, 0.25], 0.55);
    b.box(-0.3, 0.05, 0, 0.13, 0.5, 0.13, { perUnit: 1 });
    b.box(0.3, 0.05, 0, 0.13, 0.5, 0.13, { perUnit: 1 });
    b.box(0, -0.45, 0, 0.43, 0.14, 0.13, { perUnit: 1 });
    b.style(TEX.PLAIN, [0.92, 0.92, 0.95], 0.6);
    for (const s of [-1, 1]) b.box(s * 0.3, 0.5, 0, 0.13, 0.1, 0.13, { perUnit: 1 });
  });
  M.big = mk((b) => {
    b.style(TEX.PLAIN, [0.95, 0.2, 0.15], 0.55);
    b.sphere(0, 0.25, 0, 0.5, 10, 6, 0.62);   // squashed cap
    b.style(TEX.PLAIN, [0.98, 0.94, 0.86], 0.4);
    b.cylinder(0, -0.25, 0, 0.22, 0.5, 8);
    b.style(TEX.PLAIN, [1, 1, 1], 0.8);
    b.sphere(0, 0.42, 0.3, 0.12, 6, 4, 1);
    b.sphere(-0.3, 0.35, -0.15, 0.11, 6, 4, 1);
  });
  M.star = mk((b) => {
    b.style(TEX.PLAIN, [1.0, 0.9, 0.2], 1.0);
    b.sphere(0, 0, 0, 0.3, 6, 4, 1);
    // Five points, in the plane the pickup spins in.
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2;
      b.box(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0, 0.16, 0.16, 0.09, { perUnit: 1 });
    }
  });
  return M;
}

class Pickups {
  constructor(gl, city, rand) {
    this.city = city;
    this.rand = rand;
    this.meshes = buildPickupMeshes(gl);
    this.items = [];       // { x, y, z, type }
    this.timer = 0;
    // Weighted bag to draw types from.
    this.bag = [];
    for (const t of PICKUP_TYPES) {
      for (let k = 0; k < t.weight * 2; k++) this.bag.push(t.key);
    }
  }

  // A random point on a road lane somewhere in the ring around the player.
  spawnPoint(player) {
    const city = this.city, rand = this.rand;
    for (let tries = 0; tries < 30; tries++) {
      const axis = rand() < 0.5 ? 0 : 1;
      const li = (rand() * GRID) | 0;
      const k = (rand() * (GRID - 1)) | 0;
      if (!city.edgeOpen(axis, li, k)) continue;
      const along = roadCenter(k) + rand() * CELL;
      const side = rand() < 0.5 ? -1 : 1;
      const a = axis ? [li, k] : [k, li];
      const off = city.laneOff(city.roadRank(a[0], a[1])) * side;
      const c = roadCenter(li) + city.bowAt(along, li, axis) + off;
      const x = axis ? c : along, z = axis ? along : c;
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < PICKUP_NEAR || d > PICKUP_FAR) continue;
      return { x, z };
    }
    return null;
  }

  update(dt, player, inCar) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.7;
      // Retire the far ones, top the ring back up.
      this.items = this.items.filter((it) =>
        Math.hypot(it.x - player.x, it.z - player.z) < PICKUP_GONE);
      while (this.items.length < PICKUP_COUNT) {
        const p = this.spawnPoint(player);
        if (!p) break;
        this.items.push({
          x: p.x, y: this.city.groundY(p.x, p.z), z: p.z,
          type: this.bag[(this.rand() * this.bag.length) | 0],
          born: game.time,
        });
      }
    }
    // Collection, car only: on foot you have no cupholder for a turbo can.
    if (!inCar) return;
    const car = game.car;
    const reach = PICKUP_REACH * (car.bodyScale || 1);
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      const d = Math.hypot(it.x - car.x, it.z - car.z);
      if (d > reach || Math.abs(car.y - it.y) > 2.6) continue;
      this.items.splice(k, 1);
      applyPickup(it.type);
    }
  }

  draw(r, camPos, time, shadowPass) {
    if (shadowPass) return;                       // a hovering toy casts no shadow
    for (const it of this.items) {
      const d = Math.hypot(it.x - camPos[0], it.z - camPos[2]);
      if (d > 240) continue;
      const bob = Math.sin(time * 2.2 + it.x * 0.7) * 0.16;
      const spin = time * 1.8 + it.z * 0.3;
      M4.compose(_pickM, it.x, it.y + 1.25 + bob, it.z, spin, 0, 0, 1.15, 1.15, 1.15);
      r.setMaterial([1, 1, 1], 0.25 + Math.sin(time * 5 + it.x) * 0.1, 0);
      r.draw(this.meshes[it.type], _pickM);
    }
    r.setMaterial([1, 1, 1], 0, 0);
  }
}
const _pickM = M4.create();

// ------------------------------------------------------------- the effects --

// Timed powers live on game.power; the rest are instant.
function applyPickup(type) {
  const car = game.car;
  const P = game.power;
  const info = PICKUP_TYPES.find((t) => t.key === type);
  say(info ? info.name : type.toUpperCase());
  playChime(type === 'star' ? 3 : type === 'big' ? 2 : 1);

  switch (type) {
    case 'wrench':
      car.damage = { engine: 0, steering: 0, wheels: 0, body: 0 };
      car.wrecked = false;
      break;
    case 'cash':
      game.credits += 150;
      break;
    case 'can':
      game.nitro.charge = 1;
      break;
    case 'oil':
      P.oil = Math.min(8, (P.oil || 0) + 5);
      break;
    case 'ram':
      P.ram = 30;
      break;
    case 'freeze':
      P.freeze = 7;
      break;
    case 'magnet':
      P.magnet = 12;
      break;
    case 'big':
      if (P.big <= 0) growCar(car, 1.45);
      P.big = 18;
      break;
    case 'star':
      P.star = 9;
      break;
  }
}

// Grow the car: heavier, wider, and it fills the mirror. Undone by shrinkCar
// when the clock runs out.
function growCar(car, s) {
  game.grownCar = car;      // shrink this one, even if the player swaps cars
  car.baseDims = car.baseDims ||
    { mass: car.mass, halfLen: car.halfLen, halfWid: car.halfWid, radius: car.radius };
  car.bodyScale = s;
  car.mass = car.baseDims.mass * 2.4;
  car.halfLen = car.baseDims.halfLen * s;
  car.halfWid = car.baseDims.halfWid * s;
  car.radius = car.baseDims.radius * s;
}

function shrinkCar(car) {
  if (!car.baseDims) return;
  car.bodyScale = 1;
  car.mass = car.baseDims.mass;
  car.halfLen = car.baseDims.halfLen;
  car.halfWid = car.baseDims.halfWid;
  car.radius = car.baseDims.radius;
}

// Tick the timers, apply what the active powers do each frame, and put the
// player's stats back when something expires.
function updatePowers(dt) {
  const P = game.power;
  const car = game.car;

  for (const k of ['ram', 'freeze', 'magnet', 'star']) {
    if (P[k] > 0) P[k] = Math.max(0, P[k] - dt);
  }
  if (P.big > 0) {
    P.big = Math.max(0, P.big - dt);
    if (P.big === 0) shrinkCar(game.grownCar || car);
  }

  // How hard the player hits and how little they feel, from what is running.
  car.attackScale = 1;
  car.damageScale = 1;
  if (P.ram > 0) { car.attackScale *= 2.6; car.damageScale *= 0.45; }
  if (P.big > 0) { car.attackScale *= 1.5; car.damageScale *= 0.6; }
  if (P.star > 0) { car.attackScale *= 2.2; car.damageScale = 0; }

  // Oil slicks age out.
  for (let k = game.slicks.length - 1; k >= 0; k--) {
    game.slicks[k].life -= dt;
    if (game.slicks[k].life <= 0) game.slicks.splice(k, 1);
  }

  // Drop a slick behind the rear bumper.
  game.oilCool = Math.max(0, (game.oilCool || 0) - dt);
  if (keys.KeyQ && P.oil > 0 && game.oilCool === 0 && game.player.inCar) {
    P.oil--;
    game.oilCool = 0.45;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    game.slicks.push({ x: car.x - fx * 3.4, z: car.z - fz * 3.4, r: 2.6, life: 26 });
    say(P.oil > 0 ? `OIL AWAY — ${P.oil} left` : 'OIL AWAY — drum empty');
  }
}

// A quick rising chime; more notes for the better toys.
function playChime(notes) {
  const a = game.audio;
  if (!a) return;
  const ctx = a.ctx, t0 = ctx.currentTime;
  for (let k = 0; k < notes + 1; k++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 620 * Math.pow(1.335, k);
    const t = t0 + k * 0.085;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(a.master);
    o.start(t); o.stop(t + 0.13);
  }
}
