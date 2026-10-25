// Procedural backgrounds. Each one is described once here: its settings
// (which the panel builds controls from) and its branch in BG_FRAG.
// Settings map onto shader slots: numbers → uP[0..7] in order, colours → uC1/uC2.

import { GLSL_COMMON } from './shaders.js';

const range = (id, label, min, max, step, def, extra = {}) => ({ id, label, type: 'range', min, max, step, def, ...extra });
const seg = (id, label, options, def) => ({ id, label, type: 'seg', options, def });
const color = (id, label, def) => ({ id, label, type: 'color', def });

export const BACKGROUNDS = [
  { id: 'plain', label: 'Plain', type: 0, params: [color('c1', 'Colour', '#eeefec')] },
  {
    id: 'receipt',
    label: 'Receipt scan',
    type: 1,
    params: [
      color('c1', 'Paper', '#f3f2ee'),
      color('c2', 'Print and dust', '#8e8e8a'),
      range('thermal', 'Thermal lines', 0, 1, 0.01, 0.5),
      range('streaks', 'Scanner streaks', 0, 1, 0.01, 0.4),
      range('fade', 'Fading', 0, 1, 0.01, 0.5),
      range('dust', 'Dust', 0, 1, 0.01, 0.4),
      range('edge', 'Edge shadow', 0, 1, 0.01, 0.5),
      range('crumple', 'Creases', 0, 1, 0.01, 0.3),
    ],
  },
  {
    id: 'film',
    label: 'Film grain',
    type: 2,
    params: [
      color('c1', 'Base', '#d8d0c0'),
      range('amount', 'Grain', 0, 1, 0.01, 0.6),
      range('size', 'Grain size', 0.5, 6, 0.05, 1.6),
      range('flicker', 'Flicker', 0, 1, 0.01, 0.4),
      range('dust', 'Dust and scratches', 0, 1, 0.01, 0.3),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.5),
      range('fps', 'Grain frame rate', 6, 60, 1, 24, { unit: ' fps' }),
    ],
  },
  {
    id: 'digital',
    label: 'Digital noise',
    type: 3,
    params: [
      color('c1', 'Base', '#121216'),
      range('amount', 'Noise', 0, 1, 0.01, 0.5),
      range('chroma', 'Colour noise', 0, 1, 0.01, 0.6),
      range('pixel', 'Noise pixel size', 1, 12, 1, 1, { unit: ' px' }),
      range('banding', 'Banding', 0, 1, 0.01, 0.3),
      range('fps', 'Refresh rate', 1, 60, 1, 30, { unit: ' fps' }),
    ],
  },
  {
    id: 'magazine',
    label: 'Magazine',
    type: 4,
    params: [
      color('c1', 'Paper', '#ecebe7'),
      color('c2', 'Ink', '#25366e'),
      range('halftone', 'Halftone', 0, 1, 0.01, 0.6),
      range('dot', 'Dot size', 2, 24, 0.5, 6, { unit: ' px' }),
      range('angle', 'Screen angle', 0, 90, 1, 15, { unit: '°' }),
      range('fibres', 'Fibres', 0, 1, 0.01, 0.4),
      range('show', 'Show-through', 0, 1, 0.01, 0.5),
      range('gloss', 'Gloss', 0, 1, 0.01, 0.3),
    ],
  },
  {
    id: 'graph',
    label: 'Graph paper',
    type: 5,
    params: [
      color('c1', 'Paper', '#f3f5f0'),
      color('c2', 'Lines', '#4f9fd0'),
      range('cell', 'Square size', 6, 120, 1, 28, { unit: ' px' }),
      range('major', 'Bold line every', 1, 12, 1, 5, { unit: '' }),
      range('weight', 'Line weight', 0.3, 4, 0.05, 1),
      range('opacity', 'Strength', 0, 1, 0.01, 0.6),
    ],
  },
  {
    id: 'crt',
    label: 'CRT screen',
    type: 6,
    params: [
      color('c1', 'Phosphor', '#1b3a2a'),
      range('glow', 'Glow', 0, 1, 0.01, 0.5),
      seg('mask', 'Mask', [['0', 'Grille'], ['1', 'Slot'], ['2', 'Dots']], '0'),
      range('size', 'Mask size', 1, 8, 0.1, 3, { unit: ' px' }),
      range('scan', 'Scanlines', 0, 1, 0.01, 0.5),
      range('static', 'Static', 0, 1, 0.01, 0.2),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.6),
    ],
  },
  {
    id: 'vhs',
    label: 'VHS',
    type: 7,
    params: [
      color('c1', 'Tape colour', '#0d1230'),
      range('snow', 'Snow', 0, 1, 0.01, 0.4),
      range('tracking', 'Tracking', 0, 1, 0.01, 0.5),
      range('bleed', 'Colour bleed', 0, 1, 0.01, 0.5),
      range('wobble', 'Wobble', 0, 1, 0.01, 0.3),
      range('head', 'Head switching', 0, 1, 0.01, 0.6),
    ],
  },
  {
    id: 'gradient',
    label: 'Gradient',
    type: 8,
    params: [
      color('c1', 'From', '#f1efe9'),
      color('c2', 'To', '#c3c7d2'),
      range('angle', 'Angle', 0, 360, 1, 90, { unit: '°' }),
      range('noise', 'Dither noise', 0, 1, 0.01, 0.3),
      seg('shape', 'Shape', [['0', 'Linear'], ['1', 'Radial']], '0'),
    ],
  },
];

export const BG_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform int uType;
uniform float uP[8];
uniform vec3 uC1, uC2;
uniform vec2 uRes;       // output size in pixels
uniform float uSS, uUnit, uTime, uAlpha;
out vec4 outColor;
${GLSL_COMMON}

const float TAU = 6.2831853;

vec3 receipt(vec2 px, vec2 q, vec2 uv) {
  vec3 c = uC1;
  c *= 1.0 - 0.035 * fbm2(q * vec2(0.5, 0.12), 1u);                         // paper fibre
  c = mix(c, c * 0.9 + 0.03, uP[2] * smoothstep(0.4, 0.75, fbm2(uv * vec2(3.0, 5.0), 2u))); // fading
  float rl = h1(floor(q.y / 1.6), 3u);                                       // thermal head rows
  c = mix(c, uC2, uP[0] * 0.14 * smoothstep(0.86, 1.0, rl));
  c *= 1.0 - uP[0] * 0.025 * (0.5 + 0.5 * sin(q.y * 3.14159 / 1.6));
  float sl = h1(floor(q.x / 2.0), 4u);                                       // scanner CCD streaks
  c = mix(c, uC2, uP[1] * 0.2 * smoothstep(0.94, 1.0, sl));
  c += uP[1] * 0.02 * (vn2(vec2(q.x * 0.4, 0.5), 5u) - 0.5);
  vec2 pp = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);                        // creases: a few straight folds
  for (int k = 0; k < 5; k++) {
    float a = h1(float(k), 21u) * 3.14159;
    float d = dot(pp, vec2(cos(a), sin(a))) - (h1(float(k), 22u) - 0.5) * 0.9;
    d += (vn2(pp * 60.0 + float(k) * 7.0, 23u) - 0.5) * 0.002;
    float side = d > 0.0 ? 1.0 : -0.6;
    c *= 1.0 - uP[5] * (0.16 * smoothstep(0.0018, 0.0, abs(d)) + 0.05 * side * exp(-abs(d) * 25.0));
  }
  c *= 1.0 + uP[5] * 0.05 * (fbm2(uv * 5.0, 7u) - 0.5);
  float d = h2(ivec2(floor(q / 2.5)), 8u);                                   // dust
  c = mix(c, uC2 * 0.55, uP[3] * step(0.9975, d));
  float hair = abs(vn2(q * 0.01 + 4.0, 15u) - 0.5);
  c = mix(c, uC2 * 0.7, uP[3] * 0.5 * smoothstep(0.004, 0.0, hair) * step(0.6, vn2(q * 0.003, 16u)));
  float e = min(uv.x, 1.0 - uv.x);                                           // scanner bed shadow
  c *= 1.0 - uP[4] * 0.35 * smoothstep(0.1, 0.0, e);
  c += (h2(ivec2(px), 9u) - 0.5) * 0.02;                                     // sensor noise
  return c;
}

vec3 film(vec2 px, vec2 q, vec2 uv) {
  float frame = floor(uTime * uP[5]);
  uint fs = uint(frame);
  vec2 g = q / uP[1];
  float n = vn2(g + frame * 17.31, fs) * 0.55 + h2(ivec2(g * 1.7), fs + 11u) * 0.45 - 0.5;
  vec3 c = uC1 * (1.0 + n * uP[0] * 0.55);
  c *= 1.0 - uP[2] * 0.09 * (h1(frame, 12u) - 0.5) * 2.0;
  for (int k = 0; k < 3; k++) {
    float sx = h1v(frame, float(k), 13u);
    if (h1v(floor(frame / 3.0), float(k), 14u) < uP[3] * 0.8) {
      float dx = abs(uv.x - sx) * uRes.x / uUnit;
      float along = smoothstep(0.2, 0.6, vn2(vec2(float(k) * 9.0, q.y * 0.01), 18u));
      c *= 1.0 - 0.4 * smoothstep(1.4, 0.0, dx) * along;
    }
  }
  float dn = vn2(q / 5.0 + frame * 31.7, fs + 20u);
  c *= 1.0 - uP[3] * 0.7 * smoothstep(0.93, 0.985, dn);
  vec2 v = uv - 0.5;
  c *= 1.0 - uP[4] * dot(v, v) * 1.8;
  return c;
}

vec3 digital(vec2 px, vec2 q, vec2 uv) {
  float frame = floor(uTime * uP[4]);
  uint fs = uint(frame);
  ivec2 cell = ivec2(floor(q / uP[2]));
  float l = h2(cell, fs) - 0.5;
  vec3 ch = vec3(h2(cell, fs + 1u), h2(cell, fs + 2u), h2(cell, fs + 3u)) - 0.5;
  vec3 c = uC1 + uP[0] * 0.22 * (vec3(l) + ch * uP[1] * 1.4);
  c += uP[3] * 0.05 * (vn2(vec2(0.5, q.y * 0.04 + frame * 0.37), 30u) - 0.5);
  return c;
}

vec3 magazine(vec2 px, vec2 q, vec2 uv) {
  vec3 c = uC1;
  float st = fbm2(vec2(1.0 - uv.x, uv.y) * vec2(3.0, 4.0) + 9.0, 40u);        // print from the other side
  float density = smoothstep(0.45, 0.72, st);
  float a = radians(uP[2]);
  vec2 hp = mat2(cos(a), -sin(a), sin(a), cos(a)) * q / uP[1];
  float r = length(fract(hp) - 0.5);
  float tone = 0.06 + density * 0.45;
  float dotMask = smoothstep(sqrt(tone) * 0.56, sqrt(tone) * 0.56 - 0.08, r);
  c = mix(c, uC2, dotMask * uP[0] * 0.35);
  c = mix(c, mix(c, uC2, 0.35), density * uP[4] * 0.25);
  c *= 1.0 - uP[3] * 0.06 * fbm2(q * vec2(0.06, 0.7), 41u);
  float g = smoothstep(0.0, 1.0, 1.0 - abs((uv.x + uv.y) - 0.9) * 1.4);
  c += uP[5] * 0.08 * g;
  return c;
}

vec3 graph(vec2 px, vec2 q, vec2 uv) {
  vec2 g = q / uP[0];
  vec2 a = abs(fract(g - 0.5) - 0.5) / fwidth(g);
  float minor = 1.0 - min(min(a.x, a.y) / uP[2], 1.0);
  vec2 gm = g / max(1.0, floor(uP[1]));
  vec2 am = abs(fract(gm - 0.5) - 0.5) / fwidth(gm);
  float major = 1.0 - min(min(am.x, am.y) / (uP[2] * 1.8), 1.0);
  return mix(uC1, uC2, max(minor * 0.45, major) * uP[3]);
}

vec3 crtBg(vec2 px, vec2 q, vec2 uv) {
  vec3 mask = crtMask(q, uP[2], int(uP[1] + 0.5));
  vec3 c = uC1 * 0.35 + uC1 * mask * (0.4 + uP[0] * 1.4);
  c *= 1.0 - uP[3] * 0.5 * (0.5 + 0.5 * cos(q.y * TAU / (uP[2] * 3.0)));
  c += uP[4] * 0.12 * (h2(ivec2(px), uint(uTime * 30.0)) - 0.5);
  vec2 v = (uv - 0.5) * 2.0;
  float corner = length(max(abs(v) - 0.75, 0.0)) / 0.25;
  c *= 1.0 - uP[5] * (0.35 * dot(v, v) * 0.5 + 0.6 * smoothstep(0.6, 1.0, corner));
  return c;
}

vec3 vhs(vec2 px, vec2 q, vec2 uv) {
  float frame = floor(uTime * 30.0);
  uint fs = uint(frame);
  q.x += sin(uv.y * 40.0 + uTime * 3.0) * uP[3] * 3.0;
  vec3 c = uC1 * (0.88 + 0.12 * vn2(vec2(0.5, q.y * 0.02 - uTime * 0.5), 50u));
  c += uP[0] * 0.35 * (h2(ivec2(floor(q.x / 1.5), floor(px.y)), fs) - 0.5);
  float ln = h1(floor(q.y / 2.0), fs + 3u);
  c += uP[0] * 0.5 * step(0.985, ln) * h2(ivec2(px), fs + 5u);
  float bp = 1.0 - fract(uTime * 0.07);
  float band = exp(-pow((uv.y - bp) / 0.03, 2.0));
  c += uP[1] * band * 0.35 * h2(ivec2(floor(q.x / 3.0), floor(px.y)), fs + 7u);
  float cb = vn2(vec2(q.x * 0.01 + uTime * 0.2, q.y * 0.5), 60u) - 0.5;
  c += uP[2] * vec3(cb, -cb * 0.5, cb * 0.8) * 0.14;
  float hs = smoothstep(0.035, 0.0, uv.y);
  c = mix(c, vec3(h2(ivec2(px / 2.0), fs + 9u)), uP[4] * hs * 0.6);
  return c;
}

vec3 gradient(vec2 px, vec2 q, vec2 uv) {
  float t;
  if (uP[2] < 0.5) {
    float a = radians(uP[0]);
    t = dot(uv - 0.5, vec2(cos(a), sin(a))) + 0.5;
  } else {
    t = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0)) * 1.4;
  }
  return mix(uC1, uC2, clamp(t, 0.0, 1.0)) + (h2(ivec2(px), 0u) - 0.5) * uP[1] * 0.06;
}

void main() {
  vec2 px = gl_FragCoord.xy / uSS;   // output pixels
  vec2 uv = px / uRes;
  vec2 q = px / uUnit;               // 1080p-equivalent pixels, so textures scale with resolution
  vec3 c = uC1;
  if (uType == 1) c = receipt(px, q, uv);
  else if (uType == 2) c = film(px, q, uv);
  else if (uType == 3) c = digital(px, q, uv);
  else if (uType == 4) c = magazine(px, q, uv);
  else if (uType == 5) c = graph(px, q, uv);
  else if (uType == 6) c = crtBg(px, q, uv);
  else if (uType == 7) c = vhs(px, q, uv);
  else if (uType == 8) c = gradient(px, q, uv);
  outColor = vec4(clamp(c, 0.0, 1.0), uAlpha);
}
`;
