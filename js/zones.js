// Zoning: which kind of place each block of the map is, and the rules that
// stop the map reading as a random pile of unrelated blocks.
//
// The core idea is a single continuous "urbanity" field. Everything on the
// main axis — from open country up to downtown — is a band of that field, so
// a smooth field can only ever step one band at a time. Two zones sit off the
// axis (parks and industrial estates) and are placed afterwards under their
// own host rules. A repair pass then guarantees the adjacency rule outright
// rather than trusting the noise to behave.
'use strict';

const Z = {
  WILD: 0,        // woodland and rough meadow
  FARM: 1,        // fields, hedgerows, the odd barn
  VILLAGE: 2,     // cottages, a green, a church
  SUBURB: 3,      // detached houses, gardens, driveways
  TOWN: 4,        // terraces and small offices
  HIGHST: 5,      // high street: shops with flats above
  DOWNTOWN: 6,    // towers
  PARK: 7,        // overlay
  INDUSTRIAL: 8,  // overlay
  WATER: 9,       // overlay: the river, which crosses every rank it meets
};

const ZONE_COUNT = 10;
const RANK_MAX = 6;

// rank: position on the urbanity axis, or -1 for an overlay zone.
// ground: the block's base surface. urban: kerbs, lit streets, lane markings.
const ZONES = [
  { key: Z.WILD, name: 'Wildwood', rank: 0, urban: false,
    ground: { layer: TEX.GRASS, tint: [0.50, 0.64, 0.40], scale: 7 }, map: '#39562f' },
  { key: Z.FARM, name: 'Farmland', rank: 1, urban: false,
    ground: { layer: TEX.GRASS, tint: [0.68, 0.72, 0.42], scale: 8 }, map: '#5c6a33' },
  { key: Z.VILLAGE, name: 'Village', rank: 2, urban: false,
    ground: { layer: TEX.GRASS, tint: [0.62, 0.74, 0.48], scale: 6 }, map: '#4f6b3d' },
  { key: Z.SUBURB, name: 'Suburbs', rank: 3, urban: true,
    ground: { layer: TEX.GRASS, tint: [0.60, 0.72, 0.50], scale: 5 }, map: '#5a6a52' },
  { key: Z.TOWN, name: 'Town', rank: 4, urban: true,
    ground: { layer: TEX.SIDEWALK, tint: [0.92, 0.92, 0.90], scale: 4 }, map: '#6a6e74' },
  { key: Z.HIGHST, name: 'High Street', rank: 5, urban: true,
    ground: { layer: TEX.SIDEWALK, tint: [0.96, 0.95, 0.92], scale: 4 }, map: '#7d7a72' },
  { key: Z.DOWNTOWN, name: 'Downtown', rank: 6, urban: true,
    ground: { layer: TEX.SIDEWALK, tint: [0.88, 0.90, 0.94], scale: 4 }, map: '#8b93a2' },
  { key: Z.PARK, name: 'Park', rank: -1, urban: true,
    ground: { layer: TEX.GRASS, tint: [0.66, 0.80, 0.52], scale: 6 }, map: '#3f6b3a' },
  { key: Z.INDUSTRIAL, name: 'Industrial', rank: -1, urban: true,
    ground: { layer: TEX.CONCRETE, tint: [0.72, 0.72, 0.70], scale: 4 }, map: '#6b6458' },
  { key: Z.WATER, name: 'River', rank: -1, urban: false,
    ground: { layer: TEX.WATER, tint: [1, 1, 1], scale: 10 }, map: '#2f5f7d' },
];

// How far the river surface sits below the streets, and how wide its banks are.
const WATER_Y = -1.6;
const BANK_W = 4.0;

// Where an overlay is allowed to sit, expressed as the host rank it replaces
// plus the ranks it is willing to have as neighbours. An industrial estate on
// the edge of town is ordinary; one at the end of a village lane is not.
const OVERLAY_RULES = {
  [Z.PARK]:       { host: [1, 2, 3, 4, 5, 6], forbidNeighbourRank: [] },
  [Z.INDUSTRIAL]: { host: [3, 4],             forbidNeighbourRank: [0, 1, 2] },
};

const zoneInfo = (key) => ZONES[key];
const zoneRank = (key) => ZONES[key].rank;

// Rank of a zone for adjacency purposes: overlays answer with the rank of the
// block they were placed on, which is what keeps them inside the gradient.
function effectiveRank(key, host) {
  const r = ZONES[key].rank;
  return r >= 0 ? r : host;
}

class ZoneMap {
  // n is the number of blocks per axis.
  constructor(seed, n) {
    this.n = n;
    this.seed = seed >>> 0;
    this.rank = new Int8Array(n * n);
    this.zone = new Int8Array(n * n);
    this.u = new Float32Array(n * n);      // smoothed urbanity, 0..1
    this.repairs = 0;
    this.build();
  }

  idx(bi, bj) { return bj * this.n + bi; }
  inside(bi, bj) { return bi >= 0 && bj >= 0 && bi < this.n && bj < this.n; }

  zoneAt(bi, bj) { return this.inside(bi, bj) ? this.zone[this.idx(bi, bj)] : Z.WILD; }
  rankAt(bi, bj) { return this.inside(bi, bj) ? this.rank[this.idx(bi, bj)] : 0; }
  urbanityAt(bi, bj) { return this.inside(bi, bj) ? this.u[this.idx(bi, bj)] : 0; }
  info(bi, bj) { return ZONES[this.zoneAt(bi, bj)]; }

  // Per-block PRNG. Deterministic in (seed, bi, bj) alone, so a block's
  // contents never depend on the order blocks happen to be built in.
  randFor(bi, bj, salt) {
    const h = (this.seed ^ Math.imul(bi + 1, 374761393) ^
               Math.imul(bj + 1, 668265263) ^ Math.imul((salt | 0) + 1, 2246822519)) >>> 0;
    return makeRandom(h || 1);
  }

  build() {
    const n = this.n, seed = this.seed;
    const rand = makeRandom(seed ^ 0x5bf03635);

    // Two cities, at opposite ends of one line across the map, with open
    // country between them. Sharing a line is what lets a single motorway
    // corridor join them up rather than wander diagonally through the fields.
    const alongX = rand() < 0.5;
    const line = Math.round(lerp(n * 0.26, n * 0.74, rand()));
    const aPos = n * (0.15 + rand() * 0.04);
    const bPos = n * (0.85 - rand() * 0.04);
    const city = (pos, peak, reach) => ({
      bi: alongX ? pos : line, bj: alongX ? line : pos, peak, reach: n * reach,
    });
    this.centres = [city(aPos, 1.00, 0.40 + rand() * 0.04),
                    city(bPos, 0.86, 0.34 + rand() * 0.04)];
    this.corridor = { alongX, line };

    // A village or two off the corridor, so the countryside is not empty.
    const satellites = 1 + ((rand() * 2) | 0);
    for (let s = 0; s < satellites; s++) {
      const a = rand() * Math.PI * 2;
      const d = n * (0.18 + rand() * 0.12);
      const c = this.centres[s % 2];
      this.centres.push({
        bi: clamp(c.bi + Math.cos(a) * d, 1, n - 2),
        bj: clamp(c.bj + Math.sin(a) * d, 1, n - 2),
        peak: 0.40 + rand() * 0.12,       // a settlement, not a third city
        reach: n * (0.11 + rand() * 0.06),
      });
    }

    // --- continuous field ---
    const raw = new Float32Array(n * n);
    for (let bj = 0; bj < n; bj++) {
      for (let bi = 0; bi < n; bi++) {
        let settle = 0;
        for (const c of this.centres) {
          const d = Math.hypot(bi - c.bi, bj - c.bj) / c.reach;
          settle = Math.max(settle, c.peak * (1 - smoothstep(0, 1, d)));
        }
        // Low-frequency noise so the skyline is not a clean radial gradient,
        // kept gentle: a violent field would fight the adjacency rule.
        const nz = fbm(bi * 0.13, bj * 0.13, seed, 3) - 0.5;
        raw[this.idx(bi, bj)] = settle + nz * 0.26;
      }
    }

    // --- bands ---
    // Assigned by quantile rather than by fixed thresholds on the field: the
    // noise decides *where* each kind of place goes, MIX decides how much of
    // the map each one gets. Otherwise a flat-ish seed yields all countryside.
    const MIX = [0.17, 0.14, 0.12, 0.18, 0.17, 0.14, 0.08];
    const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]);
    let cursor = 0;
    for (let r = 0; r < MIX.length; r++) {
      const upto = r === MIX.length - 1
        ? order.length
        : Math.round(order.length * MIX.slice(0, r + 1).reduce((s, v) => s + v, 0));
      for (; cursor < upto; cursor++) this.rank[order[cursor]] = r;
    }

    this.repairs = this.smoothRanks();

    // --- overlays ---
    this.placeOverlays();

    // --- continuous field, rebuilt from the final ranks ---
    // Blurring the ranks gives building generators something that varies
    // across a block boundary instead of stepping at it.
    for (let bj = 0; bj < n; bj++) {
      for (let bi = 0; bi < n; bi++) {
        let sum = this.rank[this.idx(bi, bj)] * 2, w = 2;
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          if (!this.inside(bi + dx, bj + dz)) continue;
          sum += this.rank[this.idx(bi + dx, bj + dz)];
          w++;
        }
        this.u[this.idx(bi, bj)] = sum / w / RANK_MAX;
      }
    }
  }

  // Enforce the connection rule: no two neighbouring blocks may differ by more
  // than one rank. Each pass pulls the higher of an offending pair down one
  // step, which strictly reduces the total, so this always terminates.
  smoothRanks() {
    const n = this.n;
    let changed = true, passes = 0, fixes = 0;
    while (changed && passes < 64) {
      changed = false;
      passes++;
      for (let bj = 0; bj < n; bj++) {
        for (let bi = 0; bi < n; bi++) {
          const i = this.idx(bi, bj);
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            if (!this.inside(bi + dx, bj + dz)) continue;
            const k = this.idx(bi + dx, bj + dz);
            const d = this.rank[i] - this.rank[k];
            if (d > 1) { this.rank[i] -= d - 1; changed = true; fixes++; }
            else if (d < -1) { this.rank[k] += d + 1; changed = true; fixes++; }
          }
        }
      }
    }
    return fixes;
  }

  placeOverlays() {
    const n = this.n, seed = this.seed;
    for (let i = 0; i < this.zone.length; i++) this.zone[i] = this.rank[i];

    const canPlace = (bi, bj, key) => {
      const rule = OVERLAY_RULES[key];
      if (!rule.host.includes(this.rank[this.idx(bi, bj)])) return false;
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (!this.inside(bi + dx, bj + dz)) continue;
        const nr = this.rank[this.idx(bi + dx, bj + dz)];
        if (rule.forbidNeighbourRank.includes(nr)) return false;
        // Two overlays of different kinds should not share an edge either.
        const nz = this.zone[this.idx(bi + dx, bj + dz)];
        if (nz > RANK_MAX && nz !== key) return false;
      }
      return true;
    };

    // Both are capped as a share of the map. Thresholding noise alone leaves
    // the amount to chance, and one seed in five comes out as an industrial
    // estate with a town attached.
    const scatter = (key, share, freq, salt) => {
      const cap = Math.max(1, Math.round(n * n * share));
      const cand = [];
      for (let bj = 0; bj < n; bj++) {
        for (let bi = 0; bi < n; bi++) {
          if (this.zone[this.idx(bi, bj)] > RANK_MAX) continue;
          cand.push({ bi, bj, f: fbm(bi * freq + salt, bj * freq - salt, seed ^ salt, 3) });
        }
      }
      cand.sort((a, b) => b.f - a.f);
      let placed = 0;
      for (const c of cand) {
        if (placed >= cap) break;
        if (c.f < 0.55) break;
        if (!canPlace(c.bi, c.bj, key)) continue;
        this.zone[this.idx(c.bi, c.bj)] = key;
        placed++;
      }
    };
    // Industrial first: it is the fussier of the two, and clusters.
    scatter(Z.INDUSTRIAL, 0.055, 0.21, 0x1d3f);
    scatter(Z.PARK, 0.085, 0.29, 0x77a1);
    this.carveRiver();
  }

  // A river from one edge of the map to the other. It ignores the urbanity
  // gradient entirely — a real river runs through whatever is in its way, and
  // the roads that meet it become bridges.
  carveRiver() {
    const n = this.n;
    const rand = makeRandom(this.seed ^ 0x9e3779b9);
    const vertical = rand() < 0.5;              // flows north-south or east-west
    let a = 1 + ((rand() * (n - 2)) | 0);       // position across the flow
    this.river = [];
    // (b along the flow, a across it) -> block indices.
    const wet = (a2, b2) => {
      const bi = vertical ? a2 : b2, bj = vertical ? b2 : a2;
      if (!this.inside(bi, bj)) return;
      if (this.zone[this.idx(bi, bj)] === Z.WATER) return;
      this.zone[this.idx(bi, bj)] = Z.WATER;
      this.river.push({ bi, bj });
    };
    for (let b = 0; b < n; b++) {
      // Meander, but never more than one block per row, and take the corner
      // block on the way: a diagonal jump would leave two pools with dry land
      // between them.
      const drift = fbm(b * 0.42, vertical ? 11 : 71, this.seed ^ 0x51ed, 2) - 0.5;
      const want = clamp(a + Math.round(drift * 2.4), 1, n - 2);
      const step = clamp(want - a, -1, 1);
      wet(a, b);
      if (step !== 0) { a += step; wet(a, b); }
    }
    this.riverVertical = vertical;
  }

  // Any pair of neighbours that breaks the connection rule. Should be empty:
  // it is here so the rule can be checked rather than assumed.
  violations() {
    const out = [];
    for (let bj = 0; bj < this.n; bj++) {
      for (let bi = 0; bi < this.n; bi++) {
        const a = effectiveRank(this.zoneAt(bi, bj), this.rankAt(bi, bj));
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          if (!this.inside(bi + dx, bj + dz)) continue;
          const b = effectiveRank(this.zoneAt(bi + dx, bj + dz), this.rankAt(bi + dx, bj + dz));
          if (Math.abs(a - b) > 1) out.push({ bi, bj, dx, dz, a, b });
        }
      }
    }
    return out;
  }

  counts() {
    const c = new Array(ZONE_COUNT).fill(0);
    for (let i = 0; i < this.zone.length; i++) c[this.zone[i]]++;
    return c;
  }

  summary() {
    return this.counts()
      .map((v, k) => (v ? `${ZONES[k].name} ${v}` : null))
      .filter(Boolean).join(', ');
  }

  // A block of the given zone, preferring ones near the middle of their
  // region so the player does not start on a boundary.
  findBlock(keys, rand) {
    const want = Array.isArray(keys) ? keys : [keys];
    const hits = [];
    for (let bj = 0; bj < this.n; bj++) {
      for (let bi = 0; bi < this.n; bi++) {
        if (!want.includes(this.zoneAt(bi, bj))) continue;
        let same = 0;
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          if (want.includes(this.zoneAt(bi + dx, bj + dz))) same++;
        }
        hits.push({ bi, bj, same });
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.same - a.same);
    const pool = hits.filter((h) => h.same === hits[0].same);
    return pool[((rand ? rand() : 0.5) * pool.length) | 0];
  }
}
