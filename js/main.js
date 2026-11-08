import { Renderer } from './renderer.js';
import { aiAvailable, aiDepth, lumaDepth, flatDepth, flip } from './depth.js';
import { Recorder, download, probeFormat } from './recorder.js';
import { encodeVideo, findEncoder } from './encoder.js';
import { analyse, pickPoints, buildLinks, GeometryLayer, FONTS, displace, project, sampleBilinear } from './geometry.js';
import { VideoSource, CameraSource } from './media.js';
import { Tracker, drawTracking } from './tracking.js';
import { BACKGROUNDS } from './backgrounds.js';
import { EFFECTS, PALETTES, CHARSETS } from './effects.js';
import { PresetStore, STARTERS, NOT_IN_PRESETS, clean } from './presets.js';

// ---------------------------------------------------------------- settings

const FORMATS = {
  reel: { w: 1080, h: 1920, label: 'Reel 9:16' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5' },
  square: { w: 1080, h: 1080, label: 'Square 1:1' },
  wide: { w: 1920, h: 1080, label: 'Wide 16:9' },
};
const DENSITY = { sparse: 450, medium: 900, dense: 1400 };
const COLOR_MODES = { original: 0, ink: 1, negative: 2, duotone: 3 };
const SCAN_AXES = { depth: 0, across: 1, down: 2 };
const QUALITY_BPP = { standard: 0.12, high: 0.25, max: 0.5 }; // bits per pixel per frame
const MAX_SLOTS = 4;
const STORAGE_KEY = 'geo_sc:settings:v1';
const COLLAPSE_KEY = 'geo_sc:collapsed:v1';
const TAU = Math.PI * 2;

const DEFAULTS = {
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
const bgKey = (bg, p) => `bg_${bg}_${p}`;
const fxKey = (fx, p) => `fx_${fx}_${p}`;
for (const bg of BACKGROUNDS) for (const p of bg.params) DEFAULTS[bgKey(bg.id, p.id)] = p.def;
for (const fx of EFFECTS) {
  DEFAULTS[fxKey(fx.id, 'on')] = false;
  DEFAULTS[fxKey(fx.id, 'amount')] = fx.amount ?? 1;
  for (const p of fx.params) DEFAULTS[fxKey(fx.id, p.id)] = p.def;
}

// Backgrounds that have been retired fall back to something sensible.
function validBg(id) {
  if (BACKGROUNDS.some((b) => b.id === id)) return id;
  return id === 'film' ? 'film35' : 'plain';
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
    out.bg = validBg(out.bg);
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
    } catch {
      /* private mode etc. — settings just won't persist */
    }
  }, 200);
}

const S = loadSettings();

// ---------------------------------------------------------------- control panel

const SECTIONS = [
  {
    id: 'presets',
    title: 'Presets',
    controls: [{ type: 'presets' }],
  },
  {
    id: 'source',
    title: 'Source',
    controls: [
      { key: 'depthMode', type: 'seg', label: 'Depth from', options: [['ai', 'AI model'], ['luma', 'Brightness'], ['flat', 'Flat']] },
      { key: 'flipDepth', type: 'toggle', label: 'Flip depth' },
      { key: 'key', type: 'range', label: 'Remove background', min: 0, max: 0.6, step: 0.01 },
    ],
  },
  {
    id: 'form',
    title: 'Form',
    controls: [
      { key: 'density', type: 'seg', label: 'Particles', options: [['sparse', 'Sparse'], ['medium', 'Medium'], ['dense', 'Dense']] },
      { key: 'size', type: 'range', label: 'Dot size', min: 0.3, max: 3, step: 0.05 },
      { key: 'depth', type: 'range', label: 'Depth', min: 0, max: 1.5, step: 0.01 },
      { key: 'scale', type: 'range', label: 'Image size', min: 0.4, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: 'auto',
    title: 'Auto motion',
    note: 'Everything here locks to the tempo. One cycle is the number of bars you pick.',
    controls: [
      { key: 'bpm', type: 'range', label: 'Tempo', min: 60, max: 200, step: 1, unit: ' bpm' },
      { type: 'button', label: 'Tap tempo', id: 'tap', title: 'Tap along to set the tempo (B)' },
      { key: 'bars', type: 'seg', label: 'Bars per cycle', options: [['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']] },
      { key: 'spin', type: 'range', label: 'Spin', min: -2, max: 2, step: 0.25, unit: ' turns' },
      { key: 'tilt', type: 'range', label: 'Tilt', min: -60, max: 60, step: 1, unit: '°' },
      { key: 'sway', type: 'range', label: 'Wobble', min: 0, max: 1, step: 0.01 },
      { key: 'dolly', type: 'range', label: 'Dolly', min: 0, max: 1, step: 0.01 },
      { key: 'pulse', type: 'range', label: 'Beat pulse', min: 0, max: 1, step: 0.01 },
      { key: 'wave', type: 'range', label: 'Wave', min: 0, max: 1, step: 0.01 },
      { key: 'waveSize', type: 'range', label: 'Wave count', min: 0.5, max: 8, step: 0.1 },
      { key: 'waveDir', type: 'range', label: 'Wave direction', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'ripple', type: 'range', label: 'Ripple', min: 0, max: 1, step: 0.01 },
      { key: 'rippleSize', type: 'range', label: 'Ripple count', min: 0.5, max: 8, step: 0.1 },
      { key: 'twist', type: 'range', label: 'Twist', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: 'motion',
    title: 'Drift and cursor',
    controls: [
      { key: 'drift', type: 'range', label: 'Drift', min: 0, max: 1, step: 0.01 },
      { key: 'speed', type: 'range', label: 'Drift speed', min: 0, max: 3, step: 0.01 },
      { key: 'stream', type: 'range', label: 'Streamers', min: 0, max: 0.4, step: 0.005 },
      { key: 'wind', type: 'range', label: 'Wind direction', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'splash', type: 'range', label: 'Cursor push', min: 0, max: 1, step: 0.01 },
      { key: 'cursorSize', type: 'range', label: 'Cursor size', min: 0.05, max: 1.5, step: 0.01 },
    ],
  },
  {
    id: 'scan',
    title: 'Scan',
    toggle: 'scan',
    controls: [
      { key: 'scanAxis', type: 'seg', label: 'Sweep', options: [['depth', 'Through depth'], ['across', 'Across'], ['down', 'Down']] },
      { key: 'scanSpeed', type: 'range', label: 'Speed', min: 0.05, max: 2, step: 0.01 },
      { key: 'scanWidth', type: 'range', label: 'Band width', min: 0.01, max: 0.25, step: 0.005 },
      { key: 'scanBurn', type: 'range', label: 'Burn', min: 0, max: 1, step: 0.01 },
      { key: 'scanJitter', type: 'range', label: 'Kick', min: 0, max: 1.5, step: 0.01 },
    ],
  },
  {
    id: 'trails',
    title: 'Trails',
    toggle: 'trails',
    controls: [{ key: 'trailLength', type: 'range', label: 'Length', min: 0, max: 1, step: 0.01 }],
  },
  {
    id: 'geo',
    title: 'Geometry',
    toggle: 'geo',
    note: 'Points found in the picture, joined by lines and labelled with what was measured there.',
    controls: [
      { key: 'geoSource', type: 'seg', label: 'Find', options: [['corners', 'Corners'], ['edges', 'Edges'], ['bright', 'Bright'], ['dark', 'Dark'], ['depth', 'Near']] },
      { key: 'geoCount', type: 'range', label: 'Points', min: 3, max: 300, step: 1, unit: '' },
      { key: 'geoSpacing', type: 'range', label: 'Spacing', min: 0.01, max: 0.25, step: 0.005 },
      { key: 'geoLinks', type: 'seg', label: 'Lines', options: [['none', 'None'], ['nearest', 'Nearest'], ['chain', 'Chain'], ['hub', 'Hubs']] },
      { key: 'geoK', type: 'range', label: 'Links per point', min: 1, max: 6, step: 1, unit: '' },
      { key: 'geoMaxLen', type: 'range', label: 'Longest line', min: 0.02, max: 1.5, step: 0.01 },
      { key: 'geoMark', type: 'seg', label: 'Marks', options: [['none', 'None'], ['dot', 'Dot'], ['cross', 'Cross'], ['square', 'Square'], ['circle', 'Ring'], ['bracket', 'Bracket']] },
      { key: 'geoMarkSize', type: 'range', label: 'Mark size', min: 0.3, max: 4, step: 0.05 },
      { key: 'geoLabel', type: 'seg', label: 'Numbers', options: [['none', 'None'], ['value', 'Measured'], ['depth', 'Depth'], ['brightness', 'Brightness'], ['position', 'Position'], ['index', 'Index']] },
      { key: 'geoDecimals', type: 'range', label: 'Decimals', min: 0, max: 4, step: 1, unit: '' },
      { key: 'geoFont', type: 'seg', label: 'Font', options: [['mono', 'Mono'], ['sans', 'Sans'], ['serif', 'Serif'], ['typewriter', 'Typewriter'], ['condensed', 'Condensed'], ['custom', 'Your font']] },
      { type: 'button', label: 'Load a font file', id: 'font-load', title: 'Use any .ttf, .otf, .woff or .woff2 file' },
      { key: 'geoTextSize', type: 'range', label: 'Text size', min: 0.5, max: 4, step: 0.05 },
      { key: 'geoColor', type: 'seg', label: 'Colour', options: [['ink', 'Ink'], ['accent', 'Accent'], ['contrast', 'Black or white']] },
      { key: 'geoLineWidth', type: 'range', label: 'Line weight', min: 0.25, max: 5, step: 0.05 },
      { key: 'geoOpacity', type: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.01 },
      { key: 'geoBox', type: 'toggle', label: 'Box behind numbers' },
      { key: 'geoReveal', type: 'toggle', label: 'Reveal with scan' },
    ],
  },
  {
    id: 'tracking',
    title: 'Tracking',
    toggle: 'track',
    note: 'Finds blobs in the source picture or video each frame and follows them with stable IDs. Works best on video and webcam.',
    controls: [
      { key: 'trackMode', type: 'seg', label: 'Find blobs by', options: [['brightness', 'Brightness'], ['colour', 'Colour'], ['motion', 'Motion']] },
      { key: 'trackThresh', type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.01, show: () => S.trackMode !== 'colour' },
      { key: 'trackInvert', type: 'toggle', label: 'Track dark areas', show: () => S.trackMode === 'brightness' },
      { key: 'trackKey', type: 'color', label: 'Colour to track', show: () => S.trackMode === 'colour' },
      { key: 'trackKeyTol', type: 'range', label: 'Colour tolerance', min: 0.02, max: 1, step: 0.01, show: () => S.trackMode === 'colour' },
      { key: 'trackRes', type: 'seg', label: 'Detail', options: [['128', 'Low'], ['192', 'Medium'], ['256', 'High'], ['384', 'Fine']] },
      { key: 'trackBlur', type: 'range', label: 'Soften', min: 0, max: 3, step: 0.05 },
      { key: 'trackClose', type: 'range', label: 'Join nearby pieces', min: 0, max: 4, step: 1, unit: ' px' },
      { key: 'trackMinSize', type: 'range', label: 'Smallest blob', min: 0, max: 10, step: 0.05, unit: '%' },
      { key: 'trackMaxSize', type: 'range', label: 'Largest blob', min: 1, max: 100, step: 0.5, unit: '%' },
      { key: 'trackMaxCount', type: 'range', label: 'Most blobs', min: 1, max: 32, step: 1, unit: '' },
      { key: 'trackSmooth', type: 'range', label: 'Smoothing', min: 0, max: 0.95, step: 0.01 },
      { key: 'trackHold', type: 'range', label: 'Hold lost blobs', min: 0, max: 30, step: 1, unit: ' frames' },
      {
        key: 'trackLatency',
        type: 'seg',
        label: 'Latency',
        options: [['smooth', 'Smooth'], ['locked', 'Locked']],
      },
      { key: 'trackStyle', type: 'seg', label: 'Boxes', options: [['none', 'None'], ['outline', 'Outline'], ['filled', 'Filled'], ['negative', 'Negative']] },
      { key: 'trackColor', type: 'seg', label: 'Colour', options: [['ink', 'Ink'], ['accent', 'Accent'], ['contrast', 'Black or white']] },
      { key: 'trackLineWidth', type: 'range', label: 'Line weight', min: 0.25, max: 6, step: 0.05 },
      { key: 'trackFill', type: 'range', label: 'Fill opacity', min: 0.05, max: 1, step: 0.01, show: () => S.trackStyle === 'filled' },
      { key: 'trackPad', type: 'range', label: 'Box padding', min: 0, max: 60, step: 1, unit: ' px' },
      { key: 'trackMark', type: 'seg', label: 'Centre mark', options: [['none', 'None'], ['dot', 'Dot'], ['cross', 'Cross'], ['circle', 'Ring']] },
      { key: 'trackLabelId', type: 'toggle', label: 'Label: ID' },
      { key: 'trackLabelSize', type: 'toggle', label: 'Label: size' },
      { key: 'trackLabelPos', type: 'toggle', label: 'Label: position' },
      { key: 'trackLabelBox', type: 'toggle', label: 'Box behind labels' },
      { key: 'trackFont', type: 'seg', label: 'Label font', options: [['mono', 'Mono'], ['sans', 'Sans'], ['serif', 'Serif'], ['typewriter', 'Typewriter'], ['condensed', 'Condensed'], ['custom', 'Your font']] },
      { key: 'trackTextSize', type: 'range', label: 'Label size', min: 0.5, max: 4, step: 0.05 },
      { key: 'trackLinks', type: 'seg', label: 'Link centres', options: [['none', 'None'], ['nearest', 'Nearest'], ['chain', 'Chain'], ['hub', 'Hubs'], ['all', 'All']] },
      { key: 'trackLinkK', type: 'range', label: 'Links per blob', min: 1, max: 6, step: 1, unit: '', show: () => S.trackLinks === 'nearest' || S.trackLinks === 'hub' },
      { key: 'trackEdges', type: 'toggle', label: 'Trace edges' },
      { key: 'trackEdgeThresh', type: 'range', label: 'Edge threshold', min: 0.02, max: 1, step: 0.01, show: () => S.trackEdges },
      { key: 'trackEdgeMin', type: 'range', label: 'Shortest line', min: 2, max: 60, step: 1, unit: ' px', show: () => S.trackEdges },
      { key: 'trackEdgeWidth', type: 'range', label: 'Edge weight', min: 0.25, max: 5, step: 0.05, show: () => S.trackEdges },
      { key: 'trackEdgeOpacity', type: 'range', label: 'Edge opacity', min: 0.05, max: 1, step: 0.01, show: () => S.trackEdges },
      { key: 'trackEdgeColor', type: 'seg', label: 'Edge colour', options: [['ink', 'Ink'], ['accent', 'Accent'], ['contrast', 'Black or white']], show: () => S.trackEdges },
    ],
  },
  {
    id: 'look',
    title: 'Look',
    controls: [
      { key: 'colorMode', type: 'seg', label: 'Colour', options: [['original', 'Original'], ['ink', 'Ink'], ['negative', 'Negative'], ['duotone', 'Duotone']] },
      { key: 'ink', type: 'color', label: 'Ink' },
      { key: 'accent', type: 'color', label: 'Accent' },
      { key: 'glow', type: 'toggle', label: 'Glow' },
      { key: 'grain', type: 'range', label: 'Grain', min: 0, max: 0.2, step: 0.005 },
    ],
  },
  {
    id: 'background',
    title: 'Background',
    controls: [
      { key: 'bg', type: 'seg', label: 'Texture', options: BACKGROUNDS.map((b) => [b.id, b.label]) },
      ...BACKGROUNDS.flatMap((b) => b.params.map((p) => ({ ...p, key: bgKey(b.id, p.id), show: () => S.bg === b.id }))),
    ],
  },
  {
    id: 'effects',
    title: 'Effects',
    note: 'Applied over everything, top to bottom in this order. Switch on as many as you like.',
    controls: EFFECTS.flatMap((fx) => {
      const on = () => S[fxKey(fx.id, 'on')];
      return [
        { type: 'subhead', key: fxKey(fx.id, 'on'), label: fx.label, note: fx.note },
        { key: fxKey(fx.id, 'amount'), type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, show: on },
        ...fx.params.map((p) => ({ ...p, key: fxKey(fx.id, p.id), show: on })),
      ];
    }),
  },
  {
    id: 'export',
    title: 'Export',
    note: 'Render draws every frame perfectly offline, at the highest quality. Record live captures what you do with the cursor.',
    controls: [
      { key: 'format', type: 'select', label: 'Shape', options: Object.entries(FORMATS).map(([k, f]) => [k, f.label]) },
      { key: 'resolution', type: 'seg', label: 'Resolution', options: [['1080', '1080p'], ['4k', '4K']] },
      { key: 'smoothing', type: 'seg', label: 'Smoothing', options: [['off', 'Off'], ['2x', '2× supersample']] },
      { key: 'fps', type: 'seg', label: 'Frame rate', options: [['30', '30 fps'], ['60', '60 fps']] },
      { key: 'quality', type: 'seg', label: 'Quality', options: [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum']] },
      {
        key: 'duration',
        type: 'select',
        label: 'Length',
        numeric: true,
        options: [[5, '5 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [-1, '1 cycle'], [-2, '2 cycles'], [-4, '4 cycles'], [0, 'Until I stop it (live only)']],
      },
      { type: 'info', id: 'export-info' },
    ],
  },
];

const controlsEl = document.getElementById('controls');
const presetUI = {}; // filled when the Presets section is built
const refreshers = [];
const buttons = {};

function fmt(c, v) {
  if (c.unit === '°') return `${Math.round(v)}°`;
  if (c.unit !== undefined) return `${Number(v).toFixed(c.step < 1 ? 2 : 0)}${c.unit}`;
  return Number(v).toFixed(c.step < 0.01 ? 3 : 2);
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function set(key, value) {
  S[key] = value;
  if (!NOT_IN_PRESETS.has(key)) markEdited();
  saveSettings();
  onChange(key);
  refreshers.forEach((r) => r());
}

function buildControl(c) {
  const node = buildControlInner(c);
  if (c.show && node) refreshers.push(() => (node.hidden = !c.show()));
  return node;
}

function buildControlInner(c) {
  const id = `c-${c.key || c.id}`;
  if (c.type === 'presets') return buildPresetsUI();
  if (c.type === 'subhead') {
    const b = el('button', { type: 'button', role: 'switch', id, class: 'switch', 'aria-label': `${c.label} on`, onclick: () => set(c.key, !S[c.key]) });
    const row = el('div', { class: 'ctl subhead' }, el('label', { for: id, title: c.note || '' }, c.label), b);
    const wrap = el('div', { class: 'subhead-wrap' }, row);
    const note = c.note ? el('p', { class: 'note' }, c.note) : null;
    if (note) wrap.append(note);
    refreshers.push(() => {
      b.setAttribute('aria-checked', String(!!S[c.key]));
      wrap.classList.toggle('on', !!S[c.key]);
      if (note) note.hidden = !S[c.key];
    });
    return wrap;
  }
  if (c.type === 'range') {
    const out = el('output', { for: id });
    const input = el('input', { id, type: 'range', min: c.min, max: c.max, step: c.step });
    input.addEventListener('input', () => set(c.key, Number(input.value)));
    input.addEventListener('dblclick', () => set(c.key, DEFAULTS[c.key]));
    refreshers.push(() => {
      input.value = S[c.key];
      out.textContent = fmt(c, S[c.key]);
    });
    return el('div', { class: 'ctl range' }, el('label', { for: id }, c.label), out, input);
  }
  if (c.type === 'seg') {
    const group = el('div', { class: 'seg', role: 'group', 'aria-label': c.label });
    const btns = c.options.map(([value, text]) => {
      const b = el('button', { type: 'button', 'data-key': c.key, 'data-value': value, onclick: () => set(c.key, value) }, text);
      group.append(b);
      return b;
    });
    refreshers.push(() => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === S[c.key]))));
    return el('div', { class: 'ctl seg-row' }, el('span', { class: 'lbl' }, c.label), group);
  }
  if (c.type === 'toggle') {
    const b = el('button', { type: 'button', role: 'switch', id, class: 'switch', onclick: () => set(c.key, !S[c.key]) });
    refreshers.push(() => b.setAttribute('aria-checked', String(!!S[c.key])));
    return el('div', { class: 'ctl toggle' }, el('label', { for: id }, c.label), b);
  }
  if (c.type === 'color') {
    const input = el('input', { id, type: 'color' });
    input.addEventListener('input', () => set(c.key, input.value));
    refreshers.push(() => (input.value = S[c.key]));
    return el('div', { class: 'ctl color' }, el('label', { for: id }, c.label), input);
  }
  if (c.type === 'select') {
    const sel = el('select', { id });
    for (const [v, text] of c.options) sel.append(el('option', { value: String(v) }, text));
    sel.addEventListener('change', () => set(c.key, c.numeric ? Number(sel.value) : sel.value));
    refreshers.push(() => (sel.value = String(S[c.key])));
    return el('div', { class: 'ctl select' }, el('label', { for: id }, c.label), sel);
  }
  if (c.type === 'button') {
    const b = el('button', { type: 'button', id: c.id, class: 'ctl-button', title: c.title || '' }, c.label);
    buttons[c.id] = b;
    return el('div', { class: 'ctl' }, b);
  }
  if (c.type === 'info') {
    const p = el('p', { id: c.id, class: 'info' });
    return p;
  }
}

let collapsed = {};
try {
  collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
} catch {
  /* ignore */
}
if (!Object.keys(collapsed).length) collapsed = { geo: true, tracking: true, effects: false, export: false };

for (const section of SECTIONS) {
  const title = el('button', { type: 'button', class: 'sec-title', 'aria-expanded': 'true' }, el('h2', {}, section.title));
  const head = el('div', { class: 'sec-head' }, title);
  const body = el('div', { class: 'sec-body' });
  const sec = el('section', { class: 'sec', 'data-id': section.id }, head, body);
  const applyCollapse = () => {
    const c = !!collapsed[section.id];
    sec.classList.toggle('collapsed', c);
    title.setAttribute('aria-expanded', String(!c));
  };
  title.addEventListener('click', () => {
    collapsed[section.id] = !collapsed[section.id];
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
    applyCollapse();
  });
  applyCollapse();
  if (section.toggle) {
    const key = section.toggle;
    const b = el('button', { type: 'button', role: 'switch', class: 'switch', 'aria-label': `${section.title} on`, onclick: () => set(key, !S[key]) });
    head.append(b);
    refreshers.push(() => {
      b.setAttribute('aria-checked', String(!!S[key]));
      sec.classList.toggle('off', !S[key]);
    });
  }
  if (section.note) body.append(el('p', { class: 'note' }, section.note));
  section.controls.forEach((c) => body.append(buildControl(c)));
  controlsEl.append(sec);
}

// ---------------------------------------------------------------- renderer

const canvas = document.getElementById('view');
const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const ring = document.getElementById('ring');
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  statusEl.textContent = err.message;
  statusEl.hidden = false;
  throw err;
}
const recorder = new Recorder(canvas);
renderer.onEffectError = (id) => status(`The ${EFFECTS.find((e) => e.id === id)?.label || id} effect couldn't start on this graphics card, so it's been skipped.`, 8000);
const geoLayer = new GeometryLayer();

let statusTimer = 0;
function status(msg, ms = 0) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg || '';
  statusEl.hidden = !msg;
  if (msg && ms) statusTimer = setTimeout(() => (statusEl.hidden = true), ms);
}

function outputSize() {
  const f = FORMATS[S.format];
  const k = S.resolution === '4k' ? 2 : 1;
  return { w: f.w * k, h: f.h * k, ss: S.smoothing === '2x' && k === 1 ? 2 : 1 };
}

function fitCanvas() {
  const o = outputSize();
  renderer.setSize(o.w, o.h, o.ss);
  const r = stage.getBoundingClientRect();
  const pad = document.body.classList.contains('clean') || document.body.classList.contains('fullscreen') ? 0 : 28;
  const scale = Math.min((r.width - pad * 2) / o.w, (r.height - pad * 2) / o.h);
  canvas.style.width = `${Math.floor(o.w * scale)}px`;
  canvas.style.height = `${Math.floor(o.h * scale)}px`;
  updateExportInfo();
}
new ResizeObserver(() => fitCanvas()).observe(stage);

// ---------------------------------------------------------------- images

const slots = new Array(MAX_SLOTS).fill(null);
let current = -1; // slot shown as image A
let target = -1; // slot being morphed to (image B)
let morph = 0;
let aiState = { ok: false };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Downscale big images so textures stay within GPU limits and memory.
function prepareSource(img) {
  const limit = Math.min(2048, renderer.maxTexture);
  const long = Math.max(img.width, img.height);
  if (long <= limit) return img;
  const s = limit / long;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Background colour to key out = average of the four corners.
function cornerColor(src) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const idx = [0, 15, 15 * 16, 15 * 16 + 15];
  const sum = [0, 0, 0];
  let n = 0;
  for (const i of idx) {
    if (d[i * 4 + 3] < 128) continue;
    for (let ch = 0; ch < 3; ch++) sum[ch] += d[i * 4 + ch] / 255;
    n++;
  }
  return n ? sum.map((v) => v / n) : [1, 1, 1];
}

function depthKey() {
  const mode = S.depthMode === 'ai' && aiState.ok ? 'ai' : S.depthMode === 'ai' ? 'luma' : S.depthMode;
  return `${mode}:${S.flipDepth ? 1 : 0}`;
}

let warnedAiVideo = false;
async function ensureDepth(slot) {
  const key = depthKey();
  if (slot.depthKey === key && slot.depth) return;
  if (slot.kind !== 'image') {
    // Moving sources take depth from brightness on the GPU, every frame.
    const [mode] = key.split(':');
    slot.gpuDepth = mode !== 'flat';
    if (!slot.depth) slot.depth = renderer.depthTexture(new Float32Array([0.5]), 1, 1);
    slot.depthData = null;
    slot.depthKey = key;
    if (S.depthMode === 'ai' && !warnedAiVideo) {
      warnedAiVideo = true;
      status('AI depth works on still pictures. Video and webcam use brightness depth.', 5000);
    }
    return;
  }
  const [mode] = key.split(':');
  let d;
  if (mode === 'ai') {
    try {
      d = await aiDepth(slot.source, (m) => status(m));
      status('');
    } catch (err) {
      console.error(err);
      status(`AI depth failed: ${err.message}. Using brightness instead.`, 6000);
      d = lumaDepth(slot.source);
    }
  } else if (mode === 'luma') {
    d = lumaDepth(slot.source);
  } else {
    d = flatDepth();
  }
  if (S.flipDepth && mode !== 'flat') d = flip(d);
  const old = slot.depth;
  slot.depth = renderer.depthTexture(d.data, d.width, d.height);
  slot.depthData = d;
  slot.depthKey = key;
  slot.maps = null; // geometry re-measures against the new depth
  slot.geoPK = slot.geoLK = null;
  renderer.deleteTexture(old);
}

async function addImage(img, name) {
  const source = prepareSource(img);
  const slot = {
    kind: 'image',
    name,
    source,
    width: source.width,
    height: source.height,
    aspect: source.width / source.height,
    color: renderer.colorTexture(source),
    key: cornerColor(source),
    depth: null,
    depthKey: null,
  };
  await placeSlot(slot);
}

// <video> elements live in a hidden holder so browsers keep decoding them.
const mediaHolder = el('div', { class: 'media-holder', 'aria-hidden': 'true' });
document.body.append(mediaHolder);

function movingSlot(media, name) {
  mediaHolder.append(media.video);
  return {
    kind: media.kind,
    media,
    name,
    source: media.video,
    width: media.width,
    height: media.height,
    aspect: media.width / media.height,
    color: newVideoTexture(media),
    key: cornerColor(media.video),
    depth: null,
    depthKey: null,
    gpuDepth: true,
    mirror: media.kind === 'camera',
    lastTime: -1,
  };
}

function newVideoTexture(media) {
  const tex = renderer.videoTexture(media.width, media.height);
  renderer.updateVideoTexture(tex, media.video);
  return tex;
}

async function addVideo(file) {
  status(`Opening ${file.name}…`);
  const media = new VideoSource(file);
  try {
    await media.load();
  } catch (err) {
    media.dispose();
    throw new Error(err.message.startsWith('Timed out') ? 'the browser could not decode it. Try MP4 (H.264), MOV or WebM.' : err.message);
  }
  media.reanchor(clock.time, tempo(), 0);
  await placeSlot(movingSlot(media, file.name));
  status('');
}

async function addCamera(deviceId = '') {
  if (!CameraSource.supported()) return status('This browser has no camera access here. Open GEO_SC from http://localhost.', 6000);
  const media = new CameraSource();
  try {
    status('Starting camera…');
    await media.start(deviceId);
  } catch (err) {
    media.dispose();
    status(err.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the address bar, then try again.' : `Couldn't start the camera: ${err.message}`, 7000);
    return;
  }
  status('');
  await placeSlot(movingSlot(media, media.label));
  refreshCameraList();
}

async function placeSlot(slot) {
  let i = slots.findIndex((s) => !s);
  if (i === -1) {
    i = current;
    disposeSlot(slots[i]);
  }
  slots[i] = slot;
  await ensureDepth(slot);
  renderSlots();
  showSlot(i, current === i || current === -1);
}

function disposeSlot(slot) {
  if (!slot) return;
  slot.media?.dispose();
  slot.media?.video.remove();
  renderer.deleteTexture(slot.color);
  renderer.deleteTexture(slot.depth);
}

async function showSlot(i, instant = false) {
  const slot = slots[i];
  if (!slot) return;
  await ensureDepth(slot);
  if (instant || current === -1) {
    current = i;
    target = -1;
    morph = 0;
  } else if (i !== current) {
    if (target !== -1) current = target; // finish any morph in flight
    target = i;
    morph = 0;
  }
  renderSlots();
}

function next() {
  const from = target !== -1 ? target : current;
  for (let k = 1; k <= MAX_SLOTS; k++) {
    const i = (from + k) % MAX_SLOTS;
    if (slots[i] && i !== from) return showSlot(i);
  }
}

function removeSlot(i) {
  disposeSlot(slots[i]);
  slots[i] = null;
  if (i === current || i === target) {
    const other = slots.findIndex((s) => s);
    current = other;
    target = -1;
    morph = 0;
  }
  renderSlots();
}

const slotsEl = document.getElementById('slots');
const fileInput = document.getElementById('file');
function renderSlots() {
  slotsEl.replaceChildren();
  slots.forEach((slot, i) => {
    const active = i === (target !== -1 ? target : current);
    if (!slot) {
      slotsEl.append(
        el('button', { type: 'button', class: 'slot empty', 'aria-label': `Add picture to slot ${i + 1}`, onclick: () => fileInput.click() }, '+'),
      );
      return;
    }
    const thumb = document.createElement('canvas');
    const ts = 96;
    thumb.width = ts;
    thumb.height = ts;
    const tctx = thumb.getContext('2d');
    const s = Math.min(ts / slot.width, ts / slot.height);
    tctx.drawImage(slot.source, (ts - slot.width * s) / 2, (ts - slot.height * s) / 2, slot.width * s, slot.height * s);
    const btn = el('button', { type: 'button', class: 'slot', 'aria-pressed': String(active), title: slot.name, onclick: () => showSlot(i) }, thumb);
    const rm = el('button', { type: 'button', class: 'slot-remove', 'aria-label': `Remove ${slot.name}`, onclick: (e) => (e.stopPropagation(), removeSlot(i)) }, '×');
    const wrap = el('div', { class: 'slot-wrap', 'data-kind': slot.kind }, btn, rm);
    if (slot.kind !== 'image') wrap.append(el('span', { class: 'slot-badge' }, slot.kind === 'camera' ? 'Live' : 'Video'));
    slotsEl.append(wrap);
  });
  updateTransport();
  updateButtons();
}

async function addFiles(files) {
  for (const file of files) {
    if (/\.(ttf|otf|woff2?)$/i.test(file.name)) {
      await loadFont(file);
      continue;
    }
    const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name);
    if (!isVideo && !file.type.startsWith('image/')) continue;
    try {
      if (isVideo) {
        await addVideo(file);
        continue;
      }
      const bmp = await createImageBitmap(file);
      await addImage(bmp, file.name);
    } catch (err) {
      status(`Couldn't open ${file.name}: ${err.message}`, 5000);
    }
  }
}

fileInput.addEventListener('change', () => {
  addFiles([...fileInput.files]);
  fileInput.value = '';
});
document.getElementById('add').addEventListener('click', () => fileInput.click());
document.getElementById('add-camera').addEventListener('click', () => addCamera());

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (e.target === document.documentElement || e.clientX <= 0 || e.clientY <= 0) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  addFiles([...e.dataTransfer.files]);
});
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile());
  if (files.length) addFiles(files);
});

// A starter image so there's something on screen straight away.
function sampleImage() {
  const c = document.createElement('canvas');
  c.width = 1800;
  c.height = 420;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#e2231a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 300px "Helvetica Neue", Helvetica, Arial, sans-serif';
  const text = '@INKR.MN';
  const w = ctx.measureText(text).width;
  const squash = Math.min(1, (c.width * 0.94) / w);
  ctx.setTransform(squash, 0, 0, 1, c.width / 2, c.height / 2);
  ctx.fillText(text, 0, 10);
  return c;
}

// ---------------------------------------------------------------- fonts

const fontInput = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: '' });
document.body.append(fontInput);
let customFont = null;
let fontCount = 0;
buttons['font-load'].addEventListener('click', () => fontInput.click());
fontInput.addEventListener('change', () => {
  if (fontInput.files[0]) loadFont(fontInput.files[0]);
  fontInput.value = '';
});

async function loadFont(file) {
  try {
    const family = `GEO_SC font ${++fontCount}`;
    const face = new FontFace(family, await file.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    customFont = { family, name: file.name.replace(/\.[^.]+$/, '') };
    buttons['font-load'].textContent = `Font: ${customFont.name}`;
    set('geoFont', 'custom');
    status(`Using ${customFont.name} for numbers`, 3000);
  } catch (err) {
    status(`Couldn't load ${file.name} as a font.`, 5000);
  }
}

function fontFamily(key = 'geoFont') {
  if (S[key] === 'custom') return customFont ? `"${customFont.family}", ${FONTS.mono}` : FONTS.mono;
  return FONTS[S[key]] || FONTS.mono;
}

// ---------------------------------------------------------------- reacting to settings

async function rebuildDepth() {
  const ids = [current, target].filter((i) => i >= 0);
  for (const i of ids) if (slots[i]) await ensureDepth(slots[i]);
}

function onChange(key) {
  if (key === 'track' || key === 'trackMode' || key === 'trackRes' || key === 'trackLatency') resetTracking();
  if (key === 'hud') updateHud();
  if (key === 'trackFont' && S.trackFont === 'custom' && !customFont) {
    status('Load a font file first (Geometry → Load a font file), or drop one onto the window.', 5000);
  }
  if (['format', 'resolution', 'smoothing'].includes(key)) fitCanvas();
  if (['fps', 'quality', 'duration', 'bpm', 'bars'].includes(key)) updateExportInfo();
  if (key === 'depthMode' && S.depthMode === 'ai' && !aiState.ok) {
    status('AI depth needs a one-time setup. In the project folder run "npm install" then "npm run setup", and reload.', 9000);
    S.depthMode = 'luma';
    saveSettings();
  }
  if (key === 'geoFont' && S.geoFont === 'custom' && !customFont) {
    status('Load a font file first, or drop one onto the window.', 4000);
    fontInput.click();
  }
  if (key === 'depthMode' || key === 'flipDepth') rebuildDepth();
  if (key === 'trails' || key === 'bg' || key.startsWith('bg_')) renderer.needsClear = true;
}

// ---------------------------------------------------------------- presets

const presets = new PresetStore(DEFAULTS);
let activePreset = null; // { name, edited }
let blend = null; // in-progress blend between looks

// Settings that change what's measured or how time flows switch instantly.
const NO_BLEND = new Set(['bpm', 'bars', 'geoCount', 'geoSpacing', 'geoK', 'geoMaxLen', 'geoDecimals', 'key']);

function snapshot() {
  const settings = {};
  for (const k of Object.keys(DEFAULTS)) if (!NOT_IN_PRESETS.has(k)) settings[k] = S[k];
  return { settings, camera: { ty: cam.ty, tp: cam.tp, tz: cam.tz } };
}

function allPresets() {
  return [...presets.items.map((p) => ({ ...p, user: true })), ...STARTERS.map((p) => ({ ...p, user: false }))];
}

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round((v + (B[i] - v) * t) * 255).toString(16).padStart(2, '0')).join('');
}

function applyPreset(p, { instant = false } = {}) {
  // A preset is complete: anything it doesn't mention goes back to default.
  const targetS = {};
  for (const k of Object.keys(DEFAULTS)) if (!NOT_IN_PRESETS.has(k)) targetS[k] = DEFAULTS[k];
  Object.assign(targetS, clean(p.settings, DEFAULTS));
  targetS.bg = validBg(targetS.bg);

  const beats = Number(S.presetBlend);
  const seconds = instant || rendering ? 0 : beats * tempo().beat;
  const from = {};
  const to = {};
  const prevBg = S.bg;
  const prevFlip = S.flipDepth;
  for (const [k, v] of Object.entries(targetS)) {
    const cur = S[k];
    const blendable = seconds > 0 && !NO_BLEND.has(k) && ((typeof v === 'number' && typeof cur === 'number') || (isHex(v) && isHex(cur)));
    if (blendable && v !== cur) {
      from[k] = cur;
      to[k] = v;
    } else {
      S[k] = v;
    }
  }
  blend = Object.keys(to).length ? { from, to, t: 0, dur: seconds } : null;
  if (p.camera) Object.assign(cam, { ty: p.camera.ty ?? 0, tp: p.camera.tp ?? 0, tz: p.camera.tz ?? 1 });
  if (S.geoFont === 'custom' && !customFont) S.geoFont = 'mono';
  if (S.bg !== prevBg) renderer.needsClear = true;
  if (S.flipDepth !== prevFlip) rebuildDepth();
  activePreset = { name: p.name, edited: false };
  saveSettings();
  refreshers.forEach((r) => r());
  renderPresetList();
  status(`Preset: ${p.name}`, 1500);
}

function stepPresetBlend(dt) {
  if (!blend) return;
  blend.t = Math.min(1, blend.t + dt / blend.dur);
  const e = blend.t * blend.t * (3 - 2 * blend.t);
  for (const k of Object.keys(blend.to)) {
    const a = blend.from[k], b = blend.to[k];
    S[k] = typeof b === 'number' ? a + (b - a) * e : mixHex(a, b, e);
  }
  if (blend.t >= 1) {
    for (const k of Object.keys(blend.to)) S[k] = blend.to[k];
    blend = null;
    saveSettings();
    refreshers.forEach((r) => r());
  }
}

function markEdited() {
  if (activePreset && !activePreset.edited) {
    activePreset.edited = true;
    renderPresetList();
  }
}

function storageNote(state) {
  if (!presetUI.note) return;
  presetUI.note.textContent =
    state === 'project'
      ? 'Saved to presets/user.json in the project folder. Commit it to keep your presets with the code.'
      : 'Saved in this browser. Run the app with "npm start" to save presets into the project folder, or export them.';
}

async function savePreset(name) {
  name = name.trim();
  if (!name) {
    status('Give the preset a name first.', 2500);
    presetUI.input.focus();
    return;
  }
  if (STARTERS.some((p) => p.name === name)) {
    status('That name belongs to a starter preset. Pick another.', 3000);
    return;
  }
  const snap = snapshot();
  const state = await presets.save(name, snap.settings, snap.camera);
  activePreset = { name, edited: false };
  presetUI.input.value = '';
  storageNote(state);
  renderPresetList();
  status(`Saved preset: ${name}`, 2000);
}

function buildPresetsUI() {
  const wrap = el('div', { class: 'presets' });
  const input = el('input', { type: 'text', id: 'preset-name', placeholder: 'Name this look', maxlength: '40', 'aria-label': 'Preset name' });
  const saveBtn = el('button', { type: 'button', class: 'ctl-button' }, 'Save');
  saveBtn.addEventListener('click', () => savePreset(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') savePreset(input.value);
  });
  const list = el('ol', { class: 'preset-list' });
  const blendRow = buildControlInner({
    key: 'presetBlend',
    type: 'seg',
    label: 'Switching',
    options: [['0', 'Cut'], ['1', '1 beat'], ['4', '1 bar'], ['8', '2 bars']],
  });
  const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: '' });
  const exportBtn = el('button', { type: 'button', class: 'ctl-button' }, 'Export presets');
  const importBtn = el('button', { type: 'button', class: 'ctl-button' }, 'Import presets');
  exportBtn.addEventListener('click', () => {
    if (!presets.items.length) return status('Save a preset first.', 2500);
    download(new Blob([presets.toJSON()], { type: 'application/json' }), `geo_sc-presets-${stamp()}.json`);
  });
  importBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const n = presets.importJSON(await f.text());
      storageNote(presets.fileState);
      renderPresetList();
      status(`Imported ${n} preset${n === 1 ? '' : 's'}`, 2500);
    } catch (err) {
      status(`Couldn't import: ${err.message}`, 4000);
    }
  });
  const note = el('p', { class: 'note' });
  Object.assign(presetUI, { input, list, note });
  storageNote('browser');
  wrap.append(
    el('div', { class: 'preset-save' }, input, saveBtn),
    list,
    blendRow,
    el('div', { class: 'preset-files' }, exportBtn, importBtn),
    fileIn,
    note,
  );
  return wrap;
}

function renderPresetList() {
  const list = presetUI.list;
  if (!list) return;
  list.replaceChildren();
  const items = allPresets();
  let shownStarters = false;
  items.forEach((p, i) => {
    if (!p.user && !shownStarters) {
      shownStarters = true;
      list.append(el('li', { class: 'preset-group' }, presets.items.length ? 'Starters' : 'Starters (save your own above)'));
    }
    const active = activePreset?.name === p.name;
    const key = i < 9 ? String(i + 1) : '';
    const name = el(
      'button',
      { type: 'button', class: 'preset-name', 'aria-pressed': String(active), title: key ? `Apply (key ${key})` : 'Apply' },
      el('span', { class: 'preset-key' }, key),
      el('span', {}, p.name + (active && activePreset.edited ? ' (edited)' : '')),
    );
    name.addEventListener('click', () => applyPreset(p));
    const row = el('li', { class: 'preset-row' }, name);
    if (p.user) {
      const upd = el('button', { type: 'button', class: 'link', title: 'Overwrite with the current look' }, 'Update');
      upd.addEventListener('click', async () => {
        const snap = snapshot();
        storageNote(await presets.save(p.name, snap.settings, snap.camera));
        activePreset = { name: p.name, edited: false };
        renderPresetList();
        status(`Updated ${p.name}`, 2000);
      });
      const del = el('button', { type: 'button', class: 'preset-del', 'aria-label': `Delete ${p.name}`, title: 'Delete' }, '×');
      let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Delete?';
          setTimeout(() => {
            armed = false;
            del.textContent = '×';
          }, 2500);
          return;
        }
        storageNote(await presets.remove(p.name));
        if (activePreset?.name === p.name) activePreset = null;
        renderPresetList();
      });
      row.append(upd, del);
    }
    list.append(row);
  });
}

// ---------------------------------------------------------------- tempo

function tempo() {
  const beat = 60 / S.bpm;
  const bar = beat * 4;
  const cycle = bar * Number(S.bars);
  return { beat, bar, cycle };
}

let taps = [];
function tap() {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  if (taps.length >= 2) {
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    set('bpm', Math.max(60, Math.min(200, Math.round(60000 / avg))));
  }
  buttons.tap.classList.add('flash');
  setTimeout(() => buttons.tap.classList.remove('flash'), 90);
}
buttons.tap.addEventListener('click', tap);

// ---------------------------------------------------------------- pointer + camera

const cam = { yaw: 0, pitch: 0, zoom: 1, ty: 0, tp: 0, tz: 1 };
const pointer = { nx: 0.5, ny: 0.5, cx: 0, cy: 0, over: false, down: false, lx: 0, ly: 0, burst: 0, world: [0, 0, 0] };

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.nx = (e.clientX - r.left) / r.width;
  pointer.ny = (e.clientY - r.top) / r.height;
  pointer.cx = e.clientX;
  pointer.cy = e.clientY;
  pointer.over = true;
  if (pointer.down) {
    cam.ty += (e.clientX - pointer.lx) * 0.006;
    cam.tp = Math.max(-1.2, Math.min(1.2, cam.tp + (e.clientY - pointer.ly) * 0.006));
  }
  pointer.lx = e.clientX;
  pointer.ly = e.clientY;
});
canvas.addEventListener('pointerdown', (e) => {
  pointer.down = true;
  pointer.burst = 1;
  pointer.lx = e.clientX;
  pointer.ly = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (pointer.down = false));
canvas.addEventListener('pointerleave', () => (pointer.over = false));
canvas.addEventListener('dblclick', () => Object.assign(cam, { ty: 0, tp: 0, tz: 1 }));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cam.tz = Math.max(0.35, Math.min(3, cam.tz * Math.exp(e.deltaY * 0.001)));
  },
  { passive: false },
);

// The ring shows how far the cursor's push reaches (on screen only, never exported).
function updateRing(zoom) {
  const show = pointer.over && S.splash > 0 && !rendering && !document.body.classList.contains('clean');
  ring.hidden = !show;
  if (!show) return;
  const r = canvas.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const radius = (S.cursorSize / zoom) * (r.height / 2);
  ring.style.width = ring.style.height = `${radius * 2}px`;
  ring.style.transform = `translate(${pointer.cx - sr.left - radius}px, ${pointer.cy - sr.top - radius}px)`;
}

// ---------------------------------------------------------------- frame state

const clock = { time: 0, scan: 0, spin: 0, last: performance.now() };
const MORPH_SECONDS = 1.8;
const fract = (x) => x - Math.floor(x);
let lastKeyIdx = -1;

function bgBase() {
  return S[bgKey(S.bg, 'c1')] || '#eeefec';
}
function isDark(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.4;
}

function bgParams() {
  const def = BACKGROUNDS.find((b) => b.id === S.bg) || BACKGROUNDS[0];
  const p = new Float32Array(12);
  let i = 0;
  const out = { type: def.type, p, c1: hexToRgb(bgBase()), c2: [0, 0, 0] };
  for (const prm of def.params) {
    const v = S[bgKey(def.id, prm.id)];
    if (prm.type === 'color') out[prm.id] = hexToRgb(v);
    else p[i++] = Number(v) || 0;
  }
  return out;
}

function effectParams(beats) {
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
      const cols = names[idx] ? PALETTES[names[idx]] : [S.ink, S.accent, bgBase()];
      fx.palette = new Float32Array(48);
      cols.forEach((h, k) => fx.palette.set(hexToRgb(h), k * 3));
      fx.paletteSize = cols.length;
    }
    if (def.id === 'ascii') fx.charset = CHARSETS[S[fxKey('ascii', 'charset')]] || CHARSETS.classic;
    if (def.id === 'datamosh') {
      const every = Number(S[fxKey('datamosh', 'keys')]);
      const idx = every > 0 ? Math.floor(beats / every) : 0;
      fx.keyframe = every > 0 && idx !== lastKeyIdx;
      lastKeyIdx = idx;
    }
    list.push(fx);
  }
  return list;
}
let lastCount = 0;

function step(dt) {
  clock.time += dt;
  clock.spin += (dt / tempo().cycle) * TAU * S.spin; // accumulated, so changing speed never jumps
  stepPresetBlend(dt);
  clock.scan += dt * S.scanSpeed * 0.25;
  const ease = 1 - Math.exp(-dt * 8);
  cam.yaw += (cam.ty - cam.yaw) * ease;
  cam.pitch += (cam.tp - cam.pitch) * ease;
  cam.zoom += (cam.tz - cam.zoom) * ease;
  pointer.burst *= Math.exp(-dt * 2.5);
  if (target !== -1) {
    morph += dt / MORPH_SECONDS;
    if (morph >= 1) {
      current = target;
      target = -1;
      morph = 0;
      renderSlots();
    }
  }
}

function frameParams() {
  const t = clock.time;
  const tp = tempo();
  const cycles = t / tp.cycle;
  const cyclePhase = fract(cycles);
  const barPhase = fract(t / tp.bar);
  const beats = t / tp.beat;
  const beatPhase = fract(beats);
  const env = Math.exp(-beatPhase * 5);

  const yaw = cam.yaw + clock.spin + Math.sin(TAU * cyclePhase) * 0.3 * S.sway;
  const pitch = cam.pitch + (S.tilt * Math.PI) / 180 + Math.sin(2 * TAU * cyclePhase) * 0.12 * S.sway;
  const zoom = cam.zoom * (1 + S.dolly * 0.35 * Math.sin(TAU * cyclePhase));

  const live = !rendering;
  const w = renderer.pointerToWorld(pointer.nx, pointer.ny, zoom);
  const follow = live ? 1 - Math.exp(-(1 / 60) * 12) : 0;
  for (let i = 0; i < 2; i++) pointer.world[i] += (w[i] - pointer.world[i]) * follow;
  const splash = live ? S.splash * ((pointer.over ? 0.25 : 0) + pointer.burst * 1.4) : 0;

  const A = slots[current] || null;
  const B = target !== -1 ? slots[target] : A;
  const keep = 0.75 + 0.235 * S.trailLength; // fraction of last frame kept
  const f = {
    imageA: A,
    imageB: B,
    morph: target !== -1 ? morph : 0,
    morphBurst: 0.35,
    time: t,
    density: DENSITY[S.density],
    size: S.size * (1 + S.pulse * env * 0.35),
    depth: S.depth * (1 + S.pulse * env * 0.9),
    scale: S.scale,
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
    splashPos: pointer.world,
    splash,
    splashRadius: S.cursorSize,
    scan: S.scan,
    scanPos: -0.3 + 1.6 * fract(clock.scan),
    scanWidth: S.scanWidth,
    scanBurn: S.scanBurn,
    scanJitter: S.scanJitter,
    scanAxis: SCAN_AXES[S.scanAxis],
    trails: S.trails,
    trailFade: 1 - keep,
    ink: hexToRgb(S.ink),
    accent: hexToRgb(S.accent),
    colorMode: COLOR_MODES[S.colorMode],
    bg: bgParams(),
    effects: effectParams(beats),
    beatPhase,
    beats,
    paperDark: isDark(bgBase()),
    flipDepth: S.flipDepth,
    glow: S.glow,
    grain: S.grain,
    yaw,
    pitch,
    zoom,
  };
  Object.assign(f, renderer.matrices(f));
  return f;
}

function geoSetFor(slot) {
  if (!slot) return null;
  if (slot.kind !== 'image' && slot.mapsFrame !== frameNo) {
    // Moving pictures are re-measured every frame.
    slot.maps = analyse(slot.source, null, { width: slot.width, height: slot.height, mirror: slot.mirror, flip: S.flipDepth });
    slot.mapsFrame = frameNo;
    slot.geoPK = slot.geoLK = null;
  }
  if (!slot.maps) slot.maps = analyse(slot.source, slot.depthData);
  const pk = [S.geoSource, S.geoCount, S.geoSpacing, S.key].join('|');
  if (slot.geoPK !== pk) {
    slot.geoPoints = pickPoints(slot.maps, { source: S.geoSource, count: S.geoCount, spacing: S.geoSpacing, key: S.key, keyColor: slot.key });
    slot.geoPK = pk;
    slot.geoLK = null;
  }
  const lk = [pk, S.geoLinks, S.geoK, S.geoMaxLen].join('|');
  if (slot.geoLK !== lk) {
    slot.geoLinks = buildLinks(slot.geoPoints, { mode: S.geoLinks, k: S.geoK, maxLen: S.geoMaxLen, aspect: slot.aspect });
    slot.geoLK = lk;
  }
  return { points: slot.geoPoints, links: slot.geoLinks };
}

function drawGeometry(f) {
  if (!S.geo || !f.imageA) return null;
  const W = renderer.width, H = renderer.height;
  const aspect = W / H;
  const A = f.imageA, B = f.imageB;
  const planeA = renderer.plane(A.aspect, aspect, f.scale);
  const planeB = renderer.plane(B.aspect, aspect, f.scale);
  let m = Math.min(1, Math.max(0, f.morph * 1.6 - 0.3));
  m = m * m * (3 - 2 * m);
  const sets = [];
  const a = geoSetFor(A);
  if (A === B || !f.morph) {
    sets.push({ ...a, plane: planeA, weight: 1 });
  } else {
    const b = geoSetFor(B);
    sets.push({ ...a, plane: planeB, morphFrom: { plane: planeA, t: m }, weight: 1 - m });
    sets.push({ ...b, plane: planeB, morphFrom: { plane: planeA, t: m }, weight: m });
  }
  const color = S.geoColor === 'accent' ? S.accent : S.geoColor === 'contrast' ? (isDark(bgBase()) ? '#ffffff' : '#000000') : S.ink;
  f.geo = {
    source: S.geoSource,
    color,
    boxColor: bgBase(),
    lineWidth: S.geoLineWidth,
    opacity: S.geoOpacity,
    mark: S.geoMark,
    markSize: S.geoMarkSize,
    label: S.geoLabel,
    decimals: S.geoDecimals,
    font: fontFamily(),
    textSize: S.geoTextSize,
    box: S.geoBox,
  };
  f.geoReveal = S.geoReveal;
  return geoLayer.draw(sets, f, W, H);
}

// ---------------------------------------------------------------- VHS on-screen display

const osdStart = new Date();
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function osdMode() {
  const fx = S.fx_vhs_on ? Number(S.fx_vhs_osd) : 0;
  const bg = S.bg === 'vhs' ? Number(S.bg_vhs_osd) : 0;
  return Math.max(fx, bg);
}

function drawOSD(ctx, W, H, mode, t) {
  const u = Math.min(W, H) / 1080;
  const size = Math.round(44 * u);
  const pad = Math.round(72 * u);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = `bold ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';
  const text = (str, x, y, align = 'left', color = '#f4f4f0') => {
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7 * u;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  };
  const p2 = (n) => String(n).padStart(2, '0');
  if (mode === 1) {
    text('PLAY ▶', pad, pad);
    text('SP', pad, pad + size * 1.25);
    const s = Math.floor(t);
    text(`${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`, W - pad, pad, 'right');
  } else {
    if (Math.floor(t * 1.5) % 2 === 0) {
      ctx.fillStyle = '#e8231a';
      ctx.beginPath();
      ctx.arc(pad + size * 0.4, pad + size * 0.5, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    text('REC', pad + size * 1.0, pad);
    const d = new Date(osdStart.getTime() + t * 1000);
    let h = d.getHours();
    const ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    text(`${ap} ${h}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`, pad, H - pad - size * 2.3);
    text(`${MONTHS[d.getMonth()]}. ${d.getDate()} ${d.getFullYear()}`, pad, H - pad - size);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- tracking

const tracker = new Tracker();
const TRACK_MODES = { brightness: 0, colour: 1, motion: 2 };
let frameNo = 0;
const perf = { frameMs: 0, trackMs: 0, fps: 0, frames: 0, since: performance.now() };

function trackSize(slot) {
  const long = Number(S.trackRes);
  return slot.aspect >= 1
    ? [long, Math.max(8, Math.round(long / slot.aspect))]
    : [Math.max(8, Math.round(long * slot.aspect)), long];
}

function trackOpts() {
  return {
    minSize: S.trackMinSize,
    maxSize: S.trackMaxSize,
    maxCount: S.trackMaxCount,
    smooth: S.trackSmooth,
    hold: S.trackHold,
    close: S.trackClose,
    edges: S.trackEdges,
    edgeThresh: S.trackEdgeThresh,
    edgeMin: S.trackEdgeMin,
  };
}

function pickColour(which) {
  if (which === 'accent') return S.accent;
  if (which === 'contrast') return isDark(bgBase()) ? '#ffffff' : '#000000';
  return S.ink;
}

// Map a point on the source picture to the screen, through the same motion
// the particles get (including a morph in progress).
function screenMapper(f) {
  const W = renderer.width, H = renderer.height;
  const aspect = W / H;
  const A = f.imageA, B = f.imageB;
  const pa = renderer.plane(A.aspect, aspect, f.scale);
  const pb = renderer.plane(B.aspect, aspect, f.scale);
  let m = Math.min(1, Math.max(0, f.morph * 1.6 - 0.3));
  m = m * m * (3 - 2 * m);
  return (u, v, d) => {
    const z = (d - 0.5) * f.depth;
    let x = (u - 0.5) * 2 * pa[0], y = (0.5 - v) * 2 * pa[1];
    if (f.morph) {
      x += ((u - 0.5) * 2 * pb[0] - x) * m;
      y += ((0.5 - v) * 2 * pb[1] - y) * m;
    }
    return project(f.view, f.proj, displace([x, y, z], d, f), W, H);
  };
}

function depthSampler(slot) {
  if (slot.gpuDepth) return (u, v, l) => (S.flipDepth ? l : 1 - l);
  const d = slot.depthData;
  if (d && d.data.length > 1) return (u, v) => sampleBilinear(d.data, d.width, d.height, u, v);
  return () => 0.5;
}

function drawTrackingLayer(ctx, f) {
  return drawTracking(
    ctx,
    renderer.width,
    renderer.height,
    tracker,
    {
      style: S.trackStyle,
      color: pickColour(S.trackColor),
      boxColor: bgBase(),
      lineWidth: S.trackLineWidth,
      fillOpacity: S.trackFill,
      pad: S.trackPad,
      centreMark: S.trackMark,
      labelId: S.trackLabelId,
      labelSize: S.trackLabelSize,
      labelPos: S.trackLabelPos,
      labelBox: S.trackLabelBox,
      font: fontFamily('trackFont'),
      textSize: S.trackTextSize,
      links: S.trackLinks,
      linkK: S.trackLinkK,
      aspect: f.imageA.aspect,
      hold: S.trackHold,
      edges: S.trackEdges,
      edgeColor: pickColour(S.trackEdgeColor),
      edgeWidth: S.trackEdgeWidth,
      edgeOpacity: S.trackEdgeOpacity,
    },
    screenMapper(f),
    depthSampler(f.imageA),
  );
}

// Smooth: analyse after drawing and show the result next frame (never waits on the GPU).
// Locked: analyse first and wait for it, so boxes sit exactly on this frame.
function runTrackPass(slot, offline, locked = false) {
  const t0 = performance.now();
  const [w, h] = trackSize(slot);
  renderer.trackPass({
    tex: slot.color,
    srcWidth: slot.width,
    mirror: slot.mirror,
    mode: TRACK_MODES[S.trackMode] ?? 0,
    thresh: S.trackThresh,
    invert: S.trackInvert,
    key: hexToRgb(S.trackKey),
    keyTol: S.trackKeyTol,
    blur: S.trackBlur,
    w,
    h,
  });
  if (offline || locked) {
    // Read back straight away. In Smooth mode the result is used for the next
    // frame, the same delay the live readback has, so exports match.
    const r = renderer.readTrackSync();
    if (r) tracker.process(r, trackOpts());
  } else {
    renderer.startTrackRead();
  }
  perf.trackMs = performance.now() - t0 + tracker.ms;
}

function resetTracking() {
  tracker.reset();
  renderer.resetTrack();
}

// ---------------------------------------------------------------- moving sources

function activeSlots() {
  const list = [];
  if (slots[current]) list.push(slots[current]);
  if (target !== -1 && slots[target] && target !== current) list.push(slots[target]);
  return list;
}

// Live: keep videos on their timeline and upload new frames.
function updateSourcesLive() {
  const tp = tempo();
  const inUse = new Set(activeSlots());
  for (const slot of slots) {
    if (!slot || slot.kind === 'image') continue;
    if (!inUse.has(slot)) {
      if (slot.kind === 'video' && !slot.media.video.paused) slot.media.video.pause();
      continue;
    }
    if (slot.kind === 'video') slot.media.updateLive(clock.time, tp);
    else slot.media.updateLive();
    const v = slot.media.video;
    if (v.readyState >= 2 && (slot.media.newFrame || v.currentTime !== slot.lastTime || slot.kind === 'camera')) {
      renderer.updateVideoTexture(slot.color, v);
      slot.media.newFrame = false;
      slot.lastTime = v.currentTime;
    }
  }
}

// Export: put every video in use on the exact frame for this clock time.
async function seekSourcesExact() {
  const tp = tempo();
  for (const slot of activeSlots()) {
    if (slot.kind !== 'video') continue;
    await slot.media.seekExact(clock.time, tp);
    renderer.updateVideoTexture(slot.color, slot.media.video);
    slot.lastTime = slot.media.video.currentTime;
  }
}

// When the clock restarts (render or recording), playing videos start from the
// beginning (bar 1 when tempo-synced) so every export is repeatable. A paused
// video stays on the frame it's holding.
function rebaseClock() {
  const tp = tempo();
  for (const slot of slots) {
    if (slot?.kind !== 'video') continue;
    const m = slot.media;
    if (m.playing) {
      m.anchor = 0;
      m.phase = 0;
    } else {
      m.reanchor(clock.time, tp);
    }
    m.anchorClock = 0;
  }
  clock.time = 0;
  clock.scan = 0;
  clock.spin = 0;
}

function usesCamera() {
  return activeSlots().some((s) => s.kind === 'camera');
}

function drawOverlay(f) {
  const geoCanvas = drawGeometry(f);
  const osd = osdMode();
  const tracking = S.track && f.imageA;
  if (!osd && !tracking) {
    renderer.setNegativeBoxes([]);
    return geoCanvas;
  }
  const canvas = geoCanvas || geoLayer.clear(renderer.width, renderer.height);
  renderer.setNegativeBoxes(tracking ? drawTrackingLayer(geoLayer.ctx, f) : []);
  if (osd) drawOSD(geoLayer.ctx, renderer.width, renderer.height, osd, f.time);
  return canvas;
}

function drawFrame(offline = false) {
  const t0 = performance.now();
  frameNo++;
  const locked = S.track && S.trackLatency === 'locked';
  if (!offline) {
    updateSourcesLive();
    if (S.track && !locked) for (const r of renderer.pollTrackReads()) tracker.process(r, trackOpts());
  }
  const trackSlot = slots[current];
  if (locked && trackSlot) runTrackPass(trackSlot, offline, true);
  const t1 = performance.now();
  const f = frameParams();
  renderer.setOverlay(drawOverlay(f));
  const t2 = performance.now();
  lastCount = renderer.render(f);
  const t3 = performance.now();
  if (S.track && !locked && f.imageA) runTrackPass(f.imageA, offline);
  const t4 = performance.now();
  perf.frameMs = t4 - t0;
  perf.parts = { sources: t1 - t0, overlay: t2 - t1, render: t3 - t2, track: t4 - t3 };
  return f;
}

// ---------------------------------------------------------------- export: offline render

const renderBtn = document.getElementById('render');
const recordBtn = document.getElementById('record');
const stillBtn = document.getElementById('still');
let rendering = false;
let renderAbort = null;
let canRender = false;

function clipSeconds() {
  const d = S.duration;
  if (d > 0) return d;
  if (d < 0) return -d * tempo().cycle;
  return 0;
}

function bitrate(fps) {
  return Math.min(250e6, Math.round(renderer.width * renderer.height * fps * QUALITY_BPP[S.quality]));
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function updateExportInfo() {
  const info = document.getElementById('export-info');
  if (!info || !renderer.width) return;
  const fps = Number(S.fps);
  const secs = clipSeconds();
  const mbps = bitrate(fps) / 1e6;
  const parts = [`Output ${renderer.width}×${renderer.height}`];
  if (renderer.ss > 1) parts.push(`drawn at ${renderer.width * renderer.ss}×${renderer.height * renderer.ss}`);
  parts.push(`about ${Math.round(mbps)} Mbit/s`);
  if (secs) parts.push(`${secs.toFixed(secs % 1 ? 2 : 0)} s, roughly ${Math.max(1, Math.round((mbps * secs) / 8))} MB`);
  info.textContent = parts.join(', ') + '.';
  updateButtons();
}

function updateButtons() {
  const secs = clipSeconds();
  if (rendering) return;
  const cam = usesCamera();
  renderBtn.disabled = !canRender || !secs || cam;
  renderBtn.textContent = !canRender
    ? 'Render not supported here'
    : cam
      ? 'Webcam: use Record live'
      : secs
        ? `Render ${secs.toFixed(secs % 1 ? 1 : 0)}s`
        : 'Pick a length to render';
  updateRecordLabel();
}

async function renderVideo() {
  if (rendering) {
    renderAbort?.abort();
    return;
  }
  if (recorder.active) return;
  if (usesCamera()) {
    status("Render needs a picture or video file: a webcam can't be stepped frame by frame. Use Record live for webcams.", 7000);
    return;
  }
  const fps = Number(S.fps);
  const secs = clipSeconds();
  if (!secs) return;
  const frameCount = Math.round(secs * fps);
  rendering = true;
  renderAbort = new AbortController();
  document.body.classList.add('rendering');
  rebaseClock();
  resetTracking();
  pointer.burst = 0;
  renderer.needsClear = true;
  renderer.moshFresh = true;
  lastKeyIdx = -1;
  const started = performance.now();
  try {
    const blob = await encodeVideo({
      canvas,
      fps,
      frameCount,
      bitrate: bitrate(fps),
      signal: renderAbort.signal,
      renderFrame: async (i) => {
        if (i > 0) step(1 / fps);
        await seekSourcesExact();
        drawFrame(true);
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0)); // let the page breathe
      },
      onProgress: (p) => {
        renderBtn.textContent = `Rendering ${Math.round(p * 100)}% (click or Esc to stop)`;
      },
    });
    download(blob, `geo_sc-${stamp()}.mp4`);
    const took = ((performance.now() - started) / 1000).toFixed(1);
    status(`Saved MP4: ${renderer.width}×${renderer.height}, ${fps} fps, ${(blob.size / 1e6).toFixed(1)} MB (took ${took}s)`, 6000);
  } catch (err) {
    if (err.name === 'AbortError') status('Render stopped', 3000);
    else {
      console.error(err);
      status(`Render failed: ${err.message}`, 8000);
    }
  } finally {
    rendering = false;
    renderAbort = null;
    document.body.classList.remove('rendering');
    clock.last = performance.now();
    resetTracking();
    updateButtons();
  }
}
renderBtn.addEventListener('click', renderVideo);

async function checkRender() {
  const o = outputSize();
  canRender = !!(await findEncoder(o.w, o.h, 60, 20e6)) || !!(await findEncoder(1080, 1920, 30, 20e6));
  updateButtons();
}

// ---------------------------------------------------------------- export: live record + stills

let recFormat = null;
let recChecked = false;
recordBtn.disabled = true;
async function checkRecording() {
  recFormat = await probeFormat(canvas);
  recChecked = true;
  recordBtn.disabled = !recFormat;
  if (!recFormat) recordBtn.title = 'This browser cannot record video. Try Chrome or Safari.';
  updateRecordLabel();
}
let recStart = 0;
let wantStill = false;

async function toggleRecord() {
  if (rendering) return;
  if (recorder.active) {
    recordBtn.textContent = 'Saving…';
    let res = null;
    try {
      res = await recorder.stop();
    } catch (err) {
      status(err.message, 6000);
    }
    document.body.classList.remove('recording');
    updateRecordLabel();
    if (res) {
      download(res.blob, `geo_sc-live-${stamp()}.${res.ext}`);
      status(res.ext === 'mp4' ? 'Saved MP4' : 'Saved WebM. Convert to MP4 for Instagram, or record in Chrome or Safari for MP4 directly.', 5000);
    }
    return;
  }
  try {
    rebaseClock();
    resetTracking();
    const fps = Number(S.fps);
    recorder.start(recFormat, { fps, bitrate: Math.min(100e6, renderer.width * renderer.height * fps * 0.2) });
    recStart = performance.now();
    document.body.classList.add('recording');
  } catch (err) {
    status(err.message, 5000);
  }
}

function updateRecordLabel() {
  const limit = clipSeconds();
  if (recorder.active) {
    const t = (performance.now() - recStart) / 1000;
    recordBtn.textContent = limit ? `Stop (${t.toFixed(1)} / ${limit.toFixed(1)}s)` : `Stop (${t.toFixed(1)}s)`;
  } else if (!recChecked) {
    recordBtn.textContent = 'Checking video support…';
  } else if (!recFormat) {
    recordBtn.textContent = 'Live recording not supported';
  } else {
    recordBtn.textContent = 'Record live';
  }
}
refreshers.push(updateButtons);

recordBtn.addEventListener('click', toggleRecord);
stillBtn.addEventListener('click', () => (wantStill = true));
document.getElementById('hide').addEventListener('click', toggleClean);
document.getElementById('save-preset').addEventListener('click', quickSave);

// Save: update the preset you're on, or ask for a name if it's new.
async function quickSave() {
  const p = activePreset && presets.find(activePreset.name);
  if (p) {
    const snap = snapshot();
    storageNote(await presets.save(p.name, snap.settings, snap.camera));
    activePreset = { name: p.name, edited: false };
    renderPresetList();
    status(`Saved ${p.name}`, 2000);
    return;
  }
  const sec = document.querySelector('.sec[data-id="presets"]');
  if (sec?.classList.contains('collapsed')) sec.querySelector('.sec-title').click();
  sec?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  presetUI.input.focus();
  status('Name this look and press Enter to save it.', 3000);
}

function toggleClean() {
  document.body.classList.toggle('clean');
  fitCanvas();
}

// ---------------------------------------------------------------- transport bar (video and webcam)

const transport = document.getElementById('transport');
const tp = {
  play: document.getElementById('tp-play'),
  scrub: document.getElementById('tp-scrub'),
  time: document.getElementById('tp-time'),
  speed: document.getElementById('tp-speed'),
  loop: document.getElementById('tp-loop'),
  sync: document.getElementById('tp-sync'),
  camera: document.getElementById('tp-camera'),
  mirror: document.getElementById('tp-mirror'),
};
let scrubbing = false;

function shownSlot() {
  return slots[target !== -1 ? target : current] || null;
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

function updateTransport() {
  const slot = shownSlot();
  const kind = slot?.kind;
  transport.hidden = !slot || kind === 'image';
  transport.dataset.kind = kind || '';
  if (!slot || kind === 'image') return;
  if (kind === 'video') {
    const m = slot.media;
    tp.play.textContent = m.playing ? 'Pause' : 'Play';
    tp.play.setAttribute('aria-pressed', String(m.playing));
    tp.speed.value = String(m.speed);
    tp.speed.disabled = m.sync > 0;
    tp.loop.setAttribute('aria-checked', String(m.loop || m.sync > 0));
    tp.loop.disabled = m.sync > 0;
    tp.sync.value = String(m.sync);
  } else {
    tp.mirror.setAttribute('aria-checked', String(!!slot.mirror));
  }
  refreshTransport();
}

function refreshTransport() {
  const slot = shownSlot();
  if (!slot || slot.kind !== 'video' || transport.hidden) return;
  const m = slot.media;
  const pos = m.positionAt(clock.time, tempo());
  if (!scrubbing) tp.scrub.value = String(m.duration ? Math.round((pos / m.duration) * 1000) : 0);
  tp.time.textContent = `${fmtTime(pos)} / ${fmtTime(m.duration || 0)}`;
}

function videoSet(changes) {
  const slot = shownSlot();
  if (slot?.kind !== 'video') return;
  slot.media.set(changes, clock.time, tempo());
  updateTransport();
}

function togglePlay() {
  const slot = shownSlot();
  if (slot?.kind === 'video') videoSet({ playing: !slot.media.playing });
}

tp.play.addEventListener('click', togglePlay);
tp.scrub.addEventListener('input', () => {
  scrubbing = true;
  const slot = shownSlot();
  if (slot?.kind !== 'video') return;
  slot.media.seekTo((Number(tp.scrub.value) / 1000) * slot.media.duration, clock.time, tempo());
  refreshTransport();
});
tp.scrub.addEventListener('change', () => (scrubbing = false));
tp.speed.addEventListener('change', () => videoSet({ speed: Number(tp.speed.value) }));
tp.loop.addEventListener('click', () => {
  const slot = shownSlot();
  if (slot?.kind === 'video') videoSet({ loop: !slot.media.loop });
});
tp.sync.addEventListener('change', () => videoSet({ sync: Number(tp.sync.value) }));
tp.mirror.addEventListener('click', () => {
  const slot = shownSlot();
  if (slot?.kind !== 'camera') return;
  slot.mirror = !slot.mirror;
  slot.mapsFrame = -1;
  updateTransport();
});
tp.camera.addEventListener('change', async () => {
  const slot = shownSlot();
  if (slot?.kind !== 'camera') return;
  try {
    await slot.media.start(tp.camera.value);
    if (slot.media.width !== slot.width || slot.media.height !== slot.height) {
      renderer.deleteTexture(slot.color);
      slot.color = newVideoTexture(slot.media);
    }
    Object.assign(slot, { width: slot.media.width, height: slot.media.height, aspect: slot.media.width / slot.media.height, name: slot.media.label });
    renderSlots();
  } catch (err) {
    status(`Couldn't switch camera: ${err.message}`, 6000);
  }
});

async function refreshCameraList() {
  const list = await CameraSource.devices();
  const slot = shownSlot();
  tp.camera.replaceChildren(...list.map((d) => el('option', { value: d.id }, d.label)));
  if (slot?.kind === 'camera') tp.camera.value = slot.media.deviceId;
}
navigator.mediaDevices?.addEventListener?.('devicechange', refreshCameraList);

// ---------------------------------------------------------------- output window, fullscreen, readout

let outWin = null;
let outStream = null;
// Called by output.html when it opens (or reloads) to receive the picture.
window.geoAttachOutput = (videoEl) => {
  if (!outStream) outStream = canvas.captureStream();
  videoEl.srcObject = outStream;
  videoEl.play().catch(() => {});
};

function openOutput() {
  if (outWin && !outWin.closed) {
    outWin.focus();
    return;
  }
  outWin = window.open('output.html', 'geo_sc_output', 'popup,width=960,height=600');
  if (!outWin) status('The browser blocked the output window. Allow pop-ups for this page, then try again.', 7000);
  else status('Output window open. Drag it to the projector and press F there for fullscreen.', 6000);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else stage.requestFullscreen?.().catch((err) => status(`Fullscreen isn't available: ${err.message}`, 5000));
}
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
  fitCanvas();
});

const hud = document.getElementById('hud');
function updateHud() {
  hud.hidden = !S.hud;
  if (!S.hud) return;
  const lines = [`${perf.fps.toFixed(0)} fps`, `frame ${perf.frameMs.toFixed(1)} ms (CPU)`];
  if (S.track) lines.push(`tracking ${perf.trackMs.toFixed(1)} ms, ${tracker.tracks.filter((t) => !t.missed).length} blobs`);
  lines.push(`${renderer.width}×${renderer.height}${renderer.ss > 1 ? ` (×${renderer.ss})` : ''}`);
  hud.textContent = lines.join('\n');
}

document.getElementById('output-window').addEventListener('click', openOutput);
document.getElementById('fullscreen').addEventListener('click', toggleFullscreen);

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    quickSave();
    return;
  }
  if (e.key === 'Escape' && rendering) return renderAbort?.abort();
  if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range')) return;
  if (e.metaKey || e.ctrlKey || e.altKey || rendering) return;
  const k = e.key.toLowerCase();
  if (k === 'r' && recordBtn.disabled) return;
  if (k === ' ') {
    e.preventDefault();
    if (tag === 'BUTTON') e.target.blur();
    next();
  } else if (k === 's') set('scan', !S.scan);
  else if (k === 't') set('trails', !S.trails);
  else if (k === 'g') set('geo', !S.geo);
  else if (k === 'b') tap();
  else if (k === 'r') toggleRecord();
  else if (k === 'p') wantStill = true;
  else if (k === 'h') toggleClean();
  else if (k === '0') Object.assign(cam, { ty: 0, tp: 0, tz: 1 });
  else if (k === 'k') set('track', !S.track);
  else if (k === 'f') toggleFullscreen();
  else if (k === 'o') openOutput();
  else if (k === 'i') set('hud', !S.hud);
  else if (k === 'v') togglePlay();
  else if (/^[1-9]$/.test(k)) {
    const p = allPresets()[Number(k) - 1];
    if (p) applyPreset(p);
  }
});

// ---------------------------------------------------------------- loop

const countEl = document.getElementById('count');

function frame(now) {
  if (!rendering) {
    const dt = Math.min(0.25, (now - clock.last) / 1000); // real time, unless the tab was away
    clock.last = now;
    step(dt);
    const f = drawFrame();
    updateRing(f.zoom);
    countEl.textContent = `${lastCount.toLocaleString()} particles`;
    perf.frames++;
    if (now - perf.since > 500) {
      perf.fps = (perf.frames * 1000) / (now - perf.since);
      perf.frames = 0;
      perf.since = now;
      updateHud();
    }
    refreshTransport();

    if (wantStill) {
      wantStill = false;
      canvas.toBlob((b) => b && download(b, `geo_sc-${stamp()}.png`), 'image/png');
    }
    if (recorder.active) {
      updateRecordLabel();
      const limit = clipSeconds();
      if (limit && (now - recStart) / 1000 >= limit) toggleRecord();
    }
  } else {
    ring.hidden = true;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start

(async () => {
  fitCanvas();
  aiState = await aiAvailable();
  const aiBtn = controlsEl.querySelector('[data-value="ai"]');
  if (aiBtn && !aiState.ok) aiBtn.title = 'Needs one-time setup: npm install, then npm run setup';
  if (S.depthMode === 'ai' && !aiState.ok) S.depthMode = 'luma';
  if (S.geoFont === 'custom') S.geoFont = 'mono'; // font files aren't kept between visits
  refreshers.forEach((r) => r());
  await presets.load();
  renderPresetList();
  await addImage(sampleImage(), 'INKR.MN sample');
  requestAnimationFrame(frame);
  checkRender();
  checkRecording();
})();

// Exposed for debugging in the console.
window.geo = { S, slots, renderer, set, render: renderVideo, presets, applyPreset, tracker, perf, addCamera, showSlot, clock };
