// The look engine: settings, their defaults, and how they become the
// parameters for one frame. Shared by the GEO_SC app (main.js) and the website
// player (player.js), so both draw exactly the same thing from the same settings.
// Nothing here touches the page: it's plain functions of the settings object S.

import { BACKGROUNDS } from './backgrounds.js';
import { EFFECTS, PALETTES, CHARSETS } from './effects.js';

export const TAU = Math.PI * 2;
export const fract = (x) => x - Math.floor(x);

export const DENSITY = { sparse: 450, medium: 900, dense: 1400 };
export const COLOR_MODES = { original: 0, ink: 1, negative: 2, duotone: 3 };
export const SCAN_AXES = { depth: 0, across: 1, down: 2 };

export const DEFAULTS = {
  depthMode: 'luma',
  flipDepth: false,
  key: 0.12,
  density: 'medium',
  size: 1.3,
  depth: 0.6,
  scale: 1.0,
  // auto motion
  bpm: 120,
  bars: '2',
  spin: 0,
  tilt: 0,
  sway: 0.3,
  dolly: 0,
  pulse: 0,
  wave: 0,
  waveSize: 2,
  waveDir: 0,
  ripple: 0,
  rippleSize: 2,
  twist: 0,
  // manual motion
  drift: 0.25,
  speed: 1.0,
  stream: 0.06,
  wind: 160,
  splash: 0.6,
  cursorSize: 0.35,
  // scan
  scan: true,
  scanAxis: 'depth',
  scanSpeed: 0.5,
  scanWidth: 0.06,
  scanBurn: 0.3,
  scanJitter: 0.5,
  // trails
  trails: false,
  trailLength: 0.6,
  // geometry
  geo: false,
  geoSource: 'corners',
  geoCount: 40,
  geoSpacing: 0.05,
  geoLinks: 'nearest',
  geoK: 2,
  geoMaxLen: 0.3,
  geoMark: 'cross',
  geoMarkSize: 1,
  geoLabel: 'value',
  geoDecimals: 2,
  geoFont: 'mono',
  geoTextSize: 1,
  geoColor: 'ink',
  geoLineWidth: 1,
  geoOpacity: 0.9,
  geoBox: false,
  geoReveal: false,
  // background (per-background settings are added below from backgrounds.js)
  bg: 'plain',
  // tracking (moving or still sources)
  track: false,
  trackMode: 'brightness',
  trackThresh: 0.6,
  trackInvert: false,
  trackKey: '#e2231a',
  trackKeyTol: 0.25,
  trackRes: '192',
  trackBlur: 0.5,
  trackClose: 1,
  trackMinSize: 0.3,
  trackMaxSize: 40,
  trackMaxCount: 12,
  trackSmooth: 0.5,
  trackHold: 6,
  trackLatency: 'smooth',
  trackStyle: 'outline',
  trackColor: 'accent',
  trackLineWidth: 1.2,
  trackFill: 0.35,
  trackPad: 6,
  trackMark: 'cross',
  trackLabelId: true,
  trackLabelSize: false,
  trackLabelPos: false,
  trackLabelBox: false,
  trackFont: 'mono',
  trackTextSize: 1,
  trackLinks: 'none',
  trackLinkK: 2,
  trackEdges: false,
  trackEdgeThresh: 0.25,
  trackEdgeMin: 6,
  trackEdgeWidth: 1,
  trackEdgeOpacity: 0.8,
  trackEdgeColor: 'ink',
  hud: false,
  // look
  colorMode: 'original',
  ink: '#111111',
  accent: '#e2231a',
  glow: false,
  grain: 0.02,
  // export
  format: 'reel',
  resolution: '1080',
  smoothing: '2x',
  fps: '60',
  quality: 'high',
  duration: 10,
  presetBlend: '4',
};

// Settings for every background and effect come from their descriptions.
export const bgKey = (bg, p) => `bg_${bg}_${p}`;
export const fxKey = (fx, p) => `fx_${fx}_${p}`;
for (const bg of BACKGROUNDS) for (const p of bg.params) DEFAULTS[bgKey(bg.id, p.id)] = p.def;
for (const fx of EFFECTS) {
  DEFAULTS[fxKey(fx.id, 'on')] = false;
  DEFAULTS[fxKey(fx.id, 'amount')] = fx.amount ?? 1;
  for (const p of fx.params) DEFAULTS[fxKey(fx.id, p.id)] = p.def;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function tempo(S) {
  const beat = 60 / S.bpm;
  const bar = beat * 4;
  const cycle = bar * Number(S.bars);
  return { beat, bar, cycle };
}

export function bgBase(S) {
  return S[bgKey(S.bg, 'c1')] || '#eeefec';
}
export function isDark(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.4;
}

export function bgParams(S) {
  const def = BACKGROUNDS.find((b) => b.id === S.bg) || BACKGROUNDS[0];
  const p = new Float32Array(12);
  let i = 0;
  const out = { type: def.type, p, c1: hexToRgb(bgBase(S)), c2: [0, 0, 0] };
  for (const prm of def.params) {
    const v = S[bgKey(def.id, prm.id)];
    if (prm.type === 'color') out[prm.id] = hexToRgb(v);
    else p[i++] = Number(v) || 0;
  }
  return out;
}

export function effectParams(S, beats, mosh) {
  const list = [];
  for (const def of EFFECTS) {
    if (!S[fxKey(def.id, 'on')]) continue;
    const p = new Float32Array(12);
    let i = 0;
    const fx = { id: def.id, amount: S[fxKey(def.id, 'amount')], p, c1: [0, 0, 0], c2: [1, 1, 1] };
    for (const prm of def.params) {
      const v = S[fxKey(def.id, prm.id)];
      if (prm.type === 'color') fx[prm.id] = hexToRgb(v);
      else p[i++] = Number(v) || 0;
    }
    if (def.id === 'palette') {
      const names = ['gameboy', 'cga1', 'cga2', 'ega', 'mac16', 'teletext', 'virtualboy'];
      const idx = Number(S[fxKey('palette', 'palette')]);
      const cols = names[idx] ? PALETTES[names[idx]] : [S.ink, S.accent, bgBase(S)];
      fx.palette = new Float32Array(48);
      cols.forEach((h, k) => fx.palette.set(hexToRgb(h), k * 3));
      fx.paletteSize = cols.length;
    }
    if (def.id === 'ascii') fx.charset = CHARSETS[S[fxKey('ascii', 'charset')]] || CHARSETS.classic;
    if (def.id === 'datamosh') {
      const every = Number(S[fxKey('datamosh', 'keys')]);
      const idx = every > 0 ? Math.floor(beats / every) : 0;
      fx.keyframe = every > 0 && idx !== mosh.lastKeyIdx;
      mosh.lastKeyIdx = idx;
    }
    list.push(fx);
  }
  return list;
}

// Advance the clock that drives auto motion. Spin is accumulated, so changing
// its speed never makes the picture jump.
export function stepClock(clock, S, dt) {
  clock.time += dt;
  clock.spin += (dt / tempo(S).cycle) * TAU * S.spin;
  clock.scan += dt * S.scanSpeed * 0.25;
}

// How much the website player enlarges the logo on a portrait frame (aspect =
// width / height). It ramps up from square to phone shape, so resizing never
// jumps, and never lets the logo fill more than 90% of the frame (leaving room
// for the near end to grow in perspective as it spins). GEO_SC uses
// the same rule for the tall fallback still, so the still and the live canvas match.
export const MOBILE_SCALE = 1.35;
export function portraitScale(S, aspect, mobileScale = MOBILE_SCALE) {
  if (aspect >= 1) return 1;
  const t = Math.min(1, (1 - aspect) / 0.45);
  const want = 1 + (mobileScale - 1) * t;
  const cap = Math.max(1, 0.9 / (0.82 * S.scale));
  return Math.min(want, cap);
}

// Everything the renderer needs for one frame, except the pictures, the morph
// between them and the camera matrices (the caller adds those).
//   st.time, st.scan, st.spin  the clock (see stepClock)
//   st.cam                     { yaw, pitch, zoom } of the user camera
//   st.mosh                    { lastKeyIdx } state kept between frames for datamosh
//   st.splash(zoom)            optional: returns { pos: [x, y], amount } for the cursor push
//   st.density, st.scaleMul    optional overrides used by the website player
export function lookParams(S, st) {
  const t = st.time;
  const tp = tempo(S);
  const cycles = t / tp.cycle;
  const cyclePhase = fract(cycles);
  const barPhase = fract(t / tp.bar);
  const beats = t / tp.beat;
  const beatPhase = fract(beats);
  const env = Math.exp(-beatPhase * 5);

  const cam = st.cam;
  const yaw = cam.yaw + st.spin + Math.sin(TAU * cyclePhase) * 0.3 * S.sway;
  const pitch = cam.pitch + (S.tilt * Math.PI) / 180 + Math.sin(2 * TAU * cyclePhase) * 0.12 * S.sway;
  const zoom = cam.zoom * (1 + S.dolly * 0.35 * Math.sin(TAU * cyclePhase));

  const sp = st.splash ? st.splash(zoom) : null;
  const keep = 0.75 + 0.235 * S.trailLength; // fraction of last frame kept
  const f = {
    time: t,
    density: st.density ?? DENSITY[S.density],
    size: S.size * (1 + S.pulse * env * 0.35),
    depth: S.depth * (1 + S.pulse * env * 0.9),
    scale: S.scale * (st.scaleMul ?? 1),
    opacity: 1,
    key: S.key,
    drift: S.drift,
    speed: S.speed,
    stream: S.stream,
    wind: (S.wind * Math.PI) / 180,
    scatter: 0,
    barPhase,
    cyclePhase,
    wave: S.wave,
    waveFreq: S.waveSize,
    waveAngle: (S.waveDir * Math.PI) / 180,
    ripple: S.ripple,
    rippleFreq: S.rippleSize,
    twist: S.twist,
    splashPos: sp ? sp.pos : [0, 0],
    splash: sp ? sp.amount : 0,
    splashRadius: S.cursorSize,
    scan: S.scan,
    scanPos: -0.3 + 1.6 * fract(st.scan),
    scanWidth: S.scanWidth,
    scanBurn: S.scanBurn,
    scanJitter: S.scanJitter,
    scanAxis: SCAN_AXES[S.scanAxis],
    trails: S.trails,
    trailFade: 1 - keep,
    ink: hexToRgb(S.ink),
    accent: hexToRgb(S.accent),
    colorMode: COLOR_MODES[S.colorMode],
    bg: bgParams(S),
    effects: effectParams(S, beats, st.mosh),
    beatPhase,
    beats,
    paperDark: isDark(bgBase(S)),
    flipDepth: S.flipDepth,
    glow: S.glow,
    grain: S.grain,
    yaw,
    pitch,
    zoom,
  };
  return f;
}
