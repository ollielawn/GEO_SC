// Global effects, applied over everything (particles, background, geometry)
// in the order listed. Each effect is described once: its settings (the
// panel builds controls from them) and its shader. Number settings map onto
// uP[0..7] in order; colour settings onto uC1/uC2. Every effect also gets
// an Amount (uAmount) and the tempo clock (uBeat = phase in the beat,
// uBeats = beats elapsed).

import { GLSL_COMMON } from './shaders.js';

const range = (id, label, min, max, step, def, extra = {}) => ({ id, label, type: 'range', min, max, step, def, ...extra });
const seg = (id, label, options, def) => ({ id, label, type: 'seg', options, def });
const color = (id, label, def) => ({ id, label, type: 'color', def });

export const PALETTES = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  cga1: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  cga2: ['#000000', '#55ff55', '#ff5555', '#ffff55'],
  ega: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'],
  mac16: ['#ffffff', '#fcf305', '#ff6402', '#dd0806', '#f20884', '#4600a5', '#0000d4', '#02abea', '#1fb714', '#006411', '#562c05', '#90713a', '#c0c0c0', '#808080', '#404040', '#000000'],
  teletext: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'],
  virtualboy: ['#000000', '#550000', '#aa0000', '#ff0000'],
};

export const CHARSETS = {
  classic: ' .:-=+*#%@',
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: ' ░▒▓█',
  binary: ' 01',
};

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uUnit, uTime, uBeat, uBeats, uAmount;
uniform float uP[8];
uniform vec3 uC1, uC2;
in vec2 vUv;
out vec4 outColor;
${GLSL_COMMON}
const float TAU = 6.2831853;
vec3 src(vec2 uv) { return texture(uSrc, uv).rgb; }
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
`;

const DATAMOSH = HEAD + /* glsl */ `
uniform sampler2D uHist, uPrevSrc;
uniform float uKeyframe;
void main() {
  vec2 px = vUv * uRes;
  float bs = uP[1] * uUnit;
  vec2 blk = floor(px / bs);
  vec2 bc = (blk + 0.5) * bs / uRes;
  vec3 cur = src(vUv);
  // Per-block motion: drifting noise vectors plus a rough optical flow estimate.
  float tt = uBeats * 0.35;
  vec2 mv = (vec2(vn2(blk * 0.35 + vec2(tt, 0.0), 70u), vn2(blk * 0.35 + vec2(0.0, tt) + 9.0, 71u)) - 0.5) * uP[2] * bs * 0.5;
  vec2 ex = vec2(2.0 * uUnit / uRes.x, 0.0), ey = vec2(0.0, 2.0 * uUnit / uRes.y);
  float It = lum(texture(uSrc, bc).rgb) - lum(texture(uPrevSrc, bc).rgb);
  vec2 g = vec2(lum(texture(uSrc, bc + ex).rgb) - lum(texture(uSrc, bc - ex).rgb), lum(texture(uSrc, bc + ey).rgb) - lum(texture(uSrc, bc - ey).rgb));
  vec2 flow = clamp(-It * g / (dot(g, g) + 0.002), -1.0, 1.0);
  mv += flow * uP[3] * bs * 1.5;
  vec3 h = texture(uHist, (px - mv) / uRes).rgb;
  float refresh = max(uKeyframe, step(h2(ivec2(blk), uint(uTime * 30.0)), uP[5] * 0.06));
  float keep = clamp(uP[0] * uAmount, 0.0, 0.995) * (1.0 - refresh);
  outColor = vec4(mix(cur, h, keep), 1.0);
}
`;

const BEND = HEAD + /* glsl */ `
void main() {
  float slot = floor(uBeats * uP[0]);
  if (h1(slot, 1u) > uAmount) { outColor = vec4(src(vUv), 1.0); return; }
  vec2 uv = vUv;
  float sh = max(1.0, uP[1] * uUnit);
  float row = floor(uv.y * uRes.y / sh);
  if (h1v(row, slot, 2u) < 0.4) uv.x += (h1v(row, slot, 3u) - 0.5) * uP[2] * 0.6;
  vec2 bpx = floor(uv * uRes / (sh * 3.0));
  if (h2(ivec2(bpx), uint(slot) + 5u) < uP[6] * 0.2) uv += vec2(h1(slot, 6u), h1(slot, 7u)) * 0.35;
  vec3 c = src(fract(uv));
  float cs = h1(slot, 8u);
  if (cs < uP[3]) c = cs < uP[3] * 0.5 ? c.gbr : c.brg;
  if (h1(slot, 9u) < uP[4]) { float lv = mix(24.0, 2.0, uP[4]); c = floor(c * lv) / lv; }
  if (h1v(row, slot, 10u) < uP[5] * 0.3) c = 1.0 - c;
  outColor = vec4(c, 1.0);
}
`;

const LOWRES = HEAD + /* glsl */ `
void main() {
  vec2 px = vUv * uRes;
  float ps = max(1.0, uP[0] * uUnit);
  vec3 c = src((floor(px / ps) + 0.5) * ps / uRes);
  float bs = 8.0 * ps;                                   // JPEG-style 8×8 blocks
  vec2 b0 = floor(px / bs) * bs;
  vec3 mean = (src((b0 + vec2(0.25, 0.25) * bs) / uRes) + src((b0 + vec2(0.75, 0.25) * bs) / uRes) + src((b0 + vec2(0.25, 0.75) * bs) / uRes) + src((b0 + vec2(0.75, 0.75) * bs) / uRes)) * 0.25;
  c = mix(c, mean, uP[2] * 0.75);
  vec3 yc = rgb2ycc(c);                                  // chroma at half resolution
  vec3 cc = rgb2ycc(src((floor(px / (ps * 2.0)) + 0.5) * ps * 2.0 / uRes));
  yc.yz = mix(yc.yz, cc.yz, uP[3]);
  c = ycc2rgb(yc);
  float lv = pow(2.0, floor(uP[1])) - 1.0;
  c = floor(c * lv + 0.5) / lv;
  outColor = vec4(mix(src(vUv), c, uAmount), 1.0);
}
`;

const PALETTE = HEAD + /* glsl */ `
uniform vec3 uPal[16];
uniform int uPalN;
float pattern(vec2 cell, int kind) {
  if (kind == 1) return bayer4(cell);
  if (kind == 2) return bayer8(cell);
  if (kind == 3) return h2(ivec2(cell), 77u);
  return 0.5;
}
void main() {
  vec2 px = vUv * uRes;
  float ps = max(1.0, uP[3] * uUnit);
  vec2 cell = floor(px / ps);
  vec3 c = src((cell + 0.5) * ps / uRes);
  c += (pattern(cell, int(uP[1] + 0.5)) - 0.5) * uP[2] * 0.45;
  vec3 best = uPal[0];
  float bd = 1e9;
  for (int i = 0; i < 16; i++) {
    if (i >= uPalN) break;
    vec3 d = (c - uPal[i]) * vec3(0.3, 0.59, 0.11);
    float dist = dot(d, d);
    if (dist < bd) { bd = dist; best = uPal[i]; }
  }
  outColor = vec4(mix(src(vUv), best, uAmount), 1.0);
}
`;

const DITHER = HEAD + /* glsl */ `
float pattern(vec2 cell, int kind) {
  if (kind == 0) return bayer2(cell);
  if (kind == 1) return bayer4(cell);
  if (kind == 2) return bayer8(cell);
  if (kind == 3) return h2(ivec2(cell), 91u);
  if (kind == 4) return abs(fract(cell.y / 4.0) - 0.5) * 2.0;
  vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * cell / 5.0;   // halftone dots
  return clamp(length(fract(r) - 0.5) * 1.414, 0.0, 1.0);
}
void main() {
  vec2 px = vUv * uRes;
  float ps = max(1.0, uP[1] * uUnit);
  vec2 cell = floor(px / ps);
  float l = lum(src((cell + 0.5) * ps / uRes));
  l = (l - 0.5) * uP[3] + 0.5 + uP[2];
  float bit = step(pattern(cell, int(uP[0] + 0.5)), l);
  outColor = vec4(mix(src(vUv), mix(uC1, uC2, bit), uAmount), 1.0);
}
`;

const ASCII = HEAD + /* glsl */ `
uniform sampler2D uAtlas;
uniform float uGlyphs;
void main() {
  vec2 px = vUv * uRes;
  float cs = uP[0] * uUnit;
  vec2 size = vec2(cs * 0.6, cs);
  vec2 cell = floor(px / size);
  vec3 c = src((cell + 0.5) * size / uRes);
  float l = clamp(lum(c), 0.0, 0.999);
  float gi = floor(l * uGlyphs);
  vec2 local = fract(px / size);
  float g = texture(uAtlas, vec2((gi + local.x) / uGlyphs, 1.0 - local.y)).r;
  int mode = int(uP[2] + 0.5);
  vec3 fg = vec3(0.25, 1.0, 0.45), bg = vec3(0.01, 0.05, 0.02);
  if (mode == 1) { fg = vec3(1.0, 0.69, 0.1); bg = vec3(0.06, 0.03, 0.0); }
  else if (mode == 2) { fg = vec3(1.0); bg = vec3(0.0); }
  else if (mode == 3) { fg = c * 1.35; bg = vec3(0.0); }
  else if (mode == 4) { fg = uC1; bg = uC2; }
  vec3 r = mix(bg, fg, g) + fg * l * uP[3] * 0.25;
  outColor = vec4(mix(src(vUv), r, uAmount), 1.0);
}
`;

const RGBSHIFT = HEAD + /* glsl */ `
void main() {
  float kick = 1.0 + uP[3] * exp(-uBeat * 5.0) * 2.0;
  vec2 dir = vec2(cos(radians(uP[1])), sin(radians(uP[1])));
  vec2 off = mix(dir, (vUv - 0.5) * 2.0, uP[2]) * uP[0] * uUnit * kick * uAmount / uRes;
  outColor = vec4(src(vUv + off).r, src(vUv).g, src(vUv - off).b, 1.0);
}
`;

const VHS = HEAD + /* glsl */ `
void main() {
  float frame = floor(uTime * 30.0);
  uint fs = uint(frame);
  vec2 uv = vUv;
  float line = floor(uv.y * uRes.y / (2.0 * uUnit));
  uv.x += (h1v(line, frame, 1u) - 0.5) * uP[0] * 0.004 + (vn2(vec2(uv.y * 40.0, uTime * 3.0), 2u) - 0.5) * uP[0] * 0.012;
  float bp = 1.0 - fract(uTime * 0.08);
  float band = exp(-pow((uv.y - bp) / 0.04, 2.0));
  uv.x += band * uP[1] * 0.05 * (vn2(vec2(uv.y * 200.0, uTime * 20.0), 3u) - 0.5);
  float hs = smoothstep(0.045, 0.0, uv.y);
  uv.x += hs * uP[5] * 0.04 * (h1v(line, frame, 4u) - 0.3);
  vec3 yc = rgb2ycc(src(uv));
  vec2 cc = vec2(0.0);
  for (int k = 0; k < 6; k++) cc += rgb2ycc(src(uv - vec2(float(k) * uP[2] * 3.0 * uUnit / uRes.x, 0.0))).yz;
  yc.yz = mix(yc.yz, cc / 6.0, min(1.0, uP[2] * 1.5));
  yc.yz *= 1.0 + uP[4] * 0.5;
  yc.z += uP[4] * 0.03;
  vec3 c = ycc2rgb(yc);
  c += uP[3] * 0.14 * (h2(ivec2(vUv * uRes / vec2(2.0, 1.0)), fs) - 0.5);
  c += band * uP[1] * 0.3 * h2(ivec2(vUv * uRes / vec2(3.0, 1.0)), fs + 5u);
  c += hs * uP[5] * 0.35 * (h2(ivec2(vUv * uRes / 2.0), fs + 7u) - 0.5);
  outColor = vec4(mix(src(vUv), c, uAmount), 1.0);
}
`;

const CRT = HEAD + /* glsl */ `
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float k = uP[0] * 0.22;
  vec2 cp = p * (1.0 + k * dot(p, p)) / (1.0 + k * 1.2);
  vec2 uv = cp * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(mix(src(vUv), vec3(0.0), uAmount), 1.0); return; }
  float ab = 0.8 * uUnit / uRes.x;
  vec3 c = vec3(src(uv + vec2(ab, 0.0)).r, src(uv).g, src(uv - vec2(ab, 0.0)).b);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) / 8.0 * TAU;
    glow += src(uv + vec2(cos(a), sin(a)) * 7.0 * uUnit / uRes);
  }
  glow /= 8.0;
  c += uP[5] * 0.6 * glow * glow;
  float s = 0.5 + 0.5 * cos(uv.y * uP[2] * TAU);
  c *= mix(1.0, 0.5 + 0.5 * s, uP[1]) * (1.0 + uP[1] * 0.3);
  vec3 mask = crtMask(uv * uRes / uUnit, 2.0, int(uP[3] + 0.5));
  c *= mix(vec3(1.0), mask * 1.6, uP[4]);
  float corner = length(max(abs(cp) - 0.82, 0.0)) / 0.18;
  c *= mix(1.0, smoothstep(1.3, 0.5, length(cp)) * smoothstep(1.0, 0.7, corner), uP[6]);
  c *= 1.0 - uP[7] * 0.07 * h1(floor(uTime * 60.0), 3u);
  float roll = fract(uv.y - uTime * 0.12);
  c *= 1.0 + uP[7] * 0.1 * smoothstep(0.0, 0.08, roll) * smoothstep(0.25, 0.08, roll);
  outColor = vec4(mix(src(vUv), c, uAmount), 1.0);
}
`;

export const EFFECTS = [
  {
    id: 'datamosh',
    label: 'Datamosh',
    note: 'Smears the previous frames along their motion, like a video with its keyframes ripped out.',
    frag: DATAMOSH,
    params: [
      range('mosh', 'Mosh', 0, 1, 0.01, 0.9),
      range('block', 'Block size', 4, 64, 1, 16, { unit: ' px' }),
      range('motion', 'Drift', 0, 1, 0.01, 0.4),
      range('follow', 'Follow movement', 0, 1, 0.01, 0.6),
      seg('keys', 'Clean frame every', [['1', '1 beat'], ['2', '2'], ['4', '4'], ['8', '8'], ['16', '16'], ['0', 'Never']], '4'),
      range('refresh', 'Random block refresh', 0, 1, 0.01, 0.2),
    ],
  },
  {
    id: 'bend',
    label: 'Circuit bend',
    note: 'Glitches like a hot-wired video mixer: slipped lines, swapped channels, crushed colour. Amount sets how often it fires.',
    frag: BEND,
    params: [
      range('rate', 'Glitches per beat', 0.25, 8, 0.25, 2, { unit: '' }),
      range('slice', 'Slice height', 2, 200, 1, 24, { unit: ' px' }),
      range('shift', 'Line slip', 0, 1, 0.01, 0.4),
      range('swap', 'Channel swap', 0, 1, 0.01, 0.4),
      range('crush', 'Bit crush', 0, 1, 0.01, 0.3),
      range('invert', 'Invert', 0, 1, 0.01, 0.2),
      range('corrupt', 'Corrupt blocks', 0, 1, 0.01, 0.3),
    ],
    amount: 0.5,
  },
  {
    id: 'lowres',
    label: 'Low-res and JPEG',
    note: 'Big pixels, fewer colours, 8×8 compression blocks and smeared colour.',
    frag: LOWRES,
    params: [
      range('pixel', 'Pixel size', 1, 48, 1, 4, { unit: ' px' }),
      range('bits', 'Colour depth', 1, 8, 1, 5, { unit: ' bit' }),
      range('blocks', 'Compression blocks', 0, 1, 0.01, 0.4),
      range('chroma', 'Colour smear', 0, 1, 0.01, 0.6),
    ],
  },
  {
    id: 'palette',
    label: 'Retro palette',
    note: 'Forces every pixel into a classic computer palette, with optional dithering.',
    frag: PALETTE,
    params: [
      seg('palette', 'Palette', [['0', 'Game Boy'], ['1', 'CGA cyan'], ['2', 'CGA red'], ['3', 'EGA'], ['4', 'Mac 16'], ['5', 'Teletext'], ['6', 'Virtual Boy'], ['7', 'Your colours']], '0'),
      seg('pattern', 'Dither', [['0', 'None'], ['1', 'Bayer 4'], ['2', 'Bayer 8'], ['3', 'Noise']], '1'),
      range('strength', 'Dither strength', 0, 1, 0.01, 0.6),
      range('pixel', 'Pixel size', 1, 16, 1, 3, { unit: ' px' }),
    ],
  },
  {
    id: 'dither',
    label: '1-bit dither',
    note: 'Two colours only, like an early Mac or a fax.',
    frag: DITHER,
    params: [
      seg('pattern', 'Pattern', [['0', 'Bayer 2'], ['1', 'Bayer 4'], ['2', 'Bayer 8'], ['3', 'Noise'], ['4', 'Lines'], ['5', 'Halftone']], '2'),
      range('pixel', 'Pixel size', 1, 12, 1, 2, { unit: ' px' }),
      range('threshold', 'Threshold', -0.5, 0.5, 0.01, 0),
      range('contrast', 'Contrast', 0.5, 3, 0.01, 1.2),
      color('c1', 'Dark', '#111111'),
      color('c2', 'Light', '#eeefec'),
    ],
  },
  {
    id: 'ascii',
    label: 'ASCII terminal',
    note: 'Rebuilds the picture out of text characters.',
    frag: ASCII,
    params: [
      range('cell', 'Character size', 6, 40, 1, 14, { unit: ' px' }),
      seg('charset', 'Characters', [['classic', 'Classic'], ['detailed', 'Detailed'], ['blocks', 'Blocks'], ['binary', 'Binary']], 'classic'),
      seg('color', 'Colour', [['0', 'Green'], ['1', 'Amber'], ['2', 'White'], ['3', 'Original'], ['4', 'Your colours']], '0'),
      range('glow', 'Glow', 0, 1, 0.01, 0.4),
      color('c1', 'Text', '#e2231a'),
      color('c2', 'Screen', '#111111'),
    ],
  },
  {
    id: 'rgb',
    label: 'RGB shift',
    note: 'Pulls the red and blue channels apart. Beat kick widens it on every beat.',
    frag: RGBSHIFT,
    params: [
      range('shift', 'Shift', 0, 40, 0.5, 6, { unit: ' px' }),
      range('angle', 'Angle', 0, 360, 1, 0, { unit: '°' }),
      range('radial', 'From the centre', 0, 1, 0.01, 0),
      range('kick', 'Beat kick', 0, 1, 0.01, 0.3),
    ],
  },
  {
    id: 'vhs',
    label: 'VHS',
    note: 'Tape wobble, tracking bands, bleeding colour and head-switching noise.',
    frag: VHS,
    params: [
      range('jitter', 'Line jitter', 0, 1, 0.01, 0.4),
      range('tracking', 'Tracking', 0, 1, 0.01, 0.5),
      range('bleed', 'Colour bleed', 0, 1, 0.01, 0.6),
      range('noise', 'Noise', 0, 1, 0.01, 0.4),
      range('color', 'Colour shift', 0, 1, 0.01, 0.4),
      range('head', 'Head switching', 0, 1, 0.01, 0.6),
    ],
  },
  {
    id: 'crt',
    label: 'CRT',
    note: 'A curved tube with scanlines, a phosphor mask and glow.',
    frag: CRT,
    params: [
      range('curve', 'Curvature', 0, 1, 0.01, 0.5),
      range('scan', 'Scanlines', 0, 1, 0.01, 0.5),
      range('lines', 'Line count', 120, 960, 10, 480, { unit: '' }),
      seg('mask', 'Mask', [['0', 'Grille'], ['1', 'Slot'], ['2', 'Dots']], '0'),
      range('maskAmt', 'Mask strength', 0, 1, 0.01, 0.4),
      range('glow', 'Glow', 0, 1, 0.01, 0.5),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.6),
      range('flicker', 'Flicker and roll', 0, 1, 0.01, 0.3),
    ],
  },
];

// Draw the glyph strip used by the ASCII effect.
export function glyphAtlas(chars) {
  const cw = 48, ch = 80;
  const c = document.createElement('canvas');
  c.width = cw * chars.length;
  c.height = ch;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 66px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  [...chars].forEach((g, i) => ctx.fillText(g, i * cw + cw / 2, ch / 2 + 2));
  return c;
}
