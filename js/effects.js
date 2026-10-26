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
uniform float uP[12];
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
// Built like the tape signal: 480 lines, soft luma, low-bandwidth delayed
// chroma, edge ringing, per-line timing jitter, dropouts, tracking, head switching.
void main() {
  float frame = floor(uTime * 29.97);
  uint fs = uint(frame);
  float lines = 480.0;
  float line = floor((1.0 - vUv.y) * lines);
  float ux = uUnit / uRes.x;                                   // one 1080p pixel across, in uv
  float jx = ((vn2(vec2(line * 0.08, uTime * 4.0), 2u) - 0.5) * 6.0 + (h1v(line, frame, 1u) - 0.5) * 1.5) * uP[0];
  float bp = fract(-uTime * 0.06);
  float band = exp(-pow((vUv.y - bp) / 0.04, 2.0));
  jx += band * uP[1] * (vn2(vec2(line * 0.5, uTime * 20.0), 3u) - 0.5) * 60.0;
  float hs = smoothstep(0.035, 0.0, vUv.y);
  jx += hs * uP[5] * (25.0 + 30.0 * h1v(line, frame, 4u));
  vec2 uv = vec2(vUv.x + jx * ux, 1.0 - (line + 0.5) / lines);
  // Luma: low horizontal bandwidth, then ringing (the sharpening halo VCRs add).
  float bw = 0.8 + uP[6] * 4.0;
  float Y = 0.0, Yt = 0.0, Yw = 0.0;
  for (int k = -3; k <= 3; k++) {
    float w = exp(-float(k * k) / 4.5);
    Y += lum(src(uv + vec2(float(k) * bw * ux, 0.0))) * w;
    Yt += w;
  }
  Y /= Yt;
  for (int k = -2; k <= 2; k++) Yw += lum(src(uv + vec2((float(k) * bw * 3.0 + 2.0) * ux, 0.0)));
  Y += (Y - Yw / 5.0) * uP[7] * 1.6;
  // Chroma: a fraction of the luma bandwidth, smeared and delayed to the right.
  vec2 C = vec2(0.0);
  float Ct = 0.0;
  float cb = 3.0 + uP[2] * 22.0;
  for (int k = -4; k <= 4; k++) {
    float w = exp(-float(k * k) / 8.0);
    C += rgb2ycc(src(uv + vec2((float(k) * cb * 0.5 - uP[2] * 9.0) * ux, 0.0))).yz * w;
    Ct += w;
  }
  C /= Ct;
  float x = vUv.x / ux;
  C += (vec2(vn2(vec2(x * 0.015, line * 0.5 + frame * 13.0), 5u), vn2(vec2(x * 0.015 + 40.0, line * 0.5 + frame * 13.0), 6u)) - 0.5) * uP[3] * 0.09;
  C *= 1.0 - uP[4] * 0.3;
  vec3 c = ycc2rgb(vec3(Y, C));
  c += uP[3] * ((vn2(vec2(x * 0.3, line + frame * 61.0), 7u) - 0.5) * 0.13 + (h2(ivec2(int(x * 0.7), int(line)), fs + 11u) - 0.5) * 0.05);
  if (h1v(line, frame, 8u) < uP[8] * 0.02) {
    float sx = h1v(line, frame, 12u) * uRes.x / uUnit;
    float len = 15.0 + 170.0 * h1v(line, frame, 13u);
    c = mix(c, vec3(0.95), step(sx, x) * step(x, sx + len) * 0.9);
  }
  c = mix(c, vec3(h2(ivec2(int(x / 3.0), int(line)), fs + 9u)), uP[1] * band * 0.45);
  c = mix(c, vec3(h2(ivec2(int(x * 0.5), int(line)), fs + 10u)), uP[5] * hs * 0.5);
  c = mix(c, c * 0.9 + 0.045, uP[4]);                           // lifted blacks, softer whites
  outColor = vec4(mix(src(vUv), c, uAmount), 1.0);
}
`;

const FILMFX = HEAD + /* glsl */ `
vec3 stockColour(vec3 c, int stock) {
  float l = lum(c);
  if (stock == 3) {                                             // black and white
    float m = smoothstep(0.02, 0.98, l);
    return vec3(1.02, 1.0, 0.96) * mix(l, m, 0.7);
  }
  if (stock == 2) {                                             // Super 8 reversal: punchy, warm, faded blacks
    c = mix(vec3(l), c, 1.3);
    c = smoothstep(-0.05, 1.02, c);
    return c * vec3(1.06, 1.0, 0.86) + vec3(0.045, 0.02, 0.04) * (1.0 - l);
  }
  if (stock == 1) {                                             // 16mm: softer, cooler, greener shadows
    c = mix(vec3(l), c, 0.82);
    c = mix(c, vec3(0.5), 0.06);
    return c + vec3(-0.005, 0.018, 0.006) * (1.0 - l);
  }
  vec3 s = c * c * (3.0 - 2.0 * c);                              // 35mm print: S-curve, warm highs, teal lows
  c = mix(c, s, 0.5) * 0.95 + 0.025;
  return c + vec3(0.03, 0.008, -0.025) * l - vec3(0.018, -0.004, -0.018) * (1.0 - l);
}
void main() {
  int stock = int(uP[0] + 0.5);
  float soft = stock == 3 ? 0.0 : stock == 2 ? 0.6 : stock == 1 ? 0.65 : 0.75;
  float sizeMul = stock == 2 ? 2.2 : stock == 1 ? 1.5 : 1.0;
  Film f = Film(uP[1], uP[2] * sizeMul, soft, stock == 3 ? 0.0 : 0.55, stock == 2 ? 0.6 : 0.35, uP[5], uP[6],
                stock == 0 ? 0.08 : 0.3, uP[8], stock == 2 ? 0.3 : 0.0, stock == 2 ? 0.4 : 0.0, stock == 2 ? 18.0 : 24.0,
                stock == 3 ? 1.0 : 0.0, uP[4]);
  float frame = filmFrame(uTime, f);
  vec2 uv = vUv + filmWeave(frame, f) * uUnit / uRes;
  vec3 c = src(uv);
  if (uP[9] > 0.0) {                                            // lens softness
    vec2 r = 1.5 * uUnit / uRes;
    vec3 b = (src(uv + vec2(r.x, 0.0)) + src(uv - vec2(r.x, 0.0)) + src(uv + vec2(0.0, r.y)) + src(uv - vec2(0.0, r.y))) * 0.25;
    c = mix(c, b, uP[9] * 0.8);
  }
  vec3 hal = vec3(0.0);                                         // halation: highlights bleed red-orange
  for (int i = 0; i < 8; i++) {
    float a = float(i) / 8.0 * TAU;
    vec2 d = vec2(cos(a), sin(a)) * uUnit / uRes;
    hal += max(src(uv + d * 5.0) - 0.62, 0.0) + max(src(uv + d * 13.0) - 0.62, 0.0);
  }
  c += lum(hal / 16.0) * vec3(1.0, 0.33, 0.1) * uP[3] * 2.2;
  c = mix(c, stockColour(clamp(c, 0.0, 1.0), stock), uP[7]);
  c = filmLook(c, uv * uRes / uUnit, uv, uRes, uUnit, uTime, f);
  outColor = vec4(mix(src(vUv), c, uAmount), 1.0);
}
`;

const PHOSPHOR = HEAD + /* glsl */ `
// A close-up of a picture tube: every screen pixel is a red, green and blue
// phosphor lit by an electron beam whose spot grows with brightness, so dark
// areas break into separate dots and bright ones swell and merge toward white.
const vec3 PR = vec3(1.0, 0.1, 0.06), PG = vec3(0.1, 1.0, 0.16), PB = vec3(0.09, 0.2, 1.0);
void main() {
  float a = radians(uP[7]);
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 centre = uRes * 0.5;
  vec2 p = R * (vUv * uRes - centre) / uUnit;                  // rotated, in 1080p pixels
  float cell = uP[0];
  int kind = int(uP[1] + 0.5);
  vec2 g = p / cell;
  float bloom = uP[2], gap = uP[3], focus = uP[8];
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float cx = floor(g.x) + float(i);
      float yoff = kind == 1 || kind == 2 ? mod(cx, 2.0) * 0.5 : 0.0;   // slot and dot masks are staggered
      float cy = floor(g.y - yoff) + float(j);
      vec2 ctr = vec2(cx + 0.5, cy + 0.5 + yoff);
      // Average the picture over the cell (particles have gaps; one tap would speckle).
      vec3 s = vec3(0.0);
      for (int t = 0; t < 4; t++) {
        vec2 o = vec2(float(t & 1) - 0.5, float(t >> 1) - 0.5) * 0.5;
        vec2 spx = transpose(R) * ((ctr + o) * cell) * uUnit + centre;
        s += pow(max(src(spx / uRes), 0.0), vec3(2.2));
      }
      s *= 0.25 * uP[5];                                         // linear light, then drive
      for (int k = 0; k < 3; k++) {
        float v = s[k];
        vec2 sub = kind == 2 ? ctr + vec2(float(k) - 1.0, k == 1 ? -0.28 : 0.2) * vec2(0.3, 1.0)
                               : ctr + vec2((float(k) - 1.0) / 3.0, 0.0);
        sub.x += (float(k) - 1.0) * uP[6] * 0.12;                // convergence error
        vec2 d = g - sub;
        float prof;
        if (kind == 3) {                                       // LCD: hard-edged subpixels, no bloom
          vec2 e = abs(d * vec2(3.0, 1.0));
          float soft = 0.04 + focus * 0.12;
          prof = smoothstep(0.42 + soft, 0.42 - soft, e.x) * smoothstep(0.44 + soft, 0.44 - soft, e.y);
        } else if (kind == 2) {                                // round dots
          float r = mix(0.1, 0.22, pow(v, 0.5)) * (1.0 + bloom * v * 0.7) + focus * 0.06;
          prof = exp(-pow(length(d * vec2(1.0, 0.9)) / r, 2.2));
        } else {                                                 // stripes and slots
          float vv = pow(clamp(v, 0.0, 4.0), 0.55);
          // Beam spot grows with brightness (wider than tall), leaving dark seams between rows.
          float wx = mix(0.14, 0.36, min(vv, 1.0)) * (1.0 + bloom * v * 0.35) + focus * 0.15;
          float wy = mix(0.1, 0.3, min(vv, 1.0)) * (1.0 - gap * 0.5) + bloom * v * 0.08 + focus * 0.15;
          if (kind == 1) wy *= 0.85;
          prof = exp(-pow(abs(d.x * 3.0) / wx, 2.4)) * exp(-pow(abs(d.y) / wy, 2.4));
        }
        acc[k] += v * prof;
      }
    }
  }
  vec3 col = acc.r * PR + acc.g * PG + acc.b * PB;
  vec3 glow = vec3(0.0);                                         // light spreading in the glass
  for (int i = 0; i < 8; i++) {
    float t = float(i) / 8.0 * TAU;
    glow += pow(max(src(vUv + vec2(cos(t), sin(t)) * cell * 0.9 * uUnit / uRes), 0.0), vec3(2.2));
  }
  col += glow / 8.0 * uP[4] * 0.6 * uP[5];
  col = 1.0 - exp(-col * 1.2);                                   // highlights burn out like a photo of a screen
  float l = lum(col);
  col = mix(vec3(l), col, uP[9] * 1.6);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  outColor = vec4(mix(src(vUv), col, uAmount), 1.0);
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
    id: 'film',
    label: 'Film stock',
    note: 'Puts everything on film: grain that reacts to brightness, halation, gate weave, flicker, dust and the colour of the stock.',
    frag: FILMFX,
    params: [
      seg('stock', 'Stock', [['0', '35mm colour'], ['1', '16mm'], ['2', 'Super 8'], ['3', 'Black and white']], '0'),
      range('grain', 'Grain', 0, 1.5, 0.01, 0.6),
      range('size', 'Grain size', 0.5, 4, 0.05, 1.1),
      range('halation', 'Halation', 0, 1, 0.01, 0.35),
      range('weave', 'Gate weave', 0, 1, 0.01, 0.3),
      range('flicker', 'Flicker', 0, 1, 0.01, 0.25),
      range('dust', 'Dust and hair', 0, 1, 0.01, 0.25),
      range('colour', 'Stock colour', 0, 1, 0.01, 0.7),
      range('vignette', 'Vignette', 0, 1, 0.01, 0.3),
      range('soft', 'Lens softness', 0, 1, 0.01, 0.2),
    ],
  },
  {
    id: 'vhs',
    label: 'VHS',
    note: 'Built like the tape signal: soft picture, colour smeared to the right, edge halos, line jitter, dropouts, tracking and head switching.',
    frag: VHS,
    params: [
      range('jitter', 'Line jitter', 0, 1, 0.01, 0.4),
      range('tracking', 'Tracking', 0, 1, 0.01, 0.35),
      range('bleed', 'Colour bleed', 0, 1, 0.01, 0.6),
      range('noise', 'Tape noise', 0, 1, 0.01, 0.4),
      range('color', 'Faded colour', 0, 1, 0.01, 0.5),
      range('head', 'Head switching', 0, 1, 0.01, 0.6),
      range('soft', 'Softness', 0, 1, 0.01, 0.5),
      range('ring', 'Edge halos', 0, 1, 0.01, 0.5),
      range('dropouts', 'Dropouts', 0, 1, 0.01, 0.3),
      seg('osd', 'On-screen display', [['0', 'Off'], ['1', 'PLAY'], ['2', 'Camcorder']], '0'),
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
  {
    id: 'phosphor',
    label: 'RGB phosphors',
    note: 'A macro view of a picture tube: each pixel becomes red, green and blue phosphors whose glow grows with brightness.',
    frag: PHOSPHOR,
    params: [
      range('cell', 'Pixel size', 3, 60, 0.5, 14, { unit: ' px' }),
      seg('layout', 'Phosphors', [['0', 'Stripes'], ['1', 'Slots'], ['2', 'Dots'], ['3', 'LCD']], '0'),
      range('bloom', 'Bloom', 0, 1, 0.01, 0.4),
      range('gap', 'Line gaps', 0, 1, 0.01, 0.75),
      range('glow', 'Glow', 0, 1, 0.01, 0.4),
      range('drive', 'Brightness', 0.5, 4, 0.01, 1.5),
      range('converge', 'Misconvergence', 0, 1, 0.01, 0.15),
      range('angle', 'Camera angle', -15, 15, 0.1, 0, { unit: '°' }),
      range('focus', 'Focus blur', 0, 1, 0.01, 0.15),
      range('sat', 'Saturation', 0, 1, 0.01, 0.85),
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
