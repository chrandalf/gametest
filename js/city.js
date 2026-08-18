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
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
    this.zones = new ZoneMap(this.seed, GRID - 1, this.seed ^ 0x3c6ef35f);
    this.motorway = this.zones.corridor;
    this.terrain = new Terrain(this.seed ^ 0x3c6ef35f, GRID, CELL, this.zones.river,
                               this.zones, ROAD / 2);
    this.lift = 0;            // vertical offset applied while building a block
    this.colliders = [];      // { x0, z0, x1, z1, top }
    this.buildings = [];      // minimap footprints
    this.parks = [];
    this.water = [];
    this.bridges = [];
    this.lights = [];         // street lamp positions, used for night point lights
    // The civic ledger: everything the population hangs off. Homes have doors
    // and room for a family, workplaces have jobs, parking spots have a yaw to
    // park at. The census joins them up into people.
    this.homes = [];          // { x, z, cap }
    this.works = [];          // { x, z, jobs }
    this.spots = [];          // { x, z, yaw, kind: 'drive'|'bay'|'kerb', taken, home }
    this.stations = [];       // petrol stations: { x, z, x0, z0, x1, z1 }
    this.hospital = null;     // { x, z, bay: { x, z, yaw } }
    this.ramps = new RampSet();
    this.chunks = [];
    this.decals = [];         // road paint: drawn, but never casts a shadow
    this.hash = new Map();
    this.hashCell = 24;
    this.build();
  }

  // ------------------------------------------------------------ collision --

  // `top` is given in the local frame of whatever is being built, so the
  // current lift is added here rather than at every call site. `what` names
  // the thing, so the game can say what you just hit instead of leaving you
  // to guess why you stopped.
  addCollider(x0, z0, x1, z1, top, what) {
    const c = { x0, z0, x1, z1, top: top + this.lift, what: what || 'something solid' };
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
  addBuilding(x0, z0, x1, z1, top, downtown, what) {
    this.addCollider(x0, z0, x1, z1, top, what || 'a building');
    this.buildings.push({ x0, z0, x1, z1, h: top + this.lift, downtown: downtown || 0 });
  }

  // Register one parking spot. `yaw` is the way a car parked in it faces.
  // Positions are world x/z; the ground supplies the height when a car is
  // actually stood in it.
  addSpot(x, z, yaw, kind, home) {
    const s = { x, z, yaw, kind, taken: 0, home: home === undefined ? -1 : home };
    this.spots.push(s);
    return s;
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

  // The surface with nothing built on it. The terrain already knows which
  // ground has been levelled, so this is that height everywhere — no plateaus
  // to reconcile, and nothing that can disagree with what is drawn. The one
  // exception is the river, whose channel is cut below the level of its block.
  groundY(x, z) {
    const y = this.terrain.at(x, z);
    const bi = Math.floor(x / CELL), bj = Math.floor(z / CELL);
    if (bi < 0 || bj < 0 || bi >= GRID - 1 || bj >= GRID - 1) return y;
    if (this.zones.zoneAt(bi, bj) !== Z.WATER) return y;
    // Down the bank and into the water, over the same run the bank is drawn on.
    const x0 = roadCenter(bi) + ROAD/2, x1 = roadCenter(bi + 1) - ROAD/2;
    const z0 = roadCenter(bj) + ROAD/2, z1 = roadCenter(bj + 1) - ROAD/2;
    const inset = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    if (inset <= 0) return y;
    return y + WATER_Y * smoothstep(0, BANK_W, inset);
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
        hit = { nx: ox, nz: oz, what: c.what };
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
      hit = { nx, nz, what: c.what };
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

  // ------------------------------------------------------- road network ---
  // A grid is not a road network, it is a chessboard. Real streets have dead
  // ends, lanes that go nowhere and blocks of three and five sides, and the
  // cheapest way to get all of that is not to grow a network from scratch —
  // it is to generate the grid and then take roads *out* of it, which is what
  // city-tour's road_network_simplifier does after its buildings are placed.
  //
  // Two rules keep the result playable. A minimum spanning tree is worked out
  // first, weighted toward flat ground and busy streets, and those edges can
  // never be removed — so the network is provably connected however unlucky
  // the dice are. And anything too steep to drive is removed outright, which
  // is where the ragged edges of the map come from: the lanes stop at the
  // hills rather than climbing them.

  segIndex(axis, li, k) { return (axis * GRID + li) * (GRID - 1) + k; }

  // Is there a road along this segment? `axis` 0 runs along X at grid line
  // `li`, crossing cell `k`; axis 1 runs along Z.
  edgeOpen(axis, li, k) {
    if (li < 0 || li >= GRID || k < 0 || k >= GRID - 1) return false;
    return this.open[this.segIndex(axis, li, k)] === 1;
  }

  // The segment leaving junction (i, j) in direction (di, dj), as [axis, li, k].
  edgeFrom(i, j, di, dj) {
    if (di !== 0) return [0, j, di > 0 ? i : i - 1];
    return [1, i, dj > 0 ? j : j - 1];
  }

  // Can you drive from junction (i, j) in this direction?
  canGo(i, j, di, dj) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) return false;
    const [axis, li, k] = this.edgeFrom(i, j, di, dj);
    return this.edgeOpen(axis, li, k);
  }

  // How many roads meet at a junction. One is a cul-de-sac; two in line is
  // just a bend; three or four is a proper junction.
  degree(i, j) {
    let d = 0;
    for (const [di, dj] of DIRS4) if (this.canGo(i, j, di, dj)) d++;
    return d;
  }

  buildNetwork() {
    const n = GRID, segs = 2 * GRID * (GRID - 1);
    this.open = new Uint8Array(segs).fill(1);
    const T = this.terrain;

    // Every segment, with the two junctions it joins and what it costs to use.
    const edges = [];
    for (let axis = 0; axis < 2; axis++) {
      for (let li = 0; li < GRID; li++) {
        for (let k = 0; k < GRID - 1; k++) {
          const a = axis ? [li, k] : [k, li];
          const b = axis ? [li, k + 1] : [k + 1, li];
          const rank = Math.max(this.roadRank(a[0], a[1]), this.roadRank(b[0], b[1]));
          const rise = Math.abs(T.node(a[0], a[1]) - T.node(b[0], b[1]));
          const mway = this.isMotorway(a[0], a[1]) && this.isMotorway(b[0], b[1]);
          const noise = hash2(axis * 977 + li, k, this.seed ^ 0x5eed10ad);
          edges.push({
            axis, li, k, rank, rise, mway,
            ia: a[1] * GRID + a[0], ib: b[1] * GRID + b[0],
            // A spanning route prefers flat ground and busy streets. The
            // motorway is free, so the trunk route is always part of it.
            cost: mway ? -1000 : rise * 3 + (RANK_MAX - rank) * 1.6 + noise * 2,
            noise,
            roll: hash2(axis * 31 + k, li * 17, this.seed ^ 0x3aa1c0de),
          });
        }
      }
    }

    // Cut first, repair after. Protecting a spanning tree up front sounds
    // safer but half the grid ends up in the tree, so almost nothing can be
    // removed; deleting freely and then mending only what actually broke
    // leaves the countryside genuinely sparse.
    //
    // A downtown block keeps its grid because a city centre really is gridded;
    // a village keeps about half its lanes; open country keeps a road only
    // where one was worth making.
    const CUT = [0.62, 0.56, 0.42, 0.27, 0.13, 0.07, 0.03];
    // Steeper than this between two junctions and the road is simply not built.
    const MAX_CLIMB = CELL * 0.15;
    let cut = 0, steep = 0;
    for (const e of edges) {
      const idx = this.segIndex(e.axis, e.li, e.k);
      if (e.mway) continue;                       // the trunk route is untouchable
      if (e.rise > MAX_CLIMB) { this.open[idx] = 0; steep++; cut++; continue; }
      if (e.roll < CUT[clamp(e.rank, 0, RANK_MAX)]) { this.open[idx] = 0; cut++; }
    }

    // Whatever that broke into islands is joined back up with the cheapest
    // road available, so the map is provably connected however the dice fell.
    const parent = new Int32Array(n * n);
    for (let k = 0; k < parent.length; k++) parent[k] = k;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return false; parent[ra] = rb; return true; };
    for (const e of edges) {
      if (this.open[this.segIndex(e.axis, e.li, e.k)]) union(e.ia, e.ib);
    }
    let mended = 0;
    for (const e of [...edges].sort((p, q) => p.cost - q.cost)) {
      const idx = this.segIndex(e.axis, e.li, e.k);
      if (this.open[idx]) continue;
      if (!union(e.ia, e.ib)) continue;
      this.open[idx] = 1;
      cut--; mended++;
      if (e.rise > MAX_CLIMB) steep--;
    }
    this.network = { total: segs, cut, steep, mended, kept: segs - cut };
  }

  // Where a road has been taken out, the two blocks either side of it and the
  // corridor between them are one piece of land, and something should be built
  // across the whole of it — otherwise a deleted street just leaves a strip of
  // grass with the same two blocks staring at each other over it.
  //
  // Merges are only accepted when the result is still a filled rectangle. Every
  // zone builder works in x0..x1 by z0..z1 and hands out plots along four
  // edges; an L-shaped block would need all nine of them rewritten, and a
  // bigger rectangle needs none of them touched at all.
  buildMerges() {
    const m = GRID - 1;
    const parent = new Int32Array(m * m);
    const box = [];
    for (let k = 0; k < m * m; k++) {
      parent[k] = k;
      box.push({ i0: k % m, j0: (k / m) | 0, i1: k % m, j1: (k / m) | 0, cells: 1 });
    }
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };

    const zoneOf = (k) => this.zones.zoneAt(k % m, (k / m) | 0);
    const tryJoin = (ka, kb) => {
      const ra = find(ka), rb = find(kb);
      if (ra === rb) return;
      // The river draws its own surface per cell and the terrain levels open
      // country differently from town; neither survives being merged.
      if (zoneOf(ka) === Z.WATER || zoneOf(kb) === Z.WATER) return;
      if (this.isRural(ka % m, (ka / m) | 0) !== this.isRural(kb % m, (kb / m) | 0)) return;
      const a = box[ra], b = box[rb];
      const i0 = Math.min(a.i0, b.i0), i1 = Math.max(a.i1, b.i1);
      const j0 = Math.min(a.j0, b.j0), j1 = Math.max(a.j1, b.j1);
      // Only if the two together exactly fill their bounding box.
      if ((i1 - i0 + 1) * (j1 - j0 + 1) !== a.cells + b.cells) return;
      // ...and not so big that a single zone swallows a quarter of the map.
      if ((i1 - i0 + 1) > 2 || (j1 - j0 + 1) > 2) return;
      parent[ra] = rb;
      box[rb] = { i0, j0, i1, j1, cells: a.cells + b.cells };
    };

    for (let bj = 0; bj < m; bj++) {
      for (let bi = 0; bi < m; bi++) {
        // The road separating this block from its eastern neighbour runs along
        // Z at grid line bi+1; the one to the north runs along X at line bj+1.
        if (bi + 1 < m && !this.edgeOpen(1, bi + 1, bj)) tryJoin(bj * m + bi, bj * m + bi + 1);
        if (bj + 1 < m && !this.edgeOpen(0, bj + 1, bi)) tryJoin(bj * m + bi, (bj + 1) * m + bi);
      }
    }

    // A merged group takes the zone of its root, so it reads as one place
    // rather than half a park and half a warehouse yard.
    this.merged = new Int32Array(m * m);
    this.groups = new Map();
    for (let k = 0; k < m * m; k++) {
      const r = find(k);
      this.merged[k] = r;
      if (!this.groups.has(r)) this.groups.set(r, box[r]);
    }
    let joined = 0;
    for (const g of this.groups.values()) if (g.cells > 1) joined++;
    this.mergeCount = joined;
    // The terrain levels each block to its own pad; a merged block has to be
    // one pad or its buildings stand at one height and its ground at another.
    this.terrain.levelGroups(this.groups, this.merged);
  }

  // Bounds of the block a cell belongs to, merges included.
  blockBounds(bi, bj) {
    const m = GRID - 1;
    const g = this.groups ? this.groups.get(this.merged[bj * m + bi]) : null;
    const b = g || { i0: bi, j0: bj, i1: bi, j1: bj };
    return {
      x0: roadCenter(b.i0) + ROAD/2, x1: roadCenter(b.i1 + 1) - ROAD/2,
      z0: roadCenter(b.j0) + ROAD/2, z1: roadCenter(b.j1 + 1) - ROAD/2,
      root: b,
    };
  }

  // Is this cell the one that builds for its group?
  isBlockRoot(bi, bj) {
    const m = GRID - 1;
    return !this.merged || this.merged[bj * m + bi] === bj * m + bi;
  }

  // --------------------------------------------------------- road shape ---
  // A road does not have to be a straight line just because its junctions sit
  // on a grid. Each segment bows away from its grid line and back, so the
  // network reads as lanes and streets that were laid along the ground rather
  // than ruled onto it. The bow is zero at every junction and flat there too,
  // so successive segments join without a kink and everything that navigates
  // by junction — traffic, the race circuit, the courier drops — is untouched.

  // Half the width of the carriageway. A country lane is not a boulevard, and
  // the narrower it is the more room it has to wander inside its corridor.
  roadHalf(rank, motorway) {
    if (motorway) return ROAD / 2;
    return rank >= 4 ? ROAD / 2 : rank === 3 ? 11.6 : rank === 2 ? 8.0 : 6.5;
  }

  // How far from the centre line traffic runs, matched to that width.
  laneOff(rank) {
    return rank >= 4 ? LANE : rank === 3 ? 5.4 : rank === 2 ? 4.0 : 3.2;
  }

  // The bow of one segment: `li` is the road's grid line, `k` the cell it
  // crosses, `axis` 0 for a road running along X and 1 for one along Z.
  bowAmp(li, k, axis) {
    if (k < 0 || k >= GRID - 1 || li < 0 || li >= GRID) return 0;
    if (this.open && !this.edgeOpen(axis, li, k)) return 0;
    const a = axis ? [li, k] : [k, li];
    const c = axis ? [li, k + 1] : [k + 1, li];
    if (this.isMotorway(a[0], a[1]) || this.isMotorway(c[0], c[1])) return 0;
    const rank = Math.max(this.roadRank(a[0], a[1]), this.roadRank(c[0], c[1]));
    // A high street is straight because the buildings down both sides make it
    // straight. Nothing holds a lane between two fields to any line at all.
    const cap = rank >= 4 ? 0 : rank === 3 ? 2.2 : rank === 2 ? 4.6 : 8.0;
    if (!cap) return 0;
    return (hash2(li * 7 + axis * 313, k * 11, this.seed ^ 0x2b7c1f) - 0.5) * 2 * cap;
  }

  // Lateral offset of the centre line at a point along the corridor. sin^2 is
  // flat at both ends, so the segment leaves and rejoins its junction square
  // on and the bends run into each other smoothly.
  bowAt(along, li, axis) {
    const k = Math.floor(along / CELL);
    const amp = this.bowAmp(li, k, axis);
    if (!amp) return 0;
    const s = Math.sin(Math.PI * clamp(along / CELL - k, 0, 1));
    return amp * s * s;
  }

  // Is a point on tarmac (plus a margin)? Scatter uses it, so a lane that
  // wanders out of its corridor does not end up with a tree standing in it.
  onRoadSurface(x, z, pad) {
    const p = pad || 0;
    for (let axis = 0; axis < 2; axis++) {
      const along = axis ? z : x, across = axis ? x : z;
      const li = Math.round(across / CELL);
      if (li < 0 || li >= GRID) continue;
      const k = clamp(Math.floor(along / CELL), 0, GRID - 2);
      const a = axis ? [li, k] : [k, li];
      const c = axis ? [li, k + 1] : [k + 1, li];
      if (!this.edgeOpen(axis, li, k)) continue;
      const rank = Math.max(this.roadRank(a[0], a[1]), this.roadRank(c[0], c[1]));
      const half = this.roadHalf(rank, this.isMotorway(a[0], a[1]));
      if (Math.abs(across - roadCenter(li) - this.bowAt(along, li, axis)) < half + p) return true;
    }
    // Junction boxes are tarmac too, and they are wider than either road that
    // meets there — a car swinging round in one is not off the road.
    const ji = Math.round(x / CELL), jj = Math.round(z / CELL);
    if (ji >= 0 && jj >= 0 && ji < GRID && jj < GRID && this.degree(ji, jj)) {
      let rk = this.roadRank(ji, jj);
      for (const [di, dj] of DIRS4) {
        if (this.canGo(ji, jj, di, dj)) rk = Math.max(rk, this.roadRank(ji + di, jj + dj));
      }
      const hw = this.roadHalf(rk, this.isMotorway(ji, jj)) + p;
      if (Math.abs(x - roadCenter(ji)) < hw && Math.abs(z - roadCenter(jj)) < hw) return true;
    }
    return false;
  }

  // Where a car heading for junction (i, j) should point its nose: its own
  // lane, a look-ahead further on, following whatever bend the road is making.
  // Aiming straight at the junction would cut the corner off every bend.
  aimPoint(i, j, dx, dz, x, z, look) {
    const alongX = dx !== 0;
    const axis = alongX ? 0 : 1;
    const li = alongX ? j : i;
    const dir = alongX ? dx : dz;
    const goal = alongX ? roadCenter(i) : roadCenter(j);
    let a = (alongX ? x : z) + dir * (look === undefined ? 15 : look);
    a = dir > 0 ? Math.min(a, goal) : Math.max(a, goal);
    const off = this.laneOff(this.roadRank(i, j)) * (alongX ? -dir : dir);
    const c = roadCenter(li) + this.bowAt(a, li, axis) + off;
    return alongX ? { x: a, z: c } : { x: c, z: a };
  }

  // The lane point at a junction. The bow is zero here, so this is on the
  // grid: everything that routes by junction keeps working unchanged.
  laneTarget(i, j, dx, dz) {
    const off = this.laneOff(this.roadRank(i, j));
    return { x: roadCenter(i) + dz * off, z: roadCenter(j) - dx * off };
  }

  // ---------------------------------------------------------- generation ---

  // A strip following a centre line that bows, laid on the ground it crosses.
  // `axis` 0 runs along X at z = line; 1 runs along Z at x = line. `w0`..`w1`
  // is the band it covers, measured sideways from the bowed centre line, so
  // the carriageway and the verge beside it come out of the same call and
  // meet on exactly the same vertices — no seam, and no grass poking through.
  ribbon(b, axis, li, line, a0, a1, w0, w1, yOff, steps, uRep, vRep) {
    const T = this.terrain;
    const n = Math.max(1, steps | 0);
    const corner = (a, c) => {
      const px = axis ? c : a, pz = axis ? a : c;
      return [px, T.at(px, pz) + yOff, pz];
    };
    for (let k = 0; k < n; k++) {
      const s0 = lerp(a0, a1, k / n), s1 = lerp(a0, a1, (k + 1) / n);
      const c0 = line + this.bowAt(s0, li, axis), c1 = line + this.bowAt(s1, li, axis);
      const p0 = corner(s0, c0 + w0), p1 = corner(s1, c1 + w0);
      const p2 = corner(s1, c1 + w1), p3 = corner(s0, c0 + w1);
      // Take the winding from the geometry rather than assuming it: the strip
      // is walked in four different directions and half of them would face
      // down if the order were fixed.
      const ex = p1[0]-p0[0], ey = p1[1]-p0[1], ez = p1[2]-p0[2];
      const fx = p3[0]-p0[0], fy = p3[1]-p0[1], fz = p3[2]-p0[2];
      let nx = ey*fz - ez*fy, ny = ez*fx - ex*fz, nz = ex*fy - ey*fx;
      const flip = ny < 0;
      const l = (Math.hypot(nx, ny, nz) || 1) * (flip ? -1 : 1);
      nx /= l; ny /= l; nz /= l;
      const v0 = vRep * k / n, v1 = vRep * (k + 1) / n;
      const base = b.vertex(p0[0], p0[1], p0[2], nx, ny, nz, 0, v0);
      b.vertex(p1[0], p1[1], p1[2], nx, ny, nz, 0, v1);
      b.vertex(p2[0], p2[1], p2[2], nx, ny, nz, uRep, v1);
      b.vertex(p3[0], p3[1], p3[2], nx, ny, nz, uRep, v0);
      if (flip) b.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // An axis-aligned patch that follows the ground. Everything laid on the
  // surface — tarmac, grass, paint — goes through here, so nothing can end up
  // buried or hovering.
  sheet(b, x0, z0, x1, z1, sub, yOff, uRepeat, vRepeat, smooth) {
    const T = this.terrain;
    const n = Math.max(1, sub | 0);
    // Per-vertex normals cost three noise samples a corner, so they are only
    // paid for on ground the player sees as landscape — not on paint.
    const nrm = smooth
      ? (x, z, y) => T.normalAt(x, z, y - yOff)
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
          n0 = nrm(p[0][0], p[0][2], p[0][1]); n1 = nrm(p[1][0], p[1][2], p[1][1]);
          n2 = nrm(p[2][0], p[2][2], p[2][1]); n3 = nrm(p[3][0], p[3][2], p[3][1]);
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
    this.buildNetwork();
    this.buildMerges();
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
        if (!this.isBlockRoot(bi, bj)) continue;
        // Only the block itself: the road corridors around it are covered by
        // the carriageway and its verge, which are cut from one strip and so
        // cannot disagree with each other about where the surface is.
        const bb = this.blockBounds(bi, bj);
        // Exactly the block, and not a metre further. A levelled block is a
        // plane, so one quad describes it perfectly — but two metres of
        // overhang reaches into the road corridor where the ground is ramping,
        // and a flat quad drawn across a ramp cuts up through whatever is on
        // top of it. That is the grass wedge showing through the tarmac. The
        // corridors are covered by the verge and the grass strip anyway, both
        // of which overlap the block edge and both of which follow the ramp.
        const gx0 = bb.x0, gx1 = bb.x1, gz0 = bb.z0, gz1 = bb.z1;
        // A levelled block is a plane, so it needs no subdividing at all.
        const sub = this.isRural(bi, bj) ? 6 : 1;
        this.sheet(ground, gx0, gz0, gx1, gz1, sub, -0.10,
                   (gx1 - gx0) / 16, (gz1 - gz0) / 16, true);
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
    // Road paint goes in its own set of meshes. It is a decal lying a few
    // centimetres above the tarmac, and a few centimetres is enough for the
    // shadow map to treat it as a wall: every dashed line was casting a little
    // shadow of itself onto the road beside it. Decals are drawn in the scene
    // pass only, so they light but never occlude.
    const decals = [];
    for (let i = 0; i < chunkCount * chunkCount; i++) {
      builders.push(new MeshBuilder());
      decals.push(new MeshBuilder());
    }
    const chunkIdx = (bi, bj) =>
      Math.min(chunkCount-1, Math.floor(bi/CH)) * chunkCount +
      Math.min(chunkCount-1, Math.floor(bj/CH));
    const chunkAt = (bi, bj) => builders[chunkIdx(bi, bj)];
    const paintAt = (bi, bj) => decals[chunkIdx(bi, bj)];

    // --- roads: one bowed ribbon per segment, plus a patch at each junction ---
    const lo = -ROAD/2, hi = (GRID - 1) * CELL + ROAD/2;
    const tintFor = (rk) => rk >= 4 ? [1, 1, 1] : rk >= 2 ? [1.06, 1.04, 1.00] : [1.14, 1.10, 1.02];
    const segRank = (axis, li, k) => {
      const a = axis ? [li, k] : [k, li];
      const c = axis ? [li, k + 1] : [k + 1, li];
      return Math.max(this.roadRank(a[0], a[1]), this.roadRank(c[0], c[1]));
    };
    for (let axis = 0; axis < 2; axis++) {
      for (let li = 0; li < GRID; li++) {
        for (let k = 0; k < GRID - 1; k++) {
          if (!this.edgeOpen(axis, li, k)) {
            // No road here. The corridor still has to be covered or there is a
            // twenty-six metre hole through the world where one used to be.
            // Grass, laid the same way, so it mates with its neighbours.
            const b0 = chunkAt(axis ? li : k, axis ? k : li);
            b0.style(TEX.GRASS, [0.52, 0.62, 0.42], 0);
            this.ribbon(b0, axis, li, roadCenter(li), roadCenter(k), roadCenter(k + 1),
                        -ROAD/2 - 2, ROAD/2 + 2, -0.02, 8, (ROAD + 4) / 16, CELL / 16);
            continue;
          }
          const a = axis ? [li, k] : [k, li];
          const rk = segRank(axis, li, k);
          const mway = this.isMotorway(a[0], a[1]) &&
                       this.isMotorway(axis ? li : k + 1, axis ? k + 1 : li);
          const hw = this.roadHalf(rk, mway);
          const b = chunkAt(a[0], a[1]);
          // A lane that wanders leaves its corridor and is laid over the field
          // beside it, so it goes down a hair above anything the block puts on
          // the ground. The two axes are separated the same way.
          const yOff = (rk <= 1 ? 0.09 : 0) + axis * 0.006;
          const s0 = roadCenter(k), s1 = roadCenter(k + 1);
          b.style(TEX.ASPHALT, tintFor(rk), 0);
          this.ribbon(b, axis, li, roadCenter(li), s0, s1, -hw, hw, yOff, 16, 2.4, 8);
          // Verge: the rest of the corridor, cut from the same strip so the two
          // share their vertices and the grass can never rise through the road.
          if (hw < ROAD/2 - 0.05) {
            b.style(TEX.GRASS, [0.52, 0.62, 0.42], 0);
            // Not over the river: a verge laid across the channel would be a
            // grass bridge sitting a metre and a half above the water.
            const flank = (s) => {
              const bk = axis ? [li + (s > 0 ? 0 : -1), k] : [k, li + (s > 0 ? 0 : -1)];
              return this.zones.zoneAt(bk[0], bk[1]) !== Z.WATER;
            };
            // Same texture scale as the fields it runs through, or the verge
            // stretches into a flat grey band that reads as more tarmac.
            const vu = (ROAD/2 + 1.5 - hw) / 16, vv = (s1 - s0) / 16;
            if (flank(-1)) {
              this.ribbon(b, axis, li, roadCenter(li), s0, s1, -ROAD/2 - 1.5, -hw,
                          yOff - 0.02, 16, vu, vv);
            }
            if (flank(1)) {
              this.ribbon(b, axis, li, roadCenter(li), s0, s1, hw, ROAD/2 + 1.5,
                          yOff - 0.02, 16, vu, vv);
            }
          }
        }
      }
    }
    // Junction patches, wide enough for the widest road that meets there.
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        if (!this.degree(i, j)) continue;                  // nothing meets here
        // Sized by the roads that actually meet here. Taking it from the rank
        // of the blocks around instead left a boulevard-sized slab of tarmac
        // at the end of a farm track, which is most of what makes the edge of
        // town look like it was dropped there.
        let hw = 0, rk = 0;
        for (const [di, dj] of DIRS4) {
          if (!this.canGo(i, j, di, dj)) continue;
          const r = Math.max(this.roadRank(i, j), this.roadRank(i + di, j + dj));
          rk = Math.max(rk, r);
          hw = Math.max(hw, this.roadHalf(r, this.isMotorway(i, j)));
        }
        if (hw <= 0) continue;
        // A town junction is paved corner to corner. Letting it stop at the
        // width of the roads that meet there left four grass squares in the
        // middle of a city crossroads, where a real one flares out to meet
        // the pavement on every side.
        if (rk >= 3) hw = ROAD / 2;
        const b = chunkAt(i, j);
        b.style(TEX.ASPHALT, tintFor(rk), 0);
        this.sheet(b, roadCenter(i) - hw, roadCenter(j) - hw,
                      roadCenter(i) + hw, roadCenter(j) + hw, 6,
                      (rk <= 1 ? 0.09 : 0) + 0.012, 1, 1);
      }
    }

    // --- lane markings, on built-up streets only, following the bow ---
    for (let axis = 0; axis < 2; axis++) {
      for (let li = 0; li < GRID; li++) {
        for (let k = 0; k < GRID - 1; k++) {
          if (!this.edgeOpen(axis, li, k)) continue;
          const a = axis ? [li, k] : [k, li];
          if (segRank(axis, li, k) < 3) continue;
          if (this.isMotorway(a[0], a[1])) continue;   // its own markings, later
          const b = paintAt(a[0], a[1]);
          b.style(TEX.MARK, [1.0, 0.85, 0.15], 0);
          // Dashed centre line, skipping the intersection box at each end.
          for (let t = 0; t < 10; t++) {
            const s0 = roadCenter(k) + t * (CELL/10) + 1, s1 = s0 + CELL/20;
            if (s0 < lo + ROAD/2 + 3 || s1 > hi - ROAD/2 - 3) continue;
            const nearNode = Math.min(s0 - roadCenter(k), roadCenter(k + 1) - s1) < ROAD/2 + 3;
            if (nearNode) continue;
            this.ribbon(b, axis, li, roadCenter(li), s0, s1, -0.22, 0.22,
                        0.035 + axis * 0.002, 1, 1, 1);
          }
        }
      }
    }
    // --- zebra crossings, at the busiest junctions ---
    for (let i = 0; i < GRID; i++) {
      const c = roadCenter(i);
      for (let j = 0; j < GRID; j++) {
        if (this.isMotorway(i, j)) continue;
        if (this.degree(i, j) < 3) continue;               // not a crossroads
        const b = paintAt(i, j);
        if (this.roadRank(i, j) < 4) continue;
        b.style(TEX.MARK, [0.95, 0.95, 0.92], 0);
        const cz = roadCenter(j);
        const BAR_W = 0.62, BAR_L = 3.2;
        // A crossing spans the road it is painted on, kerb to kerb, and roads
        // are not all the same width any more — a fixed span either ran out
        // before the far kerb or carried on over the verge. It is also only
        // painted across a road that is actually there.
        const stripe = (alongX, side) => {
          // The road being crossed runs along `alongX`; we stand `side` of the
          // junction, on the arm of the junction going that way.
          const dirI = alongX ? side : 0, dirJ = alongX ? 0 : side;
          if (!this.canGo(i, j, dirI, dirJ)) return;
          const seg = this.edgeFrom(i, j, dirI, dirJ);
          const other = [i + dirI, j + dirJ];
          const rank = Math.max(this.roadRank(i, j), this.roadRank(other[0], other[1]));
          const hw = this.roadHalf(rank, this.isMotorway(i, j)) - 1.4;
          const bars = Math.max(4, Math.round(hw * 2 / 2.9));
          for (let k = 0; k <= bars; k++) {
            const off = lerp(-hw, hw, k / bars);
            if (alongX) {
              // Crossing an east-west road: bars run along Z, stacked in X.
              const xEdge = c + side * (ROAD/2 + 2.6);
              if (xEdge <= lo || xEdge >= hi) continue;
              this.sheet(b, xEdge - BAR_L/2, cz + off - BAR_W,
                            xEdge + BAR_L/2, cz + off + BAR_W, 1, 0.045, 1, 1);
            } else {
              const zEdge = cz + side * (ROAD/2 + 2.6);
              if (zEdge <= lo || zEdge >= hi) continue;
              this.sheet(b, c + off - BAR_W, zEdge - BAR_L/2,
                            c + off + BAR_W, zEdge + BAR_L/2, 1, 0.04, 1, 1);
            }
          }
        };
        for (const side of [-1, 1]) { stripe(true, side); stripe(false, side); }
      }
    }

    // --- blocks ---
    // One pass per group, not per cell: a merged block is built once, across
    // the whole of the land the deleted road released.
    this.pickCivicBlocks();
    for (let bi = 0; bi < GRID - 1; bi++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        if (!this.isBlockRoot(bi, bj)) continue;
        this.buildBlock(chunkAt(bi, bj), paintAt(bi, bj), bi, bj);
      }
    }

    this.buildMotorway(chunkAt, paintAt);
    this.buildBridges(chunkAt);

    // --- street furniture, thinning out as the streets get quieter ---
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const rk = this.roadRank(i, j);
        if (rk < 2 || !this.degree(i, j)) continue;
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
          // Down the length of each street that actually exists.
          const northOpen = this.canGo(i, j, 0, 1), eastOpen = this.canGo(i, j, 1, 0);
          for (let t = spacing; t < CELL - 1; t += spacing) {
            const side = ((t / spacing) | 0) % 2 ? 1 : -1;
            if (northOpen) place(cx + side * (ROAD/2 + 1.6), cz + t, -side, 0);
            if (eastOpen) place(cx + t, cz + side * (ROAD/2 + 1.6), 0, -side);
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
        if (this.roadRank(i, j) >= 3 && !onCircuit(i, j) && !this.isMotorway(i, j) &&
            this.canGo(i, j, 1, 0) && this.canGo(i, j, 0, 1)) {
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

    this.buildBoundary(builders[0]);

    for (const bld of builders) {
      if (bld.empty) continue;
      this.chunks.push(bld.upload(this.gl));
    }
    for (const bld of decals) {
      if (bld.empty) continue;
      this.decals.push(bld.upload(this.gl));
    }

    this.spawn = this.pickSpawn();
  }

  // The edge of the world. This used to be four invisible walls, which is the
  // worst thing a driving game can do: you are heading for open grass at sixty
  // and you simply stop. It is a crash barrier now — Armco on posts, with a
  // reflector every few metres so it reads at night and at distance — and the
  // collider is the barrier rather than a slab of nothing behind it.
  buildBoundary(b) {
    const lo = -ROAD/2 - 26, hi = (GRID - 1) * CELL + ROAD/2 + 26;
    const RAIL_Y = 0.78, POST = 3.4;
    const run = (ax, az, bx, bz, nx, nz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / POST));
      const dx = (bx - ax) / n, dz = (bz - az) / n;
      for (let k = 0; k <= n; k++) {
        const x = ax + dx * k, z = az + dz * k;
        const y = this.terrain.at(x, z);
        // Post.
        b.style(TEX.PLAIN, [0.40, 0.42, 0.44], 0);
        b.box(x, y + RAIL_Y / 2, z, 0.11, RAIL_Y / 2 + 0.2, 0.11, { perUnit: 1 });
        if (k === n) continue;
        // Rail between this post and the next. A solid rather than two facing
        // quads: hand-winding a vertical strip gets one side lit and the other
        // black, and a black barrier is no better than an invisible one.
        const x2 = x + dx, z2 = z + dz;
        const y2 = this.terrain.at(x2, z2);
        const along = Math.abs(dx) > Math.abs(dz);
        // Alternating red and white panels, lit from within. A plain steel
        // rail is only lit on the side the sun is on, and the far side of a
        // ring barrier is always the dark side — which puts you right back at
        // an invisible wall. This one reads from any angle and after dark.
        const warn = (k % 2) === 0;
        b.style(TEX.PLAIN, warn ? [0.86, 0.16, 0.13] : [0.94, 0.94, 0.92], 0.34);
        b.chamferBox((x + x2) / 2, (y + y2) / 2 + RAIL_Y + 0.18, (z + z2) / 2,
                     along ? Math.abs(dx) / 2 : 0.09, 0.20, along ? 0.09 : Math.abs(dz) / 2,
                     0.06, { perUnit: 0.7 });
        // A reflector on every third post: this is what makes the barrier
        // read as a line rather than a grey smear at a hundred metres.
        b.style(TEX.PLAIN, [1.0, 0.72, 0.18], 0.9);
        b.box(x - nx * 0.13, y + RAIL_Y + 0.42, z - nz * 0.13, 0.13, 0.10, 0.13, { perUnit: 1 });
      }
    };
    run(lo, lo, hi, lo, 0, 1);
    run(hi, lo, hi, hi, -1, 0);
    run(hi, hi, lo, hi, 0, -1);
    run(lo, hi, lo, lo, 1, 0);

    const w = 8;
    const edge = 'the crash barrier at the edge of town';
    this.addCollider(lo - w, lo - w, hi + w, lo, 30, edge);
    this.addCollider(lo - w, hi, hi + w, hi + w, 30, edge);
    this.addCollider(lo - w, lo - w, lo, hi + w, 30, edge);
    this.addCollider(hi, lo - w, hi + w, hi + w, 30, edge);
  }

  // The motorway that joins the two cities. It is not a wider road — it is the
  // same corridor given two lanes each way, a central reservation you cannot
  // cross, and no crossings for people to walk over. The reservation is broken
  // at every junction, so the ordinary grid still gets through.
  buildMotorway(chunkAt, paintAt) {
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
      const paint = paintAt(m.alongX ? k : m.line, m.alongX ? m.line : k);

      // Lane divider between the two running lanes on each carriageway, and a
      // solid edge line at the hard shoulder. Paint, so it goes in the decal
      // mesh — the hard shoulder line was shadowing the hard shoulder.
      for (const side of [-1, 1]) {
        paint.style(TEX.MARK, [0.95, 0.95, 0.92], 0);
        // These offsets are across the corridor, so they are measured from the
        // corridor's own centre line, not from the origin.
        const div = line + side * (CENTRAL_RES + 6.0);
        for (let t = 0; t < 8; t++) {
          const s0 = lerp(a0, a1, t / 8) + 3, s1 = s0 + CELL / 16;
          if (s0 < lo || s1 > hi) continue;
          const q0 = P(s0, div - 0.18), q1 = P(s1, div + 0.18);
          this.sheet(paint, Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]),
                        Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1]), 1, 0.05, 1, 1);
        }
        const edge = line + side * (ROAD/2 - 1.1);
        const e0 = P(Math.max(a0, lo), edge - 0.2);
        const e1 = P(Math.min(a1, hi), edge + 0.2);
        this.sheet(paint, Math.min(e0[0], e1[0]), Math.min(e0[1], e1[1]),
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
                         1.3, 'the central reservation');
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
        if (!this.edgeOpen(0, j, bi)) continue;      // no road, so no crossing
        span(chunkAt(bi, j), roadCenter(bi) + ROAD/2, roadCenter(j),
             roadCenter(bi + 1) - ROAD/2, roadCenter(j), 0, 1);
      }
    }
    for (let i = 0; i < GRID; i++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        if (!isWet(i - 1, bj) || !isWet(i, bj)) continue;
        if (!this.edgeOpen(1, i, bj)) continue;
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
      const bi = clamp(Math.floor((b.x0 + b.x1) / 2 / CELL), 0, GRID - 2);
      const bj = clamp(Math.floor((b.z0 + b.z1) / 2 / CELL), 0, GRID - 2);
      const { x0, x1, z0, z1 } = this.blockBounds(bi, bj);
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
  // Everything is generated flat about y=0 and then raised to the level the
  // terrain has already been cut to, so no zone builder has to know about the
  // terrain and nothing stands proud of the road outside it.
  buildBlock(chunk, decal, bi, bj) {
    const b = new MeshBuilder();
    // Anything a block paints on its own ground — parking bays, hatching —
    // goes into this builder and on into the decal mesh, so it lights like
    // the surface it lies on and casts no shadow of itself.
    const paint = new MeshBuilder();
    // Open country is not levelled: fields and woods lie on the ground as it
    // is, and their builders place each thing at its own height.
    const lift = this.isRural(bi, bj) ? 0 : this.terrain.blockLift(bi, bj);
    this.lift = lift;
    this.buildBlockLocal(b, paint, bi, bj);
    this.lift = 0;
    if (!b.empty) chunk.append(b, 0, lift, 0);
    if (!paint.empty) decal.append(paint, 0, lift, 0);
  }

  // Two petrol stations on the way into town and one hospital in it, each
  // taking over a whole ordinary block. Chosen here, before any block builds,
  // so the zone builders can simply be swapped out for the civic ones.
  pickCivicBlocks() {
    const m = GRID - 1;
    this.gasBlocks = new Set();
    this.hospitalBlock = -1;
    const cands = [];
    for (let bi = 0; bi < m; bi++) {
      for (let bj = 0; bj < m; bj++) {
        if (!this.isBlockRoot(bi, bj)) continue;
        const z = this.zones.zoneAt(bi, bj);
        if (z === Z.WATER || z === Z.PARK) continue;
        // A single, unmerged block with a road along its southern edge, which
        // is the edge both builders put their entrance on.
        if ((this.blockBounds(bi, bj).root.cells || 1) !== 1) continue;
        if (!this.edgeOpen(0, bj, bi)) continue;
        cands.push({ bi, bj, key: bj * m + bi, rank: this.zones.rankAt(bi, bj),
                     roll: hash2(bi * 31 + 7, bj * 57 + 3, this.seed ^ 0x9a5f00d) });
      }
    }
    // Petrol stations live on the edge of town: busy enough to have trade,
    // cheap enough land for a forecourt.
    const gas = cands.filter((c) => c.rank >= 2 && c.rank <= 4)
                     .sort((a, b) => b.roll - a.roll);
    for (const g of gas) {
      if (this.gasBlocks.size >= 2) break;
      let clear = true;
      for (const k of this.gasBlocks) {
        const oi = k % m, oj = (k / m) | 0;
        if (Math.hypot(g.bi - oi, g.bj - oj) < 5) clear = false;
      }
      if (clear) this.gasBlocks.add(g.key);
    }
    // The hospital wants to be in town, where the casualties are.
    const hosp = cands.filter((c) => c.rank >= 3 && !this.gasBlocks.has(c.key))
                      .sort((a, b) => (b.rank * 10 + b.roll) - (a.rank * 10 + a.roll));
    if (hosp.length) this.hospitalBlock = hosp[0].key;
  }

  // Wildwood and farmland follow the ground; everything else is levelled.
  isRural(bi, bj) { return !this.zones.builtUp(bi, bj); }

  buildBlockLocal(b, paint, bi, bj) {
    const zones = this.zones;
    const zone = zones.zoneAt(bi, bj);
    const info = ZONES[zone];
    const bounds = this.blockBounds(bi, bj);
    const x0 = bounds.x0, x1 = bounds.x1, z0 = bounds.z0, z1 = bounds.z1;
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

    // No bank, no retaining wall and nothing to fill in behind them: the
    // terrain under a built-up block has already been cut level, so the block
    // surface, the kerb and the road outside it are all at the same height and
    // the ground is solid all the way down.

    const ctx = {
      bi, bj, x0, z0, x1, z1, zone, rank, baseY, rural, groundAt, paint,
      u: zones.urbanityAt(bi, bj),
      rand: zones.randFor(bi, bj, 1),
    };
    // Civic blocks: the zone builder stands aside for the petrol station or
    // the hospital, which was chosen for this block before anything built.
    const key = bj * (GRID - 1) + bi;
    if (this.gasBlocks && this.gasBlocks.has(key)) return buildGasStation(this, b, ctx);
    if (this.hospitalBlock === key) return buildHospital(this, b, ctx);
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

    // Ledger entry: a tower is offices, anything smaller is flats, and a shop
    // front below the flats is a workplace of its own. The door goes on the
    // face nearest the street, which is where a walker will head for.
    if (ctx) {
      const door = [
        { d: z0 - ctx.z0, x: cx, z: z0 - 1.4 },
        { d: ctx.z1 - z1, x: cx, z: z1 + 1.4 },
        { d: x0 - ctx.x0, x: x0 - 1.4, z: cz },
        { d: ctx.x1 - x1, x: x1 + 1.4, z: cz },
      ].sort((a, c) => a.d - c.d)[0];
      if (downtown > 0.5) {
        this.works.push({ x: door.x, z: door.z, jobs: Math.min(60, floors * 3) });
      } else {
        this.homes.push({ x: door.x, z: door.z, cap: Math.min(12, floors * 2) });
        if (shopH > 0) this.works.push({ x: door.x, z: door.z, jobs: 3 });
      }
    }
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

    this.addBuilding(cx - nw/2, cz - nd/2, cx + nw/2, cz + nd/2, 13.4, 0, 'the church');
    this.addBuilding(tx - 3.4, tz - 3.4, tx + 3.4, tz + 3.4, 19.0, 0, 'the church tower');
    this.works.push({ x: cx, z: cz + nd/2 + 2, jobs: 2 });

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
    // The trunk, and only the trunk: the canopy is four metres across and
    // hitting a branch should not stop a car. A grown tree does not move, so
    // this is a proper impact — as far as the car is concerned it is a bollard.
    const tr = 0.30 * scale;
    this.addCollider(x - tr, z - tr, x + tr, z + tr, y0 + h, 'a tree');
  }

  bush(b, x, z, scale, baseY) {
    const rand = this.rand;
    const y0 = baseY || 0;
    const r = 1.1 * scale;
    b.style(TEX.LEAVES, [0.72 + rand()*0.3, 0.92 + rand()*0.2, 0.68], 0);
    b.sphere(x, y0 + r * 0.7, z, r, 7, 4, 0.8);
    b.sphere(x + (rand()-0.5)*r, y0 + r * 0.55, z + (rand()-0.5)*r, r*0.75, 6, 4, 0.85);
    // Low and soft. It stops you, but at bumper height, so a shrub scuffs the
    // paint rather than writing off the engine.
    this.addCollider(x - r * 0.7, z - r * 0.7, x + r * 0.7, z + r * 0.7,
                     y0 + r * 0.9, 'a bush');
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
    // Tight to the pole. A metre-wide box round a 30 cm lamp post is an
    // invisible clip you feel but cannot see.
    this.addCollider(x - 0.22, z - 0.22, x + 0.22, z + 0.22, SIDEWALK_H + h, 'a lamp post');
    this.lights.push({ x: ax, y: SIDEWALK_H + h - 0.4 + this.lift, z: az });
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
          // Every side has to be a road you can actually drive, or the lap is
          // a lap through somebody's garden.
          let whole = true;
          for (let i = i0; i < i1 && whole; i++) {
            if (!this.edgeOpen(0, j0, i) || !this.edgeOpen(0, j1, i)) whole = false;
          }
          for (let j = j0; j < j1 && whole; j++) {
            if (!this.edgeOpen(1, i0, j) || !this.edgeOpen(1, i1, j)) whole = false;
          }
          if (!whole) continue;
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
    // Somewhere with a road out of it, or you start the game in a field.
    for (let attempt = 0; attempt < 40; attempt++) {
      const blk = this.zones.findBlock([Z.SUBURB, Z.TOWN], this.rand) ||
                  this.zones.findBlock([Z.VILLAGE], this.rand);
      if (!blk) break;
      if (!this.edgeOpen(0, blk.bj, blk.bi)) continue;
      return { x: roadCenter(blk.bi) + CELL/2, z: roadCenter(blk.bj) - LANE,
               yaw: Math.PI / 2, bi: blk.bi, bj: blk.bj };
    }
    // Fall back to any open east-west segment on the map.
    for (let j = 1; j < GRID - 1; j++) {
      for (let i = 0; i < GRID - 1; i++) {
        if (!this.edgeOpen(0, j, i)) continue;
        return { x: roadCenter(i) + CELL/2, z: roadCenter(j) - LANE,
                 yaw: Math.PI / 2, bi: i, bj: j };
      }
    }
    return { x: roadCenter(1) + CELL/2, z: roadCenter(1) - LANE, yaw: Math.PI/2, bi: 1, bj: 1 };
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
