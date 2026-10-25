import { Renderer } from './renderer.js';
import { aiAvailable, aiDepth, lumaDepth, flatDepth, flip } from './depth.js';
import { Recorder, download, probeFormat } from './recorder.js';
import { encodeVideo, findEncoder } from './encoder.js';
import { analyse, pickPoints, buildLinks, GeometryLayer, FONTS } from './geometry.js';
import { BACKGROUNDS } from './backgrounds.js';
import { EFFECTS, PALETTES, CHARSETS } from './effects.js';

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

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
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
if (!Object.keys(collapsed).length) collapsed = { geo: true, effects: false, export: false };

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
  const pad = document.body.classList.contains('clean') ? 0 : 28;
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

async function ensureDepth(slot) {
  const key = depthKey();
  if (slot.depthKey === key && slot.depth) return;
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
    slotsEl.append(el('div', { class: 'slot-wrap' }, btn, rm));
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (/\.(ttf|otf|woff2?)$/i.test(file.name)) {
      await loadFont(file);
      continue;
    }
    if (!file.type.startsWith('image/')) continue;
    try {
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

function fontFamily() {
  if (S.geoFont === 'custom') return customFont ? `"${customFont.family}", ${FONTS.mono}` : FONTS.mono;
  return FONTS[S.geoFont] || FONTS.mono;
}

// ---------------------------------------------------------------- reacting to settings

async function rebuildDepth() {
  const ids = [current, target].filter((i) => i >= 0);
  for (const i of ids) if (slots[i]) await ensureDepth(slots[i]);
}

function onChange(key) {
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

const clock = { time: 0, scan: 0, last: performance.now() };
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
  const p = new Float32Array(8);
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
    const p = new Float32Array(8);
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

  const yaw = cam.yaw + TAU * S.spin * cycles + Math.sin(TAU * cyclePhase) * 0.3 * S.sway;
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

function drawFrame() {
  const f = frameParams();
  renderer.setOverlay(drawGeometry(f));
  lastCount = renderer.render(f);
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
  renderBtn.disabled = !canRender || !secs;
  renderBtn.textContent = !canRender ? 'Render not supported here' : secs ? `Render ${secs.toFixed(secs % 1 ? 1 : 0)}s` : 'Pick a length to render';
  updateRecordLabel();
}

async function renderVideo() {
  if (rendering) {
    renderAbort?.abort();
    return;
  }
  if (recorder.active) return;
  const fps = Number(S.fps);
  const secs = clipSeconds();
  if (!secs) return;
  const frameCount = Math.round(secs * fps);
  rendering = true;
  renderAbort = new AbortController();
  document.body.classList.add('rendering');
  clock.time = 0;
  clock.scan = 0;
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
        drawFrame();
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
    clock.time = 0;
    clock.scan = 0;
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

function toggleClean() {
  document.body.classList.toggle('clean');
  fitCanvas();
}

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
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
});

// ---------------------------------------------------------------- loop

const countEl = document.getElementById('count');

function frame(now) {
  if (!rendering) {
    const dt = Math.min(0.05, (now - clock.last) / 1000);
    clock.last = now;
    step(dt);
    const f = drawFrame();
    updateRing(f.zoom);
    countEl.textContent = `${lastCount.toLocaleString()} particles`;

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
  await addImage(sampleImage(), 'INKR.MN sample');
  requestAnimationFrame(frame);
  checkRender();
  checkRecording();
})();

// Exposed for debugging in the console.
window.geo = { S, slots, renderer, set, render: renderVideo };
