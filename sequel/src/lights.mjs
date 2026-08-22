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
const RED_AMBER = 1.2;             // British: red and amber together before green

// Lens positions on the head, top to bottom, the way every signal in the
// country is arranged.
const LENSES = [['red', 0.52], ['amber', 0], ['green', -0.52]];
// Which lenses are lit in each aspect.
const LIT = {
  red: { red: true },
  redamber: { red: true, amber: true },
  amber: { amber: true },
  green: { green: true },
};

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
    this.mats = { red: mk(2.2, 0.09, 0.06), amber: mk(2.0, 1.0, 0.06),
                  green: mk(0.12, 1.9, 0.42) };
    // The unlit lenses are real too - three dark discs on a dark box is what
    // makes it read as a traffic light rather than a glowing cube.
    const darkLens = mk(0.035, 0.035, 0.04);
    const poleMat = new StandardMaterial('sigpole', scene);
    poleMat.emissiveColor = new Color3(0.1, 0.1, 0.13);
    poleMat.disableLighting = true;
    const caseMat = new StandardMaterial('sigcase', scene);
    caseMat.emissiveColor = new Color3(0.055, 0.058, 0.07);
    caseMat.disableLighting = true;

    for (const n of net.nodes) {
      const live = n.edges.filter(Boolean);
      if (live.length < 3) continue;
      if (!live.some(e => e.cls === 'avenue')) continue;
      const off = ((n.i * 7 + n.j * 5) % 7) / 7 * CYCLE;
      const node = { n, off, heads: [] };
      // One head per approach corner, showing that approach's aspect.
      const hw = halfWidth('avenue');
      // Corner to stand it on, and the way it has to face: a signal shows
      // its aspect to ONE approach. Lamps that poke out of the back are why
      // you could stand at a green and read a red on the same corner.
      const HEADS = [
        [0, -1, -1, Math.PI / 2],    // the +x arm: faces traffic coming -x
        [1, 1, 1, -Math.PI / 2],
        [2, 1, -1, 0],
        [3, -1, 1, Math.PI],
      ];
      for (const [slot, dx, dz, yaw] of HEADS) {
        if (!n.edges[slot]) continue;
        const px = n.x + dx * (hw + 1.2), pz = n.z + dz * (hw + 1.2);
        const nx = Math.sin(yaw), nz = Math.cos(yaw);
        const pole = MeshBuilder.CreateBox('sigp', { width: 0.14, height: 4.6, depth: 0.14 }, scene);
        pole.position.set(px, 2.3, pz);
        pole.material = poleMat;
        pole.freezeWorldMatrix();
        // The housing, and a backboard behind it - which is also what stops
        // the lit lens being visible from anywhere but the approach.
        const box = MeshBuilder.CreateBox('sigh',
          { width: 0.46, height: 1.72, depth: 0.34 }, scene);
        box.position.set(px, 4.85, pz);
        box.rotation.y = yaw;
        box.material = caseMat;
        box.freezeWorldMatrix();
        const board = MeshBuilder.CreateBox('sigh',
          { width: 0.74, height: 2.0, depth: 0.08 }, scene);
        board.position.set(px - nx * 0.13, 4.85, pz - nz * 0.13);
        board.rotation.y = yaw;
        board.material = caseMat;
        board.freezeWorldMatrix();
        // Three lenses on the front face only, dark, with a bright one a
        // couple of centimetres proud that switches on and off.
        const lamps = {};
        for (const [name, dy] of LENSES) {
          const dark = MeshBuilder.CreateBox('sigd',
            { width: 0.26, height: 0.26, depth: 0.06 }, scene);
          dark.position.set(px + nx * 0.18, 4.85 + dy, pz + nz * 0.18);
          dark.rotation.y = yaw;
          dark.material = darkLens;
          dark.freezeWorldMatrix();
          const lit = MeshBuilder.CreateBox('sigl',
            { width: 0.3, height: 0.3, depth: 0.06 }, scene);
          lit.position.set(px + nx * 0.22, 4.85 + dy, pz + nz * 0.22);
          lit.rotation.y = yaw;
          lit.material = this.mats[name];
          lit.freezeWorldMatrix();
          lit.setEnabled(false);
          lamps[name] = [lit];
        }
        // Slots 0/1 are the x-axis approaches, 2/3 the z-axis.
        node.heads.push({ lamps, axis: slot < 2 ? 0 : 1, aspect: null });
      }
      this.nodes.push(node);
      n.signal = node;
    }
  }

  // 'green' | 'amber' | 'red' | 'redamber' for travel along `axis`, now.
  phase(node, axis, clock) {
    const t = (clock + node.off) % CYCLE;
    const half = CYCLE / 2;
    const mine = axis === 0 ? t < half : t >= half;
    if (mine) {
      const into = axis === 0 ? t : t - half;
      return into > GREEN ? 'amber' : 'green';
    }
    // The warning the real ones give: red and amber together, just before
    // it is your turn. Still means stop.
    const untilMine = axis === 0 ? CYCLE - t : half - t;
    return untilMine <= RED_AMBER ? 'redamber' : 'red';
  }

  update(clock) {
    for (const node of this.nodes) {
      for (const h of node.heads) {
        const p = this.phase(node, h.axis, clock);
        if (p === h.aspect) continue;        // only on the change
        h.aspect = p;
        const on = LIT[p];
        for (const [name] of LENSES) {
          for (const lamp of h.lamps[name]) lamp.setEnabled(!!on[name]);
        }
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
    const p = this.phase(node.signal, e.axis, clock);
    return p === 'red' || p === 'redamber';
  }
}
