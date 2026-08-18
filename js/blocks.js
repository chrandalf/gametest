// What actually gets built on a block, once the zone map has decided what kind
// of place it is. One builder per zone, plus the small vocabulary of parts
// (houses, roofs, hedges, sheds) they share.
'use strict';

// --- shared parts ------------------------------------------------------------

// cols/rows: how many windows one repeat of the texture contains. Without
// this the repeat count is guesswork and a two-storey house ends up with four
// rows of windows, which is what makes it read as a block of flats.
const HOUSE_WALLS = [
  { layer: TEX.HOUSE,   tint: [1.00, 0.96, 0.92], cols: 2, rows: 2 },
  { layer: TEX.HOUSE,   tint: [0.82, 0.86, 0.90], cols: 2, rows: 2 },
  { layer: TEX.COTTAGE, tint: [1.00, 0.98, 0.92], cols: 3, rows: 2 },
  { layer: TEX.COTTAGE, tint: [0.92, 0.90, 0.82], cols: 3, rows: 2 },
];
const WINDOW_SPACING = 3.4;      // metres between window centres, both axes
const ROOF_TINTS = [
  [0.92, 0.62, 0.50], [0.72, 0.46, 0.38], [0.60, 0.56, 0.54], [0.46, 0.42, 0.44],
];

// A pitched roof: two slopes and two gable ends. `alongX` puts the ridge on
// the X axis. Overhanging eaves are what stop a house reading as a box with a
// lid — they throw a shadow line right across the wall below.
function pitchedRoof(b, cx, y, cz, hw, hd, rise, alongX, over) {
  const o = over === undefined ? 0.35 : over;
  const ex = hw + o, ez = hd + o;
  if (alongX) {
    const ry = y + rise;
    // Slopes.
    b.quad([cx-ex, y, cz+ez], [cx+ex, y, cz+ez], [cx+ex, ry, cz], [cx-ex, ry, cz], ex*0.7, ez*0.7);
    b.quad([cx+ex, y, cz-ez], [cx-ex, y, cz-ez], [cx-ex, ry, cz], [cx+ex, ry, cz], ex*0.7, ez*0.7);
    // Gables (a quad with its last two corners collapsed is a triangle).
    b.quad([cx+ex, y, cz+ez], [cx+ex, y, cz-ez], [cx+ex, ry, cz], [cx+ex, ry, cz], 1, 1);
    b.quad([cx-ex, y, cz-ez], [cx-ex, y, cz+ez], [cx-ex, ry, cz], [cx-ex, ry, cz], 1, 1);
  } else {
    const ry = y + rise;
    // Wound so both slopes face up and outward; reversing either one turns the
    // roof inside out and it renders black.
    b.quad([cx+ex, y, cz+ez], [cx+ex, y, cz-ez], [cx, ry, cz-ez], [cx, ry, cz+ez], ez*0.7, ex*0.7);
    b.quad([cx-ex, y, cz-ez], [cx-ex, y, cz+ez], [cx, ry, cz+ez], [cx, ry, cz-ez], ez*0.7, ex*0.7);
    b.quad([cx-ex, y, cz+ez], [cx+ex, y, cz+ez], [cx, ry, cz+ez], [cx, ry, cz+ez], 1, 1);
    b.quad([cx+ex, y, cz-ez], [cx-ex, y, cz-ez], [cx, ry, cz-ez], [cx, ry, cz-ez], 1, 1);
  }
}

// A house: walls, pitched roof, a door on the street side and a chimney.
// `faceX`/`faceZ` point at the road, which is where the door goes.
function house(city, b, opt) {
  const rand = opt.rand;
  const w = opt.w, d = opt.d, h = opt.h;
  const cx = opt.x, cz = opt.z;
  const base = opt.baseY || 0;
  const wall = opt.wall || HOUSE_WALLS[(rand() * HOUSE_WALLS.length) | 0];
  const roofTint = opt.roofTint || ROOF_TINTS[(rand() * ROOF_TINTS.length) | 0];
  const uvU = Math.max(1, Math.round(w / (wall.cols * WINDOW_SPACING)));
  const uvV = Math.max(1, Math.round(h / (wall.rows * WINDOW_SPACING)));

  b.style(wall.layer, wall.tint, 0);
  b.chamferBox(cx, base + h/2, cz, w/2, h/2, d/2, 0.38, { skipTop: true, uvU, uvV });

  const alongX = opt.ridgeAlongX !== undefined ? opt.ridgeAlongX : w >= d;
  const rise = opt.rise === undefined ? Math.min(w, d) * 0.32 : opt.rise;
  b.style(TEX.TILE, roofTint, 0);
  pitchedRoof(b, cx, base + h, cz, w/2, d/2, rise, alongX, opt.eaves);

  // Fascia and gutter along the eaves, and a ridge tile along the apex. Small
  // pieces, but they are the difference between a house and a box with a lid:
  // they break the silhouette and catch a line of light along every edge.
  const eave = opt.eaves === undefined ? 0.35 : opt.eaves;
  b.style(TEX.PLAIN, [0.92, 0.90, 0.86], 0);
  for (const s of [-1, 1]) {
    if (alongX) {
      b.chamferBox(cx, base + h - 0.06, cz + s * (d/2 + eave), w/2 + eave, 0.15, 0.10, 0.06,
                   { perUnit: 0.8 });
    } else {
      b.chamferBox(cx + s * (w/2 + eave), base + h - 0.06, cz, 0.10, 0.15, d/2 + eave, 0.06,
                   { perUnit: 0.8 });
    }
  }
  b.style(TEX.TILE, [roofTint[0] * 0.86, roofTint[1] * 0.86, roofTint[2] * 0.86], 0);
  if (alongX) b.chamferBox(cx, base + h + rise + 0.06, cz, w/2 + eave, 0.11, 0.16, 0.10, { perUnit: 1.2 });
  else b.chamferBox(cx, base + h + rise + 0.06, cz, 0.16, 0.11, d/2 + eave, 0.10, { perUnit: 1.2 });

  // Door and a porch canopy on the street elevation.
  const fx = opt.faceX || 0, fz = opt.faceZ || 0;
  const dw = 0.55, dh = 2.05;
  const px = cx + fx * (w/2 + 0.06) + fz * (rand() - 0.5) * (w * 0.3);
  const pz = cz + fz * (d/2 + 0.06) + fx * (rand() - 0.5) * (d * 0.3);
  b.style(TEX.BARK, [0.42, 0.30, 0.22], 0);
  b.box(px, base + dh/2, pz, fz ? dw : 0.08, dh/2, fx ? dw : 0.08, { perUnit: 1 });
  b.style(TEX.CONCRETE, [0.88, 0.86, 0.82], 0);
  b.box(px + fx * 0.35, base + dh + 0.12, pz + fz * 0.35,
        (fz ? dw + 0.35 : 0.42), 0.08, (fx ? dw + 0.35 : 0.42), { perUnit: 0.6 });

  if (rand() < 0.75) {
    const chx = cx + (rand() - 0.5) * w * 0.5, chz = cz + (rand() - 0.5) * d * 0.4;
    b.style(TEX.HOUSE, [0.86, 0.72, 0.66], 0);
    b.chamferBox(chx, base + h + 1.5, chz, 0.42, 1.5, 0.42, 0.08, { perUnit: 0.8, skipTop: true });
    // Capping and a round pot: the one bit of curve on the whole roofline.
    b.style(TEX.CONCRETE, [0.86, 0.84, 0.80], 0);
    b.chamferBox(chx, base + h + 3.06, chz, 0.50, 0.09, 0.50, 0.06, { perUnit: 1 });
    b.style(TEX.TILE, [0.72, 0.50, 0.40], 0);
    b.cylinder(chx, base + h + 3.42, chz, 0.19, 0.62, 10, { uRepeat: 3, vRepeat: 1 });
  }
  if (opt.dig) {
    b.style(TEX.CONCRETE, [0.72, 0.70, 0.66], 0);
    b.box(cx, base - opt.dig / 2, cz, w/2 - 0.1, opt.dig / 2, d/2 - 0.1,
          { skipTop: true, perUnit: 0.3 });
  }
  city.addBuilding(cx - w/2, cz - d/2, cx + w/2, cz + d/2, base + h, 0, 'a house');

  // Every house is somebody's address. The door position is where a walker
  // heads for; the id ties a driveway spot to the family that parks in it.
  const id = city.homes.length;
  city.homes.push({ x: px + fx * 1.3, z: pz + fz * 1.3, cap: 2 + ((rand() * 3) | 0) });
  return id;
}

// A surface car park: an apron of tarmac with painted bays and an aisle to
// swing round in. Every bay is registered as a parking spot, so the census can
// put somebody's car in it and a commuter can reverse into it. The bay lines
// go into the block's decal mesh, so like all road paint they cast no shadow.
function carPark(city, b, ctx, x0, z0, x1, z1) {
  const y = ctx.baseY;
  b.style(TEX.ASPHALT, [1.05, 1.04, 1.01], 0);
  b.quad([x0, y + 0.03, z1], [x1, y + 0.03, z1], [x1, y + 0.03, z0], [x0, y + 0.03, z0],
         (x1 - x0) / 9, (z1 - z0) / 9);
  const paint = ctx.paint;
  const horiz = (x1 - x0) >= (z1 - z0);       // bays stack along the long axis
  const long = horiz ? x1 - x0 : z1 - z0;
  const deep = horiz ? z1 - z0 : x1 - x0;
  const BAY_W = 3.1;
  const rows = deep >= 5.4 * 2 + 6 ? 2 : 1;
  const BAY_D = Math.min(5.4, rows === 1 ? deep - 6.2 : deep / 2 - 3);
  if (BAY_D < 4.0 || long < BAY_W * 2 + 2) return;
  const n = Math.floor((long - 2) / BAY_W);
  paint.style(TEX.MARK, [0.92, 0.92, 0.88], 0);
  const stripe = (ax, az, bx, bz) => {
    paint.quad([Math.min(ax, bx), y + 0.045, Math.max(az, bz)],
               [Math.max(ax, bx), y + 0.045, Math.max(az, bz)],
               [Math.max(ax, bx), y + 0.045, Math.min(az, bz)],
               [Math.min(ax, bx), y + 0.045, Math.min(az, bz)], 1, 1);
  };
  const sides = rows === 2 ? [-1, 1] : [1];
  for (const side of sides) {
    for (let k = 0; k <= n; k++) {
      const a = (horiz ? x0 : z0) + 1 + k * BAY_W;
      if (horiz) {
        const ze = side < 0 ? z0 : z1;
        stripe(a - 0.07, ze - side * BAY_D, a + 0.07, ze);
        if (k < n) {
          city.addSpot(a + BAY_W / 2, ze - side * BAY_D / 2, side < 0 ? Math.PI : 0, 'bay');
        }
      } else {
        const xe = side < 0 ? x0 : x1;
        stripe(xe - side * BAY_D, a - 0.07, xe, a + 0.07);
        if (k < n) {
          city.addSpot(xe - side * BAY_D / 2, a + BAY_W / 2,
                       side < 0 ? -Math.PI / 2 : Math.PI / 2, 'bay');
        }
      }
    }
  }
  // Lamps at two corners, just outside the tarmac — in the aisle they were
  // exactly where a car swings while reversing into a bay.
  city.streetLight(b, x0 - 0.9, z0 - 0.9, 1, 1);
  city.streetLight(b, x1 + 0.9, z1 + 0.9, -1, -1);
}

// A petrol station: forecourt, canopy over two pump islands, a shop, a price
// totem, and somewhere to leave the car while you pay. Repairs done on the
// forecourt are quick and cheap — this is the game's garage.
function buildGasStation(city, b, ctx) {
  const { x0, z0, x1, z1 } = ctx;
  const y = ctx.baseY;
  const cx = (x0 + x1) / 2;

  // Forecourt apron, open to the road on the south edge.
  const f0 = z0 + 1.5, f1 = z0 + 27;
  b.style(TEX.CONCRETE, [0.86, 0.86, 0.84], 0);
  b.quad([x0 + 1.5, y + 0.04, f1], [x1 - 1.5, y + 0.04, f1],
         [x1 - 1.5, y + 0.04, f0], [x0 + 1.5, y + 0.04, f0],
         (x1 - x0) / 7, (f1 - f0) / 7);

  // Canopy: four columns and a flat deck whose underside glows at night.
  const pz = z0 + 13;
  b.style(TEX.METAL, [0.82, 0.83, 0.85], 0);
  for (const sx of [-7.5, 7.5]) {
    for (const sz of [-3.2, 3.2]) {
      b.cylinder(cx + sx, y + 2.9, pz + sz, 0.24, 5.8, 8, { vRepeat: 2 });
    }
  }
  b.style(TEX.PLAIN, [0.95, 0.95, 0.94], 0.30);
  b.chamferBox(cx, y + 6.05, pz, 11.5, 0.30, 6.2, 0.14, { perUnit: 0.4 });
  b.style(TEX.PLAIN, [0.92, 0.16, 0.14], 0.62);
  b.chamferBox(cx, y + 6.52, pz, 11.7, 0.22, 6.4, 0.10, { perUnit: 0.5 });

  // Two pump islands, two pumps each. The pumps are solid — clipping one at
  // forty is a crash, exactly as it would be.
  for (const ix of [-4.5, 4.5]) {
    b.style(TEX.CONCRETE, [0.9, 0.9, 0.87], 0);
    b.chamferBox(cx + ix, y + 0.14, pz, 1.1, 0.14, 4.6, 0.08, { perUnit: 0.5 });
    for (const iz of [-2.2, 2.2]) {
      b.style(TEX.PLAIN, [0.90, 0.20, 0.16], 0.12);
      b.chamferBox(cx + ix, y + 1.05, pz + iz, 0.44, 0.78, 0.5, 0.08, { perUnit: 1 });
      b.style(TEX.PLAIN, [0.94, 0.94, 0.92], 0.3);
      b.box(cx + ix, y + 1.48, pz + iz, 0.34, 0.20, 0.4, { perUnit: 1 });
      city.addCollider(cx + ix - 0.6, pz + iz - 0.66, cx + ix + 0.6, pz + iz + 0.66,
                       y + 1.9, 'a petrol pump');
    }
  }

  // The shop, set back behind the pumps.
  const shopZ = z0 + 34;
  b.style(TEX.SHOP, [1, 1, 1], 0);
  b.chamferBox(cx, y + 2.2, shopZ, 8, 2.2, 4.5, 0.2, { skipTop: true, uvU: 2, uvV: 1 });
  b.style(TEX.CONCRETE, [0.88, 0.88, 0.85], 0);
  b.box(cx, y + 4.55, shopZ, 8.4, 0.22, 4.9, { perUnit: 0.4 });
  city.addBuilding(cx - 8, shopZ - 4.5, cx + 8, shopZ + 4.5, y + 4.8, 0,
                   'the petrol station shop');
  city.works.push({ x: cx, z: shopZ - 6.2, jobs: 3 });

  // Price totem by the entrance.
  b.style(TEX.METAL, [0.6, 0.62, 0.64], 0);
  b.box(x0 + 6, y + 2.6, z0 + 4, 0.3, 2.6, 0.3, { perUnit: 1 });
  b.style(TEX.PLAIN, [0.92, 0.16, 0.14], 0.7);
  b.chamferBox(x0 + 6, y + 6.0, z0 + 4, 1.5, 1.4, 0.4, 0.12, { perUnit: 0.7 });
  city.addCollider(x0 + 5.6, z0 + 3.6, x0 + 6.4, z0 + 4.4, y + 7.4,
                   'the petrol station sign');

  // Bays beside the shop for anyone stopping longer than a fill-up.
  for (let k = 0; k < 3; k++) {
    city.addSpot(cx + 11.2, shopZ - 3.5 + k * 3.3, Math.PI / 2, 'bay');
  }

  // The back of the plot stays green.
  hedge(city, b, x0 + 3, z1 - 3.6, x1 - 3, z1 - 2.4, 1.3);
  const rand = ctx.rand;
  for (let i = 0; i < 4; i++) {
    if (rand() < 0.3) continue;
    const tx = lerp(x0 + 6, x1 - 6, rand()), tz = lerp(z0 + 44, z1 - 7, rand());
    if (!city.onRoadSurface(tx, tz, 2.5)) city.tree(b, tx, tz, 0.9 + rand() * 0.6, y);
  }

  city.stations.push({ x: cx, z: pz, x0: x0 + 1.5, z0: f0, x1: x1 - 1.5, z1: shopZ + 6 });
}

// The hospital: a white slab with a red cross you can see across town, an
// A&E canopy, an ambulance apron the ambulance actually uses, and a visitor
// car park down one side. Where everyone you run over ends up.
function buildHospital(city, b, ctx) {
  const { x0, z0, x1, z1 } = ctx;
  const y = ctx.baseY;
  const cx = (x0 + x1) / 2 - 6;

  // Main block, set back behind the ambulance apron.
  const w = Math.min(30, x1 - x0 - 26), d = 20;
  const bz = z0 + 22;
  const h = 6 * FLOOR_H;
  b.style(TEX.MODERN, [0.97, 0.98, 1.0], 0);
  b.chamferBox(cx, y + h / 2, bz + d / 2, w / 2, h / 2, d / 2, 0.6,
               { top: TEX.ROOF, topTint: [1, 1, 1],
                 uvU: Math.max(1, Math.round(w / (4 * FLOOR_H))),
                 uvV: Math.max(1, Math.round(h / (7 * FLOOR_H))) });
  // The red cross, proud of the front face and lit from within.
  b.style(TEX.PLAIN, [0.95, 0.12, 0.10], 0.85);
  b.box(cx, y + h - 3.2, bz - 0.18, 0.65, 2.0, 0.16, { perUnit: 1 });
  b.box(cx, y + h - 3.2, bz - 0.18, 2.0, 0.65, 0.16, { perUnit: 1 });
  city.addBuilding(cx - w / 2, bz, cx + w / 2, bz + d, y + h, 0.3, 'the hospital');
  city.works.push({ x: cx, z: bz - 1.6, jobs: 15 });

  // A&E canopy over the doors.
  b.style(TEX.METAL, [0.80, 0.82, 0.84], 0);
  for (const sx of [-4, 4]) b.cylinder(cx + sx, y + 2.2, bz - 5.5, 0.2, 4.4, 8);
  b.style(TEX.PLAIN, [0.95, 0.95, 0.94], 0.25);
  b.chamferBox(cx, y + 4.5, bz - 3, 5.4, 0.24, 3.4, 0.12, { perUnit: 0.5 });

  // Ambulance apron: concrete, red border, kept clear.
  const a0x = cx - 9, a1x = cx + 9, a0z = z0 + 3, a1z = bz - 1;
  b.style(TEX.CONCRETE, [0.87, 0.87, 0.85], 0);
  b.quad([a0x, y + 0.045, a1z], [a1x, y + 0.045, a1z],
         [a1x, y + 0.045, a0z], [a0x, y + 0.045, a0z], 4, 4);
  const paint = ctx.paint;
  paint.style(TEX.MARK, [0.9, 0.18, 0.14], 0);
  const border = (bx0, bz0, bx1, bz1) => {
    paint.quad([bx0, y + 0.06, bz1], [bx1, y + 0.06, bz1],
               [bx1, y + 0.06, bz0], [bx0, y + 0.06, bz0], 1, 1);
  };
  border(a0x, a0z, a1x, a0z + 0.3);
  border(a0x, a1z - 0.3, a1x, a1z);
  border(a0x, a0z, a0x + 0.3, a1z);
  border(a1x - 0.3, a0z, a1x, a1z);

  city.hospital = { x: cx, z: bz - 3,
                    bay: { x: cx, z: (a0z + a1z) / 2, yaw: Math.PI } };

  // Visitor parking down the east side.
  carPark(city, b, ctx, x1 - 14, z0 + 5, x1 - 2, z1 - 8);

  // Green edges.
  const rand = ctx.rand;
  for (let i = 0; i < 5; i++) {
    if (rand() < 0.3) continue;
    const tx = lerp(x0 + 5, cx + w / 2, rand()), tz = lerp(bz + d + 5, z1 - 5, rand());
    if (!city.onRoadSurface(tx, tz, 2.5)) city.tree(b, tx, tz, 0.9 + rand() * 0.6, y);
  }
}

// A run of hedge. Solid to drive through, but you can see it coming.
function hedge(city, b, x0, z0, x1, z1, h, solid, groundAt) {
  const hh = h || 1.25;
  b.style(TEX.LEAVES, [0.62, 0.78, 0.55], 0);
  // Over open ground a hedgerow is cut into short lengths, each sitting at its
  // own height, or a long one buries itself at one end of a slope.
  const len = Math.hypot(x1 - x0, z1 - z0);
  const segs = groundAt ? Math.max(1, Math.round(len / 11)) : 1;
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs;
    const ax = lerp(x0, x1, t0), az = lerp(z0, z1, t0);
    const bx = lerp(x0, x1, t1), bz = lerp(z0, z1, t1);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const y = groundAt ? groundAt(cx, cz) : 0;
    b.chamferBox(cx, y + hh/2, cz, Math.abs(bx-ax)/2, hh/2, Math.abs(bz-az)/2,
                 Math.min(0.4, hh * 0.3), { perUnit: 0.7 });
  }
  if (solid !== false) city.addCollider(Math.min(x0,x1), Math.min(z0,z1), Math.max(x0,x1), Math.max(z0,z1), hh, 'a hedge');
}

// Post-and-rail fencing. Visual only — it is knee height, so blocking on it
// would feel like an invisible wall.
function fence(b, x0, z0, x1, z1, rand) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 2.4));
  b.style(TEX.BARK, [0.58, 0.46, 0.34], 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.box(lerp(x0, x1, t), 0.55, lerp(z0, z1, t), 0.07, 0.55, 0.07, { perUnit: 1 });
  }
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  for (const y of [0.5, 0.95]) {
    b.box((x0+x1)/2, y, (z0+z1)/2,
          Math.abs(dx) * len/2 + 0.04, 0.05, Math.abs(dz) * len/2 + 0.04, { perUnit: 0.5 });
  }
}

// Clamp a footprint so the whole of it — eaves included — stays inside the
// block. Anything placed by hand rather than through frontage() has to go
// through here, or it ends up overhanging the road as a slab of black roof.
function fitIn(ctx, cx, cz, hw, hd, margin) {
  const m = margin === undefined ? 1.0 : margin;
  const x = clamp(cx, ctx.x0 + hw + m, ctx.x1 - hw - m);
  const z = clamp(cz, ctx.z0 + hd + m, ctx.z1 - hd - m);
  return { x, z, fits: (ctx.x1 - ctx.x0) > (hw + m) * 2 && (ctx.z1 - ctx.z0) > (hd + m) * 2 };
}

// Walk the four street-facing edges of a block, handing out plots. Everything
// residential is laid out this way, so houses always address the road.
// The corners are left empty: each run stops a plot depth short of the ends,
// so perpendicular runs cannot grow into each other. The gap reads as a side
// alley, which is a better outcome than two roofs intersecting.
function frontage(ctx, edges, plotW, depth, cb, insetFactor) {
  const { x0, z0, x1, z1, rand } = ctx;
  const inset = depth * (insetFactor === undefined ? 0.75 : insetFactor);
  for (const e of edges) {
    const horiz = e === 0 || e === 1;
    const runStart = (horiz ? x0 : z0) + inset;
    const runEnd = (horiz ? x1 : z1) - inset;
    const span = runEnd - runStart;
    if (span < plotW * 0.6) continue;
    const n = Math.max(1, Math.floor(span / plotW));
    const w = span / n;
    for (let k = 0; k < n; k++) {
      const mid = runStart + k * w + w / 2;
      let cx, cz, faceX = 0, faceZ = 0;
      if (e === 0)      { cx = mid; cz = z0 + depth/2; faceZ = -1; }
      else if (e === 1) { cx = mid; cz = z1 - depth/2; faceZ = 1; }
      else if (e === 2) { cx = x0 + depth/2; cz = mid; faceX = -1; }
      else              { cx = x1 - depth/2; cz = mid; faceX = 1; }
      cb({ cx, cz, w, depth, faceX, faceZ, edge: e, horiz, rand });
    }
  }
}

// --- zone builders -----------------------------------------------------------
// Each takes (city, b, ctx) where ctx carries the block bounds, its zone, the
// smoothed urbanity at that block and a block-local PRNG.

const ZONE_BUILDERS = {};

// Open country: woodland, rough grass, boulders and the odd track.
ZONE_BUILDERS[Z.WILD] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand } = ctx;
  const n = 14 + ((rand() * 12) | 0);
  for (let i = 0; i < n; i++) {
    const x = lerp(x0 + 3, x1 - 3, rand()), z = lerp(z0 + 3, z1 - 3, rand());
    // A lane through the woods bends off its grid line and into the block, so
    // where the tarmac ends up has to be checked, not assumed.
    if (city.onRoadSurface(x, z, 2.5)) continue;
    if (rand() < 0.22) city.bush(b, x, z, 0.7 + rand() * 0.8, ctx.groundAt(x, z));
    else city.tree(b, x, z, 0.9 + rand() * 0.9, ctx.groundAt(x, z));
  }
  for (let i = 0; i < 3; i++) {
    if (rand() > 0.5) continue;
    const x = lerp(x0 + 4, x1 - 4, rand()), z = lerp(z0 + 4, z1 - 4, rand());
    if (city.onRoadSurface(x, z, 3.5)) continue;
    const r = 0.8 + rand() * 1.6;
    b.style(TEX.CONCRETE, [0.55, 0.54, 0.50], 0);
    b.sphere(x, ctx.groundAt(x, z) + r * 0.35, z, r, 7, 4, 0.5);
    city.addCollider(x - r*0.7, z - r*0.7, x + r*0.7, z + r*0.7, r * 0.7, 'a boulder');
  }
};

// Fields divided by hedgerows, with a farmstead on some blocks.
ZONE_BUILDERS[Z.FARM] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand } = ctx;
  const strips = 2 + ((rand() * 2) | 0);
  const vertical = rand() < 0.5;
  for (let k = 0; k < strips; k++) {
    const a = k / strips, c = (k + 1) / strips;
    const fx0 = vertical ? lerp(x0, x1, a) : x0;
    const fx1 = vertical ? lerp(x0, x1, c) : x1;
    const fz0 = vertical ? z0 : lerp(z0, z1, a);
    const fz1 = vertical ? z1 : lerp(z0, z1, c);
    const crop = rand();
    const tint = crop < 0.32 ? [0.78, 0.72, 0.38]          // ripe cereal
               : crop < 0.6  ? [0.52, 0.62, 0.32]          // young green
               : crop < 0.8  ? [0.46, 0.36, 0.28]          // ploughed
                             : [0.62, 0.70, 0.40];         // pasture
    b.style(crop < 0.8 ? TEX.FIELD : TEX.GRASS, tint, 0);
    const rot = vertical !== (rand() < 0.5);
    // A field is laid over the ground it sits on, not flat across it.
    city.sheet(b, fx0 + 1, fz0 + 1, fx1 - 1, fz1 - 1, 5, 0.03,
               rot ? (fx1-fx0)/6 : (fx1-fx0)/22, rot ? (fz1-fz0)/22 : (fz1-fz0)/6, true);
    // Hedgerow between strips.
    if (k < strips - 1) {
      if (vertical) hedge(city, b, fx1 - 0.7, fz0 + 1, fx1 + 0.7, fz1 - 1, 1.5, true, ctx.groundAt);
      else hedge(city, b, fx0 + 1, fz1 - 0.7, fx1 - 1, fz1 + 0.7, 1.5, true, ctx.groundAt);
    }
  }

  // Farmstead: house, barn, a couple of bales.
  if (rand() < 0.45) {
    const e = (rand() * 4) | 0;
    const horiz = e < 2;
    const fx = horiz ? lerp(x0 + 16, x1 - 16, rand()) : (e === 2 ? x0 + 13 : x1 - 13);
    const fz = horiz ? (e === 0 ? z0 + 13 : z1 - 13) : lerp(z0 + 16, z1 - 16, rand());
    house(city, b, { x: fx, z: fz, w: 11, d: 9, h: 5.4, rand,
                     faceX: horiz ? 0 : (e === 2 ? -1 : 1), faceZ: horiz ? (e === 0 ? -1 : 1) : 0,
                     wall: HOUSE_WALLS[2], baseY: ctx.groundAt(fx, fz), dig: 2.5 });
    // Barn: creosoted timber under a dark corrugated roof. Its 0.6 m eaves are
    // part of the footprint as far as fitting inside the block goes.
    // Kept well clear of the block edge: the lane past the farm bows off its
    // grid line and can end up a metre or two inside the field.
    const barn = fitIn(ctx, fx + (rand() < 0.5 ? -16 : 16), fz + (rand() < 0.5 ? -13 : 13),
                       8.6, 6.6, 3.5);
    if (barn.fits) {
      const bx = barn.x, bz = barn.z;
      const by = ctx.groundAt(bx, bz);
      b.style(TEX.BARK, [0.66, 0.48, 0.36], 0);
      b.box(bx, by + 1.5, bz, 8, 4.6, 6, { perUnit: 0.35, skipTop: true });
      b.style(TEX.SIDING, [0.34, 0.35, 0.33], 0);
      pitchedRoof(b, bx, by + 6.2, bz, 8, 6, 2.4, true, 0.6);
      city.addBuilding(bx - 8, bz - 6, bx + 8, bz + 6, by + 6.2, 0, 'a barn');
      b.style(TEX.FIELD, [0.86, 0.80, 0.48], 0);
      for (let i = 0; i < 4; i++) {
        if (rand() < 0.4) continue;
        const bale = fitIn(ctx, bx + (rand() - 0.5) * 22, bz + (rand() - 0.5) * 18, 1.2, 1.2);
        const byy = ctx.groundAt(bale.x, bale.z);
        b.cylinder(bale.x, byy + 1.2, bale.z, 1.2, 2.4, 9, { uRepeat: 3, vRepeat: 1 });
        city.addCollider(bale.x - 1.2, bale.z - 1.2, bale.x + 1.2, bale.z + 1.2, byy + 2.4, 'a hay bale');
      }
    }
  }
  // A tree or two in the hedge line.
  for (let i = 0; i < 3; i++) {
    if (rand() < 0.45) continue;
    const tx = lerp(x0 + 4, x1 - 4, rand()), tz = lerp(z0 + 4, z1 - 4, rand());
    if (city.onRoadSurface(tx, tz, 2.5)) continue;
    city.tree(b, tx, tz, 1.0 + rand() * 0.5, ctx.groundAt(tx, tz));
  }
};

// Cottages around a green, with a church on a few blocks.
ZONE_BUILDERS[Z.VILLAGE] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand } = ctx;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

  if (rand() < 0.18) return city.church(b, ctx);

  // Village green in the middle of the block.
  b.style(TEX.GRASS, [0.58, 0.76, 0.46], 0);
  b.quad([x0+14, 0.04, z1-14], [x1-14, 0.04, z1-14], [x1-14, 0.04, z0+14], [x0+14, 0.04, z0+14],
         (x1-x0)/9, (z1-z0)/9);
  for (let i = 0; i < 3; i++) {
    if (rand() < 0.35) continue;
    city.tree(b, cx + (rand()-0.5) * 26, cz + (rand()-0.5) * 26, 1.1 + rand() * 0.6, 0);
  }
  city.bench(b, cx + (rand()-0.5) * 20, cz + (rand()-0.5) * 20, 0);

  const edges = [0, 1, 2, 3].filter(() => rand() < 0.78);
  frontage(ctx, edges.length ? edges : [0], 15, 13, (p) => {
    if (p.rand() < 0.22) return;                       // gaps: a lane, a paddock
    const w = Math.min(p.w - 3.5, 8 + p.rand() * 4);
    const d = 7 + p.rand() * 2.5;
    const along = p.horiz ? w : d, across = p.horiz ? d : w;
    const homeId = house(city, b, {
      x: p.cx + (p.horiz ? 0 : (p.rand()-0.5) * 1.5),
      z: p.cz + (p.horiz ? (p.rand()-0.5) * 1.5 : 0),
      w: p.horiz ? along : across, d: p.horiz ? across : along,
      h: p.rand() < 0.3 ? 5.6 : 3.6, rand: p.rand,
      faceX: p.faceX, faceZ: p.faceZ,
      wall: HOUSE_WALLS[2 + ((p.rand() * 2) | 0)],
      ridgeAlongX: p.horiz,
    });
    // Front garden wall.
    const gx = p.cx + p.faceX * 5.5, gz = p.cz + p.faceZ * 5.5;
    if (p.rand() < 0.7) {
      if (p.horiz) hedge(city, b, gx - p.w/2 + 1.5, gz - 0.5, gx + p.w/2 - 1.5, gz + 0.5, 1.0);
      else hedge(city, b, gx - 0.5, gz - p.w/2 + 1.5, gx + 0.5, gz + p.w/2 - 1.5, 1.0);
    }
    // Village parking is on the verge outside the garden, parallel to the lane.
    if (p.rand() < 0.6) {
      const vx = p.cx + p.faceX * 10.2, vz = p.cz + p.faceZ * 10.2;
      city.addSpot(vx, vz, p.horiz ? Math.PI / 2 : 0, 'kerb', homeId);
    }
  });
};

// Detached houses, gardens, driveways.
ZONE_BUILDERS[Z.SUBURB] = (city, b, ctx) => {
  const { rand } = ctx;
  frontage(ctx, [0, 1, 2, 3], 17, 16, (p) => {
    if (p.rand() < 0.08) return;
    // Narrow enough that the driveway genuinely fits beside the house: the
    // old width put the pad — and the car on it — inside the gable wall.
    const w = Math.min(p.w - 7, 10 + p.rand() * 3);
    const d = 8.5 + p.rand() * 2;
    const floors = p.rand() < 0.72 ? 2 : 1;
    const h = floors * 3.0;
    const along = w, across = d;
    const cx = p.cx - p.faceX * 1.5, cz = p.cz - p.faceZ * 1.5;
    const homeId = house(city, b, {
      x: cx, z: cz,
      w: p.horiz ? along : across, d: p.horiz ? across : along,
      h, rand: p.rand, faceX: p.faceX, faceZ: p.faceZ,
      wall: HOUSE_WALLS[(p.rand() * 3) | 0], ridgeAlongX: p.horiz,
      baseY: ctx.baseY,
    });
    // Garage and driveway down the side of the plot, clear of the house wall.
    const off = (p.rand() < 0.5 ? -1 : 1) * (w / 2 + 2.5);
    const dx = p.horiz ? cx + off : cx, dz = p.horiz ? cz : cz + off;
    b.style(TEX.CONCRETE, [0.78, 0.78, 0.76], 0);
    b.quad([dx - (p.horiz ? 2.2 : 6), ctx.baseY + 0.02, dz + (p.horiz ? 6 : 2.2)],
           [dx + (p.horiz ? 2.2 : 6), ctx.baseY + 0.02, dz + (p.horiz ? 6 : 2.2)],
           [dx + (p.horiz ? 2.2 : 6), ctx.baseY + 0.02, dz - (p.horiz ? 6 : 2.2)],
           [dx - (p.horiz ? 2.2 : 6), ctx.baseY + 0.02, dz - (p.horiz ? 6 : 2.2)], 2, 4);
    // The driveway is this house's parking. Nose-in, so leaving home means
    // reversing out onto the street the way everyone actually does.
    city.addSpot(dx + p.faceX * 2.5, dz + p.faceZ * 2.5,
                 Math.atan2(-p.faceX, -p.faceZ), 'drive', homeId);
    if (p.rand() < 0.55) {
      city.tree(b, cx - p.faceX * 6.5 + (p.horiz ? off * 0.6 : 0),
                   cz - p.faceZ * 6.5 + (p.horiz ? 0 : off * 0.6), 0.8 + p.rand() * 0.5, ctx.baseY);
    }
  });
};

// Terraces and small offices: the first zone that builds a continuous street
// wall, which is what makes it read as town rather than village.
ZONE_BUILDERS[Z.TOWN] = (city, b, ctx) => {
  const { rand, u } = ctx;
  frontage(ctx, [0, 1, 2, 3], 34, 15, (p) => {
    const depth = 11 + p.rand() * 2;
    const runW = p.w - 2;
    const cx = p.cx - p.faceX * 1.2, cz = p.cz - p.faceZ * 1.2;
    if (p.rand() < 0.13) {
      // A surface car park in place of a building: the town needs somewhere
      // to put all the cars the census hands out.
      const hw = p.horiz ? runW / 2 : depth / 2, hd = p.horiz ? depth / 2 : runW / 2;
      carPark(city, b, ctx, cx - hw, cz - hd, cx + hw, cz + hd);
      return;
    }
    if (p.rand() < 0.24) {
      // A small block of flats or an office breaks up the terrace.
      const h = 9 + u * 12 + p.rand() * 5;
      city.buildBuilding(b, cx - (p.horiz ? runW/2 : depth/2), cz - (p.horiz ? depth/2 : runW/2),
                            cx + (p.horiz ? runW/2 : depth/2), cz + (p.horiz ? depth/2 : runW/2),
                            h, 0.25, ctx);
      return;
    }
    // Terrace: one roof, several front doors, a party wall every few metres.
    const units = Math.max(2, Math.round(runW / 6.5));
    const uw = runW / units;
    const h = p.rand() < 0.5 ? 6.4 : 9.2;
    const wall = HOUSE_WALLS[(p.rand() * 2) | 0];
    for (let k = 0; k < units; k++) {
      const t = (k + 0.5) / units - 0.5;
      const hx = cx + (p.horiz ? t * runW : 0), hz = cz + (p.horiz ? 0 : t * runW);
      b.style(wall.layer, wall.tint, 0);
      b.chamferBox(hx, ctx.baseY + h/2, hz,
                   (p.horiz ? uw/2 : depth/2), h/2, (p.horiz ? depth/2 : uw/2), 0.1,
                   { skipTop: true, uvU: Math.max(1, Math.round(uw / 5.5)), uvV: Math.max(2, Math.round(h / 3.4)) });
      b.style(TEX.BARK, [0.35, 0.26, 0.22], 0);
      b.box(hx + p.faceX * (p.horiz ? 0 : depth/2 + 0.05) + (p.horiz ? uw * 0.28 : 0),
            ctx.baseY + 1.0,
            hz + p.faceZ * (p.horiz ? depth/2 + 0.05 : 0) + (p.horiz ? 0 : uw * 0.28),
            p.horiz ? 0.55 : 0.07, 1.0, p.horiz ? 0.07 : 0.55, { perUnit: 1 });
      // Each front door on the terrace is one address.
      city.homes.push({
        x: hx + p.faceX * (p.horiz ? 0 : depth/2 + 1.4) + (p.horiz ? uw * 0.28 : 0),
        z: hz + p.faceZ * (p.horiz ? depth/2 + 1.4 : 0) + (p.horiz ? 0 : uw * 0.28),
        cap: 2,
      });
    }
    b.style(TEX.TILE, ROOF_TINTS[(p.rand() * ROOF_TINTS.length) | 0], 0);
    pitchedRoof(b, cx, ctx.baseY + h, cz,
                p.horiz ? runW/2 : depth/2, p.horiz ? depth/2 : runW/2,
                2.2, p.horiz, 0.4);
    city.addBuilding(cx - (p.horiz ? runW/2 : depth/2), cz - (p.horiz ? depth/2 : runW/2),
                     cx + (p.horiz ? runW/2 : depth/2), cz + (p.horiz ? depth/2 : runW/2),
                     ctx.baseY + h + 2.2, 0, 'a terrace');
  }, 1.0);
  // Kerbside parking wherever the street outside actually exists.
  for (let k = 0; k < 4; k++) {
    if (rand() < 0.4) continue;
    const side = (rand() * 4) | 0, t = 0.15 + rand() * 0.7;
    const px = side < 2 ? lerp(ctx.x0, ctx.x1, t) : (side === 2 ? ctx.x0 - 2.1 : ctx.x1 + 2.1);
    const pz = side < 2 ? (side === 0 ? ctx.z0 - 2.1 : ctx.z1 + 2.1) : lerp(ctx.z0, ctx.z1, t);
    if (!city.onRoadSurface(px, pz, 0)) continue;
    // Parallel to the kerb, facing along the road.
    city.addSpot(px, pz, side < 2 ? Math.PI / 2 : 0, 'kerb');
  }
};

// High street: shops at ground level, flats above, no gaps.
ZONE_BUILDERS[Z.HIGHST] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand, u } = ctx;
  const inset = 3.0;
  // Some blocks give their frontage over to a pay-and-display car park.
  let bz0 = z0 + inset;
  if (rand() < 0.38) {
    carPark(city, b, ctx, x0 + inset, z0 + inset, x1 - inset, z0 + inset + 16);
    bz0 = z0 + inset + 19;
  }
  const lots = splitLots(x0 + inset, bz0, x1 - inset, z1 - inset, rand, 2 + ((rand() * 2) | 0), 1.2);
  for (const [lx0, lz0, lx1, lz1] of lots) {
    if (lx1 - lx0 < 9 || lz1 - lz0 < 9) continue;
    const h = 13 + u * 22 + rand() * 8;
    city.buildBuilding(b, lx0, lz0, lx1, lz1, h, 0.45, ctx);
  }
  // Kerbside spots tight to the kerb, on streets that exist.
  for (let k = 0; k < 5; k++) {
    if (rand() > 0.6) continue;
    const side = (rand() * 4) | 0, t = 0.2 + rand() * 0.6;
    const px = side < 2 ? lerp(x0, x1, t) : (side === 2 ? x0 - 2.1 : x1 + 2.1);
    const pz = side < 2 ? (side === 0 ? z0 - 2.1 : z1 + 2.1) : lerp(z0, z1, t);
    if (!city.onRoadSurface(px, pz, 0)) continue;
    city.addSpot(px, pz, side < 2 ? Math.PI / 2 : 0, 'kerb');
  }
};

// Towers.
ZONE_BUILDERS[Z.DOWNTOWN] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand, u } = ctx;
  const inset = 3.0;
  // Even downtown keeps the odd surface lot between the towers.
  let bz0 = z0 + inset;
  if (rand() < 0.3) {
    carPark(city, b, ctx, x0 + inset, z0 + inset, x1 - inset, z0 + inset + 16);
    bz0 = z0 + inset + 19;
  }
  const lots = splitLots(x0 + inset, bz0, x1 - inset, z1 - inset, rand,
                         rand() < 0.5 ? 1 : 2, 2.5);
  for (const [lx0, lz0, lx1, lz1] of lots) {
    if (lx1 - lx0 < 9 || lz1 - lz0 < 9) continue;
    const h = 34 + u * u * (40 + rand() * 90) + rand() * 16;
    city.buildBuilding(b, lx0, lz0, lx1, lz1, h, 0.95, ctx);
  }
};

// Parks: grass, paths, trees, a bandstand now and then.
ZONE_BUILDERS[Z.PARK] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand } = ctx;
  const y = ctx.baseY;
  b.style(TEX.GRASS, [0.66, 0.82, 0.52], 0);
  b.quad([x0+2, y + 0.02, z1-2], [x1-2, y + 0.02, z1-2], [x1-2, y + 0.02, z0+2], [x0+2, y + 0.02, z0+2],
         (x1-x0)/8, (z1-z0)/8);
  // Crossing paths.
  const cx = (x0+x1)/2, cz = (z0+z1)/2;
  b.style(TEX.DIRT, [1.15, 1.12, 1.05], 0);
  b.quad([cx-2.2, y + 0.04, z1-2], [cx+2.2, y + 0.04, z1-2], [cx+2.2, y + 0.04, z0+2], [cx-2.2, y + 0.04, z0+2], 1, (z1-z0)/10);
  b.quad([x0+2, y + 0.05, cz+2.2], [x1-2, y + 0.05, cz+2.2], [x1-2, y + 0.05, cz-2.2], [x0+2, y + 0.05, cz-2.2], (x1-x0)/10, 1);

  const n = 8 + ((rand() * 8) | 0);
  for (let i = 0; i < n; i++) {
    const tx = lerp(x0 + 5, x1 - 5, rand()), tz = lerp(z0 + 5, z1 - 5, rand());
    if (Math.abs(tx - cx) < 4 || Math.abs(tz - cz) < 4) continue;
    if (rand() < 0.2) city.bush(b, tx, tz, 0.7 + rand() * 0.6);
    else city.tree(b, tx, tz, 0.9 + rand() * 0.8, y);
  }
  for (let i = 0; i < 4; i++) {
    if (rand() < 0.45) continue;
    city.bench(b, lerp(x0 + 8, x1 - 8, rand()), lerp(z0 + 8, z1 - 8, rand()), y);
  }
  if (rand() < 0.35) {
    // Bandstand.
    b.style(TEX.CONCRETE, [0.90, 0.88, 0.84], 0);
    b.cylinder(cx, y + 0.35, cz, 4.4, 0.7, 14, { uRepeat: 8, vRepeat: 1 });
    b.style(TEX.METAL, [0.35, 0.40, 0.38], 0);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      b.cylinder(cx + Math.cos(a) * 3.8, y + 2.2, cz + Math.sin(a) * 3.8, 0.13, 3.0, 6);
    }
    b.style(TEX.TILE, [0.55, 0.52, 0.56], 0);
    b.cylinder(cx, y + 4.2, cz, 4.8, 0.5, 14, { uRepeat: 10, vRepeat: 1 });
    city.addCollider(cx - 4.4, cz - 4.4, cx + 4.4, cz + 4.4, y + 0.7, 'the bandstand');
  }
  city.parks.push({ x0, z0, x1, z1 });
};

// Industrial estate: big sheds, yards, containers, a silo.
ZONE_BUILDERS[Z.INDUSTRIAL] = (city, b, ctx) => {
  const { x0, z0, x1, z1, rand } = ctx;
  const y = ctx.baseY;
  b.style(TEX.CONCRETE, [0.80, 0.80, 0.78], 0);
  b.quad([x0+2, y + 0.02, z1-2], [x1-2, y + 0.02, z1-2], [x1-2, y + 0.02, z0+2], [x0+2, y + 0.02, z0+2],
         (x1-x0)/7, (z1-z0)/7);

  // Sheds take one end of the block; the rest is yard, which is where the
  // containers and the silo have to go or they end up inside a building.
  const yard = 0.30 + rand() * 0.10;
  const vertical = rand() < 0.5;
  const yx0 = vertical ? x0 : lerp(x0, x1, 1 - yard);
  const yz0 = vertical ? lerp(z0, z1, 1 - yard) : z0;
  const bx1 = vertical ? x1 : lerp(x0, x1, 1 - yard);
  const bz1 = vertical ? lerp(z0, z1, 1 - yard) : z1;

  const sheds = 1 + ((rand() * 2) | 0);
  for (let k = 0; k < sheds; k++) {
    const a = k / sheds, c = (k + 1) / sheds;
    const sx0 = (vertical ? lerp(x0, bx1, a) : x0) + 5;
    const sx1 = (vertical ? lerp(x0, bx1, c) : bx1) - 5;
    const sz0 = (vertical ? z0 : lerp(z0, bz1, a)) + 5;
    const sz1 = (vertical ? bz1 : lerp(z0, bz1, c)) - 5;
    const w = sx1 - sx0, d = sz1 - sz0;
    if (w < 12 || d < 12) continue;
    const cx = (sx0+sx1)/2, cz = (sz0+sz1)/2;
    const h = 8 + rand() * 5;
    b.style(TEX.SIDING, [0.86, 0.88, 0.88], 0);
    b.box(cx, y + h/2, cz, w/2, h/2, d/2,
          { skipTop: true, uvU: Math.max(2, Math.round(w / 8)), uvV: 1 });
    b.style(TEX.METAL, [0.52, 0.55, 0.56], 0);
    pitchedRoof(b, cx, y + h, cz, w/2, d/2, Math.min(w, d) * 0.10, w >= d, 0.5);
    // Roller shutter doors on the long side.
    b.style(TEX.METAL, [0.40, 0.42, 0.44], 0);
    const doors = Math.max(1, Math.floor((w >= d ? w : d) / 14));
    for (let q = 0; q < doors; q++) {
      const t = (q + 0.5) / doors - 0.5;
      if (w >= d) b.box(cx + t * w * 0.8, y + 2.2, cz - d/2 - 0.06, 2.6, 2.2, 0.1, { perUnit: 0.5 });
      else b.box(cx - w/2 - 0.06, y + 2.2, cz + t * d * 0.8, 0.1, 2.2, 2.6, { perUnit: 0.5 });
    }
    city.addBuilding(sx0, sz0, sx1, sz1, y + h + Math.min(w, d) * 0.10, 0, 'a warehouse');
    city.works.push({ x: cx, z: sz0 - 2, jobs: 8 });
  }

  // Container stacks in the yard.
  const COLOURS = [[0.72,0.28,0.20],[0.20,0.42,0.62],[0.68,0.60,0.22],[0.28,0.50,0.34]];
  for (let k = 0; k < 7; k++) {
    if (rand() < 0.25) continue;
    const cx = lerp(yx0 + 8, x1 - 8, rand()), cz = lerp(yz0 + 8, z1 - 8, rand());
    const stack = 1 + ((rand() * 2) | 0);
    const alongX = rand() < 0.5;
    for (let s = 0; s < stack; s++) {
      b.style(TEX.SIDING, COLOURS[(rand() * COLOURS.length) | 0], 0);
      b.box(cx, y + 1.3 + s * 2.6, cz, alongX ? 6 : 1.2, 1.3, alongX ? 1.2 : 6,
            { perUnit: 0.35 });
    }
    city.addCollider(cx - (alongX ? 6 : 1.2), cz - (alongX ? 1.2 : 6),
                     cx + (alongX ? 6 : 1.2), cz + (alongX ? 1.2 : 6),
                     y + stack * 2.6, 'a shipping container');
  }
  if (rand() < 0.5) {
    const sx = lerp(yx0 + 10, x1 - 10, rand()), sz = lerp(yz0 + 10, z1 - 10, rand());
    b.style(TEX.METAL, [0.78, 0.78, 0.76], 0);
    b.cylinder(sx, y + 9, sz, 3.2, 18, 14, { uRepeat: 6, vRepeat: 4 });
    b.style(TEX.METAL, [0.55, 0.56, 0.58], 0);
    b.cylinder(sx, y + 18.4, sz, 3.3, 0.8, 14, { uRepeat: 6, vRepeat: 1 });
    city.addCollider(sx - 3.2, sz - 3.2, sx + 3.2, sz + 3.2, y + 18.4, 'a grain silo');
  }
};

// The river. Its surface runs out under the roads on any side where the next
// block is also water, so the channel reads as continuous and the road over
// it reads as a bridge rather than a dam.
ZONE_BUILDERS[Z.WATER] = (city, b, ctx) => {
  const { x0, z0, x1, z1, bi, bj, rand } = ctx;
  const wet = (i, j) => city.zones.zoneAt(i, j) === Z.WATER;
  const over = ROAD / 2 + 0.5;
  const wx0 = x0 - (wet(bi - 1, bj) ? over : 0), wx1 = x1 + (wet(bi + 1, bj) ? over : 0);
  const wz0 = z0 - (wet(bi, bj - 1) ? over : 0), wz1 = z1 + (wet(bi, bj + 1) ? over : 0);

  b.style(TEX.WATER, [0.78, 0.88, 0.96], -1);   // negative emissive = glossy
  b.quad([wx0, WATER_Y, wz1], [wx1, WATER_Y, wz1], [wx1, WATER_Y, wz0], [wx0, WATER_Y, wz0],
         (wx1-wx0)/26, (wz1-wz0)/26);
  // Riverbed, so a low camera does not see through the surface into nothing.
  b.style(TEX.DIRT, [0.55, 0.52, 0.46], 0);
  b.quad([wx0, WATER_Y - 1.4, wz1], [wx1, WATER_Y - 1.4, wz1],
         [wx1, WATER_Y - 1.4, wz0], [wx0, WATER_Y - 1.4, wz0], 6, 6);

  // Banks: a sloped edge on each dry side, with a stone lip at street level.
  const bank = (ax0, az0, ax1, az1, nx, nz) => {
    b.style(TEX.DIRT, [0.62, 0.58, 0.50], 0);
    b.quad([ax0, 0, az0], [ax1, 0, az1],
           [ax1 + nx * BANK_W, WATER_Y - 0.6, az1 + nz * BANK_W],
           [ax0 + nx * BANK_W, WATER_Y - 0.6, az0 + nz * BANK_W], 6, 1.2);
    b.style(TEX.CONCRETE, [0.86, 0.86, 0.82], 0);
    b.box((ax0 + ax1) / 2 + nx * 0.35, 0.16, (az0 + az1) / 2 + nz * 0.35,
          Math.abs(ax1 - ax0) / 2 + (nx ? 0.35 : 0), 0.16,
          Math.abs(az1 - az0) / 2 + (nz ? 0.35 : 0), { perUnit: 0.3 });
  };
  if (!wet(bi, bj - 1)) bank(x0, z0, x1, z0, 0, 1);
  if (!wet(bi, bj + 1)) bank(x1, z1, x0, z1, 0, -1);
  if (!wet(bi - 1, bj)) bank(x0, z1, x0, z0, 1, 0);
  if (!wet(bi + 1, bj)) bank(x1, z0, x1, z1, -1, 0);

  // Reeds and the odd moored boat.
  for (let k = 0; k < 8; k++) {
    if (rand() < 0.4) continue;
    const rx = lerp(x0 + 2, x1 - 2, rand()), rz = lerp(z0 + 2, z1 - 2, rand());
    const edge = Math.min(rx - x0, x1 - rx, rz - z0, z1 - rz);
    if (edge > 7) continue;                    // reeds grow at the margins
    b.style(TEX.LEAVES, [0.70, 0.78, 0.42], 0);
    for (let s = 0; s < 5; s++) {
      b.box(rx + (rand()-0.5)*2.4, WATER_Y + 0.9, rz + (rand()-0.5)*2.4,
            0.07, 0.9, 0.07, { perUnit: 1 });
    }
  }
  if (rand() < 0.45) {
    const bx = lerp(x0 + 6, x1 - 6, rand()), bz = lerp(z0 + 6, z1 - 6, rand());
    const alongX = rand() < 0.5;
    b.style(TEX.PLAIN, [0.86, 0.84, 0.78], 0);
    b.chamferBox(bx, WATER_Y + 0.35, bz, alongX ? 3.2 : 1.1, 0.45, alongX ? 1.1 : 3.2, 0.5,
                 { perUnit: 0.6 });
    b.style(TEX.BARK, [0.55, 0.40, 0.28], 0);
    b.box(bx, WATER_Y + 0.72, bz, alongX ? 2.4 : 0.8, 0.06, alongX ? 0.8 : 2.4, { perUnit: 0.8 });
  }
  city.water.push({ x0, z0, x1, z1 });
};

// Split a rectangle into lots, cutting on one axis then optionally the other.
// Shared by the high street and downtown, which differ only in how coarse the
// split is and how tall the result gets.
function splitLots(x0, z0, x1, z1, rand, count, gap) {
  const vertical = rand() < 0.5;
  const cuts = [0];
  for (let i = 1; i < count; i++) cuts.push(i / count + (rand() - 0.5) * 0.18);
  cuts.push(1);
  const lots = [];
  for (let i = 0; i < count; i++) {
    const a = cuts[i], c = cuts[i + 1];
    if (vertical) lots.push([lerp(x0, x1, a), z0, lerp(x0, x1, c) - gap, z1]);
    else lots.push([x0, lerp(z0, z1, a), x1, lerp(z0, z1, c) - gap]);
  }
  const out = [];
  for (const l of lots) {
    if (rand() < 0.4 && Math.min(l[2]-l[0], l[3]-l[1]) > 24) {
      const t = 0.4 + rand() * 0.2;
      if (vertical) {
        out.push([l[0], l[1], l[2], lerp(l[1], l[3], t) - gap]);
        out.push([l[0], lerp(l[1], l[3], t), l[2], l[3]]);
      } else {
        out.push([l[0], l[1], lerp(l[0], l[2], t) - gap, l[3]]);
        out.push([lerp(l[0], l[2], t), l[1], l[2], l[3]]);
      }
    } else out.push(l);
  }
  return out;
}
