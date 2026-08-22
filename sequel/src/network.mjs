// The road network: the single source of truth. The 3D city is generated
// FROM this, the minimap draws it, and every vehicle - player, traffic,
// later the target and the police - navigates ON it. Turbo Esprit's city
// was a map you learned; this is that map, as data.
'use strict';

// Junction grid. Spacing is irregular - real cities do not tile - so the
// per-row/column sizes are seeded once and every consumer reads node
// positions, never assumes a pitch. CELL survives as the average, for
// callers that want a "roughly one block" distance.
export const GRID = 11;          // GRID x GRID junctions
export const CELL = 67;          // average metres between junction centres

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Road classes. Lanes are per direction; two-way everywhere in v1.
//   street:  1 lane each way   - the small roads
//   avenue:  2 lanes each way  - the through routes
//   highway: 3 lanes each way  - the ring road, no lights, high speed
//   express: 3 lanes each way, up on the deck - the elevated expressway
//   ramp:    1 lane each way, the slip road that climbs to it
export const CLASSES = {
  street:  { lanesPer: 1, laneW: 3.4, limit: 14, colour: [0.30, 0.95, 1.40] },
  avenue:  { lanesPer: 2, laneW: 3.4, limit: 19, colour: [0.30, 0.95, 1.40] },
  highway: { lanesPer: 3, laneW: 3.7, limit: 30, colour: [1.45, 0.30, 0.95] },
  express: { lanesPer: 3, laneW: 3.5, limit: 34, colour: [0.35, 0.80, 1.70] },
  ramp:    { lanesPer: 2, laneW: 3.6, limit: 20, colour: [1.60, 0.85, 0.20] },
};

// How high the deck flies.
export const DECK_Y = 9.5;

export function halfWidth(cls) {
  const c = CLASSES[cls];
  return c.lanesPer * c.laneW + 0.6;      // carriageway half-width + median sliver
}

// Node/edge model. Edges are axis-aligned: axis 0 runs +x, axis 1 runs +z.
export function buildNetwork() {
  const rand = mulberry(19860508);

  // Irregular pitches: some blocks squat, some long. Prefix-summed into
  // node coordinates.
  const pitch = () => CELL * (0.62 + rand() * 0.9);
  const xs = [0], zs = [0];
  for (let k = 1; k < GRID; k++) { xs.push(xs[k - 1] + pitch()); zs.push(zs[k - 1] + pitch()); }

  const nodes = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      nodes.push({ i, j, x: xs[i], z: zs[j], y: 0, edges: [null, null, null, null] });
    }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= GRID || j >= GRID) ? null : nodes[j * GRID + i];

  // Class layout: the perimeter ring is highway; two mid axes are avenues;
  // everything else is street. Simple, legible, learnable - the point.
  const midA = Math.floor(GRID / 3), midB = GRID - 1 - Math.floor(GRID / 3);
  const classFor = (a, axis) => {
    if (axis === 0 && (a.j === 0 || a.j === GRID - 1)) return 'highway';
    if (axis === 1 && (a.i === 0 || a.i === GRID - 1)) return 'highway';
    if (axis === 0 && (a.j === midA || a.j === midB)) return 'avenue';
    if (axis === 1 && (a.i === midA || a.i === midB)) return 'avenue';
    return 'street';
  };

  const edges = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const n = at(i, j);
      for (const [axis, di, dj] of [[0, 1, 0], [1, 0, 1]]) {
        const m = at(i + di, j + dj);
        if (!m) continue;
        const e = {
          id: edges.length, a: n, b: m, axis,
          cls: classFor(n, axis),
          len: axis === 0 ? m.x - n.x : m.z - n.z,
        };
        edges.push(e);
        // Directional slots on nodes: 0 +x, 1 -x, 2 +z, 3 -z.
        n.edges[axis === 0 ? 0 : 2] = e;
        m.edges[axis === 0 ? 1 : 3] = e;
      }
    }
  }

  // ---- out to sea: the bridges and the island ------------------------
  // The elevated roads used to cross the middle of the city, which put a
  // concrete deck over the best streets in it and a ramp over the beach
  // road. They now do something worth building: they leave from two corners,
  // run out over the water on piers, and land on an island with a city of
  // its own on it - the lights you can see across the water from the beach.
  //
  // Each crossing is a chain of ordinary edges whose ends sit at different
  // heights: a flat causeway off the corner (so nothing elevated ever
  // overlaps the ring road), a climb over the shallows, a long span, and a
  // descent onto the island.
  const degree = (n) => n.edges.filter(Boolean).length;
  const extX = xs[GRID - 1], extZ = zs[GRID - 1];
  const CAUSEWAY = 62;          // flat, clear of the ring junction
  const link = (a, b, axis, cls) => {
    const e = { id: edges.length, a, b, axis, cls,
                len: axis === 0 ? b.x - a.x : b.z - a.z };
    edges.push(e);
    a.edges[axis === 0 ? 0 : 2] = e;
    b.edges[axis === 0 ? 1 : 3] = e;
    return e;
  };
  let seaId = 0;
  const seaNode = (x, z, y) => {
    const n = { i: 900 + seaId, j: 900 + seaId, x, z, y, sea: true,
                edges: [null, null, null, null] };
    seaId += 1;
    nodes.push(n);
    return n;
  };

  // The island: a small grid of its own, sitting out in the water.
  const IGRID = 3, IPITCH = 74;
  const IX0 = extX + 250, IZ0 = extZ / 2 - IPITCH;
  // The crossings run out to the island's middle column, so the bend and
  // the span sit exactly on its spine - a four metre kink at a junction
  // would put half the carriageway in the sea.
  const SPINE_X = IX0 + IPITCH;
  const island = [];
  for (let j = 0; j < IGRID; j++) {
    for (let i = 0; i < IGRID; i++) {
      const n = { i: 800 + i, j: 800 + j, x: IX0 + i * IPITCH, z: IZ0 + j * IPITCH,
                  y: 0, isle: true, edges: [null, null, null, null] };
      island.push(n);
      nodes.push(n);
    }
  }
  const isleAt = (i, j) => island[j * IGRID + i];
  for (let j = 0; j < IGRID; j++) {
    for (let i = 0; i < IGRID; i++) {
      const mid = (i === 1 || j === 1) ? 'avenue' : 'street';
      if (i < IGRID - 1) link(isleAt(i, j), isleAt(i + 1, j), 0, j === 1 ? 'avenue' : mid);
      if (j < IGRID - 1) link(isleAt(i, j), isleAt(i, j + 1), 1, i === 1 ? 'avenue' : mid);
    }
  }

  // The two crossings. Both leave the +x side of the city, from its corners,
  // and bend out over the water to meet the island's spine.
  const bridges = [];
  const crossing = (corner, gateway, towardPlus) => {
    const sgn = towardPlus ? 1 : -1;
    // The causeway lifts a little off the junction, so its deck clears the
    // sand and the water instead of being buried in them.
    const cw = seaNode(corner.x + CAUSEWAY, corner.z, 1.2);
    const top = seaNode(SPINE_X, corner.z, DECK_Y);
    bridges.push(link(corner, cw, 0, 'ramp'));       // flat, over the sand
    bridges.push(link(cw, top, 0, 'ramp'));          // the climb
    // Bend, then the long span, then the run down onto the island.
    const foot = seaNode(top.x, gateway.z - sgn * 120, DECK_Y);
    const spanA = sgn > 0 ? top : foot, spanB = sgn > 0 ? foot : top;
    bridges.push(link(spanA, spanB, 1, 'express'));
    const rampA = sgn > 0 ? foot : gateway, rampB = sgn > 0 ? gateway : foot;
    bridges.push(link(rampA, rampB, 1, 'ramp'));
    return top;
  };
  crossing(at(GRID - 1, 0), isleAt(1, 0), true);
  crossing(at(GRID - 1, GRID - 1), isleAt(1, IGRID - 1), false);

  // How wide the deck is at each end of a slip road. A ramp that simply
  // stops being three lanes wide and starts being two looks drawn on; a
  // ramp that flares out to meet whatever it joins looks built. Each end
  // takes the width of the widest road it meets there.
  for (const e of edges) {
    if (e.cls !== 'ramp' && e.cls !== 'express') continue;
    // The widest ordinary road this end meets, if any. It sets both the
    // width the deck flares to AND how far the parapets must stop short -
    // a wall run all the way into a junction box is a wall you can drive
    // into from the road below.
    // Ordinary road at this end, if any: that is what the parapets have to
    // stop short of. Nothing at deck height needs the same care - there is
    // no traffic underneath a junction that is already in the air.
    const grounded = (n) => {
      let w = 0;
      for (const q of n.edges) {
        if (!q || q === e || q.cls === 'ramp' || q.cls === 'express') continue;
        w = Math.max(w, halfWidth(q.cls));
      }
      return w;
    };
    // Width at each end: the wider of this road and whatever it meets, so
    // both sides of every junction agree and the deck flares into it
    // instead of stepping.
    const widest = (n) => {
      let w = halfWidth(e.cls);
      for (const q of n.edges) {
        if (!q || q === e) continue;
        w = Math.max(w, halfWidth(q.cls));
      }
      return w;
    };
    e.joinA = grounded(e.a);
    e.joinB = grounded(e.b);
    e.hwA = widest(e.a);
    e.hwB = widest(e.b);
  }

  // Junctions in the air need a box round them. Two decks meeting at a
  // right angle each ran their parapets all the way to the node, straight
  // across the other one's carriageway - a wall through the corner you had
  // to drive through to get round. Each such node now owns a square of
  // deck, and a wall across every side no road leaves by; every edge's own
  // parapets stop at that square's edge and meet it cleanly.
  const deckHalf = (e, n) => (n === e.a ? e.hwA : e.hwB);
  for (const n of nodes) {
    const inc = n.edges.filter(Boolean);
    if (!inc.length) continue;
    if (!inc.every(q => q.cls === 'ramp' || q.cls === 'express')) continue;
    const widestHere = Math.max(...inc.map(q => deckHalf(q, n)));
    const ax0 = inc.find(q => q.axis === 0), ax1 = inc.find(q => q.axis === 1);
    n.bridgeBox = {
      hX: ax0 ? deckHalf(ax0, n) : widestHere,   // half-extent across x-road
      hZ: ax1 ? deckHalf(ax1, n) : widestHere,   // half-extent across z-road
      open: [0, 1, 2, 3].map((k) => !n.edges[k]),
    };
  }
  // How far each parapet stops short of each of its nodes.
  for (const e of edges) {
    if (e.cls !== 'ramp' && e.cls !== 'express') continue;
    const pad = (n, join) => {
      if (join) return join + 3;                  // clear of a street junction
      if (n.bridgeBox) return e.axis === 0 ? n.bridgeBox.hZ : n.bridgeBox.hX;
      return 0.5;
    };
    e.padA = pad(e.a, e.joinA);
    e.padB = pad(e.b, e.joinB);
  }

  // Now make it a CITY, not graph paper: delete a share of the streets,
  // creating T-junctions, long blocks and genuine dead ends - but never
  // disconnect the map, and never touch the ring or the avenues.
  const connectedWithout = (dead) => {
    const seen = new Set([nodes[0]]);
    const q = [nodes[0]];
    while (q.length) {
      const n = q.pop();
      for (const e of n.edges) {
        if (!e || e === dead || e.dead) continue;
        const m = e.a === n ? e.b : e.a;
        if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
    return seen.size === nodes.length;
  };
  const streets = edges.filter(e => e.cls === 'street' && !e.dead);
  // Shuffle, then try to kill ~a quarter of them.
  for (let k = streets.length - 1; k > 0; k--) {
    const r = (rand() * (k + 1)) | 0;
    [streets[k], streets[r]] = [streets[r], streets[k]];
  }
  let killed = 0;
  const wantDead = Math.floor(streets.length * 0.26);
  for (const e of streets) {
    if (killed >= wantDead) break;
    // Leave every node at least one road, and keep the city one piece.
    if (degree(e.a) < 2 || degree(e.b) < 2) continue;
    if (!connectedWithout(e)) continue;
    e.dead = true;
    killed++;
    const slotA = e.axis === 0 ? 0 : 2, slotB = e.axis === 0 ? 1 : 3;
    e.a.edges[slotA] = null;
    e.b.edges[slotB] = null;
  }
  const live = edges.filter(e => !e.dead);
  live.forEach((e, i) => { e.id = i; });
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const n of nodes) {
    bx0 = Math.min(bx0, n.x); bx1 = Math.max(bx1, n.x);
    bz0 = Math.min(bz0, n.z); bz1 = Math.max(bz1, n.z);
  }
  return { nodes, edges: live, at, xs, zs, deckY: DECK_Y,
           island, bridges, isleAt: (i, j) => island[j * IGRID + i],
           IGRID, IPITCH, IX0, IZ0,
           bounds: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 },
           extent: { x: xs[GRID - 1], z: zs[GRID - 1] } };
}

// A position on the network: edge, direction of travel (+1 a->b, -1 b->a),
// lane index (0 = kerbside), and distance along from the direction's start.
// Right-hand traffic: lanes sit to the LEFT of travel? No - keep it British
// like the original: drive on the left, lane offset to the left of centre.
export function lanePos(e, dir, lane, s) {
  const c = CLASSES[e.cls];
  // Offset from centreline toward this direction's side (left-hand traffic).
  const off = (0.9 + (lane + 0.5) * c.laneW) * dir;
  // Height ramps linearly from end to end, so a slip road is just an edge
  // whose ends are at different heights.
  const t = e.len > 0 ? (dir > 0 ? s / e.len : 1 - s / e.len) : 0;
  const y = e.a.y + (e.b.y - e.a.y) * Math.max(0, Math.min(1, t));
  if (e.axis === 0) {
    const x = dir > 0 ? e.a.x + s : e.b.x - s;
    return { x, y, z: e.a.z + off, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  const z = dir > 0 ? e.a.z + s : e.b.z - s;
  return { x: e.a.x - off, y, z, yaw: dir > 0 ? 0 : Math.PI };
}

// Height of an edge's deck at a point along it, ignoring direction.
export function edgeY(e, sFromA) {
  const t = e.len > 0 ? Math.max(0, Math.min(1, sFromA / e.len)) : 0;
  return e.a.y + (e.b.y - e.a.y) * t;
}

// The node a traveller on (e, dir) is heading toward / came from.
export const nodeAhead = (e, dir) => dir > 0 ? e.b : e.a;
export const nodeBehind = (e, dir) => dir > 0 ? e.a : e.b;

// From a node, the outgoing (edge, dir) for a world heading slot 0..3
// (+x, -x, +z, -z ordering matches node.edges).
export function outgoing(node, slot) {
  const e = node.edges[slot];
  if (!e) return null;
  const dir = (slot === 0 || slot === 2) ? 1 : -1;
  return { e, dir };
}

// Heading slot of a traveller on (e, dir).
export const headingSlot = (e, dir) =>
  e.axis === 0 ? (dir > 0 ? 0 : 1) : (dir > 0 ? 2 : 3);

// Relative turns from a heading slot. Babylon's world is left-handed
// (x right, y up, z into the screen), so facing +x your left hand points
// at +z: LEFT_OF[0] = slot 2. Worked through for all four headings.
const LEFT_OF = { 0: 2, 1: 3, 2: 1, 3: 0 };
const RIGHT_OF = { 0: 3, 1: 2, 2: 0, 3: 1 };
export function turnOptions(node, slot) {
  return {
    straight: outgoing(node, slot),
    left: outgoing(node, LEFT_OF[slot]),
    right: outgoing(node, RIGHT_OF[slot]),
  };
}
