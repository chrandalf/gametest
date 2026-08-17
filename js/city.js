// Procedural world generation: a road grid whose blocks are zoned from open
// country up to downtown, built from a seed.
'use strict';

const CELL = 88;          // distance between road centre lines
const ROAD = 26;          // road width
const BLOCK = CELL - ROAD;
const GRID = 17;          // road lines per axis; blocks per axis is one less
const WORLD = GRID * CELL;
const LANE = 6.5;         // lane offset from the road centre line
const SIDEWALK_H = 0.22;
const FLOOR_H = 3.4;
const DEFAULT_SEED = 20260814;

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

// Speed limit by road rank, in metres per second. Country roads are quick and
// empty; the high street is 20 mph because it is full of people.
// wild  farm  village suburb town  highst downtown
const SPEED_LIMITS = [24.6, 24.6, 13.4, 13.4, 11.2, 8.9, 13.4];
const MOTORWAY_LIMIT = 31.3;   // 70 mph
const CENTRAL_RES = 1.3;       // half-width of the central reservation

// --- polygon collision -------------------------------------------------------
// A rotated or L-shaped footprint is nothing like its bounding box, and the
// difference is felt as invisible walls sticking out past the corners.

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) &&
        x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// Nearest point on the polygon's boundary to (x, z).
function closestOnPoly(x, z, poly) {
  let bx = poly[0][0], bz = poly[0][1], best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], az = poly[j][1];
    const ex = poly[i][0] - ax, ez = poly[i][1] - az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 1e-12 ? clamp(((x - ax) * ex + (z - az) * ez) / len2, 0, 1) : 0;
    const px = ax + ex * t, pz = az + ez * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return [bx, bz, Math.sqrt(best)];
}

class City {
  constructor(gl, seed) {
    this.gl = gl;
    this.seed = (seed === undefined ? DEFAULT_SEED : seed) >>> 0;
    this.rand = makeRandom(this.seed);
    this.zones = new ZoneMap(this.seed, GRID - 1);
    this.motorway = this.zones.corridor;
    this.terrain = new Terrain(this.seed ^ 0x3c6ef35f, GRID, CELL, this.zones.river, this.zones);
    this.lift = 0;            // vertical offset applied while building a block
    this.colliders = [];      // { x0, z0, x1, z1, top }
    this.buildings = [];      // minimap footprints
    this.parks = [];
    this.water = [];
    this.bridges = [];
    this.lights = [];         // street lamp positions, used for night point lights
    this.ramps = new RampSet();
    this.chunks = [];
    this.hash = new Map();
    this.hashCell = 24;
    this.build();
  }

  // ------------------------------------------------------------ collision --

  // `top` is given in the local frame of whatever is being built, so the
  // current lift is added here rather than at every call site.
  addCollider(x0, z0, x1, z1, top) {
    const c = { x0, z0, x1, z1, top: top + this.lift };
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

  // A solid you can also land on: collides, and shows on the minimap.
  addBuilding(x0, z0, x1, z1, top, downtown) {
    this.addCollider(x0, z0, x1, z1, top);
    this.buildings.push({ x0, z0, x1, z1, h: top + this.lift, downtown: downtown || 0 });
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

  // The surface with nothing built on it: a block's plateau if the point is on
  // one, otherwise the interpolated ground between junctions.
  groundY(x, z) {
    const ground = this.terrain.at(x, z);
    // Every block within reach gets a say, and the highest wins. Consulting
    // only the nearest one leaves a step wherever two blocks of different
    // height share a road, which is a wall you cannot see.
    const bi0 = clamp(Math.floor((x - ROAD/2) / CELL) - 1, 0, GRID - 2);
    const bj0 = clamp(Math.floor((z - ROAD/2) / CELL) - 1, 0, GRID - 2);
    let top = ground;
    for (let bi = bi0; bi <= bi0 + 2 && bi < GRID - 1; bi++) {
      for (let bj = bj0; bj <= bj0 + 2 && bj < GRID - 1; bj++) {
        if (this.isRural(bi, bj)) continue;
        const x0 = roadCenter(bi) + ROAD/2, x1 = roadCenter(bi + 1) - ROAD/2;
        const z0 = roadCenter(bj) + ROAD/2, z1 = roadCenter(bj + 1) - ROAD/2;
        const out = Math.max(x0 - x, x - x1, z0 - z, z - z1);
        const run = this.zones.rankAt(bi, bj) >= 4 ? 2.0 : 3.4;
        if (out >= run) continue;
        const lift = this.terrain.blockLift(bi, bj);
        const plate = this.zones.zoneAt(bi, bj) === Z.WATER ? lift + WATER_Y : lift;
        const y = out <= 0 ? plate : lerp(plate, ground, smoothstep(0, 1, out / run));
        if (y > top) top = y;
      }
    }
    return top;
  }

  // Height of whatever solid is under a point: a rooftop if the point is over a
  // building, otherwise the ground. This is what makes roof landings possible.
  topAt(x, z) {
    let top = this.groundY(x, z);
    for (const c of this.query(x, z, 0.01)) {
      if (c.top <= top) continue;
      if (c.poly && !pointInPoly(x, z, c.poly)) continue;
      top = c.top;
    }
    return top;
  }

  // Push a circle out of any building it overlaps. Returns the surface normal
  // of the last hit, or null when nothing was touched.
  resolveCircle(pos, r, aboveY) {
    let hit = null;
    for (const c of this.query(pos.x, pos.z, r)) {
      if (aboveY !== undefined && c.top <= aboveY + 0.4) continue;   // driving on it
      if (c.poly) {
        const [bx, bz, dist] = closestOnPoly(pos.x, pos.z, c.poly);
        const inside = pointInPoly(pos.x, pos.z, c.poly);
        if (!inside && dist > r) continue;
        // Push out to the boundary along the outward direction either way.
        let ox = inside ? bx - pos.x : pos.x - bx;
        let oz = inside ? bz - pos.z : pos.z - bz;
        let ol = Math.hypot(ox, oz);
        if (ol < 1e-5) { ox = 1; oz = 0; ol = 1; }
        ox /= ol; oz /= ol;
        pos.x = bx + ox * r;
        pos.z = bz + oz * r;
        hit = { nx: ox, nz: oz };
        continue;
      }
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

  // ------------------------------------------------------------- zoning ----

  // How built-up the streets around a junction are: the highest rank of the
  // blocks that touch it. Kerbs, markings and lamp posts follow this, so the
  // road itself changes character as you drive out of town.
  roadRank(i, j) {
    // The motorway is a trunk road wherever it runs, including out in the
    // fields: it gets markings and lighting the countryside would not.
    if (this.isMotorway(i, j)) return RANK_MAX;
    let r = 0;
    for (const [bi, bj] of [[i-1, j-1], [i, j-1], [i-1, j], [i, j]]) {
      if (bi < 0 || bj < 0 || bi >= GRID - 1 || bj >= GRID - 1) continue;
      r = Math.max(r, this.zones.rankAt(bi, bj));
    }
    return r;
  }

  // Is this road cell part of the motorway corridor between the two cities?
  isMotorway(i, j) {
    const m = this.motorway;
    if (!m) return false;
    return m.alongX ? j === m.line : i === m.line;
  }

  // Is a world position on the motorway carriageway?
  onMotorway(x, z) {
    const m = this.motorway;
    if (!m) return false;
    const across = m.alongX ? z : x;
    return Math.abs(across - roadCenter(m.line)) < ROAD / 2 + 1;
  }

  // Posted speed limit for the road at a point, in metres per second. Quiet
  // country lanes are national-speed-limit fast; a high street is a crawl.
  speedLimitAt(x, z) {
    if (this.onMotorway(x, z)) return MOTORWAY_LIMIT;
    const i = Math.round(x / CELL), j = Math.round(z / CELL);
    return SPEED_LIMITS[clamp(this.roadRank(i, j), 0, RANK_MAX)];
  }

  // ---------------------------------------------------------- generation ---

  // An axis-aligned patch that follows the ground. Everything laid on the
  // surface — tarmac, grass, paint — goes through here, so nothing can end up
  // buried or hovering.
  sheet(b, x0, z0, x1, z1, sub, yOff, uRepeat, vRepeat, smooth) {
    const T = this.terrain;
    const n = Math.max(1, sub | 0);
    // Per-vertex normals cost three noise samples a corner, so they are only
    // paid for on ground the player sees as landscape — not on paint.
    const nrm = smooth
      ? (x, z) => T.normalAt(x, z)
      : null;
    for (let a = 0; a < n; a++) {
      for (let c = 0; c < n; c++) {
        const ax0 = lerp(x0, x1, a / n), ax1 = lerp(x0, x1, (a + 1) / n);
        const az0 = lerp(z0, z1, c / n), az1 = lerp(z0, z1, (c + 1) / n);
        const u0 = uRepeat * a / n, u1 = uRepeat * (a + 1) / n;
        const v0 = vRepeat * c / n, v1 = vRepeat * (c + 1) / n;
        // Four corners at their own heights: the patch twists with the ground.
        const p = [[ax0, T.at(ax0, az1) + yOff, az1], [ax1, T.at(ax1, az1) + yOff, az1],
                   [ax1, T.at(ax1, az0) + yOff, az0], [ax0, T.at(ax0, az0) + yOff, az0]];
        // Each corner takes the true surface normal at its own position, so
        // adjoining patches share an edge normal and the ground shades as a
        // continuous curve rather than as a field of flat facets.
        let n0, n1, n2, n3;
        if (nrm) {
          n0 = nrm(p[0][0], p[0][2]); n1 = nrm(p[1][0], p[1][2]);
          n2 = nrm(p[2][0], p[2][2]); n3 = nrm(p[3][0], p[3][2]);
        } else {
          const ex = p[1][0]-p[0][0], ey = p[1][1]-p[0][1], ez = p[1][2]-p[0][2];
          const fx = p[3][0]-p[0][0], fy = p[3][1]-p[0][1], fz = p[3][2]-p[0][2];
          let nx = ey*fz - ez*fy, ny = ez*fx - ex*fz, nz = ex*fy - ey*fx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          n0 = n1 = n2 = n3 = [nx/nl, ny/nl, nz/nl];
        }
        const base = b.vertex(p[0][0], p[0][1], p[0][2], n0[0], n0[1], n0[2], u0, v1);
        b.vertex(p[1][0], p[1][1], p[1][2], n1[0], n1[1], n1[2], u1, v1);
        b.vertex(p[2][0], p[2][1], p[2][2], n2[0], n2[1], n2[2], u1, v0);
        b.vertex(p[3][0], p[3][1], p[3][2], n3[0], n3[1], n3[2], u0, v0);
        b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  build() {
    const rand = this.rand;
    // Ground plane, tiled on the road grid and skipped over the river — one
    // sheet of grass at y=0 would sit on top of the water and hide it.
    const ground = new MeshBuilder();
    const pad = ROAD * 0.5 + 40;
    const lo0 = -pad, hi0 = (GRID - 1) * CELL + pad;
    const edge0 = -ROAD/2 - 0.5, edge1 = (GRID - 1) * CELL + ROAD/2 + 0.5;
    ground.style(TEX.GRASS, [0.52, 0.62, 0.42], 0);
    for (let bi = 0; bi < GRID - 1; bi++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        if (this.zones.zoneAt(bi, bj) === Z.WATER) continue;
        this.sheet(ground, roadCenter(bi), roadCenter(bj), roadCenter(bi + 1), roadCenter(bj + 1),
                   5, -0.05, CELL / 16, CELL / 16, true);
      }
    }
    // Surrounding fields, out to the horizon fog.
    for (const [ax0, az0, ax1, az1] of [[lo0, lo0, hi0, edge0], [lo0, edge1, hi0, hi0],
                                        [lo0, edge0, edge0, edge1], [edge1, edge0, hi0, edge1]]) {
      this.sheet(ground, ax0, az0, ax1, az1, 3, -0.05, (ax1-ax0)/16, (az1-az0)/16, true);
    }
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
        // Country lanes are paler and more worn than city asphalt.
        const rk = this.roadRank(i, j);
        const tint = rk >= 4 ? [1, 1, 1] : rk >= 2 ? [1.06, 1.04, 1.00] : [1.14, 1.10, 1.02];
        b.style(TEX.ASPHALT, tint, 0);
        // Carriageway width by how built-up it is. A country lane is not a
        // 26-metre boulevard; the grass either side of it is the verge.
        const hw = this.isMotorway(i, j) ? ROAD/2
                 : rk >= 4 ? ROAD/2 : rk === 3 ? 10.5 : rk === 2 ? 8.5 : 7.5;
        this.sheet(b, c - hw, clamp(z0, lo, hi), c + hw, clamp(z1, lo, hi), 4, 0, 2.4, 8);
        // East-west road, laid a hair higher so the two never z-fight.
        this.sheet(b, clamp(z0, lo, hi), c - hw, clamp(z1, lo, hi), c + hw, 4, 0.005, 8, 2.4);
      }
    }

    // --- lane markings, on built-up streets only ---
    for (let i = 0; i < GRID; i++) {
      const c = roadCenter(i);
      for (let j = 0; j < GRID; j++) {
        if (this.roadRank(i, j) < 3) continue;
        if (this.isMotorway(i, j)) continue;   // its own markings, laid later
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
          this.sheet(b, c - 0.22, z, c + 0.22, zEnd, 1, 0.03, 1, 1);
          const x = segStart + t * (CELL/10) + 1, xEnd = x + CELL/20;
          if (xEnd > hi || x < lo) continue;
          const nearNodeX = Math.abs(((x + CELL/2) % CELL) - CELL/2) > CELL/2 - ROAD/2 - 3;
          if (nearNodeX) continue;
          this.sheet(b, x, c - 0.22, xEnd, c + 0.22, 1, 0.035, 1, 1);
        }
        // Zebra crossings: bars run along the travel direction, spanning the road.
        if (this.roadRank(i, j) < 4) continue;
        b.style(TEX.MARK, [0.95, 0.95, 0.92], 0);
        const cz = roadCenter(j);
        const BAR_W = 0.62, BAR_L = 3.2, STEP = (ROAD - 3) / 8;
        for (const s of [-1, 1]) {
          for (let k = 0; k <= 8; k++) {
            const off = -ROAD/2 + 1.5 + k * STEP;
            // Crossing the north-south road.
            const zEdge = cz + s * (ROAD/2 + 2.6);
            if (zEdge > lo && zEdge < hi) {
              this.sheet(b, c + off - BAR_W, zEdge - BAR_L/2, c + off + BAR_W, zEdge + BAR_L/2, 1, 0.04, 1, 1);
            }
            // Crossing the east-west road.
            const xEdge = c + s * (ROAD/2 + 2.6);
            if (xEdge > lo && xEdge < hi) {
              this.sheet(b, xEdge - BAR_L/2, cz + off - BAR_W, xEdge + BAR_L/2, cz + off + BAR_W, 1, 0.045, 1, 1);
            }
          }
        }
      }
    }

    // --- blocks ---
    for (let bi = 0; bi < GRID - 1; bi++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        this.buildBlock(chunkAt(bi, bj), bi, bj);
      }
    }

    this.buildMotorway(chunkAt);
    this.buildBridges(chunkAt);

    // --- street furniture, thinning out as the streets get quieter ---
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const rk = this.roadRank(i, j);
        if (rk < 2) continue;
        const cx = roadCenter(i), cz = roadCenter(j);
        const corners = rk >= 4 ? [[-1,-1],[1,-1],[-1,1],[1,1]]
                      : rk === 3 ? [[-1,-1],[1,1]] : [[1,1]];
        const place = (lx, lz, dx, dz) => {
          // Each lamp stands on its own patch of ground.
          const post = new MeshBuilder();
          this.lift = this.groundY(lx, lz);
          this.streetLight(post, lx, lz, dx, dz);
          chunkAt(i, j).append(post, 0, this.lift, 0);
          this.lift = 0;
        };
        for (const [sx, sz] of corners) {
          place(cx + sx * (ROAD/2 + 1.6), cz + sz * (ROAD/2 + 1.6), -sx, -sz);
        }
        // Lamps down the length of the street as well as at its junctions:
        // one at each junction leaves long unlit gaps between them, which is
        // most of why the city went pitch black between corners.
        if (rk >= 2) {
          const spacing = rk >= 4 ? CELL / 4 : rk === 3 ? CELL / 3 : CELL / 2;
          for (let t = spacing; t < CELL - 1; t += spacing) {
            const side = ((t / spacing) | 0) % 2 ? 1 : -1;
            if (i < GRID - 1) place(cx + side * (ROAD/2 + 1.6), cz + t, -side, 0);
            if (j < GRID - 1) place(cx + t, cz + side * (ROAD/2 + 1.6), 0, -side);
          }
        }
      }
    }

    this.buildCircuit();

    // Stunt ramps: on built-up straights, where there is something to jump —
    // but never on the race circuit, where they are just a wall to hit.
    const box = this.circuitBox;
    const onCircuit = (i, j) => box &&
      ((i >= box.i0 && i <= box.i1 && (j === box.j0 || j === box.j1)) ||
       (j >= box.j0 && j <= box.j1 && (i === box.i0 || i === box.i1)));
    const rampCells = [];
    for (let i = 1; i < GRID - 1; i++) {
      for (let j = 1; j < GRID - 1; j++) {
        if (this.roadRank(i, j) >= 3 && !onCircuit(i, j) && !this.isMotorway(i, j)) {
          rampCells.push([i, j]);
        }
      }
    }
    const emitRamp = (len, w, h) => {
      if (!rampCells.length) return;
      const [i, j] = rampCells[(rand() * rampCells.length) | 0];
      const horiz = rand() < 0.5;
      const along = roadCenter(horiz ? j : i) + (rand() - 0.5) * (CELL * 0.4);
      const across = roadCenter(horiz ? i : j) - LANE;
      const x = horiz ? along : across;
      const z = horiz ? across : along;
      const yaw = horiz ? (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rand() < 0.5 ? 0 : Math.PI);
      // Built flat and dropped onto the road, which may be on a slope.
      const wedge = new MeshBuilder();
      const base = this.groundY(x, z);
      this.ramps.emit(wedge, x, z, yaw, len, w, h, base);
      chunkAt(i, j).append(wedge, 0, base, 0);
    };
    for (let n = 0; n < 8; n++) emitRamp(9.5, 6.4, 2.1);
    // A few mega ramps: steep enough to put a nitro-boosted car on a roof.
    for (let n = 0; n < 5; n++) emitRamp(15.0, 7.2, 5.4);

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

    this.spawn = this.pickSpawn();
  }

  // The motorway that joins the two cities. It is not a wider road — it is the
  // same corridor given two lanes each way, a central reservation you cannot
  // cross, and no crossings for people to walk over. The reservation is broken
  // at every junction, so the ordinary grid still gets through.
  buildMotorway(chunkAt) {
    const m = this.motorway;
    if (!m) return;
    const line = roadCenter(m.line);
    const lo = -ROAD/2, hi = (GRID - 1) * CELL + ROAD/2;
    // Along-corridor coordinate helpers: (a) runs along it, (c) across it.
    const P = (a, c) => (m.alongX ? [a, c] : [c, a]);
    const lastCell = GRID - 2;

    for (let k = 0; k <= lastCell; k++) {
      const a0 = roadCenter(k), a1 = roadCenter(k + 1);
      const b = chunkAt(m.alongX ? k : m.line, m.alongX ? m.line : k);

      // Lane divider between the two running lanes on each carriageway, and a
      // solid edge line at the hard shoulder.
      for (const side of [-1, 1]) {
        b.style(TEX.MARK, [0.95, 0.95, 0.92], 0);
        // These offsets are across the corridor, so they are measured from the
        // corridor's own centre line, not from the origin.
        const div = line + side * (CENTRAL_RES + 6.0);
        for (let t = 0; t < 8; t++) {
          const s0 = lerp(a0, a1, t / 8) + 3, s1 = s0 + CELL / 16;
          if (s0 < lo || s1 > hi) continue;
          const q0 = P(s0, div - 0.18), q1 = P(s1, div + 0.18);
          this.sheet(b, Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]),
                        Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1]), 1, 0.05, 1, 1);
        }
        const edge = line + side * (ROAD/2 - 1.1);
        const e0 = P(Math.max(a0, lo), edge - 0.2);
        const e1 = P(Math.min(a1, hi), edge + 0.2);
        this.sheet(b, Math.min(e0[0], e1[0]), Math.min(e0[1], e1[1]),
                      Math.max(e0[0], e1[0]), Math.max(e0[1], e1[1]), 4, 0.05, 1, 1);
      }

      // Central reservation, stopping short of the junction at each end.
      const gap = ROAD/2 + 3;
      const r0 = a0 + gap, r1 = a1 - gap;
      if (r1 > r0) {
        const seg = new MeshBuilder();
        const mid = (r0 + r1) / 2;
        this.lift = this.groundY(...P(mid, line));
        const half = (r1 - r0) / 2;
        const c = P(mid, line);
        seg.style(TEX.CONCRETE, [0.86, 0.86, 0.82], 0);
        seg.chamferBox(c[0], 0.45, c[1],
                       m.alongX ? half : CENTRAL_RES, 0.45, m.alongX ? CENTRAL_RES : half,
                       0.22, { perUnit: 0.5 });
        // Steel barrier on top, and a run of grass down the middle of it.
        seg.style(TEX.LEAVES, [0.58, 0.74, 0.48], 0);
        seg.chamferBox(c[0], 0.95, c[1],
                       m.alongX ? half : CENTRAL_RES * 0.75, 0.16, m.alongX ? CENTRAL_RES * 0.75 : half,
                       0.10, { perUnit: 0.8 });
        seg.style(TEX.METAL, [0.74, 0.76, 0.78], 0);
        for (const s2 of [-1, 1]) {
          const bc = P(mid, line + s2 * (CENTRAL_RES - 0.1));
          seg.chamferBox(bc[0], 1.15, bc[1],
                         m.alongX ? half : 0.10, 0.26, m.alongX ? 0.10 : half,
                         0.09, { perUnit: 0.6 });
        }
        chunkAt(m.alongX ? k : m.line, m.alongX ? m.line : k).append(seg, 0, this.lift, 0);
        this.addCollider(Math.min(P(r0, line - CENTRAL_RES)[0], P(r1, line + CENTRAL_RES)[0]),
                         Math.min(P(r0, line - CENTRAL_RES)[1], P(r1, line + CENTRAL_RES)[1]),
                         Math.max(P(r0, line - CENTRAL_RES)[0], P(r1, line + CENTRAL_RES)[0]),
                         Math.max(P(r0, line - CENTRAL_RES)[1], P(r1, line + CENTRAL_RES)[1]),
                         1.3);
        this.lift = 0;
      }

      // A sign gantry every few cells, which is what says "motorway" at a
      // glance more than any amount of paint does.
      if (k % 3 === 1) {
        const gantry = new MeshBuilder();
        const ga = a0 + CELL * 0.5;
        this.lift = this.groundY(...P(ga, line));
        const legs = [P(ga, line - (ROAD/2 - 0.6)), P(ga, line + (ROAD/2 - 0.6))];
        gantry.style(TEX.METAL, [0.62, 0.64, 0.66], 0);
        for (const g of legs) gantry.cylinder(g[0], 3.3, g[1], 0.22, 6.6, 8, { vRepeat: 3 });
        const beam = P(ga, line);
        gantry.chamferBox(beam[0], 6.8, beam[1],
                          m.alongX ? 0.3 : ROAD/2, 0.28, m.alongX ? ROAD/2 : 0.3,
                          0.12, { perUnit: 0.5 });
        // Two blue sign boards, one over each carriageway.
        gantry.style(TEX.PLAIN, [0.10, 0.22, 0.62], 0.35);
        for (const side of [-1, 1]) {
          const sc = P(ga, line + side * (ROAD/4 + 0.6));
          gantry.chamferBox(sc[0], 8.1, sc[1],
                            m.alongX ? 0.14 : ROAD/5, 1.05, m.alongX ? ROAD/5 : 0.14,
                            0.08, { perUnit: 0.7 });
        }
        chunkAt(m.alongX ? k : m.line, m.alongX ? m.line : k).append(gantry, 0, this.lift, 0);
        this.lift = 0;
      }
    }
  }

  // Wherever a road passes between two water blocks it is carrying traffic
  // over the river, so it gets parapets and piers. The deck itself is already
  // there — the road grid is drawn before anything knows about the water.
  buildBridges(chunkAt) {
    const isWet = (bi, bj) => this.zones.zoneAt(bi, bj) === Z.WATER &&
                              bi >= 0 && bj >= 0 && bi < GRID - 1 && bj < GRID - 1;
    const span = (chunk, ax, az, bx, bz, nx, nz) => {
      // The deck follows the road, which round here is at the river's level.
      const b = new MeshBuilder();
      const lift = this.groundY((ax + bx) / 2, (az + bz) / 2);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const hx = Math.abs(bx - ax) / 2, hz = Math.abs(bz - az) / 2;
      // Parapets down both edges of the deck.
      b.style(TEX.CONCRETE, [0.88, 0.88, 0.85], 0);
      for (const s of [-1, 1]) {
        b.chamferBox(cx + nx * s * (ROAD/2 - 0.35), 0.62, cz + nz * s * (ROAD/2 - 0.35),
                     hx + (nx ? 0.35 : 0), 0.62, hz + (nz ? 0.35 : 0), 0.18, { perUnit: 0.4 });
      }
      // Piers under each end.
      b.style(TEX.CONCRETE, [0.72, 0.72, 0.70], 0);
      for (const t of [0.12, 0.88]) {
        const px = lerp(ax, bx, t), pz = lerp(az, bz, t);
        b.box(px, WATER_Y - 0.6, pz, nz ? 2.2 : ROAD/2, 1.8, nz ? ROAD/2 : 2.2, { perUnit: 0.35 });
      }
      // Soffit, so there is something under the deck when seen from the bank.
      b.style(TEX.CONCRETE, [0.62, 0.62, 0.60], 0);
      b.box(cx, -0.35, cz, hx + (nx ? 0 : 0.2), 0.35, hz + (nz ? 0 : 0.2),
            { perUnit: 0.3, bottom: true, skipTop: true });
      this.bridges.push({ x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz });
      chunk.append(b, 0, lift, 0);
    };

    for (let j = 0; j < GRID; j++) {
      for (let bi = 0; bi < GRID - 1; bi++) {
        if (!isWet(bi, j - 1) || !isWet(bi, j)) continue;
        span(chunkAt(bi, j), roadCenter(bi) + ROAD/2, roadCenter(j),
             roadCenter(bi + 1) - ROAD/2, roadCenter(j), 0, 1);
      }
    }
    for (let i = 0; i < GRID; i++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        if (!isWet(i - 1, bj) || !isWet(i, bj)) continue;
        span(chunkAt(i, bj), roadCenter(i), roadCenter(bj) + ROAD/2,
             roadCenter(i), roadCenter(bj + 1) - ROAD/2, 1, 0);
      }
    }
  }

  // Buildings that stick out past the block they belong to. Should be empty:
  // anything here is hanging over the road, and reads as a slab of unlit roof
  // floating above the traffic.
  strayBuildings(margin) {
    const m = margin === undefined ? 0.6 : margin;
    const out = [];
    for (const b of this.buildings) {
      const bi = Math.floor((b.x0 + b.x1) / 2 / CELL), bj = Math.floor((b.z0 + b.z1) / 2 / CELL);
      const x0 = roadCenter(bi) + ROAD/2, x1 = roadCenter(bi + 1) - ROAD/2;
      const z0 = roadCenter(bj) + ROAD/2, z1 = roadCenter(bj + 1) - ROAD/2;
      if (b.x0 < x0 - m || b.x1 > x1 + m || b.z0 < z0 - m || b.z1 > z1 + m) {
        out.push({ bi, bj, b });
      }
    }
    return out;
  }

  // Is this spot open water? Bridges count as dry land.
  waterAt(x, z) {
    for (const b of this.bridges) {
      if (x > b.x0 - ROAD/2 && x < b.x1 + ROAD/2 && z > b.z0 - ROAD/2 && z < b.z1 + ROAD/2) return false;
    }
    for (const w of this.water) {
      if (x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1) return true;
    }
    return false;
  }

  // A block: its ground surface, its kerbs, and whatever its zone puts on it.
  // Everything is generated flat about y=0 and then lifted onto the block's
  // plateau in one go, so no zone builder has to know about the terrain.
  buildBlock(chunk, bi, bj) {
    const b = new MeshBuilder();
    // Open country is not terraced: fields and woods lie on the ground as it
    // is. Only places with buildings and pavements get levelled, because a
    // house needs a flat plot — a hillside of plateaus reads as brickwork.
    const lift = this.isRural(bi, bj) ? 0 : this.terrain.blockLift(bi, bj);
    this.lift = lift;
    this.buildBlockLocal(b, bi, bj);
    this.lift = 0;
    if (!b.empty) chunk.append(b, 0, lift, 0);
  }

  // Wildwood and farmland follow the ground; everything else is levelled.
  isRural(bi, bj) {
    const zone = this.zones.zoneAt(bi, bj);
    return zone !== Z.WATER && this.zones.rankAt(bi, bj) <= 1 &&
           zone !== Z.PARK && zone !== Z.INDUSTRIAL;
  }

  buildBlockLocal(b, bi, bj) {
    const zones = this.zones;
    const zone = zones.zoneAt(bi, bj);
    const info = ZONES[zone];
    const x0 = roadCenter(bi) + ROAD/2, x1 = roadCenter(bi + 1) - ROAD/2;
    const z0 = roadCenter(bj) + ROAD/2, z1 = roadCenter(bj + 1) - ROAD/2;
    const rank = zones.rankAt(bi, bj);

    // Pavement: a full slab in town, a kerbside band in the suburbs, nothing
    // in the country. This is most of what sells the transition on foot.
    // The river takes its host block's rank, so it has to opt out of paving
    // explicitly or a downtown stretch gets a pavement laid over the water.
    const rural = this.isRural(bi, bj);
    const slab = zone === Z.WATER || rural ? 'none'
               : rank >= 4 || zone === Z.PARK || zone === Z.INDUSTRIAL ? 'full'
               : rank === 3 ? 'band' : 'none';
    const baseY = slab === 'full' ? SIDEWALK_H : 0;
    // In the country, "y = 0" means the ground under that point.
    const groundAt = rural ? (x, z) => this.terrain.at(x, z) : () => 0;

    if (slab === 'full') {
      b.style(TEX.SIDEWALK, info.ground.tint, 0);
      b.chamferBox((x0+x1)/2, SIDEWALK_H/2, (z0+z1)/2, (x1-x0)/2, SIDEWALK_H/2, (z1-z0)/2, 0.09,
                   { top: TEX.SIDEWALK, perUnit: 0.22 });
    } else if (zone !== Z.WATER) {          // the river lays its own surface
      const g = info.ground;
      b.style(g.layer, g.tint, 0);
      if (rural) {
        this.sheet(b, x0, z0, x1, z1, 5, 0.02, (x1-x0)/g.scale/6, (z1-z0)/g.scale/6, true);
      } else {
        b.quad([x0, 0.02, z1], [x1, 0.02, z1], [x1, 0.02, z0], [x0, 0.02, z0],
               (x1-x0)/g.scale/6, (z1-z0)/g.scale/6);
      }
      if (slab === 'band') {
        b.style(TEX.SIDEWALK, [1, 1, 1], 0);
        const PW = 3.2;
        b.box((x0+x1)/2, SIDEWALK_H/2, z0 + PW/2, (x1-x0)/2, SIDEWALK_H/2, PW/2, { perUnit: 0.22 });
        b.box((x0+x1)/2, SIDEWALK_H/2, z1 - PW/2, (x1-x0)/2, SIDEWALK_H/2, PW/2, { perUnit: 0.22 });
        b.box(x0 + PW/2, SIDEWALK_H/2, (z0+z1)/2, PW/2, SIDEWALK_H/2, (z1-z0)/2 - PW, { perUnit: 0.22 });
        b.box(x1 - PW/2, SIDEWALK_H/2, (z0+z1)/2, PW/2, SIDEWALK_H/2, (z1-z0)/2 - PW, { perUnit: 0.22 });
      }
    }

    // The plateau sits at the block's highest corner, so on a slope the ground
    // falls away beneath it. That gap used to be filled with a vertical wall,
    // which caught no light and read as a black slab beside the road. It is a
    // banked slope now: it catches the sky, and a grassed bank at the kerb is
    // what a British road on a gradient actually has.
    if (zone !== Z.WATER && !rural) {
      const T = this.terrain;
      const run = rank >= 4 ? 2.0 : 3.4;      // how far the bank spreads out
      const segs = 7;
      if (rank >= 4) b.style(TEX.CONCRETE, [0.86, 0.84, 0.80], 0);
      else b.style(TEX.GRASS, [0.62, 0.76, 0.48], 0);
      // Each edge is walked in the direction that winds the bank facing out
      // and up; reversing one turns that side inside out.
      const bank = (ax0, az0, ax1, az1, nx, nz) => {
        for (let k = 0; k < segs; k++) {
          const t0 = k / segs, t1 = (k + 1) / segs;
          const px0 = lerp(ax0, ax1, t0), pz0 = lerp(az0, az1, t0);
          const px1 = lerp(ax0, ax1, t1), pz1 = lerp(az0, az1, t1);
          const ox0 = px0 + nx * run, oz0 = pz0 + nz * run;
          const ox1 = px1 + nx * run, oz1 = pz1 + nz * run;
          const y0 = T.at(ox0, oz0) - this.lift - 0.25;
          const y1 = T.at(ox1, oz1) - this.lift - 0.25;
          if (y0 > -0.05 && y1 > -0.05) continue;      // level here, no bank
          b.quad([px0, baseY, pz0], [px1, baseY, pz1], [ox1, y1, oz1], [ox0, y0, oz0], 1.5, 1);
        }
      };
      bank(x0, z0, x1, z0, 0, -1);
      bank(x1, z1, x0, z1, 0, 1);
      bank(x0, z1, x0, z0, -1, 0);
      bank(x1, z0, x1, z1, 1, 0);

      // The bank is a skin: the volume behind it still has to be filled, or
      // the block is a hollow lid and you see straight under it. Inset by the
      // bank's run so the fill never pokes through the slope in front of it.
      let low = Infinity;
      for (let k = 0; k <= 4; k++) {
        for (const [px, pz] of [[lerp(x0, x1, k/4), z0], [lerp(x0, x1, k/4), z1],
                                [x0, lerp(z0, z1, k/4)], [x1, lerp(z0, z1, k/4)]]) {
          low = Math.min(low, T.at(px + (px === x0 ? run : px === x1 ? -run : 0),
                                   pz + (pz === z0 ? run : pz === z1 ? -run : 0)));
        }
      }
      const fill = this.lift - low + 2.0;
      if (fill > 0.2) {
        b.style(TEX.CONCRETE, [0.70, 0.68, 0.64], 0);
        b.box((x0+x1)/2, baseY - fill/2, (z0+z1)/2,
              (x1-x0)/2 - run + 0.05, fill/2, (z1-z0)/2 - run + 0.05,
              { skipTop: true, perUnit: 0.22 });
      }
    }

    const ctx = {
      bi, bj, x0, z0, x1, z1, zone, rank, baseY, rural, groundAt,
      u: zones.urbanityAt(bi, bj),
      rand: zones.randFor(bi, bj, 1),
    };
    const builder = ZONE_BUILDERS[zone];
    if (builder) builder(this, b, ctx);
  }

  buildBuilding(b, x0, z0, x1, z1, height, downtown, ctx) {
    const rand = (ctx && ctx.rand) || this.rand;
    const base = (ctx && ctx.baseY) || 0;
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
      b.chamferBox(cx, base + shopH/2, cz, w/2 + 0.35, shopH/2, d/2 + 0.35, 0.3,
            { skipTop: true, uvU: Math.max(1, Math.round(w / 9)), uvV: 1 });
      b.style(TEX.CONCRETE, [0.9, 0.9, 0.88], 0);
      b.box(cx, base + shopH + 0.18, cz, w/2 + 0.6, 0.18, d/2 + 0.6,
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
      b.cylinder(cx, base + shopH + bodyH/2, cz, rad, bodyH, 24,
                 { uRepeat: Math.max(2, Math.round(2 * Math.PI * rad / (fac.cols * FLOOR_H) * fac.cols / 2)),
                   vRepeat: uvV });
      b.style(TEX.ROOF, [1, 1, 1], 0);
      b.cylinder(cx, base + totalH + 0.12, cz, rad * 1.02, 0.24, 24, { uRepeat: 6, vRepeat: 1 });
      b.style(fac.layer, tint, 0);
    } else {
      const corner = clamp(Math.min(w, d) * 0.07, 0.35, 1.4);
      b.chamferBox(cx, base + shopH + bodyH/2, cz, w/2, bodyH/2, d/2, corner,
                   { top: TEX.ROOF, topTint: [1, 1, 1], uvU, uvV });
    }

    // Facade relief: without it a building is a flat box no matter how good the
    // lighting is. Ledges every few floors and corner pilasters give the sun
    // something to cast a line of shadow from.
    if (!roundTower) {
      const bandGap = FLOOR_H * (height > 70 ? 6 : 4);
      b.style(TEX.CONCRETE, tint, 0);
      for (let y = shopH + bandGap; y < totalH - 1.2; y += bandGap) {
        b.chamferBox(cx, base + y, cz, w/2 + 0.22, 0.17, d/2 + 0.22, 0.1,
                     { perUnit: 0.5, skipTop: true });
      }
      // Pilasters up the corners, slightly proud of the wall.
      const pil = Math.min(0.85, Math.min(w, d) * 0.09);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          b.chamferBox(cx + sx * (w/2 - pil * 0.35), base + shopH + bodyH/2, cz + sz * (d/2 - pil * 0.35),
                       pil, bodyH/2, pil, pil * 0.35, { perUnit: 0.45, skipTop: true });
        }
      }
      // A cornice under the parapet reads as a real roofline.
      b.chamferBox(cx, base + totalH - 0.35, cz, w/2 + 0.42, 0.35, d/2 + 0.42, 0.18, { perUnit: 0.5 });
    }

    // Parapet wall around the roof.
    b.style(TEX.CONCRETE, tint, 0);
    if (!roundTower) {
      const pw = 0.5, ph = 1.0;
      b.box(cx, base + totalH + ph/2, z0 + pw/2, w/2, ph/2, pw/2, { perUnit: 0.4 });
      b.box(cx, base + totalH + ph/2, z1 - pw/2, w/2, ph/2, pw/2, { perUnit: 0.4 });
      b.box(x0 + pw/2, base + totalH + ph/2, cz, pw/2, ph/2, d/2, { perUnit: 0.4 });
      b.box(x1 - pw/2, base + totalH + ph/2, cz, pw/2, ph/2, d/2, { perUnit: 0.4 });
    }

    // Setback tower on tall buildings.
    if (height > 60 && rand() < 0.7) {
      const sw = w * (0.45 + rand() * 0.2), sd = d * (0.45 + rand() * 0.2);
      const sh = 8 + rand() * 26;
      b.style(fac.layer, tint, 0);
      b.chamferBox(cx, base + totalH + sh/2, cz, sw/2, sh/2, sd/2, clamp(Math.min(sw, sd) * 0.09, 0.3, 1.6),
            { top: TEX.ROOF,
              uvU: Math.max(1, Math.round(sw / (fac.cols * FLOOR_H))),
              uvV: Math.max(1, Math.round(sh / (fac.rows * FLOOR_H))) });
      // Aircraft warning light.
      b.style(TEX.PLAIN, [1.0, 0.15, 0.12], 1.0);
      b.box(cx, base + totalH + sh + 0.6, cz, 0.35, 0.6, 0.35, { perUnit: 1, emis: 1 });
      b.style(TEX.METAL, [0.7, 0.7, 0.72], 0);
      b.cylinder(cx, base + totalH + sh + 4, cz, 0.18, 8, 6);
    }

    // Rooftop clutter.
    const rc = 1 + ((rand() * 3) | 0);
    for (let i = 0; i < rc; i++) {
      const uw = 1.5 + rand() * 3.5, ud = 1.5 + rand() * 3.5, uh = 1 + rand() * 2.5;
      const ux = lerp(x0 + uw + 1, x1 - uw - 1, rand());
      const uz = lerp(z0 + ud + 1, z1 - ud - 1, rand());
      b.style(TEX.METAL, [0.62, 0.64, 0.66], 0);
      b.chamferBox(ux, base + totalH + uh/2, uz, uw/2, uh/2, ud/2, 0.28, { perUnit: 0.5 });
    }
    if (rand() < 0.25 && w > 16) {
      // Water tower.
      const ux = lerp(x0 + 6, x1 - 6, rand()), uz = lerp(z0 + 6, z1 - 6, rand());
      b.style(TEX.BARK, [0.75, 0.6, 0.45], 0);
      b.cylinder(ux, base + totalH + 5.2, uz, 2.2, 4.4, 10, { uRepeat: 4, vRepeat: 2 });
      b.style(TEX.METAL, [0.5, 0.5, 0.52], 0);
      for (const [ox, oz] of [[-1.4,-1.4],[1.4,-1.4],[-1.4,1.4],[1.4,1.4]]) {
        b.cylinder(ux + ox, base + totalH + 1.5, uz + oz, 0.16, 3, 5);
      }
    }

    this.addBuilding(x0, z0, x1, z1, base + totalH, downtown);
  }

  // A parish church: nave, porch, tower and spire. One per village or two.
  church(b, ctx) {
    const rand = ctx.rand;
    const cx = (ctx.x0 + ctx.x1) / 2, cz = (ctx.z0 + ctx.z1) / 2;
    const alongX = rand() < 0.5;
    const nw = alongX ? 19 : 8, nd = alongX ? 8 : 19;
    b.style(TEX.CONCRETE, [0.80, 0.78, 0.70], 0);
    b.chamferBox(cx, 5.0, cz, nw/2, 5.0, nd/2, 0.2, { skipTop: true, perUnit: 0.28 });
    b.style(TEX.TILE, [0.48, 0.46, 0.44], 0);
    pitchedRoof(b, cx, 10.0, cz, nw/2, nd/2, 3.4, alongX, 0.5);

    const tx = cx + (alongX ? -nw/2 - 3.2 : 0), tz = cz + (alongX ? 0 : -nd/2 - 3.2);
    b.style(TEX.CONCRETE, [0.76, 0.74, 0.66], 0);
    b.chamferBox(tx, 9.5, tz, 3.4, 9.5, 3.4, 0.25, { skipTop: true, perUnit: 0.3 });
    // Louvred belfry openings.
    b.style(TEX.BARK, [0.30, 0.24, 0.20], 0);
    for (const [ox, oz] of [[3.45,0],[-3.45,0],[0,3.45],[0,-3.45]]) {
      b.box(tx + ox, 16.5, tz + oz, ox ? 0.08 : 1.0, 1.4, oz ? 0.08 : 1.0, { perUnit: 1 });
    }
    // Spire.
    b.style(TEX.TILE, [0.42, 0.44, 0.46], 0);
    const sy = 19.0, sh = 9.0;
    for (let k = 0; k < 4; k++) {
      const a0 = k / 4 * Math.PI * 2 + Math.PI/4, a1 = (k + 1) / 4 * Math.PI * 2 + Math.PI/4;
      const r = 3.5;
      // a1 before a0: the other order winds the spire inside out.
      b.quad([tx + Math.cos(a1)*r, sy, tz + Math.sin(a1)*r],
             [tx + Math.cos(a0)*r, sy, tz + Math.sin(a0)*r],
             [tx, sy + sh, tz], [tx, sy + sh, tz], 1, 1);
    }
    b.style(TEX.METAL, [0.85, 0.80, 0.45], 0);
    b.cylinder(tx, sy + sh + 0.9, tz, 0.09, 1.8, 5);

    this.addBuilding(cx - nw/2, cz - nd/2, cx + nw/2, cz + nd/2, 13.4);
    this.addBuilding(tx - 3.4, tz - 3.4, tx + 3.4, tz + 3.4, 19.0);

    // Churchyard: wall, yews, headstones.
    const { x0, z0, x1, z1 } = ctx;
    hedge(this, b, x0 + 6, z0 + 6, x1 - 6, z0 + 7, 1.1);
    hedge(this, b, x0 + 6, z1 - 7, x1 - 6, z1 - 6, 1.1);
    for (let i = 0; i < 5; i++) {
      if (rand() < 0.4) continue;
      this.tree(b, lerp(x0 + 9, x1 - 9, rand()), lerp(z0 + 9, z1 - 9, rand()), 1.0 + rand() * 0.5, 0);
    }
    b.style(TEX.CONCRETE, [0.68, 0.68, 0.64], 0);
    for (let i = 0; i < 14; i++) {
      const gx = lerp(x0 + 8, x1 - 8, rand()), gz = lerp(z0 + 8, z1 - 8, rand());
      if (Math.abs(gx - cx) < nw/2 + 2 && Math.abs(gz - cz) < nd/2 + 2) continue;
      b.box(gx, 0.45, gz, 0.35, 0.45, 0.09, { perUnit: 1 });
    }
  }

  buildPark(b, x0, z0, x1, z1) {
    ZONE_BUILDERS[Z.PARK](this, b, {
      x0, z0, x1, z1, baseY: SIDEWALK_H, rand: this.rand,
    });
  }

  tree(b, x, z, scale, baseY) {
    const rand = this.rand;
    const y0 = baseY === undefined ? SIDEWALK_H : baseY;
    const h = (4 + rand() * 3) * scale;
    b.style(TEX.BARK, [1, 1, 1], 0);
    b.cylinder(x, y0 + h/2, z, 0.34 * scale, h, 7, { uRepeat: 2, vRepeat: 2 });
    b.style(TEX.LEAVES, [0.85 + rand()*0.3, 0.95 + rand()*0.2, 0.85], 0);
    const r = (2.2 + rand() * 1.2) * scale;
    b.sphere(x, y0 + h + r * 0.45, z, r, 9, 6, 0.85);
    b.sphere(x + (rand()-0.5)*r, y0 + h + r * 0.1, z + (rand()-0.5)*r, r*0.7, 8, 5, 0.9);
    this.addCollider(x - 0.5, z - 0.5, x + 0.5, z + 0.5, h);
  }

  bush(b, x, z, scale, baseY) {
    const rand = this.rand;
    const y0 = baseY || 0;
    const r = 1.1 * scale;
    b.style(TEX.LEAVES, [0.72 + rand()*0.3, 0.92 + rand()*0.2, 0.68], 0);
    b.sphere(x, y0 + r * 0.7, z, r, 7, 4, 0.8);
    b.sphere(x + (rand()-0.5)*r, y0 + r * 0.55, z + (rand()-0.5)*r, r*0.75, 6, 4, 0.85);
  }

  bench(b, x, z, baseY) {
    const y = baseY === undefined ? SIDEWALK_H : baseY;
    b.style(TEX.BARK, [0.8, 0.65, 0.5], 0);
    b.chamferBox(x, y + 0.55, z, 1.4, 0.08, 0.35, 0.06, { perUnit: 1 });
    b.chamferBox(x, y + 0.85, z - 0.32, 1.4, 0.35, 0.06, 0.05, { perUnit: 1 });
    b.style(TEX.METAL, [0.3, 0.32, 0.34], 0);
    b.box(x - 1.2, y + 0.28, z, 0.08, 0.28, 0.32, { perUnit: 1 });
    b.box(x + 1.2, y + 0.28, z, 0.08, 0.28, 0.32, { perUnit: 1 });
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
    this.lights.push({ x: ax, y: SIDEWALK_H + h - 0.4 + this.lift, z: az });
  }

  parkedCar(b, x, z, yaw, baseY) {
    const rand = this.rand;
    // Cars park at the kerb, which is over the road and below the plateau the
    // block is built on; without this they hang in the air above it.
    const y0 = baseY === undefined ? this.groundY(x, z) - this.lift : baseY;
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
      b.append(bb, wx, y0, wz);
    };
    boxLocal(0, 0.85, 0.95, 0.42, 2.1, TEX.METAL, col);
    boxLocal(-0.15, 1.42, 0.85, 0.34, 1.15, TEX.GLASS, [col[0]*0.4+0.1, col[1]*0.4+0.15, col[2]*0.4+0.2]);
    boxLocal(2.0, 0.9, 0.72, 0.16, 0.12, TEX.PLAIN, [1, 0.95, 0.8], 0.15);
    boxLocal(-2.0, 0.9, 0.72, 0.16, 0.12, TEX.PLAIN, [0.9, 0.15, 0.12], 0.15);
    this.addCollider(Math.min(...[T(-1,-2.3)[0], T(1,-2.3)[0], T(-1,2.3)[0], T(1,2.3)[0]]),
                     Math.min(...[T(-1,-2.3)[1], T(1,-2.3)[1], T(-1,2.3)[1], T(1,2.3)[1]]),
                     Math.max(...[T(-1,-2.3)[0], T(1,-2.3)[0], T(-1,2.3)[0], T(1,2.3)[0]]),
                     Math.max(...[T(-1,-2.3)[1], T(1,-2.3)[1], T(-1,2.3)[1], T(1,2.3)[1]]), y0 + 1.6);
  }

  // ------------------------------------------------------------- routing ---

  // A street circuit for racing: a rectangular loop of roads through the most
  // built-up part of the map, sampled into gates on the correct side of the
  // road so the AI can follow it.
  buildCircuit() {
    const zones = this.zones;
    let best = null;
    for (let i0 = 0; i0 < GRID - 3; i0++) {
      for (let j0 = 0; j0 < GRID - 3; j0++) {
        for (const size of [3, 4]) {
          const i1 = i0 + size, j1 = j0 + size;
          if (i1 >= GRID || j1 >= GRID) continue;
          let score = 0;
          for (let i = i0; i <= i1; i++) {
            score += this.roadRank(i, j0) + this.roadRank(i, j1);
          }
          for (let j = j0; j <= j1; j++) {
            score += this.roadRank(i0, j) + this.roadRank(i1, j);
          }
          if (!best || score > best.score) best = { i0, j0, i1, j1, score };
        }
      }
    }
    if (!best) return;
    this.circuitBox = best;
    const { i0, j0, i1, j1 } = best;
    const pts = [];
    const push = (x, z) => pts.push({ x, z });
    // Clockwise in (x, z): east along j0, north up i1, west along j1, south down i0.
    // Each corner gets its own gate inside the junction box. Without it the AI
    // aims straight from the last gate of one side to the first of the next,
    // which cuts the corner diagonally through the buildings.
    for (let i = i0; i < i1; i++) push(roadCenter(i) + CELL/2, roadCenter(j0) - LANE);
    push(roadCenter(i1) + LANE, roadCenter(j0) - LANE);
    for (let j = j0; j < j1; j++) push(roadCenter(i1) + LANE, roadCenter(j) + CELL/2);
    push(roadCenter(i1) + LANE, roadCenter(j1) + LANE);
    for (let i = i1; i > i0; i--) push(roadCenter(i) - CELL/2, roadCenter(j1) + LANE);
    push(roadCenter(i0) - LANE, roadCenter(j1) + LANE);
    for (let j = j1; j > j0; j--) push(roadCenter(i0) - LANE, roadCenter(j) - CELL/2);
    push(roadCenter(i0) - LANE, roadCenter(j0) - LANE);
    this.circuit = pts;
  }

  // Somewhere sensible to start: on a road in the middle of the suburbs, so
  // the city is one way and the countryside the other.
  pickSpawn() {
    const blk = this.zones.findBlock([Z.SUBURB, Z.TOWN], this.rand) ||
                this.zones.findBlock([Z.VILLAGE], this.rand) || { bi: 1, bj: 1 };
    return { x: roadCenter(blk.bi) + CELL/2, z: roadCenter(blk.bj) - LANE,
             yaw: Math.PI / 2, bi: blk.bi, bj: blk.bj };
  }

  // Which zone a world position falls in.
  zoneAtWorld(x, z) {
    const bi = clamp(Math.floor((x + ROAD/2) / CELL), 0, GRID - 2);
    const bj = clamp(Math.floor((z + ROAD/2) / CELL), 0, GRID - 2);
    return this.zones.zoneAt(bi, bj);
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
