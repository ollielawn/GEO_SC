// GLSL for GEO_SC. Every particle is computed from scratch each frame in the
// vertex shader — there is no simulation state, so effects are pure functions
// of (particle id, image, depth, time, settings). That keeps it fast and makes
// recordings reproducible.

const COMMON = /* glsl */ `
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rnd(uint id, uint salt) { return float(pcg(id ^ (salt * 0x9E3779B9u))) / 4294967295.0; }

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
vec3 noise3(vec3 p) {
  return vec3(vnoise(p), vnoise(p + vec3(31.4, 17.2, 5.9)), vnoise(p + vec3(-11.7, 43.1, 27.3))) * 2.0 - 1.0;
}
`;

export const POINTS_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uColorA, uDepthA, uColorB, uDepthB;
uniform float uLodA, uLodB;
uniform vec2 uPlaneA, uPlaneB;      // half-size of each image in world units
uniform vec3 uKeyA, uKeyB;          // background colour to remove, per image
uniform ivec2 uGrid;
uniform mat4 uProj, uView;
uniform float uTime, uPxScale, uSize, uDepthAmt, uOpacity;
uniform float uKey;
uniform float uMorph, uMorphBurst;
uniform float uDrift, uSpeed, uStream, uWind, uScatter;
uniform vec3 uSplashPos;
uniform float uSplash, uSplashR;
uniform float uScanOn, uScanPos, uScanWidth, uScanBurn, uScanJitter, uScanAxis;
uniform vec3 uInk, uAccent;
uniform int uColorMode;             // 0 original, 1 ink, 2 negative, 3 duotone
uniform float uPaperDark;

out vec4 vColor;
out float vSize;

${COMMON}

float visible(vec4 c, vec3 key) {
  if (c.a < 0.5) return 0.0;
  if (uKey <= 0.001) return 1.0;
  return smoothstep(uKey, uKey + 0.04, distance(c.rgb, key));
}

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vColor = vec4(0.0);
  vSize = 0.0;
}

void main() {
  uint id = uint(gl_VertexID);
  int ix = gl_VertexID % uGrid.x;
  int iy = gl_VertexID / uGrid.x;
  float r0 = rnd(id, 1u), r1 = rnd(id, 2u), r2 = rnd(id, 3u);
  float r3 = rnd(id, 4u), r4 = rnd(id, 5u), r5 = rnd(id, 6u);

  // Jitter inside the grid cell so it never reads as a grid.
  vec2 uv = (vec2(ix, iy) + 0.5 + (vec2(r0, r1) - 0.5) * 0.95) / vec2(uGrid);

  vec4 cA = textureLod(uColorA, uv, uLodA);
  vec4 cB = textureLod(uColorB, uv, uLodB);
  float dA = texture(uDepthA, uv).r;
  float dB = texture(uDepthB, uv).r;

  // Staggered morph between image A and image B.
  float m = clamp(uMorph * 1.6 - r2 * 0.6, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);

  float vis = mix(visible(cA, uKeyA), visible(cB, uKeyB), m);
  if (vis < 0.02) { cull(); return; }

  vec3 pA = vec3((uv.x - 0.5) * 2.0 * uPlaneA.x, (0.5 - uv.y) * 2.0 * uPlaneA.y, (dA - 0.5) * uDepthAmt);
  vec3 pB = vec3((uv.x - 0.5) * 2.0 * uPlaneB.x, (0.5 - uv.y) * 2.0 * uPlaneB.y, (dB - 0.5) * uDepthAmt);
  vec3 p = mix(pA, pB, m);
  vec4 c = mix(cA, cB, m);
  float d = mix(dA, dB, m);
  float t = uTime;

  float alphaMul = vis;
  float sizeMul = 1.0;

  // Colour treatment.
  vec3 col = c.rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  if (uColorMode == 1) {
    col = uInk;
    alphaMul *= mix(1.0 - lum * 0.92, lum, uPaperDark);
  } else if (uColorMode == 2) {
    col = 1.0 - col;
  } else if (uColorMode == 3) {
    col = mix(uInk, uAccent, smoothstep(0.1, 0.9, lum));
  }

  // Drift: slow 3D noise. Far particles wander more than near ones.
  vec3 n = noise3(p * 1.6 + vec3(0.0, 0.0, t * 0.25 * uSpeed));
  p += n * uDrift * 0.12 * (0.4 + (1.0 - d));

  // Streamers: a fraction of particles peel off along the wind and fade.
  if (r3 < uStream) {
    float f = fract(t * uSpeed * 0.12 + r4);
    vec3 dir = vec3(cos(uWind), sin(uWind), (r5 - 0.5) * 0.6);
    vec3 curl = noise3(p * 2.0 + vec3(t * 0.3));
    p += dir * (f * f) * (0.6 + r5 * 1.4) + curl * f * 0.25;
    alphaMul *= (1.0 - f) * (1.0 - f);
    sizeMul *= 0.75;
  }

  // Scatter (manual) and burst (during image changes).
  float burst = sin(3.14159265 * m) * uMorphBurst;
  float sc = uScatter + burst;
  if (sc > 0.0) {
    vec3 rv = vec3(r0, r4, r5) * 2.0 - 1.0;
    p += rv * sc * 0.9 + noise3(p * 3.0 + t * 0.2) * sc * 0.3;
  }

  // Splash: the cursor pushes particles away.
  vec2 dv = p.xy - uSplashPos.xy;
  float s = uSplash * exp(-dot(dv, dv) / (uSplashR * uSplashR));
  p.xy += normalize(dv + 1e-5) * s * 0.35 * (0.5 + r0);
  p.z += s * 0.4 * (r1 - 0.3);

  // Scan: a band sweeps through depth (or across/down the image). Particles
  // at the front light up in the accent colour and get kicked; behind it they
  // burn toward ink and slowly recover.
  if (uScanOn > 0.5) {
    float coord = uScanAxis < 0.5 ? d : (uScanAxis < 1.5 ? uv.x : uv.y);
    float dd = uScanPos - coord;
    float front = exp(-(dd * dd) / (uScanWidth * uScanWidth));
    float burn = dd > 0.0 ? exp(-dd / max(uScanBurn, 0.001)) : 0.0;
    p.z += front * uScanJitter * (r2 - 0.5) * 0.6;
    p.x += front * uScanJitter * (r0 - 0.5) * 0.08;
    col = mix(col, uInk, burn * 0.9);
    col = mix(col, uAccent, front);
    alphaMul = max(alphaMul, front * vis);
    sizeMul *= 1.0 + front * 0.8;
  }

  vec4 view = uView * vec4(p, 1.0);
  gl_Position = uProj * view;
  float ps = uSize * sizeMul * uPxScale / max(-view.z, 0.05);
  if (ps < 1.0) alphaMul *= ps;
  ps = clamp(ps, 1.0, 64.0);
  gl_PointSize = ps;
  vSize = ps;
  vColor = vec4(col, c.a * alphaMul * uOpacity);
}
`;

export const POINTS_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in float vSize;
out vec4 outColor;
void main() {
  float a = vColor.a;
  if (vSize > 2.5) {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    a *= smoothstep(1.0, 0.55, r);
  }
  outColor = vec4(vColor.rgb * a, a);
}
`;

// Full-screen triangle with no vertex buffers.
export const QUAD_VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FADE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uFade;
out vec4 outColor;
void main() { outColor = uFade; }
`;

export const PRESENT_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uFrame;
uniform float uGrain, uTime;
uniform vec2 uRes;
in vec2 vUv;
out vec4 outColor;
${COMMON}
void main() {
  vec3 c = texture(uFrame, vUv).rgb;
  if (uGrain > 0.0) {
    uvec2 px = uvec2(vUv * uRes);
    uint seed = px.x * 1973u + px.y * 9277u + uint(uTime * 60.0) * 26699u;
    c += (rnd(seed, 7u) - 0.5) * uGrain;
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
