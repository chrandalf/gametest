// The 3D city, generated from the road network. Nothing here is data the
// game reasons about - it is the network made visible: carriageways, lane
// paint, neon edging, buildings filling the blocks, signs, street lights.
'use strict';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
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

export function buildCity(scene, net, mirror) {
  const rand = mulberry(19860508);          // Turbo Esprit's release spring
  const glow = {
    cyan: neonMat(scene, 0.15, 1.05, 1.5, 'cyan'),
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
    const hw = halfWidth(e.cls);
    const c = CLASSES[e.cls];
    const cx = (e.a.x + e.b.x) / 2, cz = (e.a.z + e.b.z) / 2;
    const w = e.axis === 0 ? e.len : hw * 2;
    const d = e.axis === 0 ? hw * 2 : e.len;
    const slab = MeshBuilder.CreateBox('rd', { width: w, height: 0.09, depth: d }, scene);
    slab.position.set(cx, 0.045, cz);
    slab.material = roadMat;
    mirror.renderList.push(slab);

    // Sidewalk slabs and kerb strips down both sides, full edge length.
    for (const sd of [-1, 1]) {
      const wk = MeshBuilder.CreateBox('wk', {
        width: e.axis === 0 ? e.len : 3,
        height: 0.16,
        depth: e.axis === 0 ? 3 : e.len,
      }, scene);
      wk.position.set(
        e.axis === 0 ? cx : cx + sd * (hw + 1.6),
        0.08,
        e.axis === 0 ? cz + sd * (hw + 1.6) : cz);
      wk.material = walkMat;
      const kb = MeshBuilder.CreateBox('kb', {
        width: e.axis === 0 ? e.len : 0.22,
        height: 0.2,
        depth: e.axis === 0 ? 0.22 : e.len,
      }, scene);
      kb.position.set(
        e.axis === 0 ? cx : cx + sd * (hw + 0.12),
        0.1,
        e.axis === 0 ? cz + sd * (hw + 0.12) : cz);
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
        line.material = e.cls === 'highway' ? glow.pink : glow.cyan;
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

  // ---- blocks: buildings, some wearing signs --------------------------
  const winTex = windowTexture(scene, rand);
  const towerMats = [];
  for (let k = 0; k < 4; k++) {
    const m = new PBRMaterial('tw' + k, scene);
    m.albedoColor = new Color3(0.016, 0.016, 0.03 + k * 0.004);
    m.metallic = 0.15; m.roughness = 0.75;
    m.emissiveTexture = winTex;
    m.emissiveColor = new Color3(0.55 + k * 0.05, 0.5 + k * 0.05, 0.45);
    towerMats.push(m);
  }
  const signMats = SIGN_WORDS.map((wd, i) => {
    const col = SIGN_COLS[i % SIGN_COLS.length];
    const m = new StandardMaterial('sm' + i, scene);
    m.emissiveTexture = signTexture(scene, wd, col);
    m.opacityTexture = m.emissiveTexture;
    m.disableLighting = true;
    m.backFaceCulling = false;
    return m;
  });
  let signCount = 0;

  const centre = (GRID - 1) / 2;
  for (let bj = 0; bj < GRID - 1; bj++) {
    for (let bi = 0; bi < GRID - 1; bi++) {
      // Block interior bounds, inset from the widest surrounding road.
      const pad = halfWidth('avenue') + 5;
      const x0 = net.xs[bi] + pad, x1 = net.xs[bi + 1] - pad;
      const z0 = net.zs[bj] + pad, z1 = net.zs[bj + 1] - pad;
      if (x1 - x0 < 10 || z1 - z0 < 10) continue;
      const bw = x1 - x0, bd = z1 - z0;
      // Downtown rises toward the middle; the rim stays low industrial.
      const dc = Math.hypot(bi - centre, bj - centre) / centre;
      const tall = dc < 0.45 ? 3 : dc < 0.8 ? 2 : 1;
      const n = 2 + (rand() * 2 | 0);
      for (let k = 0; k < n; k++) {
        const w = bw * (0.34 + rand() * 0.22), d = bd * (0.34 + rand() * 0.22);
        const h = tall === 3 ? 26 + rand() * 44 : tall === 2 ? 12 + rand() * 18 : 6 + rand() * 8;
        const px = x0 + w / 2 + rand() * (bw - w);
        const pz = z0 + d / 2 + rand() * (bd - d);
        const b = MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene);
        b.position.set(px, h / 2, pz);
        b.material = towerMats[(rand() * towerMats.length) | 0];
        mirror.renderList.push(b);
        // Some buildings wear a neon sign facing the nearest road.
        if (rand() < 0.33 && signCount < 40) {
          signCount++;
          const sw = Math.min(14, w * 0.9);
          const sign = MeshBuilder.CreatePlane('sg', { width: sw, height: sw * 0.25 }, scene);
          const side = rand() < 0.5 ? -1 : 1;
          if (rand() < 0.5) {
            sign.position.set(px, Math.min(h - 2, 7 + rand() * 8), pz + side * (d / 2 + 0.3));
            sign.rotation.y = side < 0 ? Math.PI : 0;
          } else {
            sign.position.set(px + side * (w / 2 + 0.3), Math.min(h - 2, 7 + rand() * 8), pz);
            sign.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
          }
          sign.material = signMats[(rand() * signMats.length) | 0];
          mirror.renderList.push(sign);
        }
      }
    }
  }

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

  // ---- petrol stations: three, spread out, with lit forecourts ---------
  // Fuel is a clock, and these are where you wind it. Green on the map.
  const stations = [];
  const streets = net.edges.filter(e => e.cls === 'street' && e.len > 46);
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
  for (const frac of [0.18, 0.52, 0.86]) {
    const e = streets[(streets.length * frac) | 0];
    const hw = halfWidth(e.cls);
    const sMid = e.len / 2;
    const sd = 1;
    const px = e.axis === 0 ? e.a.x + sMid : e.a.x + sd * (hw + 6.5);
    const pz = e.axis === 0 ? e.a.z + sd * (hw + 6.5) : e.a.z + sMid;
    // Forecourt pad, glowing faintly green, flush with the sidewalk.
    const pad = MeshBuilder.CreateBox('pad', {
      width: e.axis === 0 ? 13 : 9, height: 0.14, depth: e.axis === 0 ? 9 : 13,
    }, scene);
    pad.position.set(px, 0.07, pz);
    pad.material = padMat;
    // Pumps and the sign.
    for (const o of [-2.6, 2.6]) {
      const pump = MeshBuilder.CreateBox('pump', { width: 0.7, height: 1.3, depth: 0.5 }, scene);
      pump.position.set(e.axis === 0 ? px + o : px, 0.65, e.axis === 0 ? pz : pz + o);
      pump.material = pumpMat;
    }
    const sg = MeshBuilder.CreatePlane('gassg', { width: 8, height: 2 }, scene);
    sg.position.set(px, 6.4, pz);
    sg.billboardMode = 2;
    sg.material = gasSign;
    // The refuel spot is kerbside on the carriageway, beside the pad.
    const rx = e.axis === 0 ? px : e.a.x + sd * (hw - 1.8);
    const rz = e.axis === 0 ? e.a.z + sd * (hw - 1.8) : pz;
    stations.push({ x: rx, z: rz });
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

  return { glow, stations, roadworks };
}
