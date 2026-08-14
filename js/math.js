// Minimal column-major 4x4 matrix / vector math (no dependencies).
'use strict';

const M4 = {
  create() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },

  identity(o) {
    o[0]=1;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=1;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=1;o[11]=0;
    o[12]=0;o[13]=0;o[14]=0;o[15]=1;
    return o;
  },

  // o = a * b  (apply b first, then a)
  mul(o, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3];
    const a10=a[4],a11=a[5],a12=a[6],a13=a[7];
    const a20=a[8],a21=a[9],a22=a[10],a23=a[11];
    const a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i = 0; i < 4; i++) {
      const b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      o[i*4  ] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      o[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      o[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      o[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0]=f/aspect;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=f;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=(far+near)*nf;o[11]=-1;
    o[12]=0;o[13]=0;o[14]=2*far*near*nf;o[15]=0;
    return o;
  },

  ortho(o, l, r, b, t, n, f) {
    const lr=1/(l-r), bt=1/(b-t), nf=1/(n-f);
    o[0]=-2*lr;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=-2*bt;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=2*nf;o[11]=0;
    o[12]=(l+r)*lr;o[13]=(t+b)*bt;o[14]=(f+n)*nf;o[15]=1;
    return o;
  },

  lookAt(o, eye, center, up) {
    let zx=eye[0]-center[0], zy=eye[1]-center[1], zz=eye[2]-center[2];
    let len = Math.hypot(zx,zy,zz) || 1; zx/=len; zy/=len; zz/=len;
    let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    len = Math.hypot(xx,xy,xz);
    if (len < 1e-6) { xx=1; xy=0; xz=0; } else { xx/=len; xy/=len; xz/=len; }
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    o[0]=xx;o[1]=yx;o[2]=zx;o[3]=0;
    o[4]=xy;o[5]=yy;o[6]=zy;o[7]=0;
    o[8]=xz;o[9]=yz;o[10]=zz;o[11]=0;
    o[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    o[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    o[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    o[15]=1;
    return o;
  },

  // Translate * RotateY * RotateX * RotateZ * Scale
  compose(o, px, py, pz, yaw, pitch, roll, sx, sy, sz) {
    const cy=Math.cos(yaw), sy_=Math.sin(yaw);
    const cp=Math.cos(pitch), sp=Math.sin(pitch);
    const cr=Math.cos(roll), sr=Math.sin(roll);
    // R = Ry * Rx * Rz
    const m00 = cy*cr + sy_*sp*sr, m01 = cp*sr, m02 = -sy_*cr + cy*sp*sr;
    const m10 = -cy*sr + sy_*sp*cr, m11 = cp*cr, m12 = sy_*sr + cy*sp*cr;
    const m20 = sy_*cp, m21 = -sp, m22 = cy*cp;
    o[0]=m00*sx; o[1]=m10*sx; o[2]=m20*sx; o[3]=0;
    o[4]=m01*sy; o[5]=m11*sy; o[6]=m21*sy; o[7]=0;
    o[8]=m02*sz; o[9]=m12*sz; o[10]=m22*sz; o[11]=0;
    o[12]=px; o[13]=py; o[14]=pz; o[15]=1;
    return o;
  },

  invert(o, a) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],
          a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11],
          a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
          b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
          b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
          b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return null;
    det = 1.0/det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det;
    o[1]=(a02*b10-a01*b11-a03*b09)*det;
    o[2]=(a31*b05-a32*b04+a33*b03)*det;
    o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det;
    o[5]=(a00*b11-a02*b08+a03*b07)*det;
    o[6]=(a32*b02-a30*b05-a33*b01)*det;
    o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det;
    o[9]=(a01*b08-a00*b10-a03*b06)*det;
    o[10]=(a30*b04-a31*b02+a33*b00)*det;
    o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det;
    o[13]=(a00*b09-a01*b07+a02*b06)*det;
    o[14]=(a31*b01-a30*b03-a32*b00)*det;
    o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  },

  // Upper-left 3x3 of a rigid transform, for normals (uniform scale assumed).
  normalMat(o, m) {
    o[0]=m[0];o[1]=m[1];o[2]=m[2];
    o[3]=m[4];o[4]=m[5];o[5]=m[6];
    o[6]=m[8];o[7]=m[9];o[8]=m[10];
    return o;
  },
};

// Extract 6 frustum planes (world space) from a view-projection matrix.
function frustumFromMatrix(m, out) {
  const p = out || new Float32Array(24);
  for (let i = 0; i < 6; i++) {
    const s = (i % 2) ? -1 : 1;
    const r = i >> 1; // 0=x, 1=y, 2=z
    p[i*4+0] = m[3]  + s * m[r];
    p[i*4+1] = m[7]  + s * m[4+r];
    p[i*4+2] = m[11] + s * m[8+r];
    p[i*4+3] = m[15] + s * m[12+r];
    const len = Math.hypot(p[i*4], p[i*4+1], p[i*4+2]) || 1;
    p[i*4]/=len; p[i*4+1]/=len; p[i*4+2]/=len; p[i*4+3]/=len;
  }
  return p;
}

function aabbInFrustum(planes, min, max) {
  for (let i = 0; i < 6; i++) {
    const a = planes[i*4], b = planes[i*4+1], c = planes[i*4+2], d = planes[i*4+3];
    const x = a > 0 ? max[0] : min[0];
    const y = b > 0 ? max[1] : min[1];
    const z = c > 0 ? max[2] : min[2];
    if (a*x + b*y + c*z + d < 0) return false;
  }
  return true;
}

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x-e0)/(e1-e0), 0, 1); return t*t*(3-2*t); };
// Shortest signed angular difference b - a, wrapped to [-PI, PI].
const angDelta = (a, b) => { let d = (b - a) % (Math.PI*2); if (d > Math.PI) d -= Math.PI*2; if (d < -Math.PI) d += Math.PI*2; return d; };

// Deterministic PRNG so every player gets the same city.
function makeRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
