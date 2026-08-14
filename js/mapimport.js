// Import real OpenStreetMap data and build a drivable world from it.
//
// Accepts Overpass JSON in either shape: ways carrying inline `geometry`
// (what `out body geom` returns), or ways referencing separate node elements
// by id (what plain `out body` returns, and what most saved extracts contain).
'use strict';

// Metres per degree of latitude. Longitude shrinks by cos(latitude).
const M_PER_DEG = 111320;

// Road widths in metres by OSM highway class. Anything unlisted is a lane.
const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 10.5, secondary: 9, tertiary: 8,
  unclassified: 6.5, residential: 6.5, living_street: 5.5, service: 4.5,
  pedestrian: 4, footway: 2.2, path: 2, track: 3.2, cycleway: 2.4,
};

function osmToWorld(json) {
  const els = json.elements || [];
  const nodes = new Map();
  for (const e of els) {
    if (e.type === 'node' && e.lat !== undefined) nodes.set(e.id, [e.lat, e.lon]);
  }

  // Origin: the stamp from the fetch tool, else the centre of everything seen.
  let lat0, lon0;
  if (json.origin && json.origin.lat !== undefined) {
    lat0 = json.origin.lat; lon0 = json.origin.lon;
  } else {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    const note = (la, lo) => {
      if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    };
    for (const [la, lo] of nodes.values()) note(la, lo);
    for (const e of els) if (e.geometry) for (const g of e.geometry) note(g.lat, g.lon);
    if (minLat > maxLat) throw new Error('no coordinates found in this file');
    lat0 = (minLat + maxLat) / 2; lon0 = (minLon + maxLon) / 2;
  }
  const kx = M_PER_DEG * Math.cos(lat0 * Math.PI / 180);
  const project = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG];

  const coordsOf = (way) => {
    if (way.geometry) return way.geometry.map((g) => project(g.lat, g.lon));
    if (way.nodes) {
      const out = [];
      for (const id of way.nodes) {
        const n = nodes.get(id);
        if (n) out.push(project(n[0], n[1]));
      }
      return out;
    }
    return [];
  };

  const buildings = [], roads = [], areas = [];
  for (const e of els) {
    if (e.type !== 'way') continue;
    const t = e.tags || {};
    const pts = coordsOf(e);
    if (pts.length < 2) continue;

    if (t.building || t['building:part']) {
      const ring = dedupeRing(pts);
      if (ring.length < 3) continue;
      // Height from tags where present, else storeys, else a sensible default.
      let h = parseFloat(t.height);
      if (!isFinite(h)) {
        const lv = parseFloat(t['building:levels']);
        h = isFinite(lv) ? lv * 3.2 : 0;
      }
      if (!isFinite(h) || h <= 0) h = 6.5 + (Math.abs(e.id) % 5);
      buildings.push({ ring, height: h, kind: t.building || 'yes' });
    } else if (t.highway) {
      if (t.highway === 'proposed' || t.highway === 'construction') continue;
      roads.push({
        pts, width: ROAD_WIDTH[t.highway] || 6,
        kind: t.highway,
        paved: !(t.highway === 'footway' || t.highway === 'path' || t.highway === 'track'),
      });
    } else if (t.natural === 'water' || t.waterway) {
      areas.push({ ring: dedupeRing(pts), kind: 'water' });
    } else if (t.landuse || t.leisure === 'park') {
      areas.push({ ring: dedupeRing(pts), kind: 'green' });
    }
  }

  return { origin: { lat: lat0, lon: lon0, label: (json.origin && json.origin.label) || '' },
           buildings, roads, areas };
}

// OSM closes rings by repeating the first node; drop that and any duplicates.
function dedupeRing(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) out.pop();
  }
  return out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Ear clipping. Real footprints are frequently L-shaped or worse, so a fan
// triangulation would fold the roof inside out.
function triangulate(ring) {
  const n = ring.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (ringArea(ring) < 0) idx.reverse();          // work anticlockwise

  const tris = [];
  let guard = 0;
  const cross = (a, b, c) =>
    (ring[b][0] - ring[a][0]) * (ring[c][1] - ring[a][1]) -
    (ring[b][1] - ring[a][1]) * (ring[c][0] - ring[a][0]);
  const inside = (a, b, c, p) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  };

  while (idx.length > 3 && guard++ < 4000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;                     // reflex corner
      let blocked = false;
      for (const k of idx) {
        if (k === a || k === b || k === c) continue;
        if (inside(a, b, c, k)) { blocked = true; break; }
      }
      if (blocked) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                                     // degenerate ring
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// A world built from map data, exposing the same surface the game expects of
// the procedural City: chunks, colliders, ground, lights and footprints.
class MapWorld {
  constructor(gl, data) {
    this.gl = gl;
    this.data = data;
    this.rand = makeRandom(4242);
    this.colliders = [];
    this.buildings = [];
    this.lights = [];
    this.chunks = [];
    this.roadNodes = [];
    this.hash = new Map();
    this.hashCell = 24;
    this.ramps = new RampSet();
    this.plantCount = 0;
    this.build();
  }

  addCollider(x0, z0, x1, z1, top) { return City.prototype.addCollider.call(this, x0, z0, x1, z1, top); }
  query(x, z, r) { return City.prototype.query.call(this, x, z, r); }
  resolveCircle(pos, r, aboveY) { return City.prototype.resolveCircle.call(this, pos, r, aboveY); }
  topAt(x, z) { return City.prototype.topAt.call(this, x, z); }

  build() {
    const gl = this.gl, d = this.data, rand = this.rand;

    // Extent, so the ground plane and camera limits fit the data.
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    const note = (p) => {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
    };
    for (const b of d.buildings) b.ring.forEach(note);
    for (const r of d.roads) r.pts.forEach(note);
    if (minX > maxX) { minX = -50; maxX = 50; minZ = -50; maxZ = 50; }
    this.extent = { minX, maxX, minZ, maxZ };
    this.center = [(minX + maxX) / 2, (minZ + maxZ) / 2];

    const ground = new MeshBuilder();
    const pad = 120;
    ground.style(TEX.GRASS, [0.70, 0.78, 0.62], 0);
    ground.quad([minX - pad, -0.06, maxZ + pad], [maxX + pad, -0.06, maxZ + pad],
                [maxX + pad, -0.06, minZ - pad], [minX - pad, -0.06, minZ - pad],
                (maxX - minX + pad * 2) / 9, (maxZ - minZ + pad * 2) / 9);
    this.groundMesh = ground.upload(gl);

    // Chunk by a grid over the extent so frustum culling still does something.
    const CH = 120;
    const cols = Math.max(1, Math.ceil((maxX - minX) / CH));
    const rows = Math.max(1, Math.ceil((maxZ - minZ) / CH));
    const builders = [];
    for (let i = 0; i < cols * rows; i++) builders.push(new MeshBuilder());
    const chunkFor = (x, z) => {
      const cx = clamp(Math.floor((x - minX) / CH), 0, cols - 1);
      const cz = clamp(Math.floor((z - minZ) / CH), 0, rows - 1);
      return builders[cz * cols + cx];
    };

    for (const road of d.roads) this.buildRoad(chunkFor, road);
    for (const b of d.buildings) this.buildBuilding(chunkFor, b, rand);
    this.scatterPlanting(chunkFor, rand);

    for (const bld of builders) {
      if (bld.empty) continue;
      this.chunks.push(bld.upload(gl));
    }

    // Keep the player inside the mapped area.
    const w = 8;
    this.addCollider(minX - pad, minZ - pad, maxX + pad, minZ - pad + w, 30);
    this.addCollider(minX - pad, maxZ + pad - w, maxX + pad, maxZ + pad, 30);
    this.addCollider(minX - pad, minZ - pad, minX - pad + w, maxZ + pad, 30);
    this.addCollider(maxX + pad - w, minZ - pad, maxX + pad, maxZ + pad, 30);
  }

  // Vegetation. An empty green plane is what makes a village read as sparse, so
  // the gaps between roads and houses get planted with mixed species at mixed
  // sizes, thinning out away from the settlement.
  scatterPlanting(chunkFor, rand) {
    const { minX, maxX, minZ, maxZ } = this.extent;
    // Coarse grid of road points, for keeping planting off the carriageway.
    const cell = 12;
    const roadGrid = new Map();
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    for (const r of this.data.roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(len / 6));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const w = r.width / 2 + 2.5;
          const g = key(x, z);
          roadGrid.set(g, Math.max(roadGrid.get(g) || 0, w));
        }
      }
    }
    const nearRoad = (x, z, pad) => {
      for (let gx = -1; gx <= 1; gx++) {
        for (let gz = -1; gz <= 1; gz++) {
          const w = roadGrid.get(key(x + gx * cell, z + gz * cell));
          if (w !== undefined && w + pad > 0) {
            // Cheap: any planting in a cell touched by a road keeps its distance.
            if (gx === 0 && gz === 0) return true;
          }
        }
      }
      return false;
    };

    const cx = this.center[0], cz = this.center[1];
    const spread = Math.max(maxX - minX, maxZ - minZ) * 0.5 + 90;
    const target = clamp(Math.round((maxX - minX) * (maxZ - minZ) / 620), 200, 1400);

    for (let n = 0; n < target * 3 && this.plantCount < target; n++) {
      const x = lerp(minX - 70, maxX + 70, rand());
      const z = lerp(minZ - 70, maxZ + 70, rand());
      // Thin out with distance so the settlement stays the busiest part.
      const d = Math.hypot(x - cx, z - cz) / spread;
      if (rand() < d * 0.75) continue;
      if (nearRoad(x, z, 0)) continue;
      if (this.query(x, z, 3.5).length) continue;
      const b = chunkFor(x, z);
      const roll = rand();
      if (roll < 0.30) this.palm(b, x, z, rand);
      else if (roll < 0.46) this.cypress(b, x, z, rand);
      else if (roll < 0.70) this.broadleaf(b, x, z, rand);
      else this.bush(b, x, z, rand);
      this.plantCount++;
    }

    // Grass tufts: crossed quads, cheap enough to carpet the open ground.
    for (let n = 0; n < target * 6; n++) {
      const x = lerp(minX - 40, maxX + 40, rand());
      const z = lerp(minZ - 40, maxZ + 40, rand());
      if (nearRoad(x, z, 0)) continue;
      if (this.query(x, z, 2).length) continue;
      const b = chunkFor(x, z);
      const h = 0.5 + rand() * 0.8, w = 0.5 + rand() * 0.6;
      const g = 0.55 + rand() * 0.5;
      b.style(TEX.LEAVES, [g * 0.85, g, g * 0.6], 0);
      for (let k = 0; k < 2; k++) {
        const a = rand() * Math.PI + k * Math.PI / 2;
        const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
        b.quad([x - dx, 0, z - dz], [x + dx, 0, z + dz],
               [x + dx, h, z + dz], [x - dx, h, z - dz], 1, 1);
        b.quad([x + dx, 0, z + dz], [x - dx, 0, z - dz],
               [x - dx, h, z - dz], [x + dx, h, z + dz], 1, 1);
      }
    }
  }

  palm(b, x, z, rand) {
    const h = 5.5 + rand() * 5;
    const lean = (rand() - 0.5) * 0.5;
    b.style(TEX.BARK, [0.85, 0.74, 0.55], 0);
    // Curved trunk: short stacked segments, drifting with the lean.
    const segs = 5;
    let px = x, pz = z;
    for (let i = 0; i < segs; i++) {
      const t = i / segs, t1 = (i + 1) / segs;
      const r = 0.28 * (1 - t * 0.4);
      const nx = x + lean * t1 * t1 * h * 0.35, nz = z + lean * 0.4 * t1 * t1 * h * 0.35;
      b.cylinder((px + nx) / 2, h * (t + t1) / 2, (pz + nz) / 2, r, h / segs + 0.15, 6,
                 { uRepeat: 2, vRepeat: 1 });
      px = nx; pz = nz;
    }
    const topX = px, topZ = pz;
    const fronds = 7 + ((rand() * 4) | 0);
    const green = 0.7 + rand() * 0.5;
    b.style(TEX.LEAVES, [green * 0.8, green, green * 0.55], 0);
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + rand() * 0.3;
      const len = 2.4 + rand() * 1.6;
      const droop = 0.5 + rand() * 0.5;
      const ex = topX + Math.cos(a) * len, ez = topZ + Math.sin(a) * len;
      const ey = h - droop * 1.5;
      const wdt = 0.42;
      const px2 = -Math.sin(a) * wdt, pz2 = Math.cos(a) * wdt;
      // Each frond is a long tapered strip, drawn both sides.
      b.quad([topX - px2, h, topZ - pz2], [topX + px2, h, topZ + pz2],
             [ex + px2 * 0.3, ey, ez + pz2 * 0.3], [ex - px2 * 0.3, ey, ez - pz2 * 0.3], 1, 1);
      b.quad([topX + px2, h, topZ + pz2], [topX - px2, h, topZ - pz2],
             [ex - px2 * 0.3, ey, ez - pz2 * 0.3], [ex + px2 * 0.3, ey, ez + pz2 * 0.3], 1, 1);
    }
  }

  cypress(b, x, z, rand) {
    const h = 5 + rand() * 6;
    b.style(TEX.BARK, [0.55, 0.45, 0.35], 0);
    b.cylinder(x, h * 0.12, z, 0.2, h * 0.24, 5, { vRepeat: 1 });
    const g = 0.45 + rand() * 0.3;
    b.style(TEX.LEAVES, [g * 0.7, g, g * 0.55], 0);
    // Stacked spheres tapering to a point.
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      b.sphere(x, h * (0.25 + t * 0.72), z, (1.15 - t * 0.75) * (0.8 + rand() * 0.3),
               8, 6, 1.5 - t * 0.3);
    }
  }

  broadleaf(b, x, z, rand) {
    const h = 3.5 + rand() * 4;
    b.style(TEX.BARK, [1, 1, 1], 0);
    b.cylinder(x, h / 2, z, 0.26 + rand() * 0.12, h, 6, { uRepeat: 2, vRepeat: 2 });
    const g = 0.75 + rand() * 0.45;
    b.style(TEX.LEAVES, [g * 0.85, g, g * 0.6], 0);
    const r = 1.6 + rand() * 1.4;
    b.sphere(x, h + r * 0.35, z, r, 9, 7, 0.82);
    b.sphere(x + (rand() - 0.5) * r, h + r * 0.05, z + (rand() - 0.5) * r, r * 0.68, 8, 6, 0.9);
    b.sphere(x + (rand() - 0.5) * r * 0.8, h + r * 0.6, z + (rand() - 0.5) * r * 0.8, r * 0.55, 7, 5, 0.9);
  }

  bush(b, x, z, rand) {
    const g = 0.6 + rand() * 0.5;
    b.style(TEX.LEAVES, [g * 0.8, g, g * 0.5], 0);
    const r = 0.7 + rand() * 0.9;
    b.sphere(x, r * 0.8, z, r, 8, 6, 0.85);
    b.sphere(x + (rand() - 0.5) * r, r * 0.6, z + (rand() - 0.5) * r, r * 0.7, 7, 5, 0.85);
  }

  buildRoad(chunkFor, road) {
    const pts = road.pts;
    const hw = road.width / 2;
    const y = road.paved ? 0.02 : 0.015;
    const tint = road.paved ? [1, 1, 1] : [0.85, 0.80, 0.70];
    const layer = road.paved ? TEX.ASPHALT : TEX.CONCRETE;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      dx /= len; dz /= len;
      const nx = -dz * hw, nz = dx * hw;
      const bld = chunkFor(a[0], a[1]);
      bld.style(layer, tint, 0);
      bld.quad([a[0] - nx, y, a[1] - nz], [a[0] + nx, y, a[1] + nz],
               [b[0] + nx, y, b[1] + nz], [b[0] - nx, y, b[1] - nz],
               road.width / 6, len / 6);
      // A disc at each joint hides the wedge gap where segments meet.
      if (i > 0) {
        bld.style(layer, tint, 0);
        const seg = 8;
        for (let k = 0; k < seg; k++) {
          const t0 = k / seg * Math.PI * 2, t1 = (k + 1) / seg * Math.PI * 2;
          bld.quad([a[0], y, a[1]],
                   [a[0] + Math.cos(t0) * hw, y, a[1] + Math.sin(t0) * hw],
                   [a[0] + Math.cos(t1) * hw, y, a[1] + Math.sin(t1) * hw],
                   [a[0], y, a[1]], 1, 1);
        }
      }
      if (road.paved && road.width >= 5.5) {
        this.roadNodes.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
        // Street lamps at intervals along the bigger roads.
        if (this.lights.length < 260 && i % 3 === 0 && len > 12) {
          const lx = a[0] + dx * len * 0.5 - nx * 1.25;
          const lz = a[1] + dz * len * 0.5 - nz * 1.25;
          bld.style(TEX.METAL, [0.32, 0.34, 0.36], 0);
          bld.cylinder(lx, 3.6, lz, 0.13, 7.2, 6, { vRepeat: 3 });
          bld.style(TEX.PLAIN, [1.0, 0.93, 0.75], 0.9);
          bld.chamferBox(lx, 7.1, lz, 0.34, 0.14, 0.34, 0.1, { perUnit: 1 });
          this.lights.push({ x: lx, y: 6.9, z: lz });
        }
      }
    }
  }

  buildBuilding(chunkFor, b, rand) {
    const ring = b.ring;
    const h = b.height;
    const bld = chunkFor(ring[0][0], ring[0][1]);
    const facade = FACADES[h > 24 ? ((rand() * 3) | 0) : (rand() < 0.55 ? 2 : 1)];
    const tint = BUILDING_TINTS[(rand() * BUILDING_TINTS.length) | 0];

    // Walls, emitted both ways round. OSM rings are not consistently wound —
    // mappers trace them in whichever direction suits — so picking an
    // orientation from the signed area leaves half of every village inside out.
    bld.style(facade.layer, tint, 0);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.05) continue;
      const u = Math.max(1, Math.round(len / (facade.cols * 3.4)));
      const v = Math.max(1, Math.round(h / (facade.rows * 3.4)));
      bld.quad([a[0], 0, a[1]], [c[0], 0, c[1]], [c[0], h, c[1]], [a[0], h, a[1]], u, v);
      bld.quad([c[0], 0, c[1]], [a[0], 0, a[1]], [a[0], h, a[1]], [c[0], h, c[1]], u, v);
    }

    // Roof, triangulated so concave footprints stay flat and solid, and also
    // double-sided for the same reason.
    bld.style(TEX.ROOF, [1, 1, 1], 0);
    for (const [i0, i1, i2] of triangulate(ring)) {
      const A = ring[i0], B = ring[i1], C = ring[i2];
      const a0 = bld.vertex(A[0], h, A[1], 0, 1, 0, A[0] / 8, A[1] / 8);
      const a1 = bld.vertex(B[0], h, B[1], 0, 1, 0, B[0] / 8, B[1] / 8);
      const a2 = bld.vertex(C[0], h, C[1], 0, 1, 0, C[0] / 8, C[1] / 8);
      bld.i.push(a0, a2, a1, a0, a1, a2);
    }

    // Collision uses the footprint's bounding box, which is close enough for
    // driving into a wall and keeps the spatial hash simple.
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of ring) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
    }
    this.addCollider(x0, z0, x1, z1, h);
    this.buildings.push({ x0, z0, x1, z1, h, downtown: 0 });
  }
}
