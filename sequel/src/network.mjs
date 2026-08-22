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
export const CELL = 84;          // average metres between junction centres

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
  ramp:    { lanesPer: 1, laneW: 3.8, limit: 16, colour: [1.60, 0.85, 0.20] },
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

  // ---- the expressway: two elevated decks crossing above the city -----
  // A second layer of nodes, directly above the middle row and the middle
  // column, sharing one junction in the centre. It is the same grammar the
  // whole game runs on - indicate, commit, arc - only nine metres up, so
  // traffic, the police and the map all understand it for free.
  //
  // Slip roads are the interesting part. A node carries one edge per
  // compass direction, so a ramp cannot simply be bolted onto a junction
  // that is already a crossroads; instead each ramp TAKES OVER the street
  // corridor it climbs, replacing that street. Nothing ever has to cross
  // anything else at the same height, and the deck stays the only thing
  // bridging over the city.
  const degree = (n) => n.edges.filter(Boolean).length;
  const DI = Math.floor(GRID / 2), DJ = Math.floor(GRID / 2);
  const DECK_FROM = 2, DECK_TO = GRID - 3;
  const deck = new Map();
  const upperOf = (i, j) => {
    const k = i + ':' + j;
    let n = deck.get(k);
    if (!n) {
      const g = at(i, j);
      n = { i, j, x: g.x, z: g.z, y: DECK_Y, up: true, ground: g,
            edges: [null, null, null, null] };
      deck.set(k, n);
      nodes.push(n);
    }
    return n;
  };
  const link = (a, b, axis, cls) => {
    const e = { id: edges.length, a, b, axis, cls,
                len: axis === 0 ? b.x - a.x : b.z - a.z };
    edges.push(e);
    a.edges[axis === 0 ? 0 : 2] = e;
    b.edges[axis === 0 ? 1 : 3] = e;
    return e;
  };
  for (let i = DECK_FROM; i < DECK_TO; i++) {
    link(upperOf(i, DJ), upperOf(i + 1, DJ), 0, 'express');
  }
  for (let j = DECK_FROM; j < DECK_TO; j++) {
    link(upperOf(DI, j), upperOf(DI, j + 1), 1, 'express');
  }

  // A slip road climbs two blocks, which is a grade you can drive rather
  // than a wall, and it TAKES OVER that street corridor entirely - the
  // streets underneath it are removed, so nothing is ever buried under a
  // ramp and the deck stays the only thing bridging over the city.
  const killEdge = (e) => {
    e.dead = true;
    e.a.edges[e.axis === 0 ? 0 : 2] = null;
    e.b.edges[e.axis === 0 ? 1 : 3] = null;
  };
  const reviveEdge = (e) => {
    e.dead = false;
    e.a.edges[e.axis === 0 ? 0 : 2] = e;
    e.b.edges[e.axis === 0 ? 1 : 3] = e;
  };
  const allConnected = () => {
    const seen = new Set([nodes[0]]);
    const q = [nodes[0]];
    while (q.length) {
      const n = q.pop();
      for (const e of n.edges) {
        if (!e || e.dead) continue;
        const m = e.a === n ? e.b : e.a;
        if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
    return seen.size === nodes.length;
  };
  const slipRoad = (axis, fixed, kGround, kDeck) => {
    const lo = Math.min(kGround, kDeck), hi = Math.max(kGround, kDeck);
    const corridor = [];
    for (let k = lo; k < hi; k++) {
      const n = axis === 0 ? at(k, fixed) : at(fixed, k);
      const e = n.edges[axis === 0 ? 0 : 2];
      if (!e || e.dead) continue;
      if (e.cls !== 'street' && e.cls !== 'avenue') return null;   // never the ring
      corridor.push(e);
    }
    const g = axis === 0 ? at(kGround, fixed) : at(fixed, kGround);
    const u = axis === 0 ? upperOf(kDeck, fixed) : upperOf(fixed, kDeck);
    const a = kGround < kDeck ? g : u, b = kGround < kDeck ? u : g;
    const sa = axis === 0 ? 0 : 2, sb = axis === 0 ? 1 : 3;
    corridor.forEach(killEdge);
    if (a.edges[sa] || b.edges[sb]) { corridor.forEach(reviveEdge); return null; }
    const e = link(a, b, axis, 'ramp');
    if (!allConnected()) {
      edges.pop();
      a.edges[sa] = null; b.edges[sb] = null;
      corridor.forEach(reviveEdge);
      return null;
    }
    return e;
  };
  const ramps = [];
  // Both ends of both decks come down to the ring, so the expressway is
  // always enterable and never a dead end in the sky.
  ramps.push(slipRoad(0, DJ, 0, DECK_FROM));
  ramps.push(slipRoad(0, DJ, GRID - 1, DECK_TO));
  ramps.push(slipRoad(1, DI, 0, DECK_FROM));
  ramps.push(slipRoad(1, DI, GRID - 1, DECK_TO));
  // Mid-city slips: off the side of each deck, two blocks down to a street.
  for (const i of [DI - 2, DI + 2]) {
    if (i >= DECK_FROM && i <= DECK_TO) ramps.push(slipRoad(1, i, DJ + 2, DJ));
  }
  for (const j of [DJ - 2, DJ + 2]) {
    if (j >= DECK_FROM && j <= DECK_TO) ramps.push(slipRoad(0, j, DI + 2, DI));
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
  return { nodes, edges: live, at, xs, zs, deckY: DECK_Y,
           ramps: ramps.filter(Boolean),
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
