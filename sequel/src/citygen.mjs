// The 3D city, generated from the road network. Nothing here is data the
// game reasons about - it is the network made visible: carriageways, lane
// paint, neon edging, buildings filling the blocks, signs, street lights.
'use strict';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { GRID, CELL, CLASSES, halfWidth, lanePos } from './network.mjs';

// Deterministic rand so the city is the same city every visit - you are
// supposed to LEARN it.
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const neonMat = (scene, r, g, b, name) => {
  const m = new StandardMaterial(name || 'nm', scene);
  m.emissiveColor = new Color3(r, g, b);
  m.disableLighting = true;
  // Depth bias: thin glowing strips lying on the road z-fight at range and
  // read as flicker; pulling them a hair toward the camera settles them.
  m.zOffset = -2;
  return m;
};

function windowTexture(scene, rand) {
  const dt = new DynamicTexture('win', { width: 256, height: 512 }, scene, true);
  const x = dt.getContext();
  x.fillStyle = '#04040a'; x.fillRect(0, 0, 256, 512);
  for (let r = 0; r < 24; r++) for (let c = 0; c < 8; c++) {
    if (rand() < 0.62) continue;
    x.fillStyle = rand() < 0.8 ? '#ffd9a0' : '#9fd8ff';
    x.fillRect(c * 32 + 9, r * 21 + 5, 16, 11);
  }
  dt.update();
  return dt;
}

// Big glowing shop/hotel signs: canvas text, one texture per word.
const SIGN_WORDS = ['HOTEL', 'NEON', 'GARAGE', 'CLUB 88', 'DINER', 'CASINO',
                    'MOTORS', 'PALMS', 'ARCADE', 'LIQUOR', 'RADIO', 'TAXI'];
const SIGN_COLS = ['#ff3ec8', '#31e8ff', '#b44dff', '#ff5a4d', '#ffd34d', '#4dff88'];
function signTexture(scene, word, col) {
  const dt = new DynamicTexture('sg' + word, { width: 512, height: 128 }, scene, true);
  const x = dt.getContext();
  x.clearRect(0, 0, 512, 128);
  x.font = '900 84px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = col; x.shadowBlur = 26;
  x.fillStyle = col;
  x.fillText(word, 256, 68);
  dt.update();
  dt.hasAlpha = true;
  return dt;
}

// A sign you can read from either side. One plane with backface culling off
// shows its own mirror image from behind - which is how every word in the
// city ended up backwards half the time. Two planes back to back, each
// culled to its front face and nudged a couple of centimetres apart so they
// cannot z-fight, read correctly from wherever you are standing.
function twoSidedSign(scene, name, opts, x, y, z, ry, mat) {
  const nx = Math.sin(ry), nz = Math.cos(ry);
  const out = [];
  for (const side of [1, -1]) {
    const p = MeshBuilder.CreatePlane(name, opts, scene);
    p.position.set(x + nx * 0.02 * side, y, z + nz * 0.02 * side);
    p.rotation.y = side > 0 ? ry : ry + Math.PI;
    p.material = mat;
    out.push(p);
  }
  return out;
}

export function buildCity(scene, net, mirror, seed = 19860508) {
  const rand = mulberry(seed);              // the same seed that built the roads
  const glow = {
    cyan: neonMat(scene, 0.15, 1.05, 1.5, 'cyan'),
    blue: neonMat(scene, 0.25, 0.75, 2.1, 'blue'),
    pink: neonMat(scene, 1.5, 0.2, 0.95, 'pink'),
    amber: neonMat(scene, 1.5, 0.75, 0.1, 'amber'),
    lampHead: neonMat(scene, 1.3, 1.1, 0.75, 'lamp'),
    white: neonMat(scene, 1.1, 1.05, 0.95, 'white'),
  };

  // ---- ground: one city-wide wet mirror plane -------------------------
  const ext = net.extent;
  const ground = MeshBuilder.CreateGround('g', { width: ext.x + 320, height: ext.z + 320 }, scene);
  ground.position.set(ext.x / 2, 0, ext.z / 2);
  const gm = new PBRMaterial('gm', scene);
  gm.albedoColor = new Color3(0.012, 0.012, 0.022);
  gm.metallic = 0.75; gm.roughness = 0.34;
  gm.reflectionTexture = mirror;
  ground.material = gm;
  mirror.renderList.push(ground);

  // ---- roads: a slightly raised dark slab per edge + lane furniture ----
  const roadMat = new PBRMaterial('road', scene);
  roadMat.albedoColor = new Color3(0.018, 0.018, 0.03);
  roadMat.metallic = 0.7; roadMat.roughness = 0.28;
  roadMat.reflectionTexture = mirror;

  const laneDashProto = MeshBuilder.CreateBox('dash', { width: 0.2, height: 0.05, depth: 2.6 }, scene);
  laneDashProto.material = glow.amber;
  laneDashProto.setEnabled(false);
  const dashes = [];

  // Sidewalks and kerbs: the lit-enough strip that separates carriageway
  // from block-shadow, so the darkness stops being misleading.
  const walkMat = new PBRMaterial('walk', scene);
  walkMat.albedoColor = new Color3(0.045, 0.05, 0.075);
  walkMat.metallic = 0.1; walkMat.roughness = 0.85;
  walkMat.emissiveColor = new Color3(0.022, 0.028, 0.042);
  const kerbMat = new StandardMaterial('kerb', scene);
  kerbMat.emissiveColor = new Color3(0.16, 0.17, 0.22);
  kerbMat.disableLighting = true;
  const stopMat = new StandardMaterial('stop', scene);
  stopMat.emissiveColor = new Color3(0.85, 0.88, 0.95);
  stopMat.disableLighting = true;

  for (const e of net.edges) {
    if (e.cls === 'express' || e.cls === 'ramp') continue;   // built up top
    const hw = halfWidth(e.cls);
    const c = CLASSES[e.cls];
    const cx = (e.a.x + e.b.x) / 2, cz = (e.a.z + e.b.z) / 2;
    const w = e.axis === 0 ? e.len : hw * 2;
    const d = e.axis === 0 ? hw * 2 : e.len;
    const slab = MeshBuilder.CreateBox('rd', { width: w, height: 0.09, depth: d }, scene);
    slab.position.set(cx, 0.045, cz);
    slab.material = roadMat;
    mirror.renderList.push(slab);

    // Sidewalk slabs and kerb strips down both sides. They stop short of
    // each junction: run them the full length of the edge and the pavement
    // of one road marches straight across the carriageway of the other,
    // which is what you see at every signalled corner.
    const crossHalf = (n) => {
      let w = 0;
      for (const q of n.edges) {
        if (!q || q.axis === e.axis) continue;
        w = Math.max(w, halfWidth(q.cls));
      }
      return w;
    };
    const insetA = crossHalf(e.a) ? crossHalf(e.a) + 0.6 : 0;
    const insetB = crossHalf(e.b) ? crossHalf(e.b) + 0.6 : 0;
    const runL = Math.max(2, e.len - insetA - insetB);
    const runMid = insetA + runL / 2;
    const wx = e.axis === 0 ? e.a.x + runMid : cx;
    const wz = e.axis === 0 ? cz : e.a.z + runMid;
    for (const sd of [-1, 1]) {
      const wk = MeshBuilder.CreateBox('wk', {
        width: e.axis === 0 ? runL : 3,
        height: 0.16,
        depth: e.axis === 0 ? 3 : runL,
      }, scene);
      wk.position.set(
        e.axis === 0 ? wx : wx + sd * (hw + 1.6),
        0.08,
        e.axis === 0 ? wz + sd * (hw + 1.6) : wz);
      wk.material = walkMat;
      const kb = MeshBuilder.CreateBox('kb', {
        width: e.axis === 0 ? runL : 0.22,
        height: 0.2,
        depth: e.axis === 0 ? 0.22 : runL,
      }, scene);
      kb.position.set(
        e.axis === 0 ? wx : wx + sd * (hw + 0.12),
        0.1,
        e.axis === 0 ? wz + sd * (hw + 0.12) : wz);
      kb.material = kerbMat;
    }
    // Stop lines where the carriageway meets each junction box: one white
    // bar per approach, on the left-hand-traffic side.
    if (e.cls !== 'highway') {
      const c2 = CLASSES[e.cls];
      const barW = c2.lanesPer * c2.laneW;
      for (const end of [0, 1]) {
        const inset = halfWidth('avenue') + 2.2;
        const along = end === 0 ? inset : e.len - inset;
        const side = end === 0 ? -1 : 1;   // approach side for each travel dir
        const bx = e.axis === 0 ? e.a.x + along : e.a.x - side * (0.9 + barW / 2);
        const bz = e.axis === 0 ? e.a.z + side * (0.9 + barW / 2) : e.a.z + along;
        const bar = MeshBuilder.CreateBox('sl', {
          width: e.axis === 0 ? 0.35 : barW,
          height: 0.055,
          depth: e.axis === 0 ? barW : 0.35,
        }, scene);
        bar.position.set(bx, 0.1, bz);
        bar.material = stopMat;
      }
    }

    // Neon edge lines, inset from the junction boxes; the Neon Drive look.
    const edgeInset = halfWidth('highway') + 2;
    const runLen = e.len - edgeInset * 2;
    if (runLen > 4) {
      for (const sd of [-1, 1]) {
        const line = MeshBuilder.CreateBox('el', {
          width: e.axis === 0 ? runLen : 0.18,
          height: 0.06,
          depth: e.axis === 0 ? 0.18 : runLen,
        }, scene);
        line.position.set(
          e.axis === 0 ? cx : cx + sd * hw,
          0.1,
          e.axis === 0 ? cz + sd * hw : cz);
        line.material = e.cls === 'highway' ? glow.blue : glow.cyan;
        mirror.renderList.push(line);
      }
      // Centre line: pink on streets/avenues, continuous.
      const mid = MeshBuilder.CreateBox('ml', {
        width: e.axis === 0 ? runLen : 0.14,
        height: 0.055,
        depth: e.axis === 0 ? 0.14 : runLen,
      }, scene);
      mid.position.set(cx, 0.1, cz);
      mid.material = e.cls === 'highway' ? glow.white : glow.pink;
      mirror.renderList.push(mid);
      // Lane-divider dashes where there is more than one lane per side.
      if (c.lanesPer > 1) {
        for (let k = 1; k < c.lanesPer; k++) {
          for (const sd of [-1, 1]) {
            const off = (0.9 + k * c.laneW) * sd;
            for (let s = -runLen / 2 + 2; s < runLen / 2 - 2; s += 7) {
              const dash = laneDashProto.createInstance('di');
              dash.position.set(
                e.axis === 0 ? cx + s : cx + off,
                0.1,
                e.axis === 0 ? cz + off : cz + s);
              if (e.axis === 0) dash.rotation.y = Math.PI / 2;
              dashes.push(dash);
            }
          }
        }
      }
    }
  }

  // ---- street lights along every edge ---------------------------------
  const poleProto = MeshBuilder.CreateBox('pole', { width: 0.16, height: 7.5, depth: 0.16 }, scene);
  const poleMat = new PBRMaterial('poleM', scene);
  poleMat.albedoColor = new Color3(0.05, 0.05, 0.07); poleMat.roughness = 0.7;
  poleProto.material = poleMat;
  poleProto.setEnabled(false);
  const headProto = MeshBuilder.CreateBox('lampHead', { width: 0.9, height: 0.16, depth: 0.42 }, scene);
  headProto.material = glow.lampHead;
  headProto.setEnabled(false);
  for (const e of net.edges) {
    if (e.cls === 'highway') continue;               // ring road glows on its own
    if (e.cls === 'express' || e.cls === 'ramp') continue;
    const hw = halfWidth(e.cls);
    for (let s = e.len * 0.24; s < e.len * 0.9; s += Math.max(26, e.len * 0.4)) {
      for (const sd of [-1, 1]) {
        const px = e.axis === 0 ? e.a.x + s : e.a.x + sd * (hw + 1.4);
        const pz = e.axis === 0 ? e.a.z + sd * (hw + 1.4) : e.a.z + s;
        const p = poleProto.createInstance('pi');
        p.position.set(px, 3.75, pz);
        const h = headProto.createInstance('hi');
        h.position.set(px - (e.axis === 0 ? 0 : sd * 0.8), 7.4, pz - (e.axis === 0 ? sd * 0.8 : 0));
      }
    }
  }

  // ---- the crossings: causeways, spans, slip roads, piers --------------
  // Every piece is a slab built straight into world space from the four
  // lateral offsets it has at each end. That is what lets a deck taper:
  // a ramp can be as wide as the road it leaves at one end and its own
  // width at the other, and the neon down its edges follows the flare
  // instead of stopping dead where the width changes.
  {
    const deckMat = new PBRMaterial('deck', scene);
    deckMat.albedoColor = new Color3(0.030, 0.030, 0.044);
    deckMat.metallic = 0.45; deckMat.roughness = 0.5;
    const concrete = new PBRMaterial('conc', scene);
    concrete.albedoColor = new Color3(0.055, 0.055, 0.072);
    concrete.metallic = 0.1; concrete.roughness = 0.85;
    concrete.emissiveColor = new Color3(0.024, 0.026, 0.036);

    // Four lateral offsets - left and right at each end - swept from a to b.
    // Positive is to the left of travel from a toward b.
    const slab = (e, name, mat, aL, aR, bL, bR, top, thick, sA, sB) => {
      const lx = e.axis === 0 ? 0 : 1, lz = e.axis === 0 ? -1 : 0;
      // Ends can stop short of the nodes, so a parapet never runs into a
      // junction box at ground level.
      const f0 = Math.min(0.45, (sA || 0) / e.len);
      const f1 = 1 - Math.min(0.45, (sB || 0) / e.len);
      const mix = (u, v, f) => u + (v - u) * f;
      const ends = [f0, f1].map((f) => ({
        x: mix(e.a.x, e.b.x, f), z: mix(e.a.z, e.b.z, f),
        y: mix(e.a.y, e.b.y, f) + top,
        l: mix(aL, bL, f), r: mix(aR, bR, f),
      }));
      const cx = (ends[0].x + ends[1].x) / 2;
      const cy = (ends[0].y + ends[1].y) / 2;
      const cz = (ends[0].z + ends[1].z) / 2;
      const P = (which, side, dy) => {
        const n = ends[which];
        const off = side === 0 ? n.l : n.r;
        return [n.x + lx * off - cx, n.y + dy - cy, n.z + lz * off - cz];
      };
      const top4 = [P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)];
      const bot4 = [P(0, 0, -thick), P(0, 1, -thick),
                    P(1, 1, -thick), P(1, 0, -thick)];
      const pos = [];
      for (const p of top4) pos.push(...p);
      for (const p of bot4) pos.push(...p);
      const idx = [
        0, 1, 2, 0, 2, 3,           // top
        6, 5, 4, 7, 6, 4,           // bottom
        0, 4, 5, 0, 5, 1,           // side a-left to a-right
        2, 6, 7, 2, 7, 3,
        1, 5, 6, 1, 6, 2,
        3, 7, 4, 3, 4, 0,
      ];
      const normals = [];
      VertexData.ComputeNormals(pos, idx, normals);
      // Make sure the top face points up rather than into the deck.
      if (normals[1] < 0) {
        for (let i = 0; i < idx.length; i += 3) {
          const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
        }
        VertexData.ComputeNormals(pos, idx, normals);
      }
      const m = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = pos; vd.indices = idx; vd.normals = normals;
      vd.uvs = new Array((pos.length / 3) * 2).fill(0);
      vd.applyToMesh(m);
      m.position.set(cx, cy, cz);
      m.material = mat;
      return m;
    };

    // Elevated junctions: a square of deck, and a wall across every side
    // that no road leaves by. Two decks crossing at a right angle used to
    // run their parapets through each other's carriageway; now each stops
    // at this square and the square closes the corner.
    const boxSlab = (name, mat, cx, cy, cz, w, h, d) => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      b.position.set(cx, cy, cz);
      b.material = mat;
      return b;
    };
    for (const n of net.nodes) {
      const box = n.bridgeBox;
      if (!box) continue;
      const { hX, hZ } = box;
      boxSlab('dk', deckMat, n.x, n.y - 0.58, n.z, hZ * 2, 1.0, hX * 2);
      const T = 0.55;
      // Slots are +x, -x, +z, -z; a wall spans the full box so the walls
      // meet each other at the corners without a seam.
      const walls = [
        [0, hZ + T / 2, 0, T, hX * 2 + T],
        [1, -hZ - T / 2, 0, T, hX * 2 + T],
        [2, 0, hX + T / 2, hZ * 2 + T, T],
        [3, 0, -hX - T / 2, hZ * 2 + T, T],
      ];
      for (const [slot, ox, oz, w, d] of walls) {
        if (!box.open[slot]) continue;
        boxSlab('prp', concrete, n.x + ox, n.y + 0.86, n.z + oz, w, 1.05, d);
        boxSlab('el', glow.blue, n.x + ox, n.y + 1.45, n.z + oz, w * 0.99, 0.16, d * 0.99);
      }
    }

    for (const e of net.edges) {
      if (e.cls !== 'express' && e.cls !== 'ramp') continue;
      const c = CLASSES[e.cls];
      const own = halfWidth(e.cls);
      const wA = e.hwA || own, wB = e.hwB || own;
      const lane = Math.min(wA, wB);          // the carriageway itself

      // Everything that stands up off a deck stops at the edge of whatever
      // junction box is at each end - a street junction below, or the
      // square of deck an elevated junction owns.
      const iA = e.padA, iB = e.padB;
      // The deck itself only stops short at a STREET junction, where the
      // road slab is the surface and a rising deck under it is just a lip
      // to catch a wheel on. In the air it runs right into the box.
      slab(e, 'dk', deckMat, wA, -wA, wB, -wB, -0.08, 1.0,
           e.joinA ? iA * 0.5 : 0, e.joinB ? iB * 0.5 : 0);
      for (const sd of [1, -1]) {
        // Parapet and its neon, both following the flare.
        slab(e, 'prp', concrete, sd * (wA + 0.55), sd * wA,
             sd * (wB + 0.55), sd * wB, 0.86, 1.05, iA, iB);
        slab(e, 'el', e.cls === 'ramp' ? glow.amber : glow.blue,
             sd * (wA + 0.55), sd * (wA + 0.33), sd * (wB + 0.55), sd * (wB + 0.33),
             0.95, 0.14, iA, iB);
        // Carriageway edge line, hugging the deck edge.
        slab(e, 'el', e.cls === 'ramp' ? glow.amber : glow.cyan,
             sd * (wA - 0.15), sd * (wA - 0.33), sd * (wB - 0.15), sd * (wB - 0.33),
             0.02, 0.06, iA * 0.4, iB * 0.4);
      }
      slab(e, 'ml', glow.white, 0.08, -0.08, 0.08, -0.08, 0.02, 0.055,
           iA * 0.4, iB * 0.4);
      // Lane dividers, on the carriageway's own constant width.
      for (let k = 1; k < c.lanesPer; k++) {
        for (const sd of [1, -1]) {
          const off = sd * Math.min(0.9 + k * c.laneW, lane - 0.6);
          for (let t = 4; t < e.len - 4; t += 9) {
            const f0 = t / e.len, f1 = (t + 2.6) / e.len;
            const seg = { axis: e.axis, len: 2.6,
              a: { x: e.a.x + (e.b.x - e.a.x) * f0, y: e.a.y + (e.b.y - e.a.y) * f0,
                   z: e.a.z + (e.b.z - e.a.z) * f0 },
              b: { x: e.a.x + (e.b.x - e.a.x) * f1, y: e.a.y + (e.b.y - e.a.y) * f1,
                   z: e.a.z + (e.b.z - e.a.z) * f1 } };
            slab(seg, 'dd', glow.amber, off + 0.1, off - 0.1, off + 0.1, off - 0.1,
                 0.02, 0.05);
          }
        }
      }

      // Piers. Out over the water a single column reads better than the
      // straddle frames a road over a street needs, and there is nothing
      // underneath to straddle.
      const step = Math.max(28, e.len / Math.max(1, Math.round(e.len / 46)));
      for (let t = step * 0.5; t < e.len - 4; t += step) {
        const f = t / e.len;
        const px = e.a.x + (e.b.x - e.a.x) * f;
        const pz = e.a.z + (e.b.z - e.a.z) * f;
        const py = e.a.y + (e.b.y - e.a.y) * f;
        if (py < 3.2) continue;
        const col = MeshBuilder.CreateBox('pier',
          { width: 3.2, height: py - 1.9, depth: 3.2 }, scene);
        col.position.set(px, (py - 1.9) / 2 - 0.5, pz);
        col.material = concrete;
        const cap = MeshBuilder.CreateBox('pier', {
          width: e.axis === 0 ? 3.4 : (wA + wB) * 0.9,
          height: 0.9,
          depth: e.axis === 0 ? (wA + wB) * 0.9 : 3.4,
        }, scene);
        cap.position.set(px, py - 1.5, pz);
        cap.material = concrete;
      }
    }
  }

  // ---- districts: the city has quarters, and they look like it --------
  // Every block belongs to one, and a district decides what gets built on
  // it - how tall, how dense, what the windows are lit with, how much neon
  // it wears and what stands between the buildings. Borders wobble so the
  // map does not read as four quadrants drawn with a ruler.
  const winTex = windowTexture(scene, rand);
  const litWindows = (warm, density) => {
    const dt = new DynamicTexture('win' + warm + density, { width: 256, height: 512 }, scene, true);
    const x = dt.getContext();
    x.fillStyle = '#04040a'; x.fillRect(0, 0, 256, 512);
    for (let r = 0; r < 24; r++) for (let c = 0; c < 8; c++) {
      if (rand() > density) continue;
      x.fillStyle = rand() < warm ? '#ffd9a0' : '#9fd8ff';
      x.fillRect(c * 32 + 9, r * 21 + 5, 16, 11);
    }
    dt.update();
    return dt;
  };
  const towerFamily = (name, tex, tint, count) => {
    const out = [];
    for (let k = 0; k < count; k++) {
      const m = new PBRMaterial(name + k, scene);
      m.albedoColor = new Color3(0.016, 0.016, 0.03 + k * 0.004);
      m.metallic = 0.15; m.roughness = 0.75;
      m.emissiveTexture = tex;
      m.emissiveColor = new Color3(tint[0] + k * 0.05, tint[1] + k * 0.05, tint[2]);
      out.push(m);
    }
    return out;
  };
  const glassTex = litWindows(0.25, 0.5);     // cold, densely occupied
  const warmTex = litWindows(0.9, 0.3);       // homes, half the lights off
  const shedTex = litWindows(0.6, 0.06);      // sheds barely have windows
  const FAMILIES = {
    glass: towerFamily('twg', glassTex, [0.5, 0.58, 0.62], 4),
    strip: towerFamily('tws', winTex, [0.7, 0.45, 0.6], 3),
    warm:  towerFamily('tww', warmTex, [0.62, 0.46, 0.3], 3),
    shed:  towerFamily('twd', shedTex, [0.22, 0.24, 0.26], 2),
  };
  const DISTRICTS = {
    downtown:    { label: 'DOWNTOWN',   fam: 'glass', h: [30, 48], n: [2, 4], w: 0.36, sign: 0.40, prop: null },
    strip:       { label: 'THE STRIP',  fam: 'strip', h: [12, 16], n: [3, 5], w: 0.30, sign: 0.90, prop: null },
    residential: { label: 'THE TERRACES', fam: 'warm', h: [8, 9],  n: [3, 5], w: 0.28, sign: 0.05, prop: 'tree' },
    industrial:  { label: 'THE WORKS',  fam: 'shed',  h: [6, 6],   n: [2, 3], w: 0.46, sign: 0.04, prop: 'stack' },
    docks:       { label: 'THE DOCKS',  fam: 'shed',  h: [7, 7],   n: [2, 3], w: 0.44, sign: 0.08, prop: 'container' },
    park:        { label: 'THE PARK',   fam: 'warm',  h: [0, 0],   n: [0, 0], w: 0,    sign: 0,    prop: 'park' },
  };

  // Deterministic per-block hash, salted by the seed: the same city zones
  // the same way every time, and a different city zones differently.
  const zoneSalt = (seed % 977) * 0.173;
  const blockHash = (bi, bj) => {
    const h = Math.sin(bi * 127.1 + bj * 311.7 + zoneSalt) * 43758.5453;
    return h - Math.floor(h);
  };
  const centre = (GRID - 1) / 2;
  const zones = [];
  for (let bj = 0; bj < GRID - 1; bj++) {
    zones.push([]);
    for (let bi = 0; bi < GRID - 1; bi++) {
      const hsh = blockHash(bi, bj);
      const dc = Math.hypot(bi - centre + 0.5, bj - centre + 0.5) / centre;
      let z;
      if (dc < 0.34 + hsh * 0.12) z = 'downtown';
      else if (hsh < 0.07) z = 'park';
      else {
        // Quadrants, with a wobble on each border.
        const j = (blockHash(bj, bi) - 0.5) * 1.6;
        const east = bi + j > centre - 0.5, north = bj + j > centre - 0.5;
        z = east ? (north ? 'strip' : 'docks') : (north ? 'residential' : 'industrial');
      }
      zones[bj].push(z);
    }
  }
  // Which district a point in the world is in - the briefing uses it.
  const districtAt = (x, z) => {
    let bi = 0, bj = 0;
    while (bi < GRID - 2 && x > net.xs[bi + 1]) bi += 1;
    while (bj < GRID - 2 && z > net.zs[bj + 1]) bj += 1;
    const key = (zones[bj] && zones[bj][bi]) || 'downtown';
    return DISTRICTS[key].label;
  };

  const signMats = SIGN_WORDS.map((wd, i) => {
    const col = SIGN_COLS[i % SIGN_COLS.length];
    const m = new StandardMaterial('sm' + i, scene);
    m.emissiveTexture = signTexture(scene, wd, col);
    m.opacityTexture = m.emissiveTexture;
    m.disableLighting = true;
    return m;
  });
  let signCount = 0;

  // Props that give a quarter its character at street level.
  const foliage = new StandardMaterial('leaf', scene);
  foliage.emissiveColor = new Color3(0.06, 0.20, 0.10);
  foliage.disableLighting = true;
  const trunkMat = new StandardMaterial('trunk', scene);
  trunkMat.emissiveColor = new Color3(0.09, 0.07, 0.05);
  trunkMat.disableLighting = true;
  const grassMat = new StandardMaterial('grass', scene);
  grassMat.emissiveColor = new Color3(0.035, 0.10, 0.055);
  grassMat.disableLighting = true;
  const CRATE = [[0.55, 0.20, 0.16], [0.16, 0.38, 0.50], [0.50, 0.42, 0.14],
                 [0.18, 0.46, 0.28]].map(([r, g, b], k) => {
    const m = new StandardMaterial('crate' + k, scene);
    m.emissiveColor = new Color3(r * 0.45, g * 0.45, b * 0.45);
    m.disableLighting = true;
    return m;
  });
  const stackMat = new StandardMaterial('stack', scene);
  stackMat.emissiveColor = new Color3(0.10, 0.10, 0.12);
  stackMat.disableLighting = true;
  const tree = (px, pz, scale) => {
    const t = MeshBuilder.CreateBox('trunk', { width: 0.4, height: 2.4 * scale, depth: 0.4 }, scene);
    t.position.set(px, 1.2 * scale, pz);
    t.material = trunkMat;
    const c = MeshBuilder.CreateCylinder('leaf', {
      diameterTop: 0.2, diameterBottom: 3.4 * scale, height: 4.4 * scale, tessellation: 7,
    }, scene);
    c.position.set(px, 2.4 * scale + 2.2 * scale, pz);
    c.material = foliage;
  };

  // ---- blocks: buildings, some wearing signs --------------------------
  for (let bj = 0; bj < GRID - 1; bj++) {
    for (let bi = 0; bi < GRID - 1; bi++) {
      // Block interior bounds, inset from the widest surrounding road.
      const pad = halfWidth('avenue') + 5;
      const x0 = net.xs[bi] + pad, x1 = net.xs[bi + 1] - pad;
      const z0 = net.zs[bj] + pad, z1 = net.zs[bj + 1] - pad;
      if (x1 - x0 < 10 || z1 - z0 < 10) continue;
      const bw = x1 - x0, bd = z1 - z0;
      const D = DISTRICTS[zones[bj][bi]];
      const mats = FAMILIES[D.fam];

      if (D.prop === 'park') {
        const lawn = MeshBuilder.CreateBox('grass',
          { width: bw, height: 0.1, depth: bd }, scene);
        lawn.position.set((x0 + x1) / 2, 0.08, (z0 + z1) / 2);
        lawn.material = grassMat;
        for (let k = 0; k < 7; k++) {
          tree(x0 + 2 + rand() * (bw - 4), z0 + 2 + rand() * (bd - 4), 0.9 + rand() * 0.5);
        }
        continue;
      }

      const n = D.n[0] + (rand() * (D.n[1] - D.n[0] + 1) | 0);
      for (let k = 0; k < n; k++) {
        const w = bw * (D.w + rand() * 0.22), d = bd * (D.w + rand() * 0.22);
        const h = D.h[0] + rand() * Math.max(1, D.h[1] - D.h[0]) + rand() * D.h[0] * 0.5;
        const px = x0 + w / 2 + rand() * Math.max(0, bw - w);
        const pz = z0 + d / 2 + rand() * Math.max(0, bd - d);
        const b = MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene);
        b.position.set(px, h / 2, pz);
        b.material = mats[(rand() * mats.length) | 0];
        mirror.renderList.push(b);
        // A chimney on the works, containers on the docks, trees on the
        // terraces: one thing per quarter that you notice from the road.
        if (D.prop === 'stack' && k === 0) {
          const st = MeshBuilder.CreateBox('stack',
            { width: 1.6, height: h + 16, depth: 1.6 }, scene);
          st.position.set(px + w * 0.3, (h + 16) / 2, pz + d * 0.3);
          st.material = stackMat;
          const tip = MeshBuilder.CreateBox('el', { width: 2, height: 0.5, depth: 2 }, scene);
          tip.position.set(px + w * 0.3, h + 16.2, pz + d * 0.3);
          tip.material = glow.pink;
        } else if (D.prop === 'container' && k < 2) {
          for (let c2 = 0; c2 < 3 + (rand() * 3 | 0); c2++) {
            const cw = 5.4, ch = 2.4, cd = 2.4;
            const box = MeshBuilder.CreateBox('crate',
              { width: cw, height: ch, depth: cd }, scene);
            box.position.set(x0 + 3 + rand() * Math.max(1, bw - 8),
                             ch / 2 + (rand() < 0.4 ? ch : 0),
                             z0 + 3 + rand() * Math.max(1, bd - 8));
            box.material = CRATE[(rand() * CRATE.length) | 0];
          }
        } else if (D.prop === 'tree' && k === 0) {
          for (let t2 = 0; t2 < 3; t2++) {
            tree(x0 + 1.5 + rand() * Math.max(1, bw - 3),
                 z0 + 1.5 + rand() * Math.max(1, bd - 3), 0.7 + rand() * 0.4);
          }
        }
        // Some buildings wear a neon sign facing the nearest road.
        if (rand() < D.sign && signCount < 60) {
          signCount++;
          const sw = Math.min(14, w * 0.9);
          const side = rand() < 0.5 ? -1 : 1;
          const sy = Math.min(h - 2, 7 + rand() * 8);
          const face = rand() < 0.5;
          const sx = face ? px : px + side * (w / 2 + 0.3);
          const sz = face ? pz + side * (d / 2 + 0.3) : pz;
          const sry = face ? (side < 0 ? Math.PI : 0)
                           : (side < 0 ? -Math.PI / 2 : Math.PI / 2);
          const mat = signMats[(rand() * signMats.length) | 0];
          for (const sgm of twoSidedSign(scene, 'sg',
                { width: sw, height: sw * 0.25 }, sx, sy, sz, sry, mat)) {
            mirror.renderList.push(sgm);
          }
        }
      }
    }
  }
  const towerMats = FAMILIES.glass;   // the island borrows downtown's look

  // ---- palms along the ring road --------------------------------------
  const palmTex = (() => {
    const dt = new DynamicTexture('palm', { width: 256, height: 512 }, scene, true);
    const x = dt.getContext();
    x.clearRect(0, 0, 256, 512);
    x.strokeStyle = '#0a0512'; x.lineWidth = 14; x.lineCap = 'round';
    x.beginPath(); x.moveTo(120, 512); x.quadraticCurveTo(150, 300, 138, 170); x.stroke();
    x.lineWidth = 9;
    for (let i = 0; i < 7; i++) {
      const a = -2.6 + i * 0.75;
      x.beginPath(); x.moveTo(138, 170);
      x.quadraticCurveTo(138 + Math.cos(a) * 70, 140 + Math.sin(a) * 50,
                         138 + Math.cos(a) * 120, 178 + Math.sin(a) * 85);
      x.stroke();
    }
    dt.update(); dt.hasAlpha = true;
    return dt;
  })();
  const palmMat = new StandardMaterial('palmM', scene);
  palmMat.emissiveTexture = palmTex; palmMat.opacityTexture = palmTex;
  palmMat.emissiveColor = new Color3(0.35, 0.9, 0.85);
  palmMat.disableLighting = true; palmMat.backFaceCulling = false;
  for (const e of net.edges) {
    if (e.cls !== 'highway') continue;
    const hw = halfWidth('highway');
    for (let s = 14; s < e.len - 8; s += 26) {
      // Outboard side only (away from the city interior).
      const sd = (e.axis === 0)
        ? (e.a.z < ext.z / 2 ? -1 : 1)
        : (e.a.x < ext.x / 2 ? -1 : 1);
      const pl = MeshBuilder.CreatePlane('pal', { width: 8, height: 16 }, scene);
      pl.position.set(
        e.axis === 0 ? e.a.x + s : e.a.x + sd * (hw + 4),
        8,
        e.axis === 0 ? e.a.z + sd * (hw + 4) : e.a.z + s);
      pl.billboardMode = 2;                    // BILLBOARDMODE_Y
      pl.material = palmMat;
    }
  }

  // Scrolling foam bands, handed back so the tick can animate them.
  const surf = [];

  // ---- the coast: sand and sea wrap the whole ring ---------------------
  // The city was on the coast all along; you only notice from the highway.
  {
    // Sand and sea between them cover most of the screen out here, and a
    // full PBR shade on every one of those pixels is what the beach could
    // not afford. Flat lit surfaces at this distance look the same and cost
    // a fraction. No mirror on the sea either - a second half-screen of
    // planar reflection was most of the old frame budget.
    const sandMat = new StandardMaterial('sand', scene);
    sandMat.diffuseColor = new Color3(0.55, 0.44, 0.27);
    sandMat.specularColor = new Color3(0.05, 0.05, 0.05);
    sandMat.emissiveColor = new Color3(0.14, 0.11, 0.06);
    const seaMat = new StandardMaterial('sea', scene);
    seaMat.diffuseColor = new Color3(0.03, 0.14, 0.30);
    seaMat.specularColor = new Color3(0.18, 0.26, 0.34);
    seaMat.specularPower = 48;
    seaMat.emissiveColor = new Color3(0.04, 0.13, 0.24);
    const hwHalf = halfWidth('highway');
    const sandW = 34, seaW = 620;
    const rim = hwHalf + 2.2;
    const strips = [
      // [cx, cz, w, d] sand then sea on each of the four sides
      [ext.x / 2, -rim - sandW / 2, ext.x + (rim + sandW) * 2, sandW],
      [ext.x / 2, ext.z + rim + sandW / 2, ext.x + (rim + sandW) * 2, sandW],
      [-rim - sandW / 2, ext.z / 2, sandW, ext.z],
      [ext.x + rim + sandW / 2, ext.z / 2, sandW, ext.z],
    ];
    for (const [cx, cz, w, d] of strips) {
      const s = MeshBuilder.CreateBox('sand', { width: w, height: 0.12, depth: d }, scene);
      s.position.set(cx, 0.05, cz);
      s.material = sandMat;
    }
    const seaRim = rim + sandW;
    const seas = [
      [ext.x / 2, -seaRim - seaW / 2, ext.x + (seaRim + seaW) * 2, seaW],
      [ext.x / 2, ext.z + seaRim + seaW / 2, ext.x + (seaRim + seaW) * 2, seaW],
      [-seaRim - seaW / 2, ext.z / 2, seaW, ext.z + seaRim * 2],
      [ext.x + seaRim + seaW / 2, ext.z / 2, seaW, ext.z + seaRim * 2],
    ];
    for (const [cx, cz, w, d] of seas) {
      const s = MeshBuilder.CreateBox('sea', { width: w, height: 0.06, depth: d }, scene);
      s.position.set(cx, -0.02, cz);
      s.material = seaMat;
    }

    // ---- surf: two bands of foam marching at the sand -----------------
    // The waves are a scroll, not a simulation. Bands of foam painted on a
    // texture and slid shoreward read as breaking surf from a car doing a
    // hundred, and they cost one uniform a frame instead of a mesh rebuild.
    const foamTex = (seed, count, thick, vertical) => {
      const dt = new DynamicTexture('foam' + seed, { width: 256, height: 256 }, scene, true);
      const x = dt.getContext();
      x.clearRect(0, 0, 256, 256);
      x.lineCap = 'round';
      for (let k = 0; k < count; k++) {
        const p0 = (k + 0.5) / count * 256;
        const a = 0.55 + ((k * 37 + seed * 13) % 10) / 10 * 0.45;
        x.strokeStyle = 'rgba(255, 255, 255, ' + a.toFixed(2) + ')';
        x.lineWidth = thick * (0.6 + ((k * 17 + seed) % 7) / 7);
        x.beginPath();
        for (let q = 0; q <= 256; q += 8) {
          const t = q / 256 * Math.PI * 2;
          const off = Math.sin(t * 3 + k * 1.7 + seed) * 7 + Math.sin(t * 7.3 + k * 0.9) * 3.5;
          const px = vertical ? p0 + off : q;
          const py = vertical ? q : p0 + off;
          if (q === 0) x.moveTo(px, py); else x.lineTo(px, py);
        }
        x.stroke();
      }
      dt.update();
      dt.hasAlpha = true;
      return dt;
    };
    // A ground plane, not a box: its UVs are defined - u along x, v along z -
    // so the foam lines can be made to run along the shore rather than
    // across it, whichever way this stretch of coast happens to face.
    const surfBand = (cx, cz, w, d, alongX, seed, count, thick, speed, tint) => {
      const tex = foamTex(seed, count, thick, !alongX);
      tex.uScale = alongX ? Math.max(2, Math.round(w / 110)) : 1;
      tex.vScale = alongX ? 1 : Math.max(2, Math.round(d / 110));
      const m = new StandardMaterial('surf' + seed, scene);
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.diffuseColor = new Color3(0, 0, 0);
      m.specularColor = new Color3(0, 0, 0);
      m.emissiveColor = tint;
      m.disableLighting = true;
      const q = MeshBuilder.CreateGround('surf', { width: w, height: d }, scene);
      q.position.set(cx, 0.07, cz);
      q.material = m;
      // Bands march shorewards: across the strip, which is v for a shore
      // running along x and u for one running along z.
      surf.push({ tex, alongX, speed });
      return q;
    };
    // The waterline is where the sand ends. Foam breaks right on it; the
    // swell rolls in from twenty-odd metres further out.
    const shore = rim + sandW;
    for (const [side, sz] of [[-1, -shore], [1, ext.z + shore]]) {
      const w = ext.x + shore * 2 + 40;
      surfBand(ext.x / 2, sz + side * 5, w, 22, true, 1 + side, 4, 13, 0.06,
               new Color3(2.0, 2.1, 2.15));
      surfBand(ext.x / 2, sz + side * 38, w, 46, true, 3 + side, 3, 7, 0.024,
               new Color3(0.7, 1.05, 1.2));
    }
    for (const [side, sx] of [[-1, -shore], [1, ext.x + shore]]) {
      const d = ext.z + shore * 2 + 40;
      surfBand(sx + side * 5, ext.z / 2, 22, d, false, 5 + side, 4, 13, 0.06,
               new Color3(2.0, 2.1, 2.15));
      surfBand(sx + side * 38, ext.z / 2, 46, d, false, 7 + side, 3, 7, 0.024,
               new Color3(0.7, 1.05, 1.2));
    }

    // ---- the people who came for the beach, not the chase -------------
    const towelCols = [[1.5, 0.35, 0.45], [0.35, 1.2, 1.5], [1.5, 1.2, 0.3],
                       [1.3, 0.5, 1.4], [0.4, 1.4, 0.7]];
    const towelMats = towelCols.map(([r, g, b], k) => {
      const m = new StandardMaterial('towel' + k, scene);
      m.emissiveColor = new Color3(r * 0.4, g * 0.4, b * 0.4);
      m.diffuseColor = new Color3(r * 0.3, g * 0.3, b * 0.3);
      return m;
    });
    const skinMat = new StandardMaterial('skin', scene);
    skinMat.diffuseColor = new Color3(0.75, 0.58, 0.42);
    skinMat.emissiveColor = new Color3(0.26, 0.19, 0.13);
    const poleM = new StandardMaterial('parapole', scene);
    poleM.diffuseColor = new Color3(0.5, 0.5, 0.52);
    poleM.emissiveColor = new Color3(0.12, 0.12, 0.14);
    // Sun loungers, towels and parasols, scattered down the whole shore.
    const sunbather = (px, pz, alongX, k) => {
      const towel = MeshBuilder.CreateBox('twl', {
        width: alongX ? 2.1 : 1.0, height: 0.06, depth: alongX ? 1.0 : 2.1,
      }, scene);
      towel.position.set(px, 0.14, pz);
      towel.material = towelMats[k % towelMats.length];
      const body = MeshBuilder.CreateBox('bod', {
        width: alongX ? 1.55 : 0.42, height: 0.26, depth: alongX ? 0.42 : 1.55,
      }, scene);
      body.position.set(px, 0.3, pz);
      body.material = skinMat;
      const head = MeshBuilder.CreateBox('bod', { width: 0.26, height: 0.24, depth: 0.26 }, scene);
      head.position.set(px + (alongX ? 0.95 : 0), 0.3, pz + (alongX ? 0 : 0.95));
      head.material = skinMat;
      if (k % 2 === 0) {
        const pole = MeshBuilder.CreateBox('parapole', {
          width: 0.09, height: 2.2, depth: 0.09,
        }, scene);
        pole.position.set(px - (alongX ? 1.5 : 0), 1.1, pz - (alongX ? 0 : 1.5));
        pole.material = poleM;
        const shade = MeshBuilder.CreateCylinder('shade', {
          diameterTop: 0.12, diameterBottom: 3.6, height: 0.75, tessellation: 8,
        }, scene);
        shade.position.set(px - (alongX ? 1.5 : 0), 2.3, pz - (alongX ? 0 : 1.5));
        shade.material = towelMats[(k + 2) % towelMats.length];
      }
    };
    // People come to a beach in twos and threes, not evenly spaced, so the
    // shore gets clusters with quiet stretches between them.
    let bather = 0;
    const sandMid = rim + sandW * 0.5;
    const cluster = (cx, cz, alongX) => {
      const n = 2 + (rand() * 3 | 0);
      for (let k = 0; k < n; k++) {
        const a = (rand() - 0.5) * 13, b = (rand() - 0.5) * 11;
        sunbather(cx + (alongX ? a : b), cz + (alongX ? b : a), alongX, bather++);
      }
    };
    for (const cz0 of [-sandMid, ext.z + sandMid]) {
      for (let x = 24; x < ext.x - 24; x += 34 + rand() * 40) {
        cluster(x, cz0 + (rand() - 0.5) * sandW * 0.3, true);
      }
    }
    for (const cx0 of [-sandMid, ext.x + sandMid]) {
      for (let z = 24; z < ext.z - 24; z += 34 + rand() * 40) {
        cluster(cx0 + (rand() - 0.5) * sandW * 0.3, z, false);
      }
    }
  }

  // ---- the island: the city you can see across the water ---------------
  // Small, dense and bright, so from the beach road it reads as a skyline
  // out at sea rather than as scenery. Its towers are never distance-culled
  // for exactly that reason: the lights across the water are the point.
  {
    const IX0 = net.IX0, IZ0 = net.IZ0, IP = net.IPITCH, IG = net.IGRID;
    const x0 = IX0 - 46, x1 = IX0 + (IG - 1) * IP + 46;
    const z0 = IZ0 - 46, z1 = IZ0 + (IG - 1) * IP + 46;
    const rockMat = new StandardMaterial('rock', scene);
    rockMat.diffuseColor = new Color3(0.30, 0.27, 0.22);
    rockMat.specularColor = new Color3(0.04, 0.04, 0.05);
    rockMat.emissiveColor = new Color3(0.14, 0.12, 0.10);
    // Lights across water cut through haze; the land they stand on does not.
    // So the island's windows, beacons and shoreline neon opt out of the
    // fog and the rock does not - which is exactly how a city looks from
    // the far side of a bay at night.
    const isleTowers = [0, 1, 2].map((k) => {
      const m = new PBRMaterial('itw' + k, scene);
      m.albedoColor = new Color3(0.02, 0.02, 0.035);
      m.metallic = 0.15; m.roughness = 0.7;
      m.emissiveTexture = winTex;
      m.emissiveColor = new Color3(1.5 + k * 0.15, 1.35 + k * 0.12, 1.05);
      m.fogEnabled = false;
      return m;
    });
    const isleNeon = (r, g, b) => {
      const m = new StandardMaterial('ineon', scene);
      m.emissiveColor = new Color3(r, g, b);
      m.disableLighting = true;
      m.fogEnabled = false;
      return m;
    };
    const isleBeacon = isleNeon(2.2, 0.45, 1.5);
    const isleShore = isleNeon(0.35, 1.5, 2.1);
    const land = MeshBuilder.CreateBox('iland', {
      width: x1 - x0, height: 0.34, depth: z1 - z0,
    }, scene);
    land.position.set((x0 + x1) / 2, -0.09, (z0 + z1) / 2);
    land.material = rockMat;
    // A shelf of sand around it so it meets the water, not a cliff.
    const beachMat = new StandardMaterial('isand', scene);
    beachMat.diffuseColor = new Color3(0.5, 0.41, 0.26);
    beachMat.emissiveColor = new Color3(0.13, 0.1, 0.06);
    const shelf = MeshBuilder.CreateBox('iland', {
      width: x1 - x0 + 30, height: 0.2, depth: z1 - z0 + 30,
    }, scene);
    shelf.position.set((x0 + x1) / 2, -0.14, (z0 + z1) / 2);
    shelf.material = beachMat;

    // Towers in the island's four blocks: taller and closer together than
    // the mainland's, so the silhouette carries across the water.
    for (let bj = 0; bj < IG - 1; bj++) {
      for (let bi = 0; bi < IG - 1; bi++) {
        const pad = halfWidth('avenue') + 4;
        const bx0 = IX0 + bi * IP + pad, bx1 = IX0 + (bi + 1) * IP - pad;
        const bz0 = IZ0 + bj * IP + pad, bz1 = IZ0 + (bj + 1) * IP - pad;
        if (bx1 - bx0 < 8 || bz1 - bz0 < 8) continue;
        const n = 2 + (rand() * 2 | 0);
        for (let k = 0; k < n; k++) {
          const w = (bx1 - bx0) * (0.4 + rand() * 0.28);
          const d = (bz1 - bz0) * (0.4 + rand() * 0.28);
          const h = 34 + rand() * 58;
          const b = MeshBuilder.CreateBox('ib', { width: w, height: h, depth: d }, scene);
          b.position.set(bx0 + w / 2 + rand() * (bx1 - bx0 - w), h / 2,
                         bz0 + d / 2 + rand() * (bz1 - bz0 - d));
          b.material = isleTowers[(rand() * isleTowers.length) | 0];
        }
      }
    }
    // A beacon on the tallest corner, and neon along the shoreline, so the
    // island is unmistakable from the mainland at night.
    for (const [bx, bz] of [[x0 + 8, z0 + 8], [x1 - 8, z0 + 8],
                            [x0 + 8, z1 - 8], [x1 - 8, z1 - 8]]) {
      const mast = MeshBuilder.CreateBox('ib', { width: 1.2, height: 46, depth: 1.2 }, scene);
      mast.position.set(bx, 23, bz);
      mast.material = isleTowers[0];
      const lamp = MeshBuilder.CreateBox('ib', { width: 4.2, height: 4.2, depth: 4.2 }, scene);
      lamp.position.set(bx, 48, bz);
      lamp.material = isleBeacon;
    }
    for (const [cx, cz, w, d] of [[(x0 + x1) / 2, z0, x1 - x0, 0.5],
                                  [(x0 + x1) / 2, z1, x1 - x0, 0.5],
                                  [x0, (z0 + z1) / 2, 0.5, z1 - z0],
                                  [x1, (z0 + z1) / 2, 0.5, z1 - z0]]) {
      const line = MeshBuilder.CreateBox('ib', { width: w, height: 0.45, depth: d }, scene);
      line.position.set(cx, 0.28, cz);
      line.material = isleShore;
    }
  }

  // ---- gantry signs pointing at the coast highway ----------------------
  {
    // The arrow points UP, not sideways. A sideways arrow has to be
    // mirrored on the back face to keep pointing at the same place, and it
    // was never right anyway: the gantry sits on the approach to the ring,
    // so from either side the coast road is straight on.
    const signTex = (() => {
      const dt = new DynamicTexture('hwsg', { width: 512, height: 128 }, scene, true);
      const x = dt.getContext();
      x.fillStyle = '#0a2a8a'; x.fillRect(0, 0, 512, 128);
      x.strokeStyle = '#e8f2ff'; x.lineWidth = 5; x.strokeRect(6, 6, 500, 116);
      x.fillStyle = '#e8f2ff';
      x.font = '800 56px system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('COAST HWY \u2191', 256, 64);
      dt.update();
      return dt;
    })();
    const gantryMat = new StandardMaterial('gant', scene);
    gantryMat.emissiveTexture = signTex;
    gantryMat.disableLighting = true;

    const postMat = new StandardMaterial('gpost', scene);
    postMat.emissiveColor = new Color3(0.12, 0.13, 0.18);
    postMat.disableLighting = true;
    for (const e of net.edges) {
      if (e.cls !== 'avenue') continue;
      // An avenue edge touching the ring: sign it, near the ring end.
      const aRing = e.a.i === 0 || e.a.j === 0 || e.a.i === GRID - 1 || e.a.j === GRID - 1;
      const bRing = e.b.i === 0 || e.b.j === 0 || e.b.i === GRID - 1 || e.b.j === GRID - 1;
      if (!aRing && !bRing) continue;
      const towardB = bRing;
      const s = towardB ? e.len * 0.72 : e.len * 0.28;
      const gx = e.axis === 0 ? e.a.x + s : e.a.x;
      const gz = e.axis === 0 ? e.a.z : e.a.z + s;
      const hw = halfWidth('avenue');
      for (const sd of [-1, 1]) {
        const post = MeshBuilder.CreateBox('gp', { width: 0.3, height: 6.4, depth: 0.3 }, scene);
        post.position.set(
          e.axis === 0 ? gx : gx + sd * (hw + 0.8), 3.2,
          e.axis === 0 ? gz + sd * (hw + 0.8) : gz);
        post.material = postMat;
      }
      const pry = e.axis === 0
        ? (towardB ? -Math.PI / 2 : Math.PI / 2)
        : (towardB ? Math.PI : 0);
      twoSidedSign(scene, 'gpan', { width: 11, height: 2.6 },
                   gx, 6.2, gz, pry, gantryMat);
    }
  }

  // ---- garages: the forecourt at the end of each service spur ----------
  // The network put a short road here; this dresses it. Canopy on posts,
  // two pumps, a hut with an attendant in it, and a big green sign you can
  // see from the junction so you know which turning to indicate for.
  const stations = [];
  {
    const gasSign = new StandardMaterial('gas', scene);
    gasSign.emissiveTexture = signTexture(scene, 'GAS', '#4dff88');
    gasSign.opacityTexture = gasSign.emissiveTexture;
    gasSign.disableLighting = true; gasSign.backFaceCulling = false;
    const padMat = new StandardMaterial('pad', scene);
    padMat.emissiveColor = new Color3(0.10, 0.55, 0.30);
    padMat.disableLighting = true;
    const pumpMat = new PBRMaterial('pump', scene);
    pumpMat.albedoColor = new Color3(0.05, 0.3, 0.15);
    pumpMat.metallic = 0.3; pumpMat.roughness = 0.5;
    pumpMat.emissiveColor = new Color3(0.05, 0.4, 0.18);
    const hutMat = new PBRMaterial('hut', scene);
    hutMat.albedoColor = new Color3(0.09, 0.11, 0.13);
    hutMat.metallic = 0.2; hutMat.roughness = 0.7;
    hutMat.emissiveColor = new Color3(0.06, 0.09, 0.08);
    const canopyMat = new StandardMaterial('canopy', scene);
    canopyMat.emissiveColor = new Color3(0.14, 0.30, 0.22);
    canopyMat.disableLighting = true;
    const stripMat = neonMat(scene, 0.25, 1.6, 0.8, 'gasneon');

    for (const f of net.forecourts) {
      // Along the spur, and across it.
      const ax = f.axis === 0 ? 1 : 0, az = f.axis === 0 ? 0 : 1;
      const px = f.x + f.dx * 5, pz = f.z + f.dz * 5;   // just past the dead end
      const W = 22, D = 17;
      const pad = MeshBuilder.CreateBox('pad', {
        width: f.axis === 0 ? D : W, height: 0.14, depth: f.axis === 0 ? W : D,
      }, scene);
      pad.position.set(px, 0.07, pz);
      pad.material = padMat;
      // Neon rim so it reads as somewhere to go, not a car park.
      for (const sd of [-1, 1]) {
        const line = MeshBuilder.CreateBox('el', {
          width: f.axis === 0 ? D : W, height: 0.07, depth: f.axis === 0 ? W : D,
        }, scene);
        line.scaling.set(1, 1, 1);
        line.position.set(px + ax * sd * (f.axis === 0 ? 0 : W / 2),
                          0.15, pz + az * sd * (f.axis === 0 ? 0 : W / 2));
        line.material = stripMat;
        line.scaling.x = f.axis === 0 ? 1 : 0.02;
        line.scaling.z = f.axis === 0 ? 0.02 : 1;
      }
      // Pumps either side of where the car stops.
      const sx = f.x - f.dx * 4, sz = f.z - f.dz * 4;      // the stopping spot
      for (const o of [-4.6, 4.6]) {
        const pump = MeshBuilder.CreateBox('pump',
          { width: 0.8, height: 1.5, depth: 0.6 }, scene);
        pump.position.set(sx + ax * o, 0.75, sz + az * o);
        pump.material = pumpMat;
        const cap = MeshBuilder.CreateBox('el',
          { width: 0.9, height: 0.1, depth: 0.7 }, scene);
        cap.position.set(sx + ax * o, 1.56, sz + az * o);
        cap.material = stripMat;
      }
      // Canopy on four posts, over the pumps.
      const roof = MeshBuilder.CreateBox('gpan', {
        width: f.axis === 0 ? 13 : 15, height: 0.5, depth: f.axis === 0 ? 15 : 13,
      }, scene);
      roof.position.set(sx, 5.4, sz);
      roof.material = canopyMat;
      for (const oa of [-6, 6]) for (const ob of [-5.5, 5.5]) {
        const post = MeshBuilder.CreateBox('gp',
          { width: 0.4, height: 5.2, depth: 0.4 }, scene);
        post.position.set(sx + ax * oa + f.dx * ob, 2.6, sz + az * oa + f.dz * ob);
        post.material = hutMat;
      }
      // The hut, at the back.
      const hut = MeshBuilder.CreateBox('b', {
        width: f.axis === 0 ? 6 : 7, height: 3.4, depth: f.axis === 0 ? 7 : 6,
      }, scene);
      hut.position.set(px + f.dx * 4, 1.7, pz + f.dz * 4);
      hut.material = hutMat;
      // The sign, on the junction side so you can see it coming.
      const sg = MeshBuilder.CreatePlane('gassg', { width: 9, height: 2.3 }, scene);
      sg.position.set(f.node.x - f.dx * 12, 7.2, f.node.z - f.dz * 12);
      sg.billboardMode = 2;
      sg.material = gasSign;
      stations.push({ x: sx, z: sz, node: f.node, edge: f.edge,
                      dx: f.dx, dz: f.dz, axis: f.axis, ax, az });
    }
  }

  // ---- roadworks: a coned-off kerb lane on two avenues -----------------
  // Traffic threads round them; drive through the cones yourself and it is
  // loud, slow and embarrassing - which is roughly the real experience.
  const roadworks = [];
  const coneMat = new StandardMaterial('cone', scene);
  coneMat.emissiveColor = new Color3(1.5, 0.5, 0.1);
  coneMat.disableLighting = true;
  const barrierMat = new StandardMaterial('barr', scene);
  barrierMat.emissiveColor = new Color3(1.2, 0.9, 0.15);
  barrierMat.disableLighting = true;
  const aves = net.edges.filter(e => e.cls === 'avenue' && e.len > 50);
  for (const frac of [0.3, 0.7]) {
    const e = aves[(aves.length * frac) | 0];
    if (!e) continue;
    const lane = CLASSES.avenue.lanesPer - 1;      // the kerb lane
    const s0 = e.len * 0.4, s1 = s0 + 16;
    for (let s = s0; s <= s1; s += 2.2) {
      const cp = lanePos(e, 1, lane, s);
      const cone = MeshBuilder.CreateCylinder('cone', { diameterTop: 0.06,
        diameterBottom: 0.4, height: 0.7, tessellation: 8 }, scene);
      cone.position.set(cp.x, 0.35, cp.z);
      cone.material = coneMat;
    }
    const bp = lanePos(e, 1, lane, s0 - 1.6);
    const bar = MeshBuilder.CreateBox('barr', {
      width: e.axis === 0 ? 0.25 : 2.6, height: 1.0,
      depth: e.axis === 0 ? 2.6 : 0.25 }, scene);
    bar.position.set(bp.x, 0.5, bp.z);
    bar.material = barrierMat;
    roadworks.push({ e, dir: 1, lane, s0: s0 - 6, s1: s1 + 3 });
  }

  return { glow, stations, roadworks, surf, districtAt, zones };
}
