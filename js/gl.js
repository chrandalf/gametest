// WebGL2 helpers: shader compilation, geometry building, procedural texture array.
'use strict';

// ---------------------------------------------------------------- shaders ---

function compileShader(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(`${name} shader failed:\n${log}`);
    throw new Error(`${name} shader: ${log}`);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc, name) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc, name + ' vertex'));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, name + ' fragment'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
  }
  // Cache every active uniform location on the program object.
  p.u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const base = info.name.replace(/\[0\]$/, '');
    p.u[base] = gl.getUniformLocation(p, info.name);
  }
  return p;
}

// ------------------------------------------------------------- mesh build ---

// Vertex layout: pos(3) normal(3) uv(2) layer(1) tint(3) emissive(1) = 13 floats.
const VERT_FLOATS = 13;

class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
    this.layer = 0;
    this.tint = [1, 1, 1];
    this.emis = 0;
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  style(layer, tint, emis) {
    this.layer = layer;
    if (tint) this.tint = tint;
    this.emis = emis || 0;
    return this;
  }

  vertex(x, y, z, nx, ny, nz, u, v) {
    this.v.push(x, y, z, nx, ny, nz, u, v, this.layer,
                this.tint[0], this.tint[1], this.tint[2], this.emis);
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
    return (this.v.length / VERT_FLOATS) - 1;
  }

  // Quad wound p0->p1->p2->p3 (counter-clockwise when seen from the front).
  quad(p0, p1, p2, p3, uw, uh) {
    const ax = p1[0]-p0[0], ay = p1[1]-p0[1], az = p1[2]-p0[2];
    const bx = p3[0]-p0[0], by = p3[1]-p0[1], bz = p3[2]-p0[2];
    let nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx/=len; ny/=len; nz/=len;
    const base = this.vertex(p0[0],p0[1],p0[2], nx,ny,nz, 0, 0);
    this.vertex(p1[0],p1[1],p1[2], nx,ny,nz, uw, 0);
    this.vertex(p2[0],p2[1],p2[2], nx,ny,nz, uw, uh);
    this.vertex(p3[0],p3[1],p3[2], nx,ny,nz, 0, uh);
    this.i.push(base, base+1, base+2, base, base+2, base+3);
    return this;
  }

  // Axis-aligned box from center + half extents, with per-face options.
  box(cx, cy, cz, hx, hy, hz, opt) {
    opt = opt || {};
    const perUnit = opt.perUnit || 0.25;       // texture repeats per world unit
    const uvU = opt.uvU, uvV = opt.uvV;        // explicit repeat counts override
    const x0=cx-hx, x1=cx+hx, y0=cy-hy, y1=cy+hy, z0=cz-hz, z1=cz+hz;
    const sideLayer = opt.side !== undefined ? opt.side : this.layer;
    const topLayer = opt.top !== undefined ? opt.top : sideLayer;
    const sideTint = opt.sideTint || this.tint;
    const topTint = opt.topTint || sideTint;
    const w = hx*2, h = hy*2, d = hz*2;
    const ru = (s) => uvU !== undefined ? uvU : s * perUnit;
    const rv = (s) => uvV !== undefined ? uvV : s * perUnit;

    this.style(sideLayer, sideTint, opt.emis || 0);
    if (!opt.skipSides) {
      this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], ru(w), rv(h)); // +Z
      this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0], ru(w), rv(h)); // -Z
      this.quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1], ru(d), rv(h)); // +X
      this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0], ru(d), rv(h)); // -X
    }
    this.style(topLayer, topTint, opt.topEmis || opt.emis || 0);
    if (!opt.skipTop) {
      this.quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],
                opt.topU !== undefined ? opt.topU : w*perUnit,
                opt.topV !== undefined ? opt.topV : d*perUnit);
    }
    if (opt.bottom) {
      this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1], w*perUnit, d*perUnit);
    }
    return this;
  }

  cylinder(cx, cy, cz, r, h, seg, opt) {
    opt = opt || {};
    const axis = opt.axis || 'y';
    const half = h / 2;
    const start = this.v.length / VERT_FLOATS;
    const place = (a, t) => {
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      const off = (t - 0.5) * h;
      if (axis === 'y') return [cx + c, cy + off, cz + s];
      if (axis === 'x') return [cx + off, cy + c, cz + s];
      return [cx + c, cy + s, cz + off];
    };
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      this.quad(place(a1, 0), place(a0, 0), place(a0, 1), place(a1, 1),
                (opt.uRepeat || 1) / seg, opt.vRepeat || 1);
    }
    // Caps
    for (const t of [0, 1]) {
      const centerIdx = this.vertex(
        ...(axis === 'y' ? [cx, cy + (t - 0.5) * h, cz] :
            axis === 'x' ? [cx + (t - 0.5) * h, cy, cz] : [cx, cy, cz + (t - 0.5) * h]),
        ...(axis === 'y' ? [0, t ? 1 : -1, 0] : axis === 'x' ? [t ? 1 : -1, 0, 0] : [0, 0, t ? 1 : -1]),
        0.5, 0.5);
      const ring = [];
      for (let i = 0; i < seg; i++) {
        const a = i / seg * Math.PI * 2;
        const p = place(a, t);
        ring.push(this.vertex(p[0], p[1], p[2],
          ...(axis === 'y' ? [0, t ? 1 : -1, 0] : axis === 'x' ? [t ? 1 : -1, 0, 0] : [0, 0, t ? 1 : -1]),
          0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5));
      }
      for (let i = 0; i < seg; i++) {
        const a = ring[i], b = ring[(i + 1) % seg];
        if (t) this.i.push(centerIdx, a, b); else this.i.push(centerIdx, b, a);
      }
    }
    void start; void half;
    return this;
  }

  sphere(cx, cy, cz, r, seg, rings, squashY) {
    const sy = squashY === undefined ? 1 : squashY;
    const idx = [];
    for (let y = 0; y <= rings; y++) {
      const v = y / rings, phi = v * Math.PI;
      const row = [];
      for (let x = 0; x <= seg; x++) {
        const u = x / seg, theta = u * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);
        row.push(this.vertex(cx + nx*r, cy + ny*r*sy, cz + nz*r, nx, ny, nz, u*2, v*2));
      }
      idx.push(row);
    }
    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < seg; x++) {
        const a = idx[y][x], b = idx[y][x+1], c = idx[y+1][x+1], d = idx[y+1][x];
        this.i.push(a, d, c, a, c, b);
      }
    }
    return this;
  }

  append(other, dx, dy, dz) {
    const base = this.v.length / VERT_FLOATS;
    for (let i = 0; i < other.v.length; i += VERT_FLOATS) {
      const x = other.v[i] + dx, y = other.v[i+1] + dy, z = other.v[i+2] + dz;
      this.v.push(x, y, z);
      for (let k = 3; k < VERT_FLOATS; k++) this.v.push(other.v[i+k]);
      if (x < this.min[0]) this.min[0] = x;
      if (y < this.min[1]) this.min[1] = y;
      if (z < this.min[2]) this.min[2] = z;
      if (x > this.max[0]) this.max[0] = x;
      if (y > this.max[1]) this.max[1] = y;
      if (z > this.max[2]) this.max[2] = z;
    }
    for (const i of other.i) this.i.push(i + base);
    return this;
  }

  get empty() { return this.i.length === 0; }

  upload(gl) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.v), gl.STATIC_DRAW);
    const stride = VERT_FLOATS * 4;
    const attrs = [[0,3,0],[1,3,3],[2,2,6],[3,1,8],[4,3,9],[5,1,12]];
    for (const [loc, size, off] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    }
    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      vao, count: this.i.length,
      min: this.min.slice(), max: this.max.slice(),
    };
  }
}

// ------------------------------------------------- procedural texture set ---

const TEX = {
  ASPHALT: 0, SIDEWALK: 1, GRASS: 2, ROOF: 3, PLAIN: 4,
  GLASS: 5, OFFICE: 6, BRICK: 7, MODERN: 8, TOWER: 9,
  SHOP: 10, METAL: 11, CONCRETE: 12, LEAVES: 13, BARK: 14, MARK: 15,
};
const TEX_COUNT = 16;
const TEX_SIZE = 256;

function makeTextureArray(gl) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  const ctx = c.getContext('2d');
  const mc = document.createElement('canvas');
  mc.width = mc.height = TEX_SIZE;
  const mctx = mc.getContext('2d');

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 9, gl.RGBA8, TEX_SIZE, TEX_SIZE, TEX_COUNT);

  const rand = makeRandom(1337);
  const S = TEX_SIZE;

  const noise = (amount, alpha) => {
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * amount;
      d[i] = clamp(d[i] + n, 0, 255);
      d[i+1] = clamp(d[i+1] + n, 0, 255);
      d[i+2] = clamp(d[i+2] + n, 0, 255);
      if (alpha !== undefined) d[i+3] = alpha;
    }
    ctx.putImageData(img, 0, 0);
  };

  const fill = (col) => { ctx.fillStyle = col; ctx.fillRect(0, 0, S, S); };
  const clearMask = () => { mctx.fillStyle = '#000'; mctx.fillRect(0, 0, S, S); };

  // Draws a grid of windows on the colour canvas and records them in the mask,
  // so night lighting can glow only through the glass.
  const windows = (cols, rows, opt) => {
    const cw = S / cols, ch = S / rows;
    const wIn = opt.wIn === undefined ? 0.26 : opt.wIn;
    const hIn = opt.hIn === undefined ? 0.24 : opt.hIn;
    for (let r = 0; r < rows; r++) {
      for (let cI = 0; cI < cols; cI++) {
        const x = cI * cw + cw * wIn, y = r * ch + ch * hIn;
        const w = cw * (1 - wIn * 2), h = ch * (1 - hIn * 2);
        const lit = rand() < (opt.litChance === undefined ? 0.55 : opt.litChance);
        const shade = 0.55 + rand() * 0.45;
        ctx.fillStyle = opt.glass(shade, lit);
        ctx.fillRect(x, y, w, h);
        if (opt.frame) {
          ctx.strokeStyle = opt.frame;
          ctx.lineWidth = Math.max(1, S / 220);
          ctx.strokeRect(x, y, w, h);
        }
        if (lit) {
          const g = Math.floor(150 + rand() * 105);
          mctx.fillStyle = `rgb(${g},${g},${g})`;
          mctx.fillRect(x, y, w, h);
        }
      }
    }
  };

  const painters = {};

  painters[TEX.ASPHALT] = () => {
    fill('#41444a');
    // Aggregate: grey-on-grey only, so the road never looks like confetti.
    for (let i = 0; i < 2200; i++) {
      const g = 45 + rand()*55;
      ctx.fillStyle = `rgba(${g|0},${(g*1.02)|0},${(g*1.06)|0},0.35)`;
      ctx.fillRect(rand()*S, rand()*S, 1 + rand()*4, 1 + rand()*3);
    }
    // Broad tar patches.
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = `rgba(56,58,62,${0.10 + rand()*0.10})`;
      ctx.beginPath();
      ctx.ellipse(rand()*S, rand()*S, 14+rand()*34, 10+rand()*28, rand()*3, 0, 6.3);
      ctx.fill();
    }
    // Hairline cracks.
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = 'rgba(38,39,42,0.55)';
      ctx.lineWidth = 0.8 + rand()*0.7;
      ctx.beginPath();
      let x = rand()*S, y = rand()*S;
      ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (rand()-0.5)*40; y += (rand()-0.5)*40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    noise(10);
  };

  painters[TEX.SIDEWALK] = () => {
    fill('#9a9a94');
    const n = 4, cs = S / n;
    ctx.strokeStyle = 'rgba(60,60,58,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i*cs, 0); ctx.lineTo(i*cs, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i*cs); ctx.lineTo(S, i*cs); ctx.stroke();
    }
    for (let i = 0; i < 300; i++) {
      const g = 120 + rand()*60 | 0;
      ctx.fillStyle = `rgba(${g},${g},${g-4},0.35)`;
      ctx.fillRect(rand()*S, rand()*S, 3+rand()*6, 3+rand()*6);
    }
    noise(14);
  };

  painters[TEX.GRASS] = () => {
    fill('#415c33');
    // Patchy tone variation first, then blades, for a muted park green.
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(${52+rand()*40|0},${74+rand()*36|0},${40+rand()*26|0},0.35)`;
      ctx.beginPath();
      ctx.ellipse(rand()*S, rand()*S, 12+rand()*40, 10+rand()*34, rand()*3, 0, 6.3);
      ctx.fill();
    }
    for (let i = 0; i < 3000; i++) {
      const g = 46 + rand()*54;
      ctx.strokeStyle = `rgba(${(g*0.55)|0},${(g*1.15)|0},${(g*0.48)|0},0.45)`;
      ctx.lineWidth = 0.9 + rand()*0.9;
      const x = rand()*S, y = rand()*S;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand()-0.5)*5, y - rand()*6); ctx.stroke();
    }
    noise(12);
  };

  painters[TEX.ROOF] = () => {
    fill('#5b5f63');
    for (let i = 0; i < 1500; i++) {
      const g = 60 + rand()*70 | 0;
      ctx.fillStyle = `rgba(${g},${g},${g+2},0.35)`;
      ctx.fillRect(rand()*S, rand()*S, 2+rand()*5, 2+rand()*5);
    }
    // Weathering streaks and a couple of tar seams.
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(${70+rand()*20|0},${72+rand()*20|0},${74+rand()*20|0},0.4)`;
      ctx.lineWidth = 2 + rand()*5;
      const y = rand()*S;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y + (rand()-0.5)*14); ctx.stroke();
    }
    noise(14);
  };

  painters[TEX.PLAIN] = () => { fill('#ffffff'); noise(6); };
  painters[TEX.MARK] = () => { fill('#f2f2ee'); noise(10); };

  painters[TEX.GLASS] = () => {
    fill('#4a6076');
    windows(8, 8, {
      glass: (sh, lit) => lit
        ? `rgb(${150*sh|0},${180*sh|0},${200*sh|0})`
        : `rgb(${80*sh|0},${112*sh|0},${138*sh|0})`,
      frame: 'rgba(46,58,70,0.9)', litChance: 0.5, wIn: 0.06, hIn: 0.08,
    });
    noise(10);
  };

  painters[TEX.OFFICE] = () => {
    fill('#8d8677');
    // Horizontal floor bands.
    for (let r = 0; r < 6; r++) {
      ctx.fillStyle = 'rgba(70,66,58,0.35)';
      ctx.fillRect(0, r * S/6, S, 3);
    }
    windows(6, 6, {
      glass: (sh, lit) => lit
        ? `rgb(${120*sh|0},${110*sh|0},${85*sh|0})`
        : `rgb(${74*sh|0},${82*sh|0},${94*sh|0})`,
      frame: 'rgba(230,228,220,0.5)', litChance: 0.45,
    });
    noise(14);
  };

  painters[TEX.BRICK] = () => {
    fill('#7d4436');
    const bh = S / 16;
    for (let r = 0; r < 16; r++) {
      const off = (r % 2) * (S / 16);
      for (let cI = 0; cI < 8; cI++) {
        const x = cI * (S/8) + off, y = r * bh;
        ctx.fillStyle = `rgb(${110+rand()*40|0},${58+rand()*24|0},${45+rand()*20|0})`;
        ctx.fillRect(x + 1, y + 1, S/8 - 2.5, bh - 2.5);
      }
    }
    windows(4, 4, {
      glass: (sh, lit) => lit
        ? `rgb(${150*sh|0},${125*sh|0},${80*sh|0})`
        : `rgb(${66*sh|0},${70*sh|0},${80*sh|0})`,
      frame: '#d8d3c8', litChance: 0.4, wIn: 0.22, hIn: 0.18,
    });
    noise(12);
  };

  painters[TEX.MODERN] = () => {
    fill('#b9bcc0');
    for (let cI = 0; cI < 4; cI++) {
      ctx.fillStyle = 'rgba(90,96,104,0.3)';
      ctx.fillRect(cI * S/4, 0, 5, S);
    }
    windows(4, 7, {
      glass: (sh, lit) => lit
        ? `rgb(${160*sh|0},${150*sh|0},${120*sh|0})`
        : `rgb(${78*sh|0},${90*sh|0},${104*sh|0})`,
      frame: 'rgba(255,255,255,0.55)', litChance: 0.5, wIn: 0.1, hIn: 0.2,
    });
    noise(12);
  };

  painters[TEX.TOWER] = () => {
    fill('#7c848f');
    windows(10, 12, {
      glass: (sh, lit) => lit
        ? `rgb(${165*sh|0},${175*sh|0},${186*sh|0})`
        : `rgb(${62*sh|0},${74*sh|0},${92*sh|0})`,
      frame: 'rgba(96,104,114,0.8)', litChance: 0.35, wIn: 0.08, hIn: 0.1,
    });
    noise(9);
  };

  painters[TEX.SHOP] = () => {
    fill('#6a5f57');
    // Big storefront glazing with an awning band on top.
    ctx.fillStyle = '#20272e';
    ctx.fillRect(S*0.05, S*0.3, S*0.9, S*0.6);
    for (let i = 0; i < 4; i++) {
      const x = S*0.05 + i * (S*0.9/4) + 4;
      const lit = rand() < 0.75;
      ctx.fillStyle = lit ? '#c9b98a' : '#39424c';
      ctx.fillRect(x, S*0.34, S*0.9/4 - 8, S*0.5);
      if (lit) {
        mctx.fillStyle = '#e0e0e0';
        mctx.fillRect(x, S*0.34, S*0.9/4 - 8, S*0.5);
      }
    }
    ctx.fillStyle = ['#b8443a', '#2f6f52', '#2b4f86', '#8a5a2b'][(rand()*4)|0];
    ctx.fillRect(0, S*0.16, S, S*0.14);
    noise(12);
  };

  painters[TEX.METAL] = () => {
    fill('#c8ccd0');
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand()*0.15})`;
      ctx.fillRect(rand()*S, rand()*S, 40+rand()*80, 1+rand()*2);
    }
    noise(8);
  };

  painters[TEX.CONCRETE] = () => {
    fill('#a8a49c');
    for (let i = 0; i < 700; i++) {
      const g = 130 + rand()*60 | 0;
      ctx.fillStyle = `rgba(${g},${g-2},${g-10},0.3)`;
      ctx.fillRect(rand()*S, rand()*S, 4+rand()*14, 4+rand()*14);
    }
    noise(16);
  };

  painters[TEX.LEAVES] = () => {
    fill('#2f5a2b');
    for (let i = 0; i < 2000; i++) {
      const g = 60 + rand()*90;
      ctx.fillStyle = `rgba(${(g*0.45)|0},${g|0},${(g*0.4)|0},0.75)`;
      const x = rand()*S, y = rand()*S, r = 3 + rand()*9;
      ctx.beginPath(); ctx.ellipse(x, y, r, r*0.7, rand()*3, 0, 6.3); ctx.fill();
    }
    noise(14);
  };

  painters[TEX.BARK] = () => {
    fill('#5c4433');
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = `rgba(${40+rand()*40|0},${28+rand()*30|0},${20+rand()*22|0},0.7)`;
      ctx.lineWidth = 1 + rand()*3;
      const x = rand()*S;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rand()-0.5)*20, S); ctx.stroke();
    }
    noise(14);
  };

  const rgba = new Uint8Array(S * S * 4);
  for (let layer = 0; layer < TEX_COUNT; layer++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    clearMask();
    (painters[layer] || painters[TEX.CONCRETE])();
    const col = ctx.getImageData(0, 0, S, S).data;
    const mask = mctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) {
      rgba[i*4]   = col[i*4];
      rgba[i*4+1] = col[i*4+1];
      rgba[i*4+2] = col[i*4+2];
      rgba[i*4+3] = mask[i*4];   // emissive (lit-window) mask
    }
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, S, S, 1,
                     gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) {
    const maxA = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxA));
  }
  return tex;
}
