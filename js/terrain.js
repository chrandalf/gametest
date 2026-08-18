// Relief. Heights are defined at road junctions and interpolated between
// them, so the roads, the ground and the blocks all read the same function and
// cannot disagree about where the surface is.
//
// Built-up ground is levelled *in the terrain itself*, not by standing the
// block on a plateau above it. Each built-up block is one flat pad, and the
// whole of the height change between two neighbouring pads is taken up by the
// road corridor between them — twenty-six metres of gentle ramp rather than a
// two-metre bank at the kerb. So a house stands at exactly the level of the
// road outside it, there is no skirt to fill in behind, and nothing is
// hollow: the ground is a single continuous function everywhere.
//
// Two more rules keep it drivable: no two neighbouring junctions differ by
// more than MAX_STEP, and the river corridor is flattened to one level so the
// water sits in a valley instead of running up a hill.
'use strict';

const TERRAIN_AMP = 30;      // metres between the lowest and highest junction
const MAX_STEP = 2.4;        // metres of rise allowed between built-up neighbours
const WILD_STEP = 17;        // ...and where there is nothing but trees and fields
const RIVER_DEPTH = 4.5;     // how far the river valley sits below its banks
const HILL_HEIGHT = 62;      // how far a proper hill stands above the plain
const DETAIL_AMP = 1.6;      // roll between the junctions, peak to trough
const DETAIL_SCALE = 74;     // metres per wavelength of that roll
const SUBDIV = 6;            // landform samples per road cell: 88 m / 6 = ~15 m
const DROPS = 14000;         // rain drops used to erode it
// Steepest step allowed between two landform samples, in metres. Over a
// 15 m spacing this is about a one-in-five hill: dramatic, still drivable.
const TALUS = 3.1;

class Terrain {
  // n is the number of junctions per axis (GRID), spacing is CELL, roadHalf
  // is half the width of a road corridor — the band the levelling ramps over.
  constructor(seed, n, spacing, riverCells, zones, roadHalf) {
    this.n = n;
    this.spacing = spacing;
    this.zones = zones;
    this.roadFrac = (roadHalf === undefined ? 13 : roadHalf) / spacing;
    this.h = new Float32Array(n * n);
    this.hills = [];
    this.build(seed >>> 0, riverCells || []);
  }

  // The rank of the built-up-ness around a junction. Roads through town have
  // to stay gentle; a track through the woods can climb.
  rankAtNode(i, j) {
    if (!this.zones) return RANK_MAX;
    let r = 0;
    for (const [bi, bj] of [[i-1, j-1], [i, j-1], [i-1, j], [i, j]]) {
      if (bi < 0 || bj < 0 || bi >= this.n - 1 || bj >= this.n - 1) continue;
      r = Math.max(r, this.zones.rankAt(bi, bj));
    }
    return r;
  }

  // How much rise is allowed between two junctions. Built-up ground is kept
  // gentle because the whole of it has to be taken up by the road ramp between
  // two level pads: MAX_STEP over a road corridor is a one-in-eleven hill,
  // which is steep for a street and still comfortable to drive.
  stepLimit(i, j, i2, j2) {
    const rank = Math.max(this.rankAtNode(i, j), this.rankAtNode(i2, j2));
    if (rank <= 1) return WILD_STEP;
    return rank === 2 ? MAX_STEP * 1.4 : MAX_STEP;
  }

  idx(i, j) { return clamp(j, 0, this.n - 1) * this.n + clamp(i, 0, this.n - 1); }
  node(i, j) { return this.h[this.idx(i, j)]; }

  build(seed, riverCells) {
    this.seed = seed;
    const n = this.n;

    // The landform is built at SUBDIV times the junction spacing, because the
    // junctions are eighty-eight metres apart and erosion at that resolution
    // does nothing you could see. The fine field is what `natural()` reads;
    // the junction heights are sampled back out of it afterwards.
    const fn = this.fn = (n - 1) * SUBDIV + 1;
    const fine = this.fine = new Float32Array(fn * fn);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < fn; j++) {
      for (let i = 0; i < fn; i++) {
        const ci = i / SUBDIV, cj = j / SUBDIV;
        // Two scales: broad hills, plus a gentler ripple so long straights are
        // not perfectly planar.
        const v = fbm(ci * 0.16, cj * 0.16, seed, 3) * 0.75 +
                  fbm(ci * 0.44 + 13, cj * 0.44 - 7, seed ^ 0x2f1b, 2) * 0.25;
        fine[j * fn + i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = Math.max(1e-4, hi - lo);
    for (let k = 0; k < fine.length; k++) fine[k] = (fine[k] - lo) / span * TERRAIN_AMP;

    // A hill or two, standing well clear of anything built: the smoothing
    // pass would flatten them otherwise, so they go where it is allowed to
    // leave a steep slope, and they are what you drive up for the view.
    const hrand = makeRandom(seed ^ 0x7f4a7c15);
    for (let attempt = 0; attempt < 60 && this.hills.length < 2; attempt++) {
      const ci = 1 + hrand() * (n - 2), cj = 1 + hrand() * (n - 2);
      if (this.rankAtNode(Math.round(ci), Math.round(cj)) > 1) continue;
      let clear = true;
      for (const h of this.hills) if (Math.hypot(h.i - ci, h.j - cj) < n * 0.4) clear = false;
      if (!clear) continue;
      const hill = { i: ci, j: cj, reach: 1.6 + hrand() * 0.8, height: HILL_HEIGHT * (0.7 + hrand() * 0.5) };
      this.hills.push(hill);
      for (let j = 0; j < fn; j++) {
        for (let i = 0; i < fn; i++) {
          const d = Math.hypot(i / SUBDIV - hill.i, j / SUBDIV - hill.j) / hill.reach;
          if (d >= 1) continue;
          fine[j * fn + i] += hill.height * (1 - smoothstep(0, 1, d));
        }
      }
    }

    this.erode(seed ^ 0x1d872b41);

    // Junction heights are read back out of the eroded landform.
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.h[this.idx(i, j)] = fine[(j * SUBDIV) * fn + i * SUBDIV];
      }
    }
    const beforeSmooth = Float32Array.from(this.h);

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
    // Whatever the river pinning and the gradient limit did to the junctions
    // has to be pushed back into the landform, or the fine field and the
    // junction heights disagree and the two show a seam where they meet.
    this.reconcile(beforeSmooth);
    this.levelBlocks();
  }

  // Particle erosion. Rain a few thousand drops on the landform; each picks up
  // material where it runs fast and drops it where it slows, which is what
  // turns a field of noise lumps into ridgelines with valleys between them.
  // It is confined to open country: town is levelled block by block anyway, so
  // eroding it would only fight the levelling and leave a seam at the kerb.
  erode(seed) {
    const fn = this.fn, h = this.fine;
    const before = Float32Array.from(h);
    const rand = makeRandom(seed >>> 0);
    const heightAt = (x, z) => {
      const ix = x | 0, iz = z | 0;
      const fx = x - ix, fz = z - iz;
      const k = iz * fn + ix;
      return lerp(lerp(h[k], h[k+1], fx), lerp(h[k+fn], h[k+fn+1], fx), fz);
    };
    const deposit = (x, z, amount) => {
      const ix = x | 0, iz = z | 0;
      const fx = x - ix, fz = z - iz;
      const k = iz * fn + ix;
      h[k]      += amount * (1 - fx) * (1 - fz);
      h[k+1]    += amount * fx * (1 - fz);
      h[k+fn]   += amount * (1 - fx) * fz;
      h[k+fn+1] += amount * fx * fz;
    };

    for (let d = 0; d < DROPS; d++) {
      let x = 1 + rand() * (fn - 3), z = 1 + rand() * (fn - 3);
      let vx = 0, vz = 0, water = 1, carried = 0;
      for (let step = 0; step < 40; step++) {
        const ix = x | 0, iz = z | 0;
        if (ix < 1 || iz < 1 || ix >= fn - 2 || iz >= fn - 2) break;
        const fx = x - ix, fz = z - iz;
        const k = iz * fn + ix;
        const gx = lerp(h[k+1] - h[k], h[k+fn+1] - h[k+fn], fz);
        const gz = lerp(h[k+fn] - h[k], h[k+fn+1] - h[k+1], fx);
        // Inertia, so a drop carves round a shoulder instead of straight down.
        vx = vx * 0.65 - gx;
        vz = vz * 0.65 - gz;
        const len = Math.hypot(vx, vz);
        if (len < 1e-5) break;
        vx /= len; vz /= len;
        const nx = x + vx, nz = z + vz;
        if (nx < 1 || nz < 1 || nx >= fn - 2 || nz >= fn - 2) break;
        const drop = heightAt(x, z) - heightAt(nx, nz);
        // Capacity to carry material rises with speed and how steeply it falls.
        const capacity = Math.max(drop, 0) * water * 5.5;
        if (carried > capacity || drop <= 0) {
          // Slowing, or running uphill into a hollow: put material down.
          const put = drop <= 0 ? Math.min(carried, -drop + 0.02) : (carried - capacity) * 0.32;
          deposit(x, z, put);
          carried -= put;
        } else {
          const take = Math.min((capacity - carried) * 0.32, drop);
          deposit(x, z, -take);
          carried += take;
        }
        water *= 0.985;
        x = nx; z = nz;
      }
    }

    // Angle of repose. Water alone cuts gullies at a hundred and fifty per
    // cent, which is the sheer-cliff problem all over again; loose material
    // does not stand at that angle, it slides. Repeatedly move the excess from
    // the high side of any pair that is steeper than TALUS to the low side,
    // and what is left is a hillside you can drive up.
    for (let pass = 0; pass < 12; pass++) {
      let moved = 0;
      for (let j = 0; j < fn; j++) {
        for (let i = 0; i < fn; i++) {
          const k = j * fn + i;
          for (const nk of [i < fn - 1 ? k + 1 : -1, j < fn - 1 ? k + fn : -1]) {
            if (nk < 0) continue;
            const d = h[k] - h[nk];
            if (Math.abs(d) <= TALUS) continue;
            const shift = (Math.abs(d) - TALUS) * 0.5 * Math.sign(d);
            h[k] -= shift; h[nk] += shift;
            moved++;
          }
        }
      }
      if (!moved) break;
    }

    // Erosion is a countryside feature. Scale each cell's change by how far it
    // is from anything built, so a levelled block never has a gully in it.
    if (!this.zones) return;
    const m = this.n - 1;
    for (let j = 0; j < fn; j++) {
      for (let i = 0; i < fn; i++) {
        const bi = clamp(Math.floor(i / SUBDIV), 0, m - 1);
        const bj = clamp(Math.floor(j / SUBDIV), 0, m - 1);
        const wild = this.zones.builtUp(bi, bj) ? 0 : 1;
        const k = j * fn + i;
        h[k] = before[k] + (h[k] - before[k]) * wild;
      }
    }
  }

  // Add the junction corrections back into the fine landform, spread bilinearly
  // between the junctions so nothing creases.
  reconcile(before) {
    const n = this.n, fn = this.fn, h = this.fine;
    const delta = new Float32Array(n * n);
    for (let k = 0; k < delta.length; k++) delta[k] = this.h[k] - before[k];
    for (let j = 0; j < fn; j++) {
      for (let i = 0; i < fn; i++) {
        const ci = i / SUBDIV, cj = j / SUBDIV;
        const a = Math.min(n - 2, ci | 0), b = Math.min(n - 2, cj | 0);
        const tx = ci - a, tz = cj - b;
        const d = lerp(lerp(delta[b * n + a], delta[b * n + a + 1], tx),
                       lerp(delta[(b+1) * n + a], delta[(b+1) * n + a + 1], tx), tz);
        h[j * fn + i] += d;
      }
    }
  }

  // One pad height per block, and how much of it applies. A pad sits at the
  // mean of its block's four corners, so the cut and the fill balance out and
  // the levelled street stays with the landform instead of standing proud of
  // it. Open country gets none of this and keeps every one of its slopes.
  levelBlocks() {
    const m = this.n - 1;
    this.pad = new Float32Array(m * m);
    this.flat = new Float32Array(m * m);
    for (let bj = 0; bj < m; bj++) {
      for (let bi = 0; bi < m; bi++) {
        this.pad[bj * m + bi] = (this.node(bi, bj) + this.node(bi + 1, bj) +
                                 this.node(bi, bj + 1) + this.node(bi + 1, bj + 1)) / 4;
        this.flat[bj * m + bi] = !this.zones || this.zones.builtUp(bi, bj) ? 1 : 0;
      }
    }
  }

  // Merged blocks share one pad. Called once the road network is known, which
  // is after the first levelling pass, so this overwrites rather than replaces.
  levelGroups(groups, merged) {
    const m = this.n - 1;
    for (const g of groups.values()) {
      if (g.cells <= 1) continue;
      let sum = 0, count = 0;
      for (let bj = g.j0; bj <= g.j1; bj++) {
        for (let bi = g.i0; bi <= g.i1; bi++) { sum += this.pad[bj * m + bi]; count++; }
      }
      const mean = sum / count;
      // If every cell of the group is built up the whole thing levels; if any
      // of it is open country the group is not levelled at all, or a field
      // would end up as a flat plate the size of two blocks.
      let allBuilt = true;
      for (let bj = g.j0; bj <= g.j1 && allBuilt; bj++) {
        for (let bi = g.i0; bi <= g.i1; bi++) {
          if (!this.flat[bj * m + bi]) { allBuilt = false; break; }
        }
      }
      if (!allBuilt) continue;
      for (let bj = g.j0; bj <= g.j1; bj++) {
        for (let bi = g.i0; bi <= g.i1; bi++) this.pad[bj * m + bi] = mean;
      }
    }
  }

  // Map a world coordinate onto the block grid so that it stands still while
  // it crosses a block and moves only while it crosses a road. Sampling the
  // pads through this is what makes each block dead level and puts the whole
  // ramp in the corridor between them.
  warp(a) {
    const c = a / this.spacing;
    const k = Math.floor(c);
    const f = c - k;
    const r = this.roadFrac;
    if (f >= r && f <= 1 - r) return k;
    if (f < r) return k - 1 + smoothstep(0, 1, (f + r) / (2 * r));
    return k + smoothstep(0, 1, (f - 1 + r) / (2 * r));
  }

  // Bilinear sample of a per-block field in warped block coordinates.
  blockField(arr, u, v) {
    const m = this.n - 1;
    const i = Math.floor(u), j = Math.floor(v);
    const tu = u - i, tv = v - j;
    const at = (bi, bj) => arr[clamp(bj, 0, m - 1) * m + clamp(bi, 0, m - 1)];
    return lerp(lerp(at(i, j), at(i + 1, j), tu),
                lerp(at(i, j + 1), at(i + 1, j + 1), tu), tv);
  }

  // The landform with nothing built on it: the eroded fine field, plus a
  // gentle roll under the resolution of it.
  natural(x, z) {
    const fn = this.fn, h = this.fine;
    const gx = clamp(x / this.spacing * SUBDIV, 0, fn - 1.001);
    const gz = clamp(z / this.spacing * SUBDIV, 0, fn - 1.001);
    const i = gx | 0, j = gz | 0;
    const tx = gx - i, tz = gz - j;
    const k = j * fn + i;
    return lerp(lerp(h[k], h[k+1], tx), lerp(h[k+fn], h[k+fn+1], tx), tz) + this.roll(x, z);
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
            const limit = this.stepLimit(i, j, i + di, j + dj);
            if (Math.abs(d) <= limit) continue;
            const excess = Math.abs(d) - limit;
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

  // Height at a world position. Out in the country this is the landform: the
  // junctions interpolated, plus a gentle roll so a hillside is not a stack of
  // slabs. Over anything built it is the block's pad, and in between it is the
  // one blending into the other across the road.
  at(x, z) {
    const u = this.warp(x), v = this.warp(z);
    const w = this.blockField(this.flat, u, v);
    const nat = this.natural(x, z);
    if (w <= 0.0005) return nat;
    const p = this.blockField(this.pad, u, v);
    return w >= 0.9995 ? p : lerp(nat, p, w);
  }

  roll(x, z) {
    // One octave: this is a gentle undulation, and it is sampled hundreds of
    // thousands of times while the world is built.
    return (valueNoise(x / DETAIL_SCALE, z / DETAIL_SCALE, this.seed ^ 0x51ab) - 0.5) * DETAIL_AMP;
  }

  // Surface normal, by difference. The levelling is piecewise, so there is no
  // useful closed form any more; the caller normally already has the height at
  // the point itself, which pays for a third of it.
  normalAt(x, z, h0) {
    const e = 3.5;
    const a = h0 === undefined ? this.at(x, z) : h0;
    const dx = (this.at(x + e, z) - a) / e;
    const dz = (this.at(x, z + e) - a) / e;
    const nx = -dx, ny = 1, nz = -dz;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  // The level a built-up block sits at. Its whole surface is at this height,
  // and so is the kerb of every road that runs past it.
  blockLift(bi, bj) {
    const m = this.n - 1;
    return this.pad[clamp(bj, 0, m - 1) * m + clamp(bi, 0, m - 1)];
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
