// Shaders, shadow mapping and the frame renderer.
'use strict';

const SHADOW_SIZE = 2048;
const MAX_LIGHTS = 16;

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

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out float vLayer;
out vec3 vTint;
out float vEmis;
out vec4 vLightPos;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vNormal = uNormalMat * aNormal;
  vUV = aUV;
  vLayer = aLayer;
  vTint = aTint;
  vEmis = aEmis;
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
in vec4 vLightPos;

uniform sampler2DArray uAtlas;
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

void main() {
  vec4 tex = texture(uAtlas, vec3(vUV, vLayer));
  vec3 albedo = tex.rgb * vTint * uTintMul;

  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, uSunDir), 0.0);
  float shadow = ndl > 0.0 ? sampleShadow(N, ndl) : 1.0;

  // Hemisphere ambient: sky above, bounced ground light below.
  vec3 ground = uFogColor * 0.45;
  vec3 ambient = mix(ground, uSkyColor, N.y * 0.5 + 0.5) * uAmbColor;

  vec3 color = albedo * (ambient + uSunColor * ndl * shadow);

  // Cheap specular sheen so glass and paint catch the sun.
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * shadow;
  color += uSunColor * spec * 0.35;

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
    color += albedo * uLightCol[i] * (nd * att * spot);
  }

  // Lit windows (alpha channel is the window mask) plus per-vertex emissives.
  float mask = tex.a * uWindowMask;
  float glow = mask * uNight * 1.35 + vEmis * (0.25 + 0.95 * uNight) + uEmisAdd;
  color += albedo * glow + vec3(1.0, 0.92, 0.78) * (mask * uNight * 0.45);

  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

  fragColor = vec4(color, uAlpha);
}`;

const DEPTH_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

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
  col += uSunColor * pow(sd, 380.0) * 9.0;
  col += uSunColor * pow(sd, 12.0) * 0.35;
  col += vec3(1.0, 0.5, 0.2) * pow(sd, 3.0) * 0.16 * (1.0 - smoothstep(0.0, 0.35, uSunDir.y));

  // Stars fade in after dusk.
  if (uNight > 0.02 && h > 0.0) {
    vec2 g = floor(dir.xz / max(abs(dir.y), 0.05) * 90.0);
    float s = hash(g);
    float star = smoothstep(0.9965, 1.0, s) * uNight * h;
    star *= 0.6 + 0.4 * sin(uTime * 2.5 + s * 60.0);
    col += vec3(star * 1.6);
  }

  // Soft horizon-hugging haze band.
  col = mix(col, uFogColor, smoothstep(0.16, 0.0, abs(h)) * 0.55);

  fragColor = vec4(col, 1.0);
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
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
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
  }

  beginScenePass(env) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }
}
