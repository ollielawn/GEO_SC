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
    id: 'film35',
    label: '35mm colour',
    type: 2,
    params: [
      color('c1', 'Base', '#cfc8bb'),
      range('grain', 'Grain', 0, 1.5, 0.01, 0.6),
      range('size', 'Grain size', 0.5, 4, 0.05, 1.1),
      range('colour', 'Colour grain', 0, 1, 0.01, 0.5),
      range('mottle', 'Density mottle', 0, 1, 0.01, 0.35),
      range('flicker', 'Flicker', 0, 1, 0.01, 0.2),
      range('weave', 'Gate weave', 0, 1, 0.01, 0.3),
      range('dust', 'Dust and hair', 0, 1, 0.01, 0.25),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.3),
    ],
  },
  {
    id: 'film16',
    label: '16mm',
    type: 9,
    params: [
      color('c1', 'Base', '#c4c3b4'),
      range('grain', 'Grain', 0, 1.5, 0.01, 0.8),
      range('size', 'Grain size', 0.5, 4, 0.05, 1.8),
      range('colour', 'Colour grain', 0, 1, 0.01, 0.6),
      range('flicker', 'Flicker', 0, 1, 0.01, 0.35),
      range('weave', 'Gate weave', 0, 1, 0.01, 0.5),
      range('dust', 'Dust and hair', 0, 1, 0.01, 0.45),
      range('scratch', 'Scratches', 0, 1, 0.01, 0.3),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.45),
    ],
  },
  {
    id: 'super8',
    label: 'Super 8',
    type: 10,
    params: [
      color('c1', 'Base', '#d6c4a4'),
      range('grain', 'Grain', 0, 1.5, 0.01, 0.9),
      range('size', 'Grain size', 0.5, 4, 0.05, 2.6),
      range('flicker', 'Flicker', 0, 1, 0.01, 0.6),
      range('weave', 'Gate weave', 0, 1, 0.01, 0.7),
      range('leaks', 'Light leaks', 0, 1, 0.01, 0.35),
      range('dust', 'Dust and hair', 0, 1, 0.01, 0.5),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.7),
      range('gate', 'Gate edges', 0, 1, 0.01, 0.5),
    ],
  },
  {
    id: 'filmbw',
    label: 'Black and white film',
    type: 11,
    params: [
      color('c1', 'Base', '#bdbdbb'),
      range('grain', 'Grain', 0, 1.5, 0.01, 0.8),
      range('size', 'Grain size', 0.5, 4, 0.05, 1.4),
      range('flicker', 'Flicker', 0, 1, 0.01, 0.3),
      range('weave', 'Gate weave', 0, 1, 0.01, 0.4),
      range('dust', 'Dust and hair', 0, 1, 0.01, 0.4),
      range('scratch', 'Scratches', 0, 1, 0.01, 0.35),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.4),
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
      color('c1', 'Tape colour', '#10142c'),
      range('snow', 'Tape noise', 0, 1, 0.01, 0.45),
      range('tracking', 'Tracking', 0, 1, 0.01, 0.5),
      range('chroma', 'Colour noise', 0, 1, 0.01, 0.5),
      range('dropouts', 'Dropouts', 0, 1, 0.01, 0.4),
      range('head', 'Head switching', 0, 1, 0.01, 0.6),
      range('jitter', 'Line jitter', 0, 1, 0.01, 0.4),
      seg('osd', 'On-screen display', [['0', 'Off'], ['1', 'PLAY'], ['2', 'Camcorder']], '1'),
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
uniform float uP[12];
uniform vec3 uC1, uC2;
uniform vec2 uRes;       // output size in pixels
uniform float uSS, uUnit, uTime, uAlpha;
out vec4 outColor;
${GLSL_COMMON}

const float TAU = 6.2831853;

Film filmFor(int type) {
  //          grain   size    soft  colour  mottle  flicker dust    scratch vignette leaks  gate   fps   mono weave
  if (type == 2)  return Film(uP[0], uP[1], 0.75, uP[2], uP[3], uP[4], uP[6], 0.08,  uP[7], 0.0,  0.0,  24.0, 0.0, uP[5]);
  if (type == 9)  return Film(uP[0], uP[1], 0.65, uP[2], 0.45,  uP[3], uP[5], uP[6], uP[7], 0.0,  0.0,  24.0, 0.0, uP[4]);
  if (type == 10) return Film(uP[0], uP[1], 0.6,  0.7,   0.6,   uP[2], uP[5], 0.25,  uP[6], uP[4], uP[7], 18.0, 0.0, uP[3]);
  return               Film(uP[0], uP[1], 0.0,  0.0,   0.3,   uP[2], uP[4], uP[5], uP[6], 0.0,  0.0,  24.0, 1.0, uP[3]);
}

vec3 film(vec2 q, vec2 uv, int type) {
  Film f = filmFor(type);
  vec2 off = filmWeave(filmFrame(uTime, f), f);
  return filmLook(uC1, q + off, uv + off * uUnit / uRes, uRes, uUnit, uTime, f);
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

// Blank tape, built like the signal: ~480 lines, low horizontal bandwidth,
// smeared colour, per-line timing jitter, dropouts, tracking and head switching.
vec3 vhs(vec2 px, vec2 q, vec2 uv) {
  float frame = floor(uTime * 29.97);
  uint fs = uint(frame);
  vec2 qr = uRes / uUnit;
  float line = floor((1.0 - uv.y) * 480.0);
  float jit = (vn2(vec2(line * 0.08, uTime * 4.0), 50u) - 0.5) * uP[5] * 8.0 + (h1v(line, frame, 51u) - 0.5) * uP[5] * 2.0;
  float x = q.x + jit;
  vec3 c = uC1 * (0.92 + 0.08 * vn2(vec2(0.5, uTime * 0.8), 52u)) * (0.95 + 0.05 * vn2(vec2(0.5, line * 0.02 - uTime * 0.3), 53u));
  float n = vn2(vec2(x * 0.3, line + frame * 61.0), 54u) - 0.5;            // streaky luma noise
  float fine = h2(ivec2(int(x * 0.7), int(line)), fs + 55u) - 0.5;
  c += uP[0] * (n * 0.24 + fine * 0.1);
  vec3 yc = rgb2ycc(c);                                                      // long colour streaks
  yc.yz += (vec2(vn2(vec2(x * 0.015, line * 0.5 + frame * 13.0), 56u), vn2(vec2(x * 0.015 + 40.0, line * 0.5 + frame * 13.0), 57u)) - 0.5) * uP[2] * 0.14;
  c = ycc2rgb(yc);
  if (h1v(line, frame, 58u) < uP[3] * 0.025) {                               // dropouts
    float sx = h1v(line, frame, 59u) * qr.x;
    float len = 15.0 + 170.0 * h1v(line, frame, 60u);
    c = mix(c, vec3(0.92), step(sx, x) * step(x, sx + len) * 0.9);
  }
  float bp = fract(-uTime * 0.06);                                            // tracking band
  float band = exp(-pow((uv.y - bp) / 0.035, 2.0));
  c = mix(c, vec3(h2(ivec2(int(x / 3.0), int(line)), fs + 62u)), uP[1] * band * 0.7);
  float hs = smoothstep(0.03, 0.0, uv.y);                                     // head switching
  c = mix(c, vec3(h2(ivec2(int(x * 0.5 + hs * 40.0), int(line)), fs + 63u)) * 0.8, uP[4] * hs * 0.85);
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
  if (uType == 2 || uType == 9 || uType == 10 || uType == 11) c = film(q, uv, uType);
  else if (uType == 3) c = digital(px, q, uv);
  else if (uType == 4) c = magazine(px, q, uv);
  else if (uType == 5) c = graph(px, q, uv);
  else if (uType == 6) c = crtBg(px, q, uv);
  else if (uType == 7) c = vhs(px, q, uv);
  else if (uType == 8) c = gradient(px, q, uv);
  outColor = vec4(clamp(c, 0.0, 1.0), uAlpha);
}
`;
