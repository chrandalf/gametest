// Procedural city generation: roads, blocks, buildings, props and colliders.
'use strict';

const CELL = 88;          // distance between road centre lines
const ROAD = 26;          // road width
const BLOCK = CELL - ROAD;
const GRID = 9;           // blocks per axis
const WORLD = GRID * CELL;
const LANE = 6.5;         // lane offset from the road centre line
const SIDEWALK_H = 0.22;
const FLOOR_H = 3.4;

// facade layer -> how many window columns/rows one texture repeat contains
const FACADES = [
  { layer: TEX.GLASS,  cols: 8,  rows: 8 },
  { layer: TEX.OFFICE, cols: 6,  rows: 6 },
  { layer: TEX.BRICK,  cols: 4,  rows: 4 },
  { layer: TEX.MODERN, cols: 4,  rows: 7 },
  { layer: TEX.TOWER,  cols: 10, rows: 12 },
];

const BUILDING_TINTS = [
  [1.00, 0.98, 0.94], [0.86, 0.88, 0.95], [0.95, 0.88, 0.80],
  [0.78, 0.84, 0.86], [0.92, 0.82, 0.78], [0.84, 0.86, 0.80],
  [0.70, 0.76, 0.88], [1.00, 0.92, 0.86],
];

const CAR_COLORS = [
  [0.78, 0.12, 0.12], [0.12, 0.28, 0.66], [0.92, 0.86, 0.30], [0.10, 0.10, 0.12],
  [0.90, 0.90, 0.92], [0.16, 0.52, 0.32], [0.85, 0.45, 0.10], [0.45, 0.45, 0.50],
  [0.55, 0.15, 0.55], [0.20, 0.65, 0.70],
];

const roadCenter = (i) => i * CELL;

class City {
  constructor(gl, seed) {
    this.gl = gl;
    this.rand = makeRandom(seed);
    this.colliders = [];      // { x0, z0, x1, z1, top }
    this.buildings = [];      // minimap footprints
    this.parks = [];
    this.lights = [];         // street lamp positions, used for night point lights
    this.ramps = new RampSet();
    this.chunks = [];
    this.hash = new Map();
    this.hashCell = 24;
    this.build();
  }

  // ------------------------------------------------------------ collision --

  addCollider(x0, z0, x1, z1, top) {
    const c = { x0, z0, x1, z1, top };
    const idx = this.colliders.length;
    this.colliders.push(c);
    const cs = this.hashCell;
    for (let gx = Math.floor(x0/cs); gx <= Math.floor(x1/cs); gx++) {
      for (let gz = Math.floor(z0/cs); gz <= Math.floor(z1/cs); gz++) {
        const key = gx * 73856093 ^ gz * 19349663;
        let arr = this.hash.get(key);
        if (!arr) { arr = []; this.hash.set(key, arr); }
        arr.push(idx);
      }
    }
    return c;
  }

  query(x, z, r) {
    const cs = this.hashCell;
    const out = [];
    const seen = new Set();
    for (let gx = Math.floor((x-r)/cs); gx <= Math.floor((x+r)/cs); gx++) {
      for (let gz = Math.floor((z-r)/cs); gz <= Math.floor((z+r)/cs); gz++) {
        const arr = this.hash.get(gx * 73856093 ^ gz * 19349663);
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          const c = this.colliders[i];
          if (x + r > c.x0 && x - r < c.x1 && z + r > c.z0 && z - r < c.z1) out.push(c);
        }
      }
    }
    return out;
  }

  // Height of whatever solid is under a point: a rooftop if the point is over a
  // building, otherwise the street. This is what makes roof landings possible.
  topAt(x, z) {
    let top = 0;
    for (const c of this.query(x, z, 0.01)) {
      if (c.top > top) top = c.top;
    }
    return top;
  }

  // Push a circle out of any building it overlaps. Returns the surface normal
  // of the last hit, or null when nothing was touched.
  resolveCircle(pos, r, aboveY) {
    let hit = null;
    for (const c of this.query(pos.x, pos.z, r)) {
      if (aboveY !== undefined && c.top <= aboveY + 0.4) continue;   // driving on it
      const cx = clamp(pos.x, c.x0, c.x1);
      const cz = clamp(pos.z, c.z0, c.z1);
      let dx = pos.x - cx, dz = pos.z - cz;
      let d = Math.hypot(dx, dz);
      if (d > r) continue;
      if (d < 1e-4) {
        // Deep inside: eject along the shallowest axis.
        const left = pos.x - c.x0, right = c.x1 - pos.x;
        const down = pos.z - c.z0, up = c.z1 - pos.z;
        const m = Math.min(left, right, down, up);
        if (m === left) { dx = -1; dz = 0; } else if (m === right) { dx = 1; dz = 0; }
        else if (m === down) { dx = 0; dz = -1; } else { dx = 0; dz = 1; }
        d = 0.001;
      }
      const nx = dx / d, nz = dz / d;
      pos.x = cx + nx * r;
      pos.z = cz + nz * r;
      hit = { nx, nz };
    }
    return hit;
  }

  // ---------------------------------------------------------- generation ---

  build() {
    const rand = this.rand;
    const ground = new MeshBuilder();
    const pad = ROAD * 0.5 + 40;
    ground.style(TEX.GRASS, [0.62, 0.72, 0.55], 0);
    ground.quad([-pad, -0.05, WORLD - CELL + pad], [WORLD - CELL + pad, -0.05, WORLD - CELL + pad],
                [WORLD - CELL + pad, -0.05, -pad], [-pad, -0.05, -pad], 90, 90);
    this.groundMesh = ground.upload(this.gl);

    // 3x3 blocks per chunk keeps draw calls low but culling still useful.
    const CH = 3;
    const chunkCount = Math.ceil(GRID / CH);
    const builders = [];
    for (let i = 0; i < chunkCount * chunkCount; i++) builders.push(new MeshBuilder());
    const chunkAt = (bi, bj) =>
      builders[Math.min(chunkCount-1, Math.floor(bi/CH)) * chunkCount +
               Math.min(chunkCount-1, Math.floor(bj/CH))];

    // --- roads: one long strip per axis, drawn once so they never z-fight ---
    const lo = -ROAD/2, hi = (GRID - 1) * CELL + ROAD/2;
    for (let i = 0; i < GRID; i++) {
      const c = roadCenter(i);
      for (let j = 0; j < GRID; j++) {
        const b = chunkAt(i, j);
        const z0 = j * CELL - CELL/2, z1 = z0 + CELL;
        b.style(TEX.ASPHALT, [1, 1, 1], 0);
        b.quad([c-ROAD/2, 0, clamp(z1, lo, hi)], [c+ROAD/2, 0, clamp(z1, lo, hi)],
               [c+ROAD/2, 0, clamp(z0, lo, hi)], [c-ROAD/2, 0, clamp(z0, lo, hi)], 2.4, 8);
        // East-west road, split so it does not overlap the intersections.
        b.quad([clamp(z0, lo, hi), 0.005, c+ROAD/2], [clamp(z1, lo, hi), 0.005, c+ROAD/2],
               [clamp(z1, lo, hi), 0.005, c-ROAD/2], [clamp(z0, lo, hi), 0.005, c-ROAD/2], 8, 2.4);
      }
    }

    // --- lane markings ---
    for (let i = 0; i < GRID; i++) {
      const c = roadCenter(i);
      for (let j = 0; j < GRID; j++) {
        const b = chunkAt(i, j);
        const segStart = j * CELL - CELL/2;
        b.style(TEX.MARK, [1.0, 0.85, 0.15], 0);
        // Dashed centre line, skipping the intersection box.
        for (let t = 0; t < 10; t++) {
          const z = segStart + t * (CELL/10) + 1;
          const zEnd = z + CELL/20;
          if (zEnd > hi || z < lo) continue;
          const nearNode = Math.abs(((z + CELL/2) % CELL) - CELL/2) > CELL/2 - ROAD/2 - 3;
          if (nearNode) continue;
          b.quad([c-0.22, 0.03, zEnd], [c+0.22, 0.03, zEnd], [c+0.22, 0.03, z], [c-0.22, 0.03, z], 1, 1);
          const x = segStart + t * (CELL/10) + 1, xEnd = x + CELL/20;
          if (xEnd > hi || x < lo) continue;
          const nearNodeX = Math.abs(((x + CELL/2) % CELL) - CELL/2) > CELL/2 - ROAD/2 - 3;
          if (nearNodeX) continue;
          b.quad([x, 0.035, c+0.22], [xEnd, 0.035, c+0.22], [xEnd, 0.035, c-0.22], [x, 0.035, c-0.22], 1, 1);
        }
        // Zebra crossings: bars run along the travel direction, spanning the road.
        b.style(TEX.MARK, [0.95, 0.95, 0.92], 0);
        const cz = roadCenter(j);
        const BAR_W = 0.62, BAR_L = 3.2, STEP = (ROAD - 3) / 8;
        for (const s of [-1, 1]) {
          for (let k = 0; k <= 8; k++) {
            const off = -ROAD/2 + 1.5 + k * STEP;
            // Crossing the north-south road.
            const zEdge = cz + s * (ROAD/2 + 2.6);
            if (zEdge > lo && zEdge < hi) {
              b.quad([c+off-BAR_W, 0.04, zEdge+BAR_L/2], [c+off+BAR_W, 0.04, zEdge+BAR_L/2],
                     [c+off+BAR_W, 0.04, zEdge-BAR_L/2], [c+off-BAR_W, 0.04, zEdge-BAR_L/2], 1, 1);
            }
            // Crossing the east-west road.
            const xEdge = c + s * (ROAD/2 + 2.6);
            if (xEdge > lo && xEdge < hi) {
              b.quad([xEdge-BAR_L/2, 0.045, cz+off+BAR_W], [xEdge+BAR_L/2, 0.045, cz+off+BAR_W],
                     [xEdge+BAR_L/2, 0.045, cz+off-BAR_W], [xEdge-BAR_L/2, 0.045, cz+off-BAR_W], 1, 1);
            }
          }
        }
      }
    }

    // --- blocks ---
    for (let bi = 0; bi < GRID - 1; bi++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        const b = chunkAt(bi, bj);
        const x0 = roadCenter(bi) + ROAD/2, x1 = roadCenter(bi + 1) - ROAD/2;
        const z0 = roadCenter(bj) + ROAD/2, z1 = roadCenter(bj + 1) - ROAD/2;
        this.buildBlock(b, bi, bj, x0, z0, x1, z1);
      }
    }

    // --- street furniture at every intersection ---
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const b = chunkAt(i, j);
        const cx = roadCenter(i), cz = roadCenter(j);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            this.streetLight(b, cx + sx * (ROAD/2 + 1.6), cz + sz * (ROAD/2 + 1.6), -sx, -sz);
          }
        }
      }
    }

    // Stunt ramps: a handful on straight stretches, facing along the road.
    for (let n = 0; n < 7; n++) {
      const horiz = rand() < 0.5;
      const i = 1 + ((rand() * (GRID - 2)) | 0), j = 1 + ((rand() * (GRID - 2)) | 0);
      const along = roadCenter(horiz ? j : i) + (rand() - 0.5) * (CELL * 0.4);
      const across = roadCenter(horiz ? i : j) - LANE;
      const x = horiz ? along : across;
      const z = horiz ? across : along;
      const yaw = horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI);
      this.ramps.emit(chunkAt(i, j), x, z, yaw, 9.5, 6.4, 2.1);
    }
    // A few mega ramps: steep enough to put a nitro-boosted car on a roof.
    for (let n = 0; n < 4; n++) {
      const horiz = rand() < 0.5;
      const i = 1 + ((rand() * (GRID - 2)) | 0), j = 1 + ((rand() * (GRID - 2)) | 0);
      const along = roadCenter(horiz ? j : i) + (rand() - 0.5) * (CELL * 0.3);
      const across = roadCenter(horiz ? i : j) - LANE;
      const x = horiz ? along : across;
      const z = horiz ? across : along;
      const yaw = horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI);
      this.ramps.emit(chunkAt(i, j), x, z, yaw, 15.0, 7.2, 5.4);
    }

    for (const bld of builders) {
      if (bld.empty) continue;
      this.chunks.push(bld.upload(this.gl));
    }

    // Invisible walls so nobody drives off the edge of the world.
    const w = 6;
    this.addCollider(lo - w, lo - w, hi + w, lo, 30);
    this.addCollider(lo - w, hi, hi + w, hi + w, 30);
    this.addCollider(lo - w, lo - w, lo, hi + w, 30);
    this.addCollider(hi, lo - w, hi + w, hi + w, 30);
  }

  buildBlock(b, bi, bj, x0, z0, x1, z1) {
    const rand = this.rand;
    // Distance from downtown drives density and height.
    const mid = (GRID - 1) / 2;
    const dc = Math.hypot(bi - mid + 0.5, bj - mid + 0.5) / mid;
    const downtown = clamp(1 - dc, 0, 1);

    // Sidewalk slab for the whole block.
    b.style(TEX.SIDEWALK, [1, 1, 1], 0);
    b.chamferBox((x0+x1)/2, SIDEWALK_H/2, (z0+z1)/2, (x1-x0)/2, SIDEWALK_H/2, (z1-z0)/2, 0.09,
          { top: TEX.SIDEWALK, perUnit: 0.22 });

    if (rand() < 0.12 + (1 - downtown) * 0.16) {
      this.buildPark(b, x0, z0, x1, z1);
      return;
    }

    // Split the block into lots. Downtown gets fewer, bigger footprints.
    const inset = 3.0;
    const ax0 = x0 + inset, az0 = z0 + inset, ax1 = x1 - inset, az1 = z1 - inset;
    const lots = [];
    const splitCount = downtown > 0.6 ? (rand() < 0.5 ? 1 : 2) : (rand() < 0.45 ? 2 : 3);
    const vertical = rand() < 0.5;
    const cuts = [0];
    for (let i = 1; i < splitCount; i++) cuts.push(i / splitCount + (rand() - 0.5) * 0.18);
    cuts.push(1);
    for (let i = 0; i < splitCount; i++) {
      const a = cuts[i], c = cuts[i + 1];
      if (vertical) {
        lots.push([lerp(ax0, ax1, a), az0, lerp(ax0, ax1, c) - 2.5, az1]);
      } else {
        lots.push([ax0, lerp(az0, az1, a), ax1, lerp(az0, az1, c) - 2.5]);
      }
    }
    // Occasionally cut each lot again on the other axis for a denser look.
    const finalLots = [];
    for (const l of lots) {
      if (rand() < (downtown > 0.55 ? 0.15 : 0.5) && Math.min(l[2]-l[0], l[3]-l[1]) > 24) {
        const t = 0.4 + rand() * 0.2;
        if (vertical) {
          finalLots.push([l[0], l[1], l[2], lerp(l[1], l[3], t) - 2.5]);
          finalLots.push([l[0], lerp(l[1], l[3], t), l[2], l[3]]);
        } else {
          finalLots.push([l[0], l[1], lerp(l[0], l[2], t) - 2.5, l[3]]);
          finalLots.push([lerp(l[0], l[2], t), l[1], l[2], l[3]]);
        }
      } else finalLots.push(l);
    }

    for (const [lx0, lz0, lx1, lz1] of finalLots) {
      if (lx1 - lx0 < 9 || lz1 - lz0 < 9) continue;
      const base = 12 + rand() * 16;
      const h = base + downtown * downtown * (30 + rand() * 110) + rand() * 10;
      this.buildBuilding(b, lx0, lz0, lx1, lz1, Math.max(9, h), downtown);
    }

    // A few parked cars along the kerb.
    for (let k = 0; k < 3; k++) {
      if (rand() > 0.55) continue;
      const side = (rand() * 4) | 0;
      const t = 0.2 + rand() * 0.6;
      let px, pz, yaw;
      if (side === 0) { px = lerp(x0, x1, t); pz = z0 - 3.4; yaw = 0; }
      else if (side === 1) { px = lerp(x0, x1, t); pz = z1 + 3.4; yaw = Math.PI; }
      else if (side === 2) { px = x0 - 3.4; pz = lerp(z0, z1, t); yaw = Math.PI/2; }
      else { px = x1 + 3.4; pz = lerp(z0, z1, t); yaw = -Math.PI/2; }
      this.parkedCar(b, px, pz, yaw);
    }
  }

  buildBuilding(b, x0, z0, x1, z1, height, downtown) {
    const rand = this.rand;
    const w = x1 - x0, d = z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const tint = BUILDING_TINTS[(rand() * BUILDING_TINTS.length) | 0];
    const fIdx = height > 55 ? (rand() < 0.6 ? 4 : 0)
               : height > 30 ? ((rand() * 3) | 0)
               : (rand() < 0.5 ? 2 : 1);
    const fac = FACADES[fIdx];

    const floors = Math.max(2, Math.round(height / FLOOR_H));
    const totalH = floors * FLOOR_H;
    const shopH = height < 46 && rand() < 0.75 ? FLOOR_H * 1.3 : 0;

    if (shopH > 0) {
      b.style(TEX.SHOP, [1, 1, 1], 0);
      b.chamferBox(cx, shopH/2, cz, w/2 + 0.35, shopH/2, d/2 + 0.35, 0.3,
            { skipTop: true, uvU: Math.max(1, Math.round(w / 9)), uvV: 1 });
      b.style(TEX.CONCRETE, [0.9, 0.9, 0.88], 0);
      b.box(cx, shopH + 0.18, cz, w/2 + 0.6, 0.18, d/2 + 0.6,
            { side: TEX.CONCRETE, top: TEX.CONCRETE, perUnit: 0.3 });
    }

    const bodyH = totalH - shopH;
    const uvU = Math.max(1, Math.round(w / (fac.cols * FLOOR_H)));
    const uvV = Math.max(1, Math.round(bodyH / (fac.rows * FLOOR_H)));
    b.style(fac.layer, tint, 0);

    // Downtown gets some genuinely round towers; everything else gets its
    // vertical corners rolled off so the skyline is not all hard boxes.
    const roundTower = downtown > 0.5 && height > 45 && Math.abs(w - d) < Math.min(w, d) * 0.45 && rand() < 0.34;
    if (roundTower) {
      const rad = Math.min(w, d) / 2;
      b.cylinder(cx, shopH + bodyH/2, cz, rad, bodyH, 24,
                 { uRepeat: Math.max(2, Math.round(2 * Math.PI * rad / (fac.cols * FLOOR_H) * fac.cols / 2)),
                   vRepeat: uvV });
      b.style(TEX.ROOF, [1, 1, 1], 0);
      b.cylinder(cx, totalH + 0.12, cz, rad * 1.02, 0.24, 24, { uRepeat: 6, vRepeat: 1 });
      b.style(fac.layer, tint, 0);
    } else {
      const corner = clamp(Math.min(w, d) * 0.07, 0.35, 1.4);
      b.chamferBox(cx, shopH + bodyH/2, cz, w/2, bodyH/2, d/2, corner,
                   { top: TEX.ROOF, topTint: [1, 1, 1], uvU, uvV });
    }

    // Facade relief: without it a building is a flat box no matter how good the
    // lighting is. Ledges every few floors and corner pilasters give the sun
    // something to cast a line of shadow from.
    if (!roundTower) {
      const bandGap = FLOOR_H * (height > 70 ? 6 : 4);
      b.style(TEX.CONCRETE, tint, 0);
      for (let y = shopH + bandGap; y < totalH - 1.2; y += bandGap) {
        b.chamferBox(cx, y, cz, w/2 + 0.22, 0.17, d/2 + 0.22, 0.1,
                     { perUnit: 0.5, skipTop: true });
      }
      // Pilasters up the corners, slightly proud of the wall.
      const pil = Math.min(0.85, Math.min(w, d) * 0.09);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          b.chamferBox(cx + sx * (w/2 - pil * 0.35), shopH + bodyH/2, cz + sz * (d/2 - pil * 0.35),
                       pil, bodyH/2, pil, pil * 0.35, { perUnit: 0.45, skipTop: true });
        }
      }
      // A cornice under the parapet reads as a real roofline.
      b.chamferBox(cx, totalH - 0.35, cz, w/2 + 0.42, 0.35, d/2 + 0.42, 0.18, { perUnit: 0.5 });
    }

    // Parapet wall around the roof.
    b.style(TEX.CONCRETE, tint, 0);
    if (!roundTower) {
    const pw = 0.5, ph = 1.0;
    b.box(cx, totalH + ph/2, z0 + pw/2, w/2, ph/2, pw/2, { perUnit: 0.4 });
    b.box(cx, totalH + ph/2, z1 - pw/2, w/2, ph/2, pw/2, { perUnit: 0.4 });
    b.box(x0 + pw/2, totalH + ph/2, cz, pw/2, ph/2, d/2, { perUnit: 0.4 });
    b.box(x1 - pw/2, totalH + ph/2, cz, pw/2, ph/2, d/2, { perUnit: 0.4 });
    }

    // Setback tower on tall buildings.
    if (height > 60 && rand() < 0.7) {
      const sw = w * (0.45 + rand() * 0.2), sd = d * (0.45 + rand() * 0.2);
      const sh = 8 + rand() * 26;
      b.style(fac.layer, tint, 0);
      b.chamferBox(cx, totalH + sh/2, cz, sw/2, sh/2, sd/2, clamp(Math.min(sw, sd) * 0.09, 0.3, 1.6),
            { top: TEX.ROOF,
              uvU: Math.max(1, Math.round(sw / (fac.cols * FLOOR_H))),
              uvV: Math.max(1, Math.round(sh / (fac.rows * FLOOR_H))) });
      // Aircraft warning light.
      b.style(TEX.PLAIN, [1.0, 0.15, 0.12], 1.0);
      b.box(cx, totalH + sh + 0.6, cz, 0.35, 0.6, 0.35, { perUnit: 1, emis: 1 });
      b.style(TEX.METAL, [0.7, 0.7, 0.72], 0);
      b.cylinder(cx, totalH + sh + 4, cz, 0.18, 8, 6);
    }

    // Rooftop clutter.
    const rc = 1 + ((rand() * 3) | 0);
    for (let i = 0; i < rc; i++) {
      const uw = 1.5 + rand() * 3.5, ud = 1.5 + rand() * 3.5, uh = 1 + rand() * 2.5;
      const ux = lerp(x0 + uw + 1, x1 - uw - 1, rand());
      const uz = lerp(z0 + ud + 1, z1 - ud - 1, rand());
      b.style(TEX.METAL, [0.62, 0.64, 0.66], 0);
      b.chamferBox(ux, totalH + uh/2, uz, uw/2, uh/2, ud/2, 0.28, { perUnit: 0.5 });
    }
    if (rand() < 0.25 && w > 16) {
      // Water tower.
      const ux = lerp(x0 + 6, x1 - 6, rand()), uz = lerp(z0 + 6, z1 - 6, rand());
      b.style(TEX.BARK, [0.75, 0.6, 0.45], 0);
      b.cylinder(ux, totalH + 5.2, uz, 2.2, 4.4, 10, { uRepeat: 4, vRepeat: 2 });
      b.style(TEX.METAL, [0.5, 0.5, 0.52], 0);
      for (const [ox, oz] of [[-1.4,-1.4],[1.4,-1.4],[-1.4,1.4],[1.4,1.4]]) {
        b.cylinder(ux + ox, totalH + 1.5, uz + oz, 0.16, 3, 5);
      }
    }

    this.addCollider(x0, z0, x1, z1, totalH);
    this.buildings.push({ x0, z0, x1, z1, h: totalH, downtown });
  }

  buildPark(b, x0, z0, x1, z1) {
    const rand = this.rand;
    b.style(TEX.GRASS, [1, 1, 1], 0);
    b.quad([x0+2, SIDEWALK_H + 0.02, z1-2], [x1-2, SIDEWALK_H + 0.02, z1-2],
           [x1-2, SIDEWALK_H + 0.02, z0+2], [x0+2, SIDEWALK_H + 0.02, z0+2],
           (x1-x0)/8, (z1-z0)/8);
    const n = 5 + ((rand() * 7) | 0);
    for (let i = 0; i < n; i++) {
      const tx = lerp(x0 + 5, x1 - 5, rand()), tz = lerp(z0 + 5, z1 - 5, rand());
      this.tree(b, tx, tz, 0.8 + rand() * 0.7);
    }
    for (let i = 0; i < 3; i++) {
      if (rand() < 0.5) continue;
      const bx = lerp(x0 + 6, x1 - 6, rand()), bz = lerp(z0 + 6, z1 - 6, rand());
      b.style(TEX.BARK, [0.8, 0.65, 0.5], 0);
      b.chamferBox(bx, SIDEWALK_H + 0.55, bz, 1.4, 0.08, 0.35, 0.06, { perUnit: 1 });
      b.chamferBox(bx, SIDEWALK_H + 0.85, bz - 0.32, 1.4, 0.35, 0.06, 0.05, { perUnit: 1 });
      b.style(TEX.METAL, [0.3, 0.32, 0.34], 0);
      b.box(bx - 1.2, SIDEWALK_H + 0.28, bz, 0.08, 0.28, 0.32, { perUnit: 1 });
      b.box(bx + 1.2, SIDEWALK_H + 0.28, bz, 0.08, 0.28, 0.32, { perUnit: 1 });
    }
    this.parks.push({ x0, z0, x1, z1 });
  }

  tree(b, x, z, scale) {
    const rand = this.rand;
    const h = (4 + rand() * 3) * scale;
    b.style(TEX.BARK, [1, 1, 1], 0);
    b.cylinder(x, SIDEWALK_H + h/2, z, 0.34 * scale, h, 7, { uRepeat: 2, vRepeat: 2 });
    b.style(TEX.LEAVES, [0.85 + rand()*0.3, 0.95 + rand()*0.2, 0.85], 0);
    const r = (2.2 + rand() * 1.2) * scale;
    b.sphere(x, SIDEWALK_H + h + r * 0.45, z, r, 9, 6, 0.85);
    b.sphere(x + (rand()-0.5)*r, SIDEWALK_H + h + r * 0.1, z + (rand()-0.5)*r, r*0.7, 8, 5, 0.9);
    this.addCollider(x - 0.5, z - 0.5, x + 0.5, z + 0.5, h);
  }

  streetLight(b, x, z, dirX, dirZ) {
    const h = 7.5;
    b.style(TEX.METAL, [0.32, 0.34, 0.36], 0);
    b.cylinder(x, SIDEWALK_H + h/2, z, 0.15, h, 6, { vRepeat: 3 });
    const ax = x + dirX * 1.4, az = z + dirZ * 1.4;
    b.box((x + ax)/2, SIDEWALK_H + h, (z + az)/2,
          Math.abs(dirX) * 0.8 + 0.12, 0.12, Math.abs(dirZ) * 0.8 + 0.12, { perUnit: 1 });
    b.style(TEX.PLAIN, [1.0, 0.93, 0.75], 0.9);
    b.chamferBox(ax, SIDEWALK_H + h - 0.22, az, 0.42, 0.16, 0.42, 0.12, { perUnit: 1 });
    this.lights.push({ x: ax, y: SIDEWALK_H + h - 0.4, z: az });
  }

  parkedCar(b, x, z, yaw) {
    const rand = this.rand;
    const col = CAR_COLORS[(rand() * CAR_COLORS.length) | 0];
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // Local (right, forward) -> world helper.
    const T = (rx, fz) => [x + rx * cos + fz * sin, z - rx * sin + fz * cos];
    const boxLocal = (fz, y, hw, hy, hl, layer, tint, emis) => {
      const [wx, wz] = T(0, fz);
      const bb = new MeshBuilder();
      bb.style(layer, tint, emis || 0);
      if (emis) bb.box(0, y, 0, hw, hy, hl, { perUnit: 0.6, emis });
      else bb.chamferBox(0, y, 0, hw, hy, hl, Math.min(hw, hy, hl) * 0.55, { perUnit: 0.6 });
      // Rotate the little box into place.
      for (let i = 0; i < bb.v.length; i += VERT_FLOATS) {
        const px = bb.v[i], pz = bb.v[i+2];
        const nx = bb.v[i+3], nz = bb.v[i+5];
        bb.v[i] = px * cos + pz * sin;
        bb.v[i+2] = -px * sin + pz * cos;
        bb.v[i+3] = nx * cos + nz * sin;
        bb.v[i+5] = -nx * sin + nz * cos;
      }
      b.append(bb, wx, 0, wz);
    };
    boxLocal(0, 0.85, 0.95, 0.42, 2.1, TEX.METAL, col);
    boxLocal(-0.15, 1.42, 0.85, 0.34, 1.15, TEX.GLASS, [col[0]*0.4+0.1, col[1]*0.4+0.15, col[2]*0.4+0.2]);
    boxLocal(2.0, 0.9, 0.72, 0.16, 0.12, TEX.PLAIN, [1, 0.95, 0.8], 0.15);
    boxLocal(-2.0, 0.9, 0.72, 0.16, 0.12, TEX.PLAIN, [0.9, 0.15, 0.12], 0.15);
    this.addCollider(Math.min(...[T(-1,-2.3)[0], T(1,-2.3)[0], T(-1,2.3)[0], T(1,2.3)[0]]),
                     Math.min(...[T(-1,-2.3)[1], T(1,-2.3)[1], T(-1,2.3)[1], T(1,2.3)[1]]),
                     Math.max(...[T(-1,-2.3)[0], T(1,-2.3)[0], T(-1,2.3)[0], T(1,2.3)[0]]),
                     Math.max(...[T(-1,-2.3)[1], T(1,-2.3)[1], T(-1,2.3)[1], T(1,2.3)[1]]), 1.6);
  }
}

// Is a world position inside the road surface (not on a block)?
function onRoad(x, z) {
  const fx = Math.abs(((x % CELL) + CELL) % CELL - 0) ;
  const dx = Math.min(fx, CELL - fx);
  const fz = Math.abs(((z % CELL) + CELL) % CELL - 0);
  const dz = Math.min(fz, CELL - fz);
  return dx < ROAD/2 || dz < ROAD/2;
}
