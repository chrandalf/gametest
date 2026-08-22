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
export const CLASSES = {
  street:  { lanesPer: 1, laneW: 3.4, limit: 14, colour: [0.30, 0.95, 1.40] },
  avenue:  { lanesPer: 2, laneW: 3.4, limit: 19, colour: [0.30, 0.95, 1.40] },
  highway: { lanesPer: 3, laneW: 3.7, limit: 30, colour: [1.45, 0.30, 0.95] },
};

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
      nodes.push({ i, j, x: xs[i], z: zs[j], edges: [null, null, null, null] });
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

  // Now make it a CITY, not graph paper: delete a share of the streets,
  // creating T-junctions, long blocks and genuine dead ends - but never
  // disconnect the map, and never touch the ring or the avenues.
  const degree = (n) => n.edges.filter(Boolean).length;
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
  const streets = edges.filter(e => e.cls === 'street');
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
  return { nodes, edges: live, at, xs, zs,
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
  if (e.axis === 0) {
    const x = dir > 0 ? e.a.x + s : e.b.x - s;
    return { x, z: e.a.z + off, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  const z = dir > 0 ? e.a.z + s : e.b.z - s;
  return { x: e.a.x - off, z, yaw: dir > 0 ? 0 : Math.PI };
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
