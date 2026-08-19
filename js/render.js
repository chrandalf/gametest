// Shaders, shadow mapping and the frame renderer.
'use strict';

const SHADOW_SIZE = 2048;
// Raised from 16: a lit street needs a run of lamps, not the nearest few.
const MAX_LIGHTS = 28;

const SCENE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in float aLayer;
layout(location=4) in vec3 aTint;
layout(location=5) in float aEmis;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uLightVP;
uniform mat3 uNormalMat;
// UV window: scale and offset applied to every UV. (1,1,0,0) is the whole
// tile; a quarter window picks one number plate out of the 4x4 plate sheet.
uniform vec4 uUVWin;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out float vLayer;
out vec3 vTint;
out float vEmis;
out float vGloss;
out vec4 vLightPos;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vNormal = uNormalMat * aNormal;
  vUV = aUV * uUVWin.xy + uUVWin.zw;
  vLayer = aLayer;
  vTint = aTint;
  vEmis = abs(aEmis);
  vGloss = aEmis < 0.0 ? 1.0 : 0.0;    // negative emissive flags a glossy material
  vLightPos = uLightVP * wp;
  gl_Position = uViewProj * wp;
}`;

const SCENE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in float vLayer;
in vec3 vTint;
in float vEmis;
in float vGloss;
in vec4 vLightPos;

uniform sampler2DArray uAtlas;
uniform sampler2D uSprite;      // cut-out sprite sheet: alpha is coverage
uniform float uSpriteMode;      // 1 while drawing sprite people
uniform sampler2DShadow uShadow;
uniform vec3 uSunDir;      // points toward the sun
uniform vec3 uSunColor;
uniform vec3 uAmbColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uNight;
uniform vec3 uTintMul;
uniform float uEmisAdd;
uniform float uWindowMask;   // 1 for buildings, 0 for vehicles and people
uniform float uAlpha;

uniform int uLightCount;
uniform vec4 uLightPos[${MAX_LIGHTS}];   // xyz = position, w = radius
uniform vec4 uLightDir[${MAX_LIGHTS}];   // xyz = spot direction, w > 0 = spotlight
uniform vec3 uLightCol[${MAX_LIGHTS}];

out vec4 fragColor;

float sampleShadow(vec3 n, float ndl) {
  vec3 p = vLightPos.xyz / vLightPos.w;
  p = p * 0.5 + 0.5;
  if (p.z > 1.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  float bias = max(0.0022 * (1.0 - ndl), 0.0007);
  float texel = 1.0 / float(${SHADOW_SIZE});
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * texel;
      sum += texture(uShadow, vec3(p.xy + o, p.z - bias));
    }
  }
  float s = sum / 9.0;
  // Fade the shadow out near the edge of the map so the seam is invisible.
  vec2 d = abs(p.xy - 0.5) * 2.0;
  float edge = smoothstep(0.82, 1.0, max(d.x, d.y));
  return mix(s, 1.0, edge);
}

vec3 toLinear(vec3 c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }

void main() {
  vec4 tex;
  if (uSpriteMode > 0.5) {
    // The atlas alpha is an emissive mask everywhere else in this shader; on a
    // sprite it is coverage, so it is tested and then thrown away rather than
    // being read as a lit window.
    tex = texture(uSprite, vUV);
    if (tex.a < 0.5) discard;
    tex.a = 0.0;
  } else {
    tex = texture(uAtlas, vec3(vUV, vLayer));
  }
  // Textures and tints are authored in sRGB; light must be summed in linear.
  vec3 albedo = toLinear(tex.rgb) * toLinear(vTint) * toLinear(uTintMul);

  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, uSunDir), 0.0);
  float shadow = ndl > 0.0 ? sampleShadow(N, ndl) : 1.0;
  // A shadow takes most of the sun, not all of it. Fully subtracting it left
  // dark surfaces — tarmac especially — reading as flat black holes wherever a
  // building fell across them.
  shadow = 0.26 + 0.74 * shadow;

  // Hemisphere ambient: sky above, bounced ground light below.
  vec3 skyLin = toLinear(uSkyColor);
  vec3 fogLin = toLinear(uFogColor);
  vec3 sunLin = toLinear(uSunColor) * 2.1;
  vec3 ground = fogLin * 0.45;
  vec3 amb = toLinear(uAmbColor);
  // The hemisphere term is a product of the sky colour and the ambient
  // colour, so after dark both factors are tiny and it collapses to nothing —
  // which is why an unlit night street used to be pure black. A moonlight
  // floor is added instead, faded in by the sun going down, so shapes stay
  // readable between the lamps without washing out the day.
  float nightAmt = 1.0 - smoothstep(-0.08, 0.12, uSunDir.y);
  vec3 ambient = mix(ground, skyLin, N.y * 0.35 + 0.65) * amb * 1.45
               + amb * nightAmt * (1.5 + 1.1 * (N.y * 0.5 + 0.5));

  vec3 color = albedo * (ambient + sunLin * ndl * shadow);

  // Specular with a Fresnel rim: surfaces go reflective at grazing angles,
  // which is most of what sells glass, wet-looking asphalt and car paint.
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(V + uSunDir);
  float gloss = mix(24.0, 140.0, vGloss);
  float spec = pow(max(dot(N, H), 0.0), gloss) * shadow;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 f0 = mix(vec3(0.04), albedo, vGloss * 0.35);
  vec3 fresnel = f0 + (1.0 - f0) * fres;
  color += sunLin * spec * fresnel * (1.2 + vGloss * 5.0) * ndl;
  // Sky reflection at glancing angles keeps big flat faces from reading as paper.
  color += skyLin * fres * mix(0.045, 0.55, vGloss) * shadow;

  // Street lamps and headlights.
  for (int i = 0; i < uLightCount; i++) {
    vec3 L = uLightPos[i].xyz - vWorld;
    float d = length(L);
    float att = clamp(1.0 - d / uLightPos[i].w, 0.0, 1.0);
    att *= att;
    if (att <= 0.001) continue;
    vec3 Ln = L / max(d, 0.001);
    float nd = max(dot(N, Ln), 0.0) * 0.85 + 0.15;
    float spot = 1.0;
    if (uLightDir[i].w > 0.5) {
      float cd = dot(-Ln, normalize(uLightDir[i].xyz));
      spot = smoothstep(0.55, 0.88, cd);
    }
    color += albedo * toLinear(uLightCol[i]) * (nd * att * spot) * 3.0;
  }

  // Lit windows (alpha channel is the window mask) plus per-vertex emissives.
  // These deliberately exceed 1.0 so the bloom pass picks them up.
  float mask = tex.a * uWindowMask;
  float glow = mask * uNight * 1.9 + vEmis * (0.3 + 2.0 * uNight) + uEmisAdd * 1.6;
  color += albedo * glow + vec3(1.0, 0.86, 0.62) * (mask * uNight * 0.7);

  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  color = mix(color, fogLin * (1.0 + uNight * 0.4), clamp(fog, 0.0, 1.0));

  fragColor = vec4(color, uAlpha);
}`;

const DEPTH_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUV;
uniform mat4 uLightVP;
uniform mat4 uModel;
out vec2 vUV;
void main() { vUV = aUV; gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;

const DEPTH_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSprite;
uniform float uSpriteMode;
void main() {
  // A billboard is a rectangle; without the cut-out here a pedestrian throws
  // the shadow of a signboard.
  if (uSpriteMode > 0.5 && texture(uSprite, vUV).a < 0.5) discard;
}`;

const SKY_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  // Fullscreen triangle.
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uNight;
uniform float uTime;
uniform float uRetro;
uniform vec3 uRetroSun;   // the banded sun: pinned just above the horizon
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 far = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);

  float h = clamp(dir.y, -1.0, 1.0);
  vec3 zenith = uSkyColor * 0.85;
  vec3 horizon = uFogColor;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, horizon * 0.75, smoothstep(0.0, -0.25, h));

  // Sun disc plus a wide bloom, warmed near the horizon.
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * pow(sd, 380.0) * 9.0 * (1.0 - uRetro * 0.75);
  col += uSunColor * pow(sd, 12.0) * 0.35;
  col += vec3(1.0, 0.5, 0.2) * pow(sd, 3.0) * 0.16 * (1.0 - smoothstep(0.0, 0.35, uSunDir.y));

  // The synthwave sun: a huge disc, banded with dark stripes across its lower
  // half, running gold at the top into hot pink at the bottom. It keys off
  // its own direction — pinned just above the horizon — so it NEVER sets:
  // at midnight it hangs there over the black skyline, which is the single
  // most retrowave fact about the whole sky.
  if (uRetro > 0.5) {
    float sr = max(dot(dir, uRetroSun), 0.0);
    float disc = smoothstep(0.9930, 0.9942, sr);
    float dy = dir.y - uRetroSun.y;
    float stripes = smoothstep(-0.2, 0.4, sin(dy * 150.0 - uTime * 0.35));
    float cut = mix(1.0, stripes, smoothstep(0.03, -0.03, dy));
    vec3 sunCol = mix(vec3(1.65, 0.22, 0.62), vec3(1.7, 1.15, 0.30),
                      smoothstep(-0.09, 0.07, dy));
    col += sunCol * disc * cut * 1.65;
    col += vec3(0.95, 0.20, 0.60) * pow(sr, 9.0) * 0.40;
    // After dark it gains the cyan halo of the arcade poster.
    col += vec3(0.16, 0.80, 0.85) * pow(sr, 34.0) * (1.0 - disc) * 0.9 * uNight;
  }

  // Stars fade in after dusk.
  if (uNight > 0.02 && h > 0.0) {
    vec2 g = floor(dir.xz / max(abs(dir.y), 0.05) * 90.0);
    float s = hash(g);
    float star = smoothstep(0.9965, 1.0, s) * uNight * h;
    star *= 0.6 + 0.4 * sin(uTime * 2.5 + s * 60.0);
    // Neon nights get tinted stars: half pink, half cyan.
    vec3 starCol = mix(vec3(1.0), s > 0.998 ? vec3(1.2, 0.5, 1.1) : vec3(0.5, 1.0, 1.2), uRetro);
    col += starCol * star * 1.6;
  }

  // Soft horizon-hugging haze band.
  col = mix(col, uFogColor, smoothstep(0.16, 0.0, abs(h)) * 0.55);

  fragColor = vec4(col, 1.0);
}`;

// Fullscreen pass shared by every post step.
const POST_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Bright-pass with a 4-tap box downsample, so the blur starts at half res.
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 fragColor;
void main() {
  // 9-tap gaussian, run once per axis.
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
  c += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
  fragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uNight;
uniform float uRetro;
uniform float uVpH;
uniform float uTime;
out vec4 fragColor;

// Narkowicz ACES approximation: the filmic shoulder is what stops bright sky
// and headlights from flattening into featureless white.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // Chromatic aberration toward the corners — the VHS fringe. Zero offset
  // in the plain style, so the extra taps collapse to the same texel.
  vec2 cc = vUv - 0.5;
  vec2 ab = cc * dot(cc, cc) * uRetro * 0.014;
  vec3 scene = vec3(texture(uScene, vUv + ab).r,
                    texture(uScene, vUv).g,
                    texture(uScene, vUv - ab).b);
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 c = scene + bloom * uBloomStrength;
  c *= uExposure;
  c = aces(c);

  // Grade: cool the shadows, warm the highlights, then a soft vignette.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c * vec3(0.94, 0.98, 1.10), c * vec3(1.06, 1.01, 0.94), smoothstep(0.15, 0.85, l));
  c = mix(vec3(l), c, 1.14 + uRetro * 0.14);         // extra saturation; neon gets more
  c = clamp((c - 0.5) * 1.09 + 0.5, 0.0, 1.0);       // gentle S-curve on top

  // CRT scanlines and film grain: faint, but they soften every hard polygon
  // edge in the frame, which is precisely the job the eighties look is
  // here to do.
  if (uRetro > 0.5) {
    c *= 1.0 - 0.065 * (0.5 + 0.5 * sin(vUv.y * uVpH * 3.14159));
    float gr = fract(sin(dot(vUv * 941.7 + fract(uTime * 7.0), vec2(12.9898, 78.233))) * 43758.5453);
    c += (gr - 0.5) * 0.04;
    // Shadows lean violet instead of black.
    c = mix(c, c * vec3(1.02, 0.94, 1.10) + vec3(0.012, 0.0, 0.02), 1.0 - smoothstep(0.0, 0.4, l));
  }
  vec2 d = vUv - 0.5;
  float vig = smoothstep(0.85, 0.28, dot(d, d) * 2.0);
  c *= mix(1.0, vig, 0.42 + uNight * 0.18);

  fragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance',
      depth: true, stencil: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;

    this.sceneProg = createProgram(gl, SCENE_VS, SCENE_FS, 'scene');
    this.depthProg = createProgram(gl, DEPTH_VS, DEPTH_FS, 'depth');
    this.skyProg = createProgram(gl, SKY_VS, SKY_FS, 'sky');
    this.atlas = makeTextureArray(gl);
    this.emptyVao = gl.createVertexArray();

    // Shadow map: a single depth texture with hardware comparison filtering.
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.brightProg = createProgram(gl, POST_VS, BRIGHT_FS, 'bright');
    this.blurProg = createProgram(gl, POST_VS, BLUR_FS, 'blur');
    this.compositeProg = createProgram(gl, POST_VS, COMPOSITE_FS, 'composite');
    // RGBA16F render targets need this extension; without it we fall back to
    // 8-bit targets, which still tone map but cannot hold highlights.
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.colorFormat = this.hdr ? gl.RGBA16F : gl.RGBA8;
    this.samples = 0;
    this.targets = null;
    this.exposure = 0.95;
    this.bloomStrength = 0.8;
    this.bloomThreshold = 1.5;

    this.lightPos = new Float32Array(MAX_LIGHTS * 4);
    this.lightDir = new Float32Array(MAX_LIGHTS * 4);
    this.lightCol = new Float32Array(MAX_LIGHTS * 3);
    this.model = M4.create();
    this.normalMat = new Float32Array(9);
    this.lightVP = M4.create();
    this.prog = null;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ensureTargets(this.canvas.width, this.canvas.height);
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }

  // Offscreen chain: multisampled HDR -> resolved HDR -> half-res bloom pair.
  ensureTargets(w, h) {
    const gl = this.gl;
    if (this.targets && this.targets.w === w && this.targets.h === h) return;
    if (this.targets) {
      const t = this.targets;
      gl.deleteFramebuffer(t.msaaFbo); gl.deleteFramebuffer(t.resolveFbo);
      gl.deleteRenderbuffer(t.msaaColor); gl.deleteRenderbuffer(t.msaaDepth);
      gl.deleteTexture(t.sceneTex);
      for (const b of t.bloom) { gl.deleteFramebuffer(b.fbo); gl.deleteTexture(b.tex); }
    }
    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    const samples = Math.min(4, maxSamples);
    this.samples = samples;

    const msaaFbo = gl.createFramebuffer();
    const msaaColor = gl.createRenderbuffer();
    const msaaDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, this.colorFormat, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaaDepth);

    const mkTex = (tw, th) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, this.colorFormat, tw, th);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const sceneTex = mkTex(w, h);
    const resolveFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);

    const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
    const bloom = [];
    for (let i = 0; i < 2; i++) {
      const tex = mkTex(bw, bh);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      bloom.push({ tex, fbo });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = { w, h, bw, bh, msaaFbo, msaaColor, msaaDepth, resolveFbo, sceneTex, bloom };
  }

  beginShadowPass(lightVP) {
    const gl = this.gl;
    this.lightVP.set(lightVP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.depthProg);
    this.prog = this.depthProg;
    gl.uniformMatrix4fv(this.depthProg.u.uLightVP, false, lightVP);
    // Depth bias in the rasteriser rather than front-face culling: buildings sit
    // flush on the road, so culling front faces would erase their ground shadow.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2.2, 4.0);
    this.setSpriteMode(false);
  }

  beginScenePass(env) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.msaaFbo);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.cullFace(gl.BACK);
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const p = this.sceneProg;
    gl.useProgram(p);
    this.prog = p;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.uniform1i(p.u.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(p.u.uShadow, 1);
    gl.uniformMatrix4fv(p.u.uViewProj, false, env.viewProj);
    gl.uniformMatrix4fv(p.u.uLightVP, false, this.lightVP);
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform3fv(p.u.uAmbColor, env.ambColor);
    gl.uniform3fv(p.u.uSkyColor, env.skyColor);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.uniform3fv(p.u.uCamPos, env.camPos);
    gl.uniform1f(p.u.uFogDensity, env.fogDensity);
    gl.uniform1f(p.u.uNight, env.night);
    gl.uniform3f(p.u.uTintMul, 1, 1, 1);
    gl.uniform1f(p.u.uEmisAdd, 0);
    gl.uniform1f(p.u.uWindowMask, 1);
    gl.uniform1f(p.u.uAlpha, 1);
    gl.uniform4f(p.u.uUVWin, 1, 1, 0, 0);

    const lights = env.lights || [];
    const n = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      this.lightPos[i*4] = L.pos[0];
      this.lightPos[i*4+1] = L.pos[1];
      this.lightPos[i*4+2] = L.pos[2];
      this.lightPos[i*4+3] = L.radius;
      this.lightDir[i*4] = L.dir ? L.dir[0] : 0;
      this.lightDir[i*4+1] = L.dir ? L.dir[1] : -1;
      this.lightDir[i*4+2] = L.dir ? L.dir[2] : 0;
      this.lightDir[i*4+3] = L.dir ? 1 : 0;
      this.lightCol[i*3] = L.color[0];
      this.lightCol[i*3+1] = L.color[1];
      this.lightCol[i*3+2] = L.color[2];
    }
    gl.uniform1i(p.u.uLightCount, n);
    if (n > 0) {
      gl.uniform4fv(p.u.uLightPos, this.lightPos);
      gl.uniform4fv(p.u.uLightDir, this.lightDir);
      gl.uniform3fv(p.u.uLightCol, this.lightCol);
    }
  }

  // The sprite sheet lives on its own texture unit and is shared by the scene
  // and depth programs, so a cut-out person is cut out of its shadow too.
  setSpriteAtlas(tex) {
    this.spriteTex = tex;
    const gl = this.gl;
    for (const p of [this.sceneProg, this.depthProg]) {
      gl.useProgram(p);
      gl.uniform1i(p.u.uSprite, 4);
      gl.uniform1f(p.u.uSpriteMode, 0);
    }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.activeTexture(gl.TEXTURE0);
  }

  setSpriteMode(on) {
    const gl = this.gl;
    if (!this.prog || !this.spriteTex) return;
    if (on) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1f(this.prog.u.uSpriteMode, on ? 1 : 0);
    // A cut-out has two visible faces: it must not be culled from behind.
    if (on) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
  }

  // Pick a sub-rectangle of the texture tile for the next draws. Used for the
  // number plates: one mesh, sixteen registrations.
  setUVWindow(sx, sy, ox, oy) {
    const gl = this.gl;
    if (this.prog !== this.sceneProg) return;
    gl.uniform4f(this.prog.u.uUVWin, sx, sy, ox, oy);
  }

  setMaterial(tint, emisAdd, windowMask, alpha) {
    const gl = this.gl;
    if (this.prog !== this.sceneProg) return;
    gl.uniform3f(this.prog.u.uTintMul, tint[0], tint[1], tint[2]);
    gl.uniform1f(this.prog.u.uEmisAdd, emisAdd || 0);
    gl.uniform1f(this.prog.u.uWindowMask, windowMask === undefined ? 1 : windowMask);
    gl.uniform1f(this.prog.u.uAlpha, alpha === undefined ? 1 : alpha);
  }

  // Additive-ish translucency for glowing volumes: no depth writes, no culling.
  beginTranslucent() {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
  }

  endTranslucent() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    this.setMaterial([1, 1, 1], 0, 1, 1);
  }

  draw(mesh, model) {
    const gl = this.gl;
    const p = this.prog;
    const m = model || M4.identity(this.model);
    gl.uniformMatrix4fv(p.u.uModel, false, m);
    if (p === this.sceneProg) {
      M4.normalMat(this.normalMat, m);
      gl.uniformMatrix3fv(p.u.uNormalMat, false, this.normalMat);
    }
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }

  // Resolve MSAA, build the bloom, tone map to the visible canvas.
  present(env) {
    const gl = this.gl;
    const t = this.targets;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.resolveFbo);
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);

    // Bright pass into bloom[0].
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.bloom[0].fbo);
    gl.viewport(0, 0, t.bw, t.bh);
    gl.useProgram(this.brightProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.sceneTex);
    gl.uniform1i(this.brightProg.u.uTex, 0);
    gl.uniform2f(this.brightProg.u.uTexel, 1 / t.w, 1 / t.h);
    gl.uniform1f(this.brightProg.u.uThreshold, this.bloomThreshold);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Two separable blur passes, ping-ponging between the two bloom buffers.
    gl.useProgram(this.blurProg);
    gl.uniform1i(this.blurProg.u.uTex, 0);
    for (let pass = 0; pass < 2; pass++) {
      for (const horiz of [true, false]) {
        const src = t.bloom[0], dst = t.bloom[1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, t.bw, t.bh);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        const step = 1 + pass;   // widen the kernel on the second pass
        gl.uniform2f(this.blurProg.u.uDir,
                     horiz ? step / t.bw : 0, horiz ? 0 : step / t.bh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        t.bloom.reverse();
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, t.w, t.h);
    gl.useProgram(this.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.sceneTex);
    gl.uniform1i(this.compositeProg.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.bloom[0].tex);
    gl.uniform1i(this.compositeProg.u.uBloom, 1);
    gl.uniform1f(this.compositeProg.u.uBloomStrength, this.hdr ? this.bloomStrength : this.bloomStrength * 0.5);
    gl.uniform1f(this.compositeProg.u.uExposure, this.exposure);
    gl.uniform1f(this.compositeProg.u.uNight, env.night);
    gl.uniform1f(this.compositeProg.u.uRetro,
                 env.retroFx === undefined ? (env.retro || 0) : env.retroFx);
    gl.uniform1f(this.compositeProg.u.uVpH, t.h);
    gl.uniform1f(this.compositeProg.u.uTime, env.time || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  drawSky(env) {
    const gl = this.gl;
    const p = this.skyProg;
    gl.useProgram(p);
    this.prog = p;
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.uniformMatrix4fv(p.u.uInvViewProj, false, env.invViewProj);
    gl.uniform3fv(p.u.uCamPos, env.camPos);
    gl.uniform3fv(p.u.uSunDir, env.sunDir);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform3fv(p.u.uSkyColor, env.skyColor);
    gl.uniform3fv(p.u.uFogColor, env.fogColor);
    gl.uniform1f(p.u.uNight, env.night);
    gl.uniform1f(p.u.uTime, env.time);
    gl.uniform1f(p.u.uRetro, env.retro || 0);
    gl.uniform3fv(p.u.uRetroSun, env.retroSun || env.sunDir);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }
}
