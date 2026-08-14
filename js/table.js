// Micro Machines mode: a toy car loose on a snooker table.
//
// The table is built oversized rather than the car being shrunk — everything
// else in the game (physics, collision, lighting) works in metres, so blowing up
// the furniture is what makes the car feel two inches long.
'use strict';

const TABLE = {
  halfX: 165, halfZ: 88,          // baize, in "car metres"
  rail: 11, railH: 5.2,
  pocket: 8.5,
  ballR: 5.2,
};

const BALL_COLOURS = [
  [0.75, 0.06, 0.06], [0.75, 0.06, 0.06], [0.75, 0.06, 0.06], [0.75, 0.06, 0.06],
  [0.75, 0.06, 0.06], [0.75, 0.06, 0.06], [0.75, 0.06, 0.06],
  [0.95, 0.85, 0.15], [0.10, 0.45, 0.16], [0.55, 0.30, 0.10],
  [0.10, 0.20, 0.70], [0.95, 0.45, 0.65], [0.05, 0.05, 0.06],
];

class TableWorld {
  constructor(gl, rand) {
    this.gl = gl;
    this.rand = rand || makeRandom(99);
    this.colliders = [];
    this.buildings = [];        // minimap footprints
    this.lights = [];
    this.chunks = [];
    this.roadNodes = [];
    this.pockets = [];
    this.hash = new Map();
    this.hashCell = 24;
    this.ramps = new RampSet();
    this.isTable = true;
    this.build();
  }

  addCollider(x0, z0, x1, z1, top) { return City.prototype.addCollider.call(this, x0, z0, x1, z1, top); }
  query(x, z, r) { return City.prototype.query.call(this, x, z, r); }
  resolveCircle(pos, r, aboveY) { return City.prototype.resolveCircle.call(this, pos, r, aboveY); }
  topAt(x, z) { return City.prototype.topAt.call(this, x, z); }

  // Regular polygon collider, so balls and pockets are round to drive against.
  addDisc(x, z, r, top, sides) {
    const n = sides || 10;
    const poly = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      poly.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
    const c = this.addCollider(x - r, z - r, x + r, z + r, top);
    c.poly = poly;
    return c;
  }

  build() {
    const gl = this.gl, rand = this.rand;
    const { halfX, halfZ, rail, railH } = TABLE;

    // The room the table stands in: a dark floor, so the table pops.
    const ground = new MeshBuilder();
    ground.style(TEX.CONCRETE, [0.16, 0.14, 0.13], 0);
    const far = 900;
    ground.quad([-far, -14, far], [far, -14, far], [far, -14, -far], [-far, -14, -far], 40, 40);
    this.groundMesh = ground.upload(gl);

    const b = new MeshBuilder();

    // --- baize ---
    b.style(TEX.GRASS, [0.30, 0.62, 0.34], 0);
    b.quad([-halfX, 0, halfZ], [halfX, 0, halfZ], [halfX, 0, -halfZ], [-halfX, 0, -halfZ], 26, 14);

    // Baulk line and the D, chalked on in white.
    b.style(TEX.MARK, [0.9, 0.95, 0.9], 0);
    const baulkX = -halfX * 0.52;
    b.quad([baulkX - 0.5, 0.05, halfZ], [baulkX + 0.5, 0.05, halfZ],
           [baulkX + 0.5, 0.05, -halfZ], [baulkX - 0.5, 0.05, -halfZ], 1, 1);
    for (let i = 0; i < 26; i++) {
      const a0 = Math.PI / 2 + i / 26 * Math.PI, a1 = Math.PI / 2 + (i + 1) / 26 * Math.PI;
      const R = 30;
      b.quad([baulkX + Math.cos(a0) * R, 0.05, Math.sin(a0) * R],
             [baulkX + Math.cos(a1) * R, 0.05, Math.sin(a1) * R],
             [baulkX + Math.cos(a1) * (R - 1), 0.05, Math.sin(a1) * (R - 1)],
             [baulkX + Math.cos(a0) * (R - 1), 0.05, Math.sin(a0) * (R - 1)], 1, 1);
    }

    // --- cushions: the walls that keep a toy car on the table ---
    const railTint = [0.42, 0.24, 0.12];
    b.style(TEX.BARK, railTint, 0);
    const rails = [
      [0, halfZ + rail / 2, halfX + rail, rail / 2],
      [0, -halfZ - rail / 2, halfX + rail, rail / 2],
      [halfX + rail / 2, 0, rail / 2, halfZ + rail],
      [-halfX - rail / 2, 0, rail / 2, halfZ + rail],
    ];
    for (const [cx, cz, hx, hz] of rails) {
      b.chamferBox(cx, railH / 2, cz, hx, railH / 2, hz, 1.2, { perUnit: 0.12 });
      this.addCollider(cx - hx, cz - hz, cx + hx, cz + hz, railH);
    }
    // Green cushion facing, so the rails read as a snooker table not a crate.
    b.style(TEX.GRASS, [0.22, 0.48, 0.26], 0);
    for (const [cx, cz, hx, hz] of rails) {
      b.chamferBox(cx, railH * 0.78, cz, hx * 0.97, railH * 0.2, hz * 0.97, 0.8, { perUnit: 0.2 });
    }

    // --- pockets ---
    for (const [px, pz] of [[-halfX, -halfZ], [-halfX, halfZ], [halfX, -halfZ],
                            [halfX, halfZ], [0, -halfZ], [0, halfZ]]) {
      this.pockets.push({ x: px, z: pz, r: TABLE.pocket });
      b.style(TEX.PLAIN, [0.02, 0.02, 0.02], 0);
      const seg = 16;
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        b.quad([px, 0.06, pz],
               [px + Math.cos(a0) * TABLE.pocket, 0.06, pz + Math.sin(a0) * TABLE.pocket],
               [px + Math.cos(a1) * TABLE.pocket, 0.06, pz + Math.sin(a1) * TABLE.pocket],
               [px, 0.06, pz], 1, 1);
      }
    }

    // --- the balls: obstacles the size of a small hill ---
    const R = TABLE.ballR;
    const ballAt = (x, z, col) => {
      b.style(TEX.PLAIN, col, 0);
      b.sphere(x, R, z, R, 16, 12, 1);
      this.addDisc(x, z, R * 0.92, R * 1.6, 10);
      this.buildings.push({ x0: x - R, z0: z - R, x1: x + R, z1: z + R, h: R * 2, downtown: 0 });
    };
    // A rack of reds, loosely broken up.
    let idx = 0;
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k <= row; k++) {
        const x = halfX * 0.34 + row * R * 2.3;
        const z = (k - row / 2) * R * 2.4;
        if (idx < 7) ballAt(x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4, BALL_COLOURS[idx]);
        idx++;
      }
    }
    ballAt(baulkX, -30, BALL_COLOURS[7]);
    ballAt(baulkX, 30, BALL_COLOURS[8]);
    ballAt(-halfX * 0.2, 0, BALL_COLOURS[9]);
    ballAt(halfX * 0.05, -46, BALL_COLOURS[10]);
    ballAt(halfX * 0.55, 44, BALL_COLOURS[11]);
    ballAt(halfX * 0.78, -20, BALL_COLOURS[12]);
    // The cue ball, white and gloss.
    ballAt(baulkX - 14, 12, [0.97, 0.96, 0.92]);

    // --- the cue, lying across the table as a long jump ---
    const cueX = -halfX * 0.1, cueZ = halfZ * 0.62;
    b.style(TEX.BARK, [0.78, 0.62, 0.38], 0);
    b.cylinder(cueX, 2.0, cueZ, 2.0, 150, 10, { axis: 'x', uRepeat: 3, vRepeat: 8 });
    b.style(TEX.PLAIN, [0.1, 0.35, 0.5], 0);
    b.cylinder(cueX + 74, 2.0, cueZ, 1.6, 4, 10, { axis: 'x' });
    this.addCollider(cueX - 76, cueZ - 2.2, cueX + 76, cueZ + 2.2, 4);

    // --- chalk cubes ---
    for (let i = 0; i < 4; i++) {
      const x = lerp(-halfX * 0.8, halfX * 0.8, rand()), z = lerp(-halfZ * 0.8, halfZ * 0.8, rand());
      b.style(TEX.PLAIN, [0.12, 0.32, 0.42], 0);
      b.chamferBox(x, 2.2, z, 2.4, 2.2, 2.4, 0.4, { perUnit: 0.5 });
      this.addCollider(x - 2.4, z - 2.4, x + 2.4, z + 2.4, 4.4);
    }

    // --- ramps: what makes it a racetrack rather than a table ---
    const rampSpots = [
      [-halfX * 0.62, -halfZ * 0.55, 0],
      [halfX * 0.15, halfZ * 0.30, Math.PI],
      [halfX * 0.62, -halfZ * 0.58, Math.PI / 2],
      [-halfX * 0.25, halfZ * 0.62, -Math.PI / 2],
      [halfX * 0.40, halfZ * 0.68, Math.PI],
    ];
    for (const [x, z, yaw] of rampSpots) this.ramps.emit(b, x, z, yaw, 16, 9, 4.6);

    // A raised loop of track: a plank you can drive up onto and along.
    const plankZ = -halfZ * 0.28;
    b.style(TEX.BARK, [0.66, 0.48, 0.28], 0);
    b.chamferBox(-20, 4.6, plankZ, 46, 0.9, 7, 0.5, { perUnit: 0.25 });
    this.addCollider(-66, plankZ - 7, 26, plankZ + 7, 5.5);
    this.ramps.emit(b, -78, plankZ, Math.PI / 2, 26, 12, 5.5);

    // Overhead table lamps for night driving.
    for (const lx of [-halfX * 0.5, 0, halfX * 0.5]) {
      b.style(TEX.PLAIN, [1.0, 0.94, 0.78], 0.9);
      b.chamferBox(lx, 78, 0, 14, 2.5, 10, 1.5, { perUnit: 0.2 });
      this.lights.push({ x: lx, y: 74, z: 0 });
    }

    this.chunks.push(b.upload(gl));

    this.extent = { minX: -halfX, maxX: halfX, minZ: -halfZ, maxZ: halfZ };
    this.center = [0, 0];
    this.spawn = { x: baulkX - 24, z: 0 };
    // Waypoints for the courier drop, kept clear of the balls.
    for (const p of [[-halfX*0.7, halfZ*0.6], [halfX*0.7, halfZ*0.6], [halfX*0.8, -halfZ*0.6],
                     [-halfX*0.75, -halfZ*0.55], [0, halfZ*0.75], [halfX*0.3, -halfZ*0.7]]) {
      this.roadNodes.push({ x: p[0], z: p[1] });
    }
  }

  // Driven into a pocket? Fun, not fatal.
  pocketAt(x, z) {
    for (const p of this.pockets) {
      if (Math.hypot(x - p.x, z - p.z) < p.r * 0.75) return p;
    }
    return null;
  }
}
