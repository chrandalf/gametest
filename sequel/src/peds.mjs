// Pedestrians. They walk the sidewalks, cross at junctions, and are the
// city's conscience: hit one and somebody saw, and what they saw decides
// how loud the sirens get. Two boxes and a head - 1986 would approve.
'use strict';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { halfWidth } from './network.mjs';

const COLOURS = [[0.9, 0.5, 0.6], [0.5, 0.8, 0.9], [0.9, 0.85, 0.5],
                 [0.6, 0.9, 0.6], [0.85, 0.6, 0.35], [0.7, 0.7, 0.95]];

export class Peds {
  constructor(scene, net, count) {
    this.net = net;
    this.list = [];
    const bodyMats = COLOURS.map(([r, g, b]) => {
      const m = new StandardMaterial('pedm', scene);
      m.emissiveColor = new Color3(r * 0.5, g * 0.5, b * 0.5);
      m.disableLighting = true;
      return m;
    });
    const edges = net.edges.filter(e => e.cls !== 'highway');
    for (let k = 0; k < count; k++) {
      const e = edges[(k * 41) % edges.length];
      const root = MeshBuilder.CreateBox('ped', { width: 0.5, height: 1.1, depth: 0.34 }, scene);
      root.position.y = 0.55;
      root.material = bodyMats[k % bodyMats.length];
      const head = MeshBuilder.CreateBox('pedh', { width: 0.3, height: 0.3, depth: 0.3 }, scene);
      head.position.y = 0.85;
      head.parent = root;
      head.material = bodyMats[(k + 2) % bodyMats.length];
      this.list.push({
        e, side: k % 2 ? 1 : -1, s: (k * 23) % Math.max(10, e.len - 10),
        dir: k % 3 ? 1 : -1,
        speed: 1 + (k % 5) * 0.15,
        state: 'walk',              // walk | cross | down
        crossT: 0,
        root,
        downT: 0,
      });
    }
  }

  posOf(p) {
    const e = p.e, hw = halfWidth(e.cls);
    const walkOff = hw + 1.6;
    if (p.state === 'cross') {
      // Crossing: slide from one side to the other at fixed s.
      const off = p.side * walkOff * (1 - 2 * p.crossT);
      return e.axis === 0
        ? { x: e.a.x + p.s, z: e.a.z + off }
        : { x: e.a.x + off, z: e.a.z + p.s };
    }
    const off = p.side * walkOff;
    return e.axis === 0
      ? { x: e.a.x + p.s, z: e.a.z + off }
      : { x: e.a.x + off, z: e.a.z + p.s };
  }

  update(dt, rand) {
    for (const p of this.list) {
      if (p.state === 'down') {
        p.downT += dt;
        continue;
      }
      if (p.state === 'cross') {
        p.crossT += dt * 0.16 * p.speed;
        if (p.crossT >= 1) { p.crossT = 0; p.side = -p.side; p.state = 'walk'; }
      } else {
        p.s += p.dir * p.speed * dt;
        if (p.s > p.e.len - 6) { p.dir = -1; }
        if (p.s < 6) { p.dir = 1; }
        // Now and then, cross the road - preferably like it's 1986 and
        // jaywalking hasn't been invented.
        if (Math.random() < dt * 0.05) { p.state = 'cross'; p.crossT = 0; }
      }
      const pos = this.posOf(p);
      p.root.position.x = pos.x;
      p.root.position.z = pos.z;
      p.root.position.y = 0.55;
      p.root.rotation.y = p.state === 'cross'
        ? (p.side > 0 ? Math.PI : 0) + (p.e.axis === 0 ? 0 : Math.PI / 2)
        : Math.atan2(p.dir * (p.e.axis === 0 ? 1 : 0), p.dir * (p.e.axis === 0 ? 0 : 1));
    }
  }

  // A car passed through somebody. Returns the victim once, then they stay
  // down (flat, static, grim) until quietly recycled.
  hitCheck(x, z) {
    for (const p of this.list) {
      if (p.state === 'down') continue;
      const pos = this.posOf(p);
      const d = Math.hypot(pos.x - x, pos.z - z);
      if (d < 1.7) {
        p.state = 'down';
        p.downT = 0;
        p.root.rotation.x = Math.PI / 2;
        p.root.position.y = 0.2;
        return p;
      }
    }
    return null;
  }

  // Long-downed peds get back up somewhere else, so the city never empties.
  recycle() {
    for (const p of this.list) {
      if (p.state === 'down' && p.downT > 45) {
        p.state = 'walk';
        p.root.rotation.x = 0;
        p.s = 10;
        p.downT = 0;
      }
    }
  }
}
