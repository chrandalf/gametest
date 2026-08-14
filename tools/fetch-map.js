#!/usr/bin/env node
// Downloads a patch of OpenStreetMap and saves it as a map fixture the game can
// load. Villages first: a 1-2 km box around a small settlement is a few hundred
// KB, where a city centre is tens of megabytes.
//
//   node tools/fetch-map.js --place "Castle Combe" --radius 700
//   node tools/fetch-map.js --lat 51.4915 --lon -2.2270 --radius 900 --out maps/combe.json
//
// Output is Overpass JSON with geometry inlined (`out body geom`), which is what
// js/mapimport.js expects. No API key is needed; both services are free and
// rate limited, so be gentle.
'use strict';

const fs = require('fs');
const path = require('path');

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'nightfall-city-map-import/1.0 (personal project)';

function parseArgs(argv) {
  const out = { radius: 800 };
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[i + 1];
  }
  return out;
}

async function geocode(place) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(place)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`geocode failed: HTTP ${res.status}`);
  const hits = await res.json();
  if (!hits.length) throw new Error(`no match for "${place}"`);
  return { lat: parseFloat(hits[0].lat), lon: parseFloat(hits[0].lon), name: hits[0].display_name };
}

// Metres -> degrees, accounting for longitude shrinking away from the equator.
function boundingBox(lat, lon, radius) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

async function main() {
  const args = parseArgs(process.argv);
  const radius = Number(args.radius) || 800;

  let lat, lon, label;
  if (args.place) {
    const hit = await geocode(args.place);
    ({ lat, lon } = hit);
    label = hit.name;
    console.log(`found: ${label}\n       ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  } else if (args.lat && args.lon) {
    lat = Number(args.lat); lon = Number(args.lon);
    label = `${lat}, ${lon}`;
  } else {
    console.error('need --place "Somewhere" or --lat <n> --lon <n>');
    process.exit(1);
  }

  const [s, w, n, e] = boundingBox(lat, lon, radius);
  const bbox = `${s},${w},${n},${e}`;
  // Buildings, anything driveable, and water/green for ground cover.
  const query = `[out:json][timeout:60];
(
  way["building"](${bbox});
  way["highway"](${bbox});
  way["natural"="water"](${bbox});
  way["landuse"~"grass|forest|meadow|farmland"](${bbox});
);
out body geom;`;

  console.log(`querying overpass for a ${radius} m box…`);
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': UA },
    body: query,
  });
  if (!res.ok) throw new Error(`overpass failed: HTTP ${res.status}`);
  const data = await res.json();

  // Stamp the centre so the loader knows where to put the origin.
  data.origin = { lat, lon, radius, label };
  const counts = { buildings: 0, roads: 0, other: 0 };
  for (const el of data.elements || []) {
    if (el.tags && el.tags.building) counts.buildings++;
    else if (el.tags && el.tags.highway) counts.roads++;
    else counts.other++;
  }

  const out = args.out || path.join('maps', `${(args.place || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`wrote ${out}  ${kb} KB`);
  console.log(`  ${counts.buildings} buildings, ${counts.roads} road ways, ${counts.other} other`);
  if (kb > 4000) console.log('  (that is large — try a smaller --radius for a first test)');
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
