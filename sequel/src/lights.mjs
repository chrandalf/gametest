// Traffic signals. Junctions where an avenue meets anything get lights;
// pure street corners stay give-way. The cycle is deterministic from the
// clock, AI queries "when may I cross?", and the player is entirely free
// to run a red - in front of the wrong audience.
'use strict';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { halfWidth } from './network.mjs';

const CYCLE = 14;                  // seconds for the whole loop
const GREEN = 5.6, AMBER = 1.4;    // per axis: green then amber, then swap

export class Signals {
  constructor(scene, net) {
    this.net = net;
    this.nodes = [];
    const mk = (r, g, b) => {
      const m = new StandardMaterial('sig', scene);
      m.emissiveColor = new Color3(r, g, b);
      m.disableLighting = true;
      return m;
    };
    this.mats = { red: mk(1.8, 0.1, 0.08), amber: mk(1.6, 0.9, 0.1),
                  green: mk(0.15, 1.5, 0.4), off: mk(0.05, 0.05, 0.06) };
    const poleMat = new StandardMaterial('sigpole', scene);
    poleMat.emissiveColor = new Color3(0.1, 0.1, 0.13);
    poleMat.disableLighting = true;

    for (const n of net.nodes) {
      const live = n.edges.filter(Boolean);
      if (live.length < 3) continue;
      if (!live.some(e => e.cls === 'avenue')) continue;
      const off = ((n.i * 7 + n.j * 5) % 7) / 7 * CYCLE;
      const node = { n, off, heads: [] };
      // One head per approach corner, showing that approach's aspect.
      const hw = halfWidth('avenue');
      for (const [slot, dx, dz] of [[0, -1, -1], [1, 1, 1], [2, 1, -1], [3, -1, 1]]) {
        if (!n.edges[slot]) continue;
        const px = n.x + dx * (hw + 1.2), pz = n.z + dz * (hw + 1.2);
        const pole = MeshBuilder.CreateBox('sigp', { width: 0.14, height: 4.6, depth: 0.14 }, scene);
        pole.position.set(px, 2.3, pz);
        pole.material = poleMat;
        pole.freezeWorldMatrix();
        const head = MeshBuilder.CreateBox('sigh', { width: 0.5, height: 0.5, depth: 0.5 }, scene);
        head.position.set(px, 4.9, pz);
        head.material = this.mats.red;
        head.freezeWorldMatrix();
        // Slots 0/1 are the x-axis approaches, 2/3 the z-axis.
        node.heads.push({ head, axis: slot < 2 ? 0 : 1 });
      }
      this.nodes.push(node);
      n.signal = node;
    }
  }

  // 'green' | 'amber' | 'red' for travel along `axis` at this node, now.
  phase(node, axis, clock) {
    const t = (clock + node.off) % CYCLE;
    const half = CYCLE / 2;
    const mine = axis === 0 ? t < half : t >= half;
    if (!mine) return 'red';
    const into = axis === 0 ? t : t - half;
    return into > GREEN ? 'amber' : 'green';
  }

  update(clock) {
    for (const node of this.nodes) {
      for (const h of node.heads) {
        const p = this.phase(node, h.axis, clock);
        h.head.material = this.mats[p];
      }
    }
  }

  // For a driver on (e, dir): the s-coordinate to hold at if their light is
  // against them, or null. AI calls this; the player never does.
  stopAtFor(e, dir, clock) {
    const node = dir > 0 ? e.b : e.a;
    if (!node.signal) return null;
    const p = this.phase(node.signal, e.axis, clock);
    if (p === 'green') return null;
    return e.len - halfWidth('avenue') - 2.6;
  }

  // Did this driver cross the box on a red just now? (Player policing.)
  ranRed(e, dir, sBefore, sAfter, clock) {
    const node = dir > 0 ? e.b : e.a;
    if (!node.signal) return false;
    const line = e.len - halfWidth('avenue') - 2.6;
    if (!(sBefore < line && sAfter >= line)) return false;
    return this.phase(node.signal, e.axis, clock) === 'red';
  }
}
