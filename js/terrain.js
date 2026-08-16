// Relief. Heights are defined at road junctions and interpolated between
// them, so the roads, the ground and the blocks all read the same function and
// cannot disagree about where the surface is.
//
// Two rules keep it drivable: no two neighbouring junctions differ by more
// than MAX_STEP, and the river corridor is flattened to one level so the water
// sits in a valley instead of running up a hill.
'use strict';

const TERRAIN_AMP = 26;      // metres between the lowest and highest junction
const MAX_STEP = 5.5;        // metres of rise allowed between neighbours
const RIVER_DEPTH = 4.5;     // how far the river valley sits below its banks

class Terrain {
  // n is the number of junctions per axis (GRID), spacing is CELL.
  constructor(seed, n, spacing, riverCells) {
    this.n = n;
    this.spacing = spacing;
    this.h = new Float32Array(n * n);
    this.flat = !TERRAIN_AMP;
    this.build(seed >>> 0, riverCells || []);
  }

  idx(i, j) { return clamp(j, 0, this.n - 1) * this.n + clamp(i, 0, this.n - 1); }
  node(i, j) { return this.h[this.idx(i, j)]; }

  build(seed, riverCells) {
    const n = this.n;
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        // Two scales: broad hills, plus a gentler ripple so long straights are
        // not perfectly planar.
        const v = fbm(i * 0.16, j * 0.16, seed, 3) * 0.75 +
                  fbm(i * 0.44 + 13, j * 0.44 - 7, seed ^ 0x2f1b, 2) * 0.25;
        this.h[this.idx(i, j)] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = Math.max(1e-4, hi - lo);
    for (let k = 0; k < this.h.length; k++) this.h[k] = (this.h[k] - lo) / span * TERRAIN_AMP;

    // The river picks a level and its corridor is cut down to it. Junctions on
    // the corners of a water block are pinned, so the channel is level.
    this.riverNodes = new Set();
    if (riverCells.length) {
      let sum = 0;
      for (const c of riverCells) sum += this.node(c.bi, c.bj);
      this.riverLevel = Math.max(0, sum / riverCells.length - RIVER_DEPTH);
      for (const c of riverCells) {
        for (const [di, dj] of [[0,0],[1,0],[0,1],[1,1]]) {
          this.riverNodes.add(this.idx(c.bi + di, c.bj + dj));
        }
      }
      for (const k of this.riverNodes) this.h[k] = this.riverLevel;
    } else {
      this.riverLevel = 0;
    }

    this.smooth();
  }

  // Cut back anything that rises faster than MAX_STEP between neighbours, and
  // re-pin the river each pass so smoothing cannot drag the valley uphill.
  smooth() {
    const n = this.n;
    for (let pass = 0; pass < 40; pass++) {
      let changed = false;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          for (const [di, dj] of [[1, 0], [0, 1]]) {
            if (i + di >= n || j + dj >= n) continue;
            const a = this.idx(i, j), b = this.idx(i + di, j + dj);
            const d = this.h[a] - this.h[b];
            if (Math.abs(d) <= MAX_STEP) continue;
            const excess = Math.abs(d) - MAX_STEP;
            const hiK = d > 0 ? a : b;
            if (this.riverNodes.has(hiK)) {
              // Cannot lower a pinned node; raise its neighbour instead.
              this.h[d > 0 ? b : a] += excess;
            } else {
              this.h[hiK] -= excess;
            }
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  // Bilinear height at a world position.
  at(x, z) {
    const fx = x / this.spacing, fz = z / this.spacing;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
    const a = this.node(i, j), b = this.node(i + 1, j);
    const c = this.node(i, j + 1), d = this.node(i + 1, j + 1);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // A block is a plateau at the highest of its corners, so its pavement is
  // never below the road running past it — a kerb you step up, never down.
  blockLift(bi, bj) {
    return Math.max(this.node(bi, bj), this.node(bi + 1, bj),
                    this.node(bi, bj + 1), this.node(bi + 1, bj + 1));
  }

  // Steepest gradient anywhere on the map, as a percentage. Used by tests:
  // past about 12% the cars start to feel like they are climbing walls.
  maxGrade() {
    let worst = 0;
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (i + di >= this.n || j + dj >= this.n) continue;
          worst = Math.max(worst, Math.abs(this.node(i, j) - this.node(i + di, j + dj)));
        }
      }
    }
    return worst / this.spacing * 100;
  }
}
