import { Renderer } from './renderer.js';
import { aiAvailable, aiDepth, lumaDepth, flatDepth, flip } from './depth.js';
import { Recorder, download, probeFormat } from './recorder.js';

// ---------------------------------------------------------------- settings

const FORMATS = {
  reel: { w: 1080, h: 1920, label: 'Reel 9:16 (1080×1920)' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5 (1080×1350)' },
  square: { w: 1080, h: 1080, label: 'Square 1:1 (1080×1080)' },
  wide: { w: 1920, h: 1080, label: 'Wide 16:9 (1920×1080)' },
};
const DENSITY = { sparse: 450, medium: 900, dense: 1400 };
const PAPER = { light: '#eeefec', dark: '#000000' };
const COLOR_MODES = { original: 0, ink: 1, negative: 2, duotone: 3 };
const SCAN_AXES = { depth: 0, across: 1, down: 2 };
const MAX_SLOTS = 4;
const STORAGE_KEY = 'geo_sc:settings:v1';

const DEFAULTS = {
  depthMode: 'luma',
  flipDepth: false,
  key: 0.12,
  density: 'medium',
  size: 1.3,
  depth: 0.6,
  scale: 1.0,
  drift: 0.25,
  speed: 1.0,
  stream: 0.06,
  wind: 160,
  sway: 0.3,
  splash: 0.6,
  scan: true,
  scanAxis: 'depth',
  scanSpeed: 0.5,
  scanWidth: 0.06,
  scanBurn: 0.3,
  scanJitter: 0.5,
  trails: false,
  trailLength: 0.6,
  colorMode: 'original',
  paper: 'light',
  ink: '#111111',
  accent: '#e2231a',
  glow: false,
  grain: 0.04,
  format: 'reel',
  duration: 10,
};

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
    title: 'Source',
    controls: [
      { key: 'depthMode', type: 'seg', label: 'Depth from', options: [['ai', 'AI model'], ['luma', 'Brightness'], ['flat', 'Flat']] },
      { key: 'flipDepth', type: 'toggle', label: 'Flip depth' },
      { key: 'key', type: 'range', label: 'Remove background', min: 0, max: 0.6, step: 0.01 },
    ],
  },
  {
    title: 'Form',
    controls: [
      { key: 'density', type: 'seg', label: 'Particles', options: [['sparse', 'Sparse'], ['medium', 'Medium'], ['dense', 'Dense']] },
      { key: 'size', type: 'range', label: 'Dot size', min: 0.3, max: 3, step: 0.05 },
      { key: 'depth', type: 'range', label: 'Depth', min: 0, max: 1.5, step: 0.01 },
      { key: 'scale', type: 'range', label: 'Image size', min: 0.4, max: 1.4, step: 0.01 },
    ],
  },
  {
    title: 'Motion',
    controls: [
      { key: 'drift', type: 'range', label: 'Drift', min: 0, max: 1, step: 0.01 },
      { key: 'speed', type: 'range', label: 'Speed', min: 0, max: 3, step: 0.01 },
      { key: 'stream', type: 'range', label: 'Streamers', min: 0, max: 0.4, step: 0.005 },
      { key: 'wind', type: 'range', label: 'Wind direction', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'sway', type: 'range', label: 'Camera sway', min: 0, max: 1, step: 0.01 },
      { key: 'splash', type: 'range', label: 'Cursor push', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
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
    title: 'Trails',
    toggle: 'trails',
    controls: [{ key: 'trailLength', type: 'range', label: 'Length', min: 0, max: 1, step: 0.01 }],
  },
  {
    title: 'Look',
    controls: [
      { key: 'colorMode', type: 'seg', label: 'Colour', options: [['original', 'Original'], ['ink', 'Ink'], ['negative', 'Negative'], ['duotone', 'Duotone']] },
      { key: 'paper', type: 'seg', label: 'Paper', options: [['light', 'Light'], ['dark', 'Dark']] },
      { key: 'ink', type: 'color', label: 'Ink' },
      { key: 'accent', type: 'color', label: 'Accent' },
      { key: 'glow', type: 'toggle', label: 'Glow' },
      { key: 'grain', type: 'range', label: 'Grain', min: 0, max: 0.2, step: 0.005 },
    ],
  },
];

const controlsEl = document.getElementById('controls');
const refreshers = [];

function fmt(c, v) {
  if (c.unit === '°') return `${Math.round(v)}°`;
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
  const id = `c-${c.key}`;
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
    const buttons = c.options.map(([value, text]) => {
      const b = el('button', { type: 'button', 'data-value': value, onclick: () => set(c.key, value) }, text);
      group.append(b);
      return b;
    });
    refreshers.push(() => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === S[c.key]))));
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
}

for (const section of SECTIONS) {
  const head = el('div', { class: 'sec-head' }, el('h2', {}, section.title));
  const body = el('div', { class: 'sec-body' });
  const sec = el('section', { class: 'sec' }, head, body);
  if (section.toggle) {
    const key = section.toggle;
    const b = el('button', { type: 'button', role: 'switch', class: 'switch', 'aria-label': `${section.title} on`, onclick: () => set(key, !S[key]) });
    head.append(b);
    refreshers.push(() => {
      b.setAttribute('aria-checked', String(!!S[key]));
      sec.classList.toggle('off', !S[key]);
    });
  }
  section.controls.forEach((c) => body.append(buildControl(c)));
  controlsEl.append(sec);
}

// Output controls
const formatSel = document.getElementById('format');
for (const [k, f] of Object.entries(FORMATS)) formatSel.append(el('option', { value: k }, f.label));
formatSel.addEventListener('change', () => set('format', formatSel.value));
const durationSel = document.getElementById('duration');
durationSel.addEventListener('change', () => set('duration', Number(durationSel.value)));
refreshers.push(() => {
  formatSel.value = S.format;
  durationSel.value = String(S.duration);
});
refreshers.forEach((r) => r());

// ---------------------------------------------------------------- renderer

const canvas = document.getElementById('view');
const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  statusEl.textContent = err.message;
  statusEl.hidden = false;
  throw err;
}
const recorder = new Recorder(canvas);

let statusTimer = 0;
function status(msg, ms = 0) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg || '';
  statusEl.hidden = !msg;
  if (msg && ms) statusTimer = setTimeout(() => (statusEl.hidden = true), ms);
}

function fitCanvas() {
  const f = FORMATS[S.format];
  renderer.setSize(f.w, f.h);
  const r = stage.getBoundingClientRect();
  const pad = document.body.classList.contains('clean') ? 0 : 28;
  const scale = Math.min((r.width - pad * 2) / f.w, (r.height - pad * 2) / f.h);
  canvas.style.width = `${Math.floor(f.w * scale)}px`;
  canvas.style.height = `${Math.floor(f.h * scale)}px`;
}
new ResizeObserver(fitCanvas).observe(stage);

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
  slot.depthKey = key;
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

// ---------------------------------------------------------------- reacting to settings

async function rebuildDepth() {
  const ids = [current, target].filter((i) => i >= 0);
  for (const i of ids) if (slots[i]) await ensureDepth(slots[i]);
}

function onChange(key) {
  if (key === 'format') fitCanvas();
  if (key === 'depthMode' && S.depthMode === 'ai' && !aiState.ok) {
    status('AI depth needs a one-time setup. In the project folder run "npm install" then "npm run setup", and reload.', 9000);
    S.depthMode = 'luma';
    saveSettings();
  }
  if (key === 'depthMode' || key === 'flipDepth') rebuildDepth();
  if (key === 'trails' || key === 'paper') renderer.needsClear = true;
}

// ---------------------------------------------------------------- pointer + camera

const cam = { yaw: 0, pitch: 0, zoom: 1, ty: 0, tp: 0, tz: 1 };
const pointer = { nx: 0.5, ny: 0.5, over: false, down: false, lx: 0, ly: 0, burst: 0, world: [0, 0, 0] };

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.nx = (e.clientX - r.left) / r.width;
  pointer.ny = (e.clientY - r.top) / r.height;
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

// ---------------------------------------------------------------- record + stills

const recordBtn = document.getElementById('record');
const stillBtn = document.getElementById('still');
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

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function toggleRecord() {
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
      download(res.blob, `geo_sc-${stamp()}.${res.ext}`);
      status(res.ext === 'mp4' ? 'Saved MP4' : 'Saved WebM. Convert to MP4 for Instagram, or record in Chrome or Safari for MP4 directly.', 5000);
    }
    return;
  }
  try {
    // Restart the clock so the scan sweep begins at the start of the clip.
    clock.time = 0;
    clock.scan = 0;
    recorder.start(recFormat, { fps: 60 });
    recStart = performance.now();
    document.body.classList.add('recording');
  } catch (err) {
    status(err.message, 5000);
  }
}

function updateRecordLabel() {
  if (recorder.active) {
    const t = (performance.now() - recStart) / 1000;
    recordBtn.textContent = S.duration ? `Stop (${t.toFixed(1)} / ${S.duration}s)` : `Stop (${t.toFixed(1)}s)`;
  } else if (!recChecked) {
    recordBtn.textContent = 'Checking video support…';
  } else if (!recFormat) {
    recordBtn.textContent = 'Recording not supported here';
  } else {
    recordBtn.textContent = S.duration ? `Record ${S.duration}s` : 'Record';
  }
}
refreshers.push(updateRecordLabel);
updateRecordLabel();

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
  if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'r' && recordBtn.disabled) return;
  if (k === ' ') {
    e.preventDefault();
    if (tag === 'BUTTON') e.target.blur();
    next();
  } else if (k === 's') set('scan', !S.scan);
  else if (k === 't') set('trails', !S.trails);
  else if (k === 'r') toggleRecord();
  else if (k === 'p') wantStill = true;
  else if (k === 'h') toggleClean();
  else if (k === '0') Object.assign(cam, { ty: 0, tp: 0, tz: 1 });
});

// ---------------------------------------------------------------- loop

const clock = { time: 0, scan: 0, last: performance.now() };
const MORPH_SECONDS = 1.8;

function frame(now) {
  const dt = Math.min(0.05, (now - clock.last) / 1000);
  clock.last = now;
  clock.time += dt;
  clock.scan += dt * S.scanSpeed * 0.25;

  // Camera easing + sway.
  const ease = 1 - Math.exp(-dt * 8);
  cam.yaw += (cam.ty - cam.yaw) * ease;
  cam.pitch += (cam.tp - cam.pitch) * ease;
  cam.zoom += (cam.tz - cam.zoom) * ease;
  const yaw = cam.yaw + Math.sin(clock.time * 0.3) * 0.25 * S.sway;
  const pitch = cam.pitch + Math.sin(clock.time * 0.21) * 0.1 * S.sway;

  // Splash follows the pointer; a click gives a burst that dies away.
  pointer.burst *= Math.exp(-dt * 2.5);
  const w = renderer.pointerToWorld(pointer.nx, pointer.ny, cam.zoom);
  for (let i = 0; i < 2; i++) pointer.world[i] += (w[i] - pointer.world[i]) * (1 - Math.exp(-dt * 12));
  const splash = S.splash * ((pointer.over ? 0.25 : 0) + pointer.burst * 1.4);

  // Image morph.
  if (target !== -1) {
    morph += dt / MORPH_SECONDS;
    if (morph >= 1) {
      current = target;
      target = -1;
      morph = 0;
      renderSlots();
    }
  }

  const A = slots[current] || null;
  const B = target !== -1 ? slots[target] : A;
  const paperHex = PAPER[S.paper];
  const keep = 0.75 + 0.235 * S.trailLength; // fraction of last frame kept

  const count = renderer.render({
    imageA: A,
    imageB: B,
    morph: target !== -1 ? morph : 0,
    morphBurst: 0.35,
    time: clock.time,
    density: DENSITY[S.density],
    size: S.size,
    depth: S.depth,
    scale: S.scale,
    opacity: 1,
    key: S.key,
    drift: S.drift,
    speed: S.speed,
    stream: S.stream,
    wind: (S.wind * Math.PI) / 180,
    scatter: 0,
    splashPos: pointer.world,
    splash,
    splashRadius: 0.35,
    scan: S.scan,
    scanPos: -0.3 + 1.6 * (clock.scan % 1),
    scanWidth: S.scanWidth,
    scanBurn: S.scanBurn,
    scanJitter: S.scanJitter,
    scanAxis: SCAN_AXES[S.scanAxis],
    trails: S.trails,
    trailFade: 1 - keep,
    ink: hexToRgb(S.ink),
    accent: hexToRgb(S.accent),
    colorMode: COLOR_MODES[S.colorMode],
    paper: hexToRgb(paperHex),
    paperDark: S.paper === 'dark',
    glow: S.glow,
    grain: S.grain,
    yaw,
    pitch,
    zoom: cam.zoom,
  });
  countEl.textContent = `${count.toLocaleString()} particles`;

  if (wantStill) {
    wantStill = false;
    canvas.toBlob((b) => b && download(b, `geo_sc-${stamp()}.png`), 'image/png');
  }

  if (recorder.active) {
    updateRecordLabel();
    if (S.duration && (now - recStart) / 1000 >= S.duration) toggleRecord();
  }
  requestAnimationFrame(frame);
}

const countEl = document.getElementById('count');

// ---------------------------------------------------------------- start

(async () => {
  fitCanvas();
  aiState = await aiAvailable();
  const aiBtn = controlsEl.querySelector('[data-value="ai"]');
  if (aiBtn && !aiState.ok) aiBtn.title = 'Needs one-time setup: npm install, then npm run setup';
  if (S.depthMode === 'ai' && !aiState.ok) S.depthMode = 'luma';
  refreshers.forEach((r) => r());
  await addImage(sampleImage(), 'INKR.MN sample');
  requestAnimationFrame(frame);
  checkRecording();
})();

// Exposed for debugging in the console.
window.geo = { S, slots, renderer, set };
