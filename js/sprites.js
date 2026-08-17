// Sprite people.
//
// The box-and-ball pedestrians read as blocky at any distance, and no amount
// of extra boxes fixes that — a person is a silhouette, and a silhouette is
// what a sprite gives you for nothing.
//
// The sheet layout is chrandalf/80sadventure's character contract, verbatim:
// 48x80 cells, six columns by five rows, anchored bottom-centre. Row 0 faces
// the camera, row 1 faces right, row 2 faces away; left-facing is the
// right-facing row mirrored, so it is never drawn. Columns 0-3 of those rows
// are the walk cycle and column 0 doubles as standing. That repo has the
// contract but not yet the art, so these sheets are painted here in the same
// style — flat colour, three shades, a bold dark contour — and any real PNG
// dropped in over the top is used instead, cell for cell.
'use strict';

const SPR = {
  cellW: 48, cellH: 80, cols: 6, rows: 5,
  anchorX: 24, anchorY: 80,        // feet, centred
  perRow: 4,                       // character sheets across the atlas
};
const SPR_SHEET_W = SPR.cellW * SPR.cols;    // 288
const SPR_SHEET_H = SPR.cellH * SPR.rows;    // 400

// Walk cycle: which column of the row to show, by phase. Column 0 is the
// standing pose, so a contact frame either side of it reads as a stride.
const WALK_COLS = [1, 0, 2, 0];

// Row index by which way the person is facing relative to the camera.
const FACE_SOUTH = 0, FACE_EAST = 1, FACE_NORTH = 2;

// A handful of townspeople. Colours are picked to survive the tone mapping:
// mid-tone clothes, because anything near black loses its shape at night.
const TOWNSFOLK = [
  { coat: [0.16, 0.30, 0.62], trews: [0.20, 0.20, 0.26], hair: [0.28, 0.18, 0.12], skin: [0.94, 0.76, 0.62] },
  { coat: [0.72, 0.16, 0.20], trews: [0.16, 0.18, 0.30], hair: [0.14, 0.11, 0.10], skin: [0.86, 0.64, 0.48] },
  { coat: [0.86, 0.68, 0.22], trews: [0.30, 0.24, 0.18], hair: [0.62, 0.44, 0.18], skin: [0.96, 0.80, 0.66] },
  { coat: [0.20, 0.48, 0.32], trews: [0.22, 0.22, 0.24], hair: [0.20, 0.14, 0.10], skin: [0.62, 0.44, 0.32] },
  { coat: [0.60, 0.30, 0.62], trews: [0.14, 0.16, 0.22], hair: [0.70, 0.60, 0.42], skin: [0.92, 0.74, 0.60] },
  { coat: [0.90, 0.90, 0.88], trews: [0.24, 0.30, 0.44], hair: [0.34, 0.22, 0.14], skin: [0.88, 0.68, 0.52] },
  { coat: [0.24, 0.56, 0.66], trews: [0.28, 0.20, 0.16], hair: [0.16, 0.13, 0.12], skin: [0.70, 0.50, 0.36] },
  { coat: [0.78, 0.42, 0.16], trews: [0.18, 0.22, 0.28], hair: [0.46, 0.30, 0.16], skin: [0.94, 0.78, 0.64] },
];

const css = (c, k) => `rgb(${Math.round(clamp(c[0] * (k || 1), 0, 1) * 255)},` +
                      `${Math.round(clamp(c[1] * (k || 1), 0, 1) * 255)},` +
                      `${Math.round(clamp(c[2] * (k || 1), 0, 1) * 255)})`;

// One 48x80 cell. `dir` is the row, `step` is 0..3 through the walk cycle.
// Everything is drawn twice: once fat in the contour colour, once in the
// material. That outline is the whole 80s cel-shaded look, and it is also
// what keeps a 48-pixel figure readable against a busy street.
function paintPerson(ctx, ox, oy, ch, dir, step, talking) {
  const INK = 'rgb(14,11,18)';
  const LINE = 2.0;      // contour width; this is what makes the figure read
  const swing = Math.sin(step / 4 * Math.PI * 2);
  const side = dir === FACE_EAST;
  const back = dir === FACE_NORTH;

  // Local helper: a rounded limb or slab, outlined then filled.
  const slab = (x, y, w, h, fill, r) => {
    const rr = r === undefined ? Math.min(w, h) * 0.45 : r;
    ctx.fillStyle = INK;
    roundRectPath(ctx, ox + x - LINE, oy + y - LINE, w + LINE*2, h + LINE*2, rr + LINE);
    ctx.fill();
    ctx.fillStyle = fill;
    roundRectPath(ctx, ox + x, oy + y, w, h, rr);
    ctx.fill();
  };

  const cx = SPR.cellW / 2;
  const legTop = 46, legLen = 26;
  const legSpread = side ? 0 : 6.5;

  // Legs. The trailing leg goes down first so the leading one overlaps it.
  const legs = [[-1, swing], [1, -swing]];
  legs.sort((a, b) => (side ? a[1] - b[1] : 0));
  for (const [s, sw] of legs) {
    const lean = sw * (side ? 7 : 4);
    const foot = Math.abs(sw) * 2.5;
    slab(cx + s * legSpread - 3.5 + lean * 0.5, legTop, 7, legLen - foot, css(ch.trews), 3);
    // Shoe.
    slab(cx + s * legSpread - 5 + lean, legTop + legLen - foot - 3, 11, 6, css(ch.trews, 0.5), 2.5);
  }

  // Body. A coat that flares slightly at the hem reads as a person rather
  // than a cardboard tube, and costs one extra pixel of width.
  ctx.fillStyle = INK;
  roundRectPath(ctx, ox + cx - 10 - LINE, oy + 23 - LINE, 20 + LINE*2, 25 + LINE*2, 4.5 + LINE);
  ctx.fill();
  ctx.fillStyle = css(ch.coat);
  roundRectPath(ctx, ox + cx - 10, oy + 23, 20, 25, 4.5);
  ctx.fill();
  // Shading down one side: the light is over the character's left shoulder.
  ctx.fillStyle = css(ch.coat, 0.66);
  roundRectPath(ctx, ox + cx + 2, oy + 23, 8, 25, 4.5);
  ctx.fill();
  if (!back) {
    // Front placket, and a collar line.
    ctx.fillStyle = css(ch.coat, 0.45);
    ctx.fillRect(ox + cx - (side ? 6 : 1), oy + 24, 2, 22);
  }

  // Arms, swinging opposite the legs.
  for (const [s, sw] of [[-1, -swing], [1, swing]]) {
    if (side && s < 0) continue;                 // the far arm is hidden
    const lean = sw * (side ? 8 : 5);
    slab(cx + s * (side ? 0 : 11) - 3.5 + lean * 0.4, 25, 7, 19, css(ch.coat, 0.82), 3);
    // Hand.
    slab(cx + s * (side ? 0 : 11) - 3 + lean, 42, 6, 6, css(ch.skin), 3);
  }

  // Head: skull, hair, and — facing the camera — a face.
  slab(cx - 8, 8, 16, 17, css(ch.skin), 6);
  ctx.fillStyle = INK;
  roundRectPath(ctx, ox + cx - 8.4 - LINE, oy + 7.6 - LINE, 16.8 + LINE*2, 8.5 + LINE*2, 4.6 + LINE);
  ctx.fill();
  ctx.fillStyle = css(ch.hair);
  roundRectPath(ctx, ox + cx - 8.4, oy + 7.6, 16.8, 8.5, 4.6);
  ctx.fill();
  if (back) {
    ctx.fillStyle = css(ch.hair, 0.85);
    roundRectPath(ctx, ox + cx - 8, oy + 10, 16, 12, 4);
    ctx.fill();
  } else {
    const ex = side ? 3 : 0;
    ctx.fillStyle = INK;
    if (!side) {
      ctx.fillRect(ox + cx - 4.5, oy + 17, 2, 2.5);
      ctx.fillRect(ox + cx + 2.5, oy + 17, 2, 2.5);
    } else {
      ctx.fillRect(ox + cx + 2.5 + ex - 3, oy + 17, 2, 2.5);
    }
    // Mouth: open on the talk frames, a line otherwise.
    ctx.fillStyle = talking ? 'rgb(80,30,34)' : INK;
    ctx.fillRect(ox + cx - 2 + ex, oy + 21, talking ? 5 : 4, talking ? 3 : 1.2);
  }
  // Neck shadow, which is what stops the head reading as a balloon.
  ctx.fillStyle = css(ch.skin, 0.55);
  ctx.fillRect(ox + cx - 3, oy + 23.5, 6, 2);
}

function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

// Build the atlas: one sheet per character, laid out in a grid. Any entry in
// `pngs` (id -> HTMLImageElement) replaces that character's whole sheet, which
// is how a hand-drawn 288x400 sheet takes over from the painted one.
function buildSpriteAtlas(gl, pngs) {
  const n = TOWNSFOLK.length;
  const across = SPR.perRow, down = Math.ceil(n / across);
  const c = document.createElement('canvas');
  c.width = SPR_SHEET_W * across;
  c.height = SPR_SHEET_H * down;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < n; i++) {
    const sx = (i % across) * SPR_SHEET_W, sy = ((i / across) | 0) * SPR_SHEET_H;
    const supplied = pngs && pngs[i];
    if (supplied) {
      ctx.drawImage(supplied, sx, sy, SPR_SHEET_W, SPR_SHEET_H);
      continue;
    }
    const ch = TOWNSFOLK[i];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < SPR.cols; col++) {
        const talking = col >= 4;
        const step = talking ? 0 : col;
        paintPerson(ctx, sx + col * SPR.cellW, sy + row * SPR.cellH, ch, row, step, talking);
      }
    }
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  // Nearest magnification keeps the pixels crisp when a pedestrian is close;
  // mipmapped minification stops the far ones fizzing.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { tex, across, down, width: c.width, height: c.height, count: n };
}

// Look for hand-drawn sheets and hand them back when they arrive. The painted
// atlas is built first and used immediately, so a missing or slow sheet never
// stops the game — it is simply replaced when it turns up.
function loadCharacterSheets(done) {
  const inlined = window.CHARACTER_SHEET_SRC || null;
  const found = {};
  let outstanding = 0, any = false;
  const finish = () => { if (--outstanding === 0 && any) done(found); };
  for (let i = 0; i < TOWNSFOLK.length; i++) {
    const src = inlined ? inlined[i] : `assets/characters/${i}.png`;
    if (inlined && !src) continue;
    const img = new Image();
    outstanding++;
    img.onload = () => { found[i] = img; any = true; finish(); };
    // A sheet that is simply not there is the normal case, not an error.
    img.onerror = () => finish();
    img.src = src;
  }
  if (outstanding === 0) return;
}

// UV rectangle of one cell, inset by half a texel so neighbouring cells never
// bleed in when the sprite is minified.
function spriteUV(atlas, sheet, row, col, mirror) {
  const sx = (sheet % atlas.across) * SPR_SHEET_W + col * SPR.cellW;
  const sy = ((sheet / atlas.across) | 0) * SPR_SHEET_H + row * SPR.cellH;
  const px = 0.5 / atlas.width, py = 0.5 / atlas.height;
  let u0 = sx / atlas.width + px, u1 = (sx + SPR.cellW) / atlas.width - px;
  const v0 = sy / atlas.height + py, v1 = (sy + SPR.cellH) / atlas.height - py;
  if (mirror) { const t = u0; u0 = u1; u1 = t; }
  return { u0, v0, u1, v1 };
}

// Which row, and whether to mirror, for a person facing `yaw` when the
// direction from them to the camera is `toCamYaw`. Right-facing is the only
// side drawn, so the left half of the circle is that row flipped.
function spriteFacing(yaw, toCamYaw) {
  let a = yaw - toCamYaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  const d = Math.abs(a);
  if (d < Math.PI * 0.3) return { row: FACE_SOUTH, mirror: false };    // looking at us
  if (d > Math.PI * 0.7) return { row: FACE_NORTH, mirror: false };    // walking away
  // Their nose crosses the screen to the right for a > 0.
  return { row: FACE_EAST, mirror: a < 0 };
}

// Append one upright, camera-facing person to a mesh builder. Knocked-down
// people are laid flat on the ground instead of standing on the spot.
function pushPersonSprite(b, atlas, p, camX, camZ, height) {
  const dx = camX - p.x, dz = camZ - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len, tz = dz / len;
  const toCamYaw = Math.atan2(tx, tz);
  const sheet = p.sheet === undefined ? 0 : p.sheet;
  const fallen = p.knocked > 0;

  let row, mirror, col;
  if (fallen) {
    row = FACE_SOUTH; mirror = false; col = 0;
  } else {
    const f = spriteFacing(p.yaw, toCamYaw);
    row = f.row; mirror = f.mirror;
    const moving = (p.speed === undefined ? 1 : p.speed) > 0.4;
    col = moving ? WALK_COLS[Math.floor(p.phase / (Math.PI / 2)) & 3] : 0;
  }
  const uv = spriteUV(atlas, sheet, row, col, mirror);

  const H = height, W = H * (SPR.cellW / SPR.cellH);
  // Screen-right in the ground plane.
  const rx = tz, rz = -tx;
  const y0 = p.y || 0;

  let c0, c1, c2, c3;
  if (fallen) {
    // Flat out: the sheet is laid on the tarmac, head away from the camera.
    const hz = H * 0.5, hw = W * 0.5;
    const cx = p.x, cz = p.z, y = y0 + 0.06;
    c0 = [cx - rx*hw - tx*hz, y, cz - rz*hw - tz*hz];
    c1 = [cx + rx*hw - tx*hz, y, cz + rz*hw - tz*hz];
    c2 = [cx + rx*hw + tx*hz, y, cz + rz*hw + tz*hz];
    c3 = [cx - rx*hw + tx*hz, y, cz - rz*hw + tz*hz];
  } else {
    const hw = W * 0.5;
    c0 = [p.x - rx*hw, y0,     p.z - rz*hw];
    c1 = [p.x + rx*hw, y0,     p.z + rz*hw];
    c2 = [p.x + rx*hw, y0 + H, p.z + rz*hw];
    c3 = [p.x - rx*hw, y0 + H, p.z - rz*hw];
  }
  // A billboard has no real surface, so it is given the normal that makes it
  // shade like a person standing there: facing the camera, tilted up a little.
  const nx = tx * 0.82, ny = 0.57, nz = tz * 0.82;
  const base = b.vertex(c0[0], c0[1], c0[2], nx, ny, nz, uv.u0, uv.v1);
  b.vertex(c1[0], c1[1], c1[2], nx, ny, nz, uv.u1, uv.v1);
  b.vertex(c2[0], c2[1], c2[2], nx, ny, nz, uv.u1, uv.v0);
  b.vertex(c3[0], c3[1], c3[2], nx, ny, nz, uv.u0, uv.v0);
  b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
