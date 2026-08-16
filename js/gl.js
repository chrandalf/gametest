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

  // Polygon with per-vertex normals supplied by a function of position, and
  // winding fixed automatically to face outward. This is what lets chamfered
  // and swept shapes read as smooth instead of faceted.
  polyN(points, normalAt, uvAt) {
    const n0 = normalAt(points[0]);
    const ax = points[1][0]-points[0][0], ay = points[1][1]-points[0][1], az = points[1][2]-points[0][2];
    const bx = points[2][0]-points[0][0], by = points[2][1]-points[0][1], bz = points[2][2]-points[0][2];
    const gx = ay*bz - az*by, gy = az*bx - ax*bz, gz = ax*by - ay*bx;
    const flip = (gx*n0[0] + gy*n0[1] + gz*n0[2]) < 0;
    const order = flip ? points.slice().reverse() : points;
    const idx = [];
    for (const p of order) {
      const n = normalAt(p);
      const uv = uvAt ? uvAt(p) : [0, 0];
      idx.push(this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]));
    }
    for (let i = 1; i < idx.length - 1; i++) this.i.push(idx[0], idx[i], idx[i+1]);
    return this;
  }

  // A box with its edges and corners cut back by `r`, shaded as if filleted.
  // The normal at any point is the direction from the inner "core" box, which
  // is exactly the normal of a true rounded box — so flat faces stay flat and
  // the cut edges catch light as a smooth roll.
  chamferBox(cx, cy, cz, hx, hy, hz, r, opt) {
    opt = opt || {};
    r = Math.max(0.001, Math.min(r, hx * 0.98, hy * 0.98, hz * 0.98));
    const ax = hx - r, ay = hy - r, az = hz - r;
    const perUnit = opt.perUnit || 0.25;
    const uvU = opt.uvU, uvV = opt.uvV;

    const normalAt = (p) => {
      const qx = clamp(p[0] - cx, -ax, ax), qy = clamp(p[1] - cy, -ay, ay), qz = clamp(p[2] - cz, -az, az);
      let nx = (p[0] - cx) - qx, ny = (p[1] - cy) - qy, nz = (p[2] - cz) - qz;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) return [0, 1, 0];
      return [nx/len, ny/len, nz/len];
    };
    // Planar UVs chosen by the dominant axis, so texture scale stays even.
    const uvAt = (p) => {
      const n = normalAt(p);
      const anx = Math.abs(n[0]), any = Math.abs(n[1]), anz = Math.abs(n[2]);
      let u, v, su, sv;
      if (any >= anx && any >= anz) { u = p[0]-cx+hx; v = p[2]-cz+hz; su = hx*2; sv = hz*2; }
      else if (anx >= anz) { u = p[2]-cz+hz; v = p[1]-cy+hy; su = hz*2; sv = hy*2; }
      else { u = p[0]-cx+hx; v = p[1]-cy+hy; su = hx*2; sv = hy*2; }
      return [uvU !== undefined ? u/su*uvU : u*perUnit,
              uvV !== undefined ? v/sv*uvV : v*perUnit];
    };
    const P = (x, y, z) => [cx+x, cy+y, cz+z];
    const face = (fixed, val, u1, v1) => {
      // fixed: which axis is pinned; builds the inset rectangle for that face.
      const pts = [];
      for (const [su, sv] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        if (fixed === 0) pts.push(P(val, su*ay, sv*az));
        else if (fixed === 1) pts.push(P(su*ax, val, sv*az));
        else pts.push(P(su*ax, sv*ay, val));
      }
      void u1; void v1;
      this.polyN(pts, normalAt, uvAt);
    };

    if (!opt.skipSides) {
      face(0, hx); face(0, -hx);
      face(2, hz); face(2, -hz);
    }
    if (!opt.skipTop) {
      const keepLayer = this.layer, keepTint = this.tint;
      if (opt.top !== undefined) this.style(opt.top, opt.topTint || keepTint, 0);
      face(1, hy);
      this.style(keepLayer, keepTint, 0);
    }
    if (opt.bottom) face(1, -hy);

    // 12 edge strips.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      this.polyN([P(sx*ax, sy*hy, -az), P(sx*ax, sy*hy, az), P(sx*hx, sy*ay, az), P(sx*hx, sy*ay, -az)],
                 normalAt, uvAt);
    }
    for (const sz of [-1, 1]) for (const sy of [-1, 1]) {
      this.polyN([P(-ax, sy*hy, sz*az), P(ax, sy*hy, sz*az), P(ax, sy*ay, sz*hz), P(-ax, sy*ay, sz*hz)],
                 normalAt, uvAt);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.polyN([P(sx*hx, -ay, sz*az), P(sx*hx, ay, sz*az), P(sx*ax, ay, sz*hz), P(sx*ax, -ay, sz*hz)],
                 normalAt, uvAt);
    }
    // 8 corner patches.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      this.polyN([P(sx*ax, sy*hy, sz*az), P(sx*hx, sy*ay, sz*az), P(sx*ax, sy*ay, sz*hz)],
                 normalAt, uvAt);
    }
    return this;
  }

  // Rounded-end column: the body of a person, an arm, a bollard.
  capsule(cx, cy, cz, r, h, seg, rings) {
    seg = seg || 12; rings = rings || 4;
    const half = Math.max(0.0001, h / 2 - r);
    const at = (theta, phi, capSign) => {
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const nx = sp * Math.cos(theta), ny = cp, nz = sp * Math.sin(theta);
      return { p: [cx + nx*r, cy + capSign*half + ny*r, cz + nz*r], n: [nx, ny, nz] };
    };
    const push = (o, u, v) => this.vertex(o.p[0], o.p[1], o.p[2], o.n[0], o.n[1], o.n[2], u, v);
    // Barrel.
    for (let i = 0; i < seg; i++) {
      const t0 = i/seg*Math.PI*2, t1 = (i+1)/seg*Math.PI*2;
      const a = push(at(t0, Math.PI/2, 1), i/seg*2, 0);
      const b = push(at(t1, Math.PI/2, 1), (i+1)/seg*2, 0);
      const c = push(at(t1, Math.PI/2, -1), (i+1)/seg*2, 2);
      const d = push(at(t0, Math.PI/2, -1), i/seg*2, 2);
      this.i.push(a, b, c, a, c, d);
    }
    // Caps.
    for (const capSign of [1, -1]) {
      for (let ri = 0; ri < rings; ri++) {
        const p0 = (ri/rings) * (Math.PI/2), p1 = ((ri+1)/rings) * (Math.PI/2);
        const phi0 = capSign > 0 ? p0 : Math.PI - p0;
        const phi1 = capSign > 0 ? p1 : Math.PI - p1;
        for (let i = 0; i < seg; i++) {
          const t0 = i/seg*Math.PI*2, t1 = (i+1)/seg*Math.PI*2;
          const a = push(at(t0, phi0, capSign), i/seg*2, 0);
          const b = push(at(t1, phi0, capSign), (i+1)/seg*2, 0);
          const c = push(at(t1, phi1, capSign), (i+1)/seg*2, 1);
          const d = push(at(t0, phi1, capSign), i/seg*2, 1);
          if (capSign > 0) this.i.push(a, b, c, a, c, d);
          else this.i.push(a, c, b, a, d, c);
        }
      }
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
    // Barrel with radial (smooth) normals — a faceted tube reads as blocky.
    const radial = (a) => {
      const c = Math.cos(a), s = Math.sin(a);
      if (axis === 'y') return [c, 0, s];
      if (axis === 'x') return [0, c, s];
      return [c, s, 0];
    };
    const uRep = opt.uRepeat || 1, vRep = opt.vRepeat || 1;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const n0 = radial(a0), n1 = radial(a1);
      const p00 = place(a0, 0), p10 = place(a1, 0), p11 = place(a1, 1), p01 = place(a0, 1);
      const u0 = i / seg * uRep, u1 = (i + 1) / seg * uRep;
      const v0 = this.vertex(p00[0], p00[1], p00[2], n0[0], n0[1], n0[2], u0, 0);
      const v1 = this.vertex(p10[0], p10[1], p10[2], n1[0], n1[1], n1[2], u1, 0);
      const v2 = this.vertex(p11[0], p11[1], p11[2], n1[0], n1[1], n1[2], u1, vRep);
      const v3 = this.vertex(p01[0], p01[1], p01[2], n0[0], n0[1], n0[2], u0, vRep);
      this.i.push(v0, v1, v2, v0, v2, v3);
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

// Geometry that is rebuilt every frame (skid trails, cloth strips). Buffers are
// allocated once at a fixed capacity and refilled with bufferSubData.
class DynamicMesh {
  constructor(gl, maxVerts, maxIndices) {
    this.gl = gl;
    this.count = 0;
    this.capacityV = maxVerts;
    this.capacityI = maxIndices;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, maxVerts * VERT_FLOATS * 4, gl.DYNAMIC_DRAW);
    const stride = VERT_FLOATS * 4;
    for (const [loc, size, off] of [[0,3,0],[1,3,3],[2,2,6],[3,1,8],[4,3,9],[5,1,12]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    }
    this.ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, maxIndices * 4, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.vScratch = new Float32Array(maxVerts * VERT_FLOATS);
    this.iScratch = new Uint32Array(maxIndices);
    this.min = [-1e5, -1e5, -1e5];
    this.max = [1e5, 1e5, 1e5];
  }

  update(builder) {
    const gl = this.gl;
    const nv = Math.min(builder.v.length, this.capacityV * VERT_FLOATS);
    const ni = Math.min(builder.i.length, this.capacityI);
    if (!ni) { this.count = 0; return; }
    for (let i = 0; i < nv; i++) this.vScratch[i] = builder.v[i];
    for (let i = 0; i < ni; i++) this.iScratch[i] = builder.i[i];
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vScratch.subarray(0, nv));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.iScratch.subarray(0, ni));
    gl.bindVertexArray(null);
    this.count = ni;
  }
}

// ------------------------------------------------- procedural texture set ---

const TEX = {
  ASPHALT: 0, SIDEWALK: 1, GRASS: 2, ROOF: 3, PLAIN: 4,
  GLASS: 5, OFFICE: 6, BRICK: 7, MODERN: 8, TOWER: 9,
  SHOP: 10, METAL: 11, CONCRETE: 12, LEAVES: 13, BARK: 14, MARK: 15,
  PLATE: 16,
  // Rural and light-industrial set, added for zoned worlds.
  FIELD: 17, DIRT: 18, TILE: 19, COTTAGE: 20, SIDING: 21, HOUSE: 22,
};
const TEX_COUNT = 23;
const PLATE_TEXT = 'E901 GBL';
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

  painters[TEX.PLATE] = () => {
    // The square tile is stretched across a 4.7:1 plate, so the glyphs are drawn
    // pre-squashed here and come out correctly proportioned on the car.
    fill('#fbfbf7');
    ctx.fillStyle = '#0a0a0a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = 205;
    ctx.font = `bold ${size}px "Arial Narrow", Arial, system-ui, sans-serif`;
    const w = ctx.measureText(PLATE_TEXT).width || 1;
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.scale((S * 0.92) / w, 1);
    ctx.fillText(PLATE_TEXT, 0, 6);
    ctx.restore();
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 7;
    ctx.strokeRect(3.5, 3.5, S - 7, S - 7);
  };
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

  // Crop rows. Tinted per field so neighbouring fields never match.
  painters[TEX.FIELD] = () => {
    fill('#7d7a44');
    const rows = 26, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const g = 96 + rand() * 44;
      ctx.fillStyle = `rgba(${g|0},${(g*0.95)|0},${(g*0.5)|0},0.45)`;
      ctx.fillRect(0, r * rh, S, rh * 0.55);
    }
    for (let i = 0; i < 1400; i++) {
      const g = 110 + rand() * 60;
      ctx.fillStyle = `rgba(${g|0},${(g*0.93)|0},${(g*0.48)|0},0.30)`;
      ctx.fillRect(rand()*S, rand()*S, 1 + rand()*3, 1 + rand()*6);
    }
    noise(12);
  };

  // Dry mud: farm tracks, yards and lay-bys.
  painters[TEX.DIRT] = () => {
    fill('#6b5a44');
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${80+rand()*40|0},${66+rand()*32|0},${48+rand()*26|0},0.4)`;
      ctx.beginPath();
      ctx.ellipse(rand()*S, rand()*S, 6+rand()*26, 5+rand()*20, rand()*3, 0, 6.3);
      ctx.fill();
    }
    // Ruts.
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = 'rgba(70,58,42,0.5)';
      ctx.lineWidth = 3 + rand()*5;
      const y = rand()*S;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y + (rand()-0.5)*30); ctx.stroke();
    }
    noise(16);
  };

  // Pitched-roof clay tiles: overlapping courses, shaded along the bottom edge.
  painters[TEX.TILE] = () => {
    fill('#8a4b34');
    const rows = 12, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const cols = 10, cw = S / cols;
      const off = (r % 2) * cw * 0.5;
      for (let cI = -1; cI < cols; cI++) {
        const x = cI * cw + off;
        const g = 0.82 + rand() * 0.36;
        ctx.fillStyle = `rgb(${(150*g)|0},${(80*g)|0},${(58*g)|0})`;
        ctx.beginPath();
        ctx.moveTo(x, y + rh);
        ctx.lineTo(x, y + rh * 0.35);
        ctx.quadraticCurveTo(x + cw/2, y - rh * 0.1, x + cw, y + rh * 0.35);
        ctx.lineTo(x + cw, y + rh);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(50,24,16,0.45)';
      ctx.fillRect(0, y + rh - 2.5, S, 2.5);
    }
    noise(10);
  };

  // Whitewashed render with small cottage windows and a timber sill line.
  painters[TEX.COTTAGE] = () => {
    fill('#ddd6c4');
    for (let i = 0; i < 500; i++) {
      const g = 200 + rand()*45 | 0;
      ctx.fillStyle = `rgba(${g},${g-6},${g-22},0.35)`;
      ctx.fillRect(rand()*S, rand()*S, 6+rand()*22, 6+rand()*22);
    }
    windows(3, 2, {
      glass: (sh, lit) => lit
        ? `rgb(${232*sh|0},${196*sh|0},${132*sh|0})`
        : `rgb(${54*sh|0},${58*sh|0},${58*sh|0})`,
      frame: 'rgba(72,58,44,0.95)', litChance: 0.45, wIn: 0.30, hIn: 0.28,
    });
    noise(14);
  };

  // Corrugated industrial cladding with a strip of high-level glazing.
  painters[TEX.SIDING] = () => {
    fill('#9aa0a4');
    for (let x = 0; x < S; x += 8) {
      ctx.fillStyle = 'rgba(120,128,134,0.55)';
      ctx.fillRect(x, 0, 3, S);
      ctx.fillStyle = 'rgba(206,212,216,0.35)';
      ctx.fillRect(x + 4, 0, 2, S);
    }
    // Glazing band near the eaves, and a rust streak or two below it.
    const by = S * 0.12, bh = S * 0.14;
    for (let x = 6; x < S - 6; x += 26) {
      const lit = rand() < 0.35;
      ctx.fillStyle = lit ? '#cbd6cf' : '#4a5459';
      ctx.fillRect(x, by, 20, bh);
      if (lit) { mctx.fillStyle = 'rgb(150,150,150)'; mctx.fillRect(x, by, 20, bh); }
    }
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(${120+rand()*40|0},${72+rand()*24|0},${44+rand()*18|0},0.28)`;
      ctx.fillRect(rand()*S, by + bh, 3 + rand()*5, 20 + rand()*90);
    }
    noise(12);
  };

  // Domestic brickwork. The office facades put windows on most of the wall,
  // which at house scale reads as a black box — here the brick has to win.
  painters[TEX.HOUSE] = () => {
    fill('#9c6a52');
    const rows = 26, bh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (S / 26);
      for (let x = -1; x < 13; x++) {
        const g = 0.86 + rand() * 0.28;
        ctx.fillStyle = `rgb(${(158*g)|0},${(104*g)|0},${(80*g)|0})`;
        ctx.fillRect(x * (S/13) + off + 1, r * bh + 1, S/13 - 2, bh - 2);
      }
    }
    windows(2, 2, {
      glass: (sh, lit) => lit
        ? `rgb(${236*sh|0},${204*sh|0},${142*sh|0})`
        : `rgb(${62*sh|0},${70*sh|0},${74*sh|0})`,
      frame: 'rgba(244,244,238,0.95)', litChance: 0.4, wIn: 0.34, hIn: 0.32,
    });
    noise(12);
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
