// The road network: the single source of truth. The 3D city is generated
// FROM this, the minimap draws it, and every vehicle - player, traffic,
// later the target and the police - navigates ON it. Turbo Esprit's city
// was a map you learned; this is that map, as data.
'use strict';

// Junction grid. Spacing is generous so blocks read as city blocks.
export const GRID = 10;          // GRID x GRID junctions
export const CELL = 84;          // metres between junction centres

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
  const nodes = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      nodes.push({ i, j, x: i * CELL, z: j * CELL, edges: [null, null, null, null] });
    }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= GRID || j >= GRID) ? null : nodes[j * GRID + i];

  // Class layout: the perimeter ring is highway; two mid axes are avenues;
  // everything else is street. Simple, legible, learnable - the point.
  const isPerim = (i, j) => i === 0 || j === 0 || i === GRID - 1 || j === GRID - 1;
  const midA = Math.floor(GRID / 3), midB = GRID - 1 - Math.floor(GRID / 3);
  const classFor = (a, b, axis) => {
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
          cls: classFor(n, m, axis),
          len: CELL,
        };
        edges.push(e);
        // Directional slots on nodes: 0 +x, 1 -x, 2 +z, 3 -z.
        n.edges[axis === 0 ? 0 : 2] = e;
        m.edges[axis === 0 ? 1 : 3] = e;
      }
    }
  }
  return { nodes, edges, at };
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
