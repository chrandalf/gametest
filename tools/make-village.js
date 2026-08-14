#!/usr/bin/env node
// Writes a village as Overpass-shaped OSM JSON, in the node-reference form that
// real saved extracts use — so it exercises exactly the same importer path as a
// file fetched with tools/fetch-map.js.
//
//   node tools/make-village.js            -> js/villagedata.js (bundled sample)
//   node tools/make-village.js --json out.json
//
// This is a stand-in, not a real place. Point the importer at a real extract as
// soon as you have one.
'use strict';

const fs = require('fs');
const path = require('path');

let seed = 20260814;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};

const LAT0 = 51.4915, LON0 = -2.2270;          // a plausible English latitude
const M_PER_DEG = 111320;
const KX = M_PER_DEG * Math.cos(LAT0 * Math.PI / 180);
const toLat = (z) => LAT0 + z / M_PER_DEG;
const toLon = (x) => LON0 + x / KX;

const elements = [];
let nextId = 1000;
const nodeId = (x, z) => {
  const id = nextId++;
  elements.push({ type: 'node', id, lat: toLat(z), lon: toLon(x) });
  return id;
};
const way = (pts, tags) => {
  elements.push({ type: 'way', id: nextId++, nodes: pts.map((p) => nodeId(p[0], p[1])), tags });
};

// --- roads: a curving main street, a lane crossing it, and a few closes ---
const mainPts = [];
for (let i = 0; i <= 26; i++) {
  const t = i / 26;
  mainPts.push([-330 + t * 660, Math.sin(t * Math.PI * 1.7) * 46 + Math.sin(t * 9) * 4]);
}
way(mainPts, { highway: 'residential', name: 'High Street' });

const crossPts = [];
for (let i = 0; i <= 16; i++) {
  const t = i / 16;
  crossPts.push([Math.sin(t * Math.PI * 1.2) * 40 - 20, -250 + t * 500]);
}
way(crossPts, { highway: 'unclassified', name: 'Mill Lane' });

const closes = [];
for (let c = 0; c < 7; c++) {
  const anchor = mainPts[3 + c * 3];
  const dir = c % 2 ? 1 : -1;
  const pts = [[anchor[0], anchor[1]]];
  let x = anchor[0], z = anchor[1];
  for (let k = 0; k < 4; k++) {
    x += (rnd() - 0.5) * 26;
    z += dir * (26 + rnd() * 16);
    pts.push([x, z]);
  }
  way(pts, { highway: 'service', name: `Close ${c + 1}` });
  closes.push(pts);
}

// --- cottages fronting every road ---
const placed = [];
const tooClose = (x, z, r) => placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < r);

function frontage(pts, offset, count, sizeMin, sizeMax, levels) {
  for (let i = 0; i < count; i++) {
    const seg = 1 + Math.floor(rnd() * (pts.length - 2));
    const a = pts[seg - 1], b = pts[seg];
    const t = 0.15 + rnd() * 0.7;
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const side = rnd() < 0.5 ? 1 : -1;
    const cx = a[0] + dx * len * t - dz * offset * side;
    const cz = a[1] + dz * len * t + dx * offset * side;
    if (tooClose(cx, cz, 15)) continue;
    placed.push([cx, cz]);

    const w = sizeMin + rnd() * (sizeMax - sizeMin);
    const d = sizeMin + rnd() * (sizeMax - sizeMin);
    // Align the cottage to the road it fronts, with a little scatter.
    const ang = Math.atan2(dz, dx) + (rnd() - 0.5) * 0.25;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const corner = (lx, lz) => [cx + lx * ca - lz * sa, cz + lx * sa + lz * ca];
    let ring = [corner(-w/2, -d/2), corner(w/2, -d/2), corner(w/2, d/2), corner(-w/2, d/2)];
    // A third of them get an L-shaped wing, which is what exercises the
    // triangulator: a fan would fold a concave roof inside out.
    if (rnd() < 0.34) {
      const wingW = w * 0.42, wingD = d * 0.55;
      ring = [
        corner(-w/2, -d/2), corner(w/2, -d/2), corner(w/2, d/2),
        corner(-w/2 + wingW, d/2), corner(-w/2 + wingW, d/2 + wingD),
        corner(-w/2, d/2 + wingD),
      ];
    }
    ring.push(ring[0].slice());                 // OSM closes its rings
    way(ring, { building: 'house', 'building:levels': String(levels) });
  }
}

frontage(mainPts, 13, 46, 7, 12, 2);
frontage(crossPts, 12, 26, 6.5, 11, 2);
for (const cl of closes) frontage(cl, 10, 5, 6, 9.5, 1);

// A church, a pub and a village hall, larger and taller.
const landmark = (x, z, w, d, levels, tags) => {
  const ring = [[x-w/2, z-d/2], [x+w/2, z-d/2], [x+w/2, z+d/2], [x-w/2, z+d/2]];
  ring.push(ring[0].slice());
  way(ring, Object.assign({ building: 'yes', 'building:levels': String(levels) }, tags));
};
landmark(-90, -70, 26, 15, 3, { amenity: 'place_of_worship', name: 'St Mary' });
landmark(70, 40, 20, 14, 2, { amenity: 'pub', name: 'The Fox' });
landmark(150, -60, 24, 18, 2, { amenity: 'community_centre', name: 'Village Hall' });

// The green and a pond.
const green = [];
for (let i = 0; i < 14; i++) {
  const a = i / 14 * Math.PI * 2;
  green.push([-40 + Math.cos(a) * 62, 110 + Math.sin(a) * 44]);
}
green.push(green[0].slice());
way(green, { landuse: 'grass', name: 'The Green' });

const pond = [];
for (let i = 0; i < 12; i++) {
  const a = i / 12 * Math.PI * 2;
  pond.push([210 + Math.cos(a) * 26, 120 + Math.sin(a) * 18]);
}
pond.push(pond[0].slice());
way(pond, { natural: 'water', name: 'Mill Pond' });

const doc = {
  version: 0.6,
  generator: 'nightfall-city make-village (synthetic stand-in, not a real place)',
  origin: { lat: LAT0, lon: LON0, radius: 400, label: 'Sample Village (generated)' },
  elements,
};

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
if (jsonIdx >= 0) {
  const out = args[jsonIdx + 1] || 'maps/sample-village.json';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc));
  console.log(`wrote ${out}`);
} else {
  const out = path.join(__dirname, '..', 'js', 'villagedata.js');
  fs.writeFileSync(out,
    '// Generated by tools/make-village.js — a synthetic village in OSM format,\n' +
    '// bundled so the map importer has something to load without a network.\n' +
    "'use strict';\n\nconst SAMPLE_VILLAGE = " + JSON.stringify(doc) + ';\n');
  console.log(`wrote js/villagedata.js  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

const ways = elements.filter((e) => e.type === 'way');
console.log(`  ${ways.filter((w) => w.tags.building).length} buildings, ` +
            `${ways.filter((w) => w.tags.highway).length} roads, ` +
            `${elements.filter((e) => e.type === 'node').length} nodes`);
