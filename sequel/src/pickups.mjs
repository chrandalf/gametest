// Things worth stopping for.
//
// Cassettes are the reason to learn the far side of the map: six of them,
// somewhere in the grid, each one worth points and a change of record. The
// briefcase is what the coupe was carrying - it lands where the coupe died
// and you have twenty-five seconds to go and get it before the law does,
// which is the beat the chase never used to have.
'use strict';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { lanePos } from './network.mjs';

const CASSETTES = 6;
const CASE_SECONDS = 25;
const REACH = 4.5;

export class Pickups {
  constructor(scene, net, hud) {
    this.net = net;
    this.hud = hud;
    this.t = 0;

    const tapeMat = new StandardMaterial('tape', scene);
    tapeMat.emissiveColor = new Color3(1.5, 0.9, 0.15);
    tapeMat.disableLighting = true;
    const spool = new StandardMaterial('spool', scene);
    spool.emissiveColor = new Color3(0.1, 0.9, 1.2);
    spool.disableLighting = true;

    this.tapes = [];
    for (let k = 0; k < CASSETTES; k++) {
      const body = MeshBuilder.CreateBox('cass',
        { width: 1.15, height: 0.72, depth: 0.16 }, scene);
      body.material = tapeMat;
      const label = MeshBuilder.CreateBox('cass',
        { width: 0.66, height: 0.3, depth: 0.22 }, scene);
      label.material = spool;
      label.parent = body;
      this.tapes.push({ mesh: body, live: false });
    }

    const caseMat = new StandardMaterial('caseM', scene);
    caseMat.emissiveColor = new Color3(1.7, 1.5, 0.6);
    caseMat.disableLighting = true;
    this.caseMat = caseMat;
    this.case = MeshBuilder.CreateBox('case',
      { width: 1.0, height: 0.66, depth: 0.36 }, scene);
    this.case.material = caseMat;
    this.case.setEnabled(false);
    this.caseLive = false;
    this.caseT = 0;

    this.scatter(1);
  }

  // Somewhere on the ordinary streets, spread out, never on a bridge deck
  // or the ring road where you are doing seventy.
  scatter(level) {
    const roads = this.net.edges.filter(e =>
      (e.cls === 'street' || e.cls === 'avenue') && e.len > 40);
    if (!roads.length) return;
    for (let k = 0; k < this.tapes.length; k++) {
      const e = roads[((k * 53 + level * 17) * 7 + 3) % roads.length];
      const p = lanePos(e, k % 2 ? 1 : -1, 0, e.len * (0.3 + (k % 3) * 0.2));
      const tp = this.tapes[k];
      tp.mesh.position.set(p.x, p.y + 1.1, p.z);
      tp.mesh.setEnabled(true);
      tp.live = true;
    }
  }

  dropCase(x, y, z) {
    this.case.position.set(x, y + 0.9, z);
    this.case.setEnabled(true);
    this.caseLive = true;
    this.caseT = CASE_SECONDS;
  }

  clearCase() {
    this.caseLive = false;
    this.case.setEnabled(false);
  }

  near(mesh, player) {
    const dx = mesh.position.x - player.pos.x;
    const dz = mesh.position.z - player.pos.z;
    if (Math.abs(mesh.position.y - player.pos.y) > 3) return false;
    return dx * dx + dz * dz < REACH * REACH;
  }

  update(dt, player) {
    this.t += dt;
    const spin = this.t * 2.2;
    for (const tp of this.tapes) {
      if (!tp.live) continue;
      tp.mesh.rotation.y = spin;
      tp.mesh.position.y = tp.mesh.position.y * 0.9 +
        (player.pos.y + 1.1 + Math.sin(this.t * 2.6) * 0.16) * 0.1;
      if (this.near(tp.mesh, player)) {
        tp.live = false;
        tp.mesh.setEnabled(false);
        if (this.onCassette) this.onCassette(this.tapes.filter(x => x.live).length);
      }
    }
    if (this.caseLive) {
      this.caseT -= dt;
      this.case.rotation.y = spin * 0.6;
      // It flashes faster the closer it is to being gone, but never fast
      // enough to be a strobe.
      const urgency = 1 - Math.max(0, this.caseT) / CASE_SECONDS;
      const g = 1.5 + Math.sin(this.t * (2 + urgency * 2)) * 0.5;
      this.caseMat.emissiveColor.set(g * 1.1, g, 0.5);
      if (this.near(this.case, player)) {
        this.clearCase();
        if (this.onCase) this.onCase();
      } else if (this.caseT <= 0) {
        this.clearCase();
        if (this.onCaseLost) this.onCaseLost();
      }
    }
  }

  caseSeconds() { return this.caseLive ? Math.max(0, Math.ceil(this.caseT)) : 0; }
  tapesLeft() { return this.tapes.filter(t => t.live).length; }

  mapEntries() {
    const out = this.tapes.filter(t => t.live).map(t => ({
      pos: { x: t.mesh.position.x, z: t.mesh.position.z },
      // Violet, decisively: in van-amber these six dots read as the
      // armoured van teleporting round the town.
      mapColour: 'rgba(200, 120, 255, 0.95)',
    }));
    if (this.caseLive) {
      out.push({ pos: { x: this.case.position.x, z: this.case.position.z },
                 mapColour: 'rgba(255, 250, 200, 1)' });
    }
    return out;
  }
}
