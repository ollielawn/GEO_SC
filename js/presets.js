// Presets: named snapshots of the look (background, effects, motion,
// geometry, colours, camera). Export settings are left out so a preset never
// changes the size or length of what you're about to render.
//
// Stored in two places:
//  - this browser (localStorage), always
//  - presets/user.json in the project folder, when running `npm start`
//    (serve.mjs accepts the write), so presets can be committed with the code.

export const NOT_IN_PRESETS = new Set(['format', 'resolution', 'smoothing', 'fps', 'quality', 'duration', 'depthMode', 'presetBlend']);

const LOCAL_KEY = 'geo_sc:presets:v1';
const FILE_URL = new URL('../presets/user.json', import.meta.url).href;

// Starter looks. Each lists only what differs from the defaults.
export const STARTERS = [
  {
    name: 'Thermal receipt',
    settings: { bg: 'receipt', colorMode: 'ink', ink: '#1c1c1c', scanAxis: 'down', scanSpeed: 0.35, stream: 0.03, grain: 0.03, sway: 0.15 },
  },
  {
    name: 'Tape loop',
    settings: {
      bg: 'vhs', fx_vhs_on: true, fx_datamosh_on: true, fx_datamosh_mosh: 0.85, fx_datamosh_keys: '4', fx_rgb_on: true, fx_rgb_shift: 4,
      sway: 0.5, pulse: 0.4, accent: '#ff3b6b',
    },
    camera: { ty: 0.25, tp: -0.1, tz: 1 },
  },
  {
    name: 'Green terminal',
    settings: { bg: 'plain', bg_plain_c1: '#000000', fx_ascii_on: true, fx_ascii_cell: 12, fx_crt_on: true, fx_crt_curve: 0.6, spin: 0.25, scan: true },
  },
  {
    name: 'Pocket console',
    settings: {
      bg: 'plain', bg_plain_c1: '#9bbc0f', fx_palette_on: true, fx_palette_palette: '0', fx_palette_pattern: '1', fx_palette_pixel: 4,
      wave: 0.4, waveSize: 3,
    },
  },
  {
    name: 'Survey',
    settings: {
      bg: 'graph', geo: true, geoSource: 'corners', geoLabel: 'value', geoMark: 'bracket', geoColor: 'accent', geoLinks: 'nearest',
      tilt: 22, spin: 0.25, drift: 0.12, scan: false,
    },
  },
  {
    name: 'Broadcast glitch',
    settings: {
      bg: 'digital', fx_bend_on: true, fx_bend_amount: 0.35, fx_rgb_on: true, fx_rgb_kick: 0.8, fx_crt_on: true,
      pulse: 0.7, ripple: 0.4, accent: '#3cf2ff',
    },
  },
  {
    name: 'Print room',
    settings: { bg: 'magazine', colorMode: 'duotone', ink: '#25366e', accent: '#e2231a', stream: 0.12, wind: 200, dolly: 0.3, grain: 0.02 },
  },
];

// Keep only settings this version knows about, with the right type.
export function clean(settings, defaults) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (NOT_IN_PRESETS.has(k) || !(k in defaults)) continue;
    if (typeof v === typeof defaults[k]) out[k] = v;
  }
  return out;
}

export class PresetStore {
  constructor(defaults) {
    this.defaults = defaults;
    this.items = []; // { name, settings, camera, updated }
    this.fileState = 'unknown'; // 'project' once a write to presets/user.json succeeds
  }

  async load() {
    let local = [];
    try {
      local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    } catch {
      /* ignore */
    }
    let file = [];
    try {
      const res = await fetch(FILE_URL, { cache: 'no-store' });
      if (res.ok) file = (await res.json()).presets || [];
    } catch {
      /* no file yet */
    }
    this.items = this.merge(local, file);
    this.persistLocal();
  }

  merge(...lists) {
    const byName = new Map();
    for (const list of lists) {
      for (const p of list) {
        if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
        const prev = byName.get(p.name);
        if (!prev || (p.updated || 0) > (prev.updated || 0)) {
          byName.set(p.name, { name: p.name, settings: clean(p.settings, this.defaults), camera: p.camera || null, updated: p.updated || 0 });
        }
      }
    }
    return [...byName.values()];
  }

  find(name) {
    return this.items.find((p) => p.name === name);
  }

  save(name, settings, camera) {
    const entry = { name, settings: clean(settings, this.defaults), camera, updated: Date.now() };
    const i = this.items.findIndex((p) => p.name === name);
    if (i >= 0) this.items[i] = entry;
    else this.items.push(entry);
    return this.persist();
  }

  remove(name) {
    this.items = this.items.filter((p) => p.name !== name);
    return this.persist();
  }

  importJSON(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.presets;
    if (!Array.isArray(list)) throw new Error('No presets found in that file.');
    const before = this.items.length;
    this.items = this.merge(this.items, list.map((p) => ({ ...p, updated: Date.now() })));
    this.persist();
    return Math.max(0, this.items.length - before) || list.length;
  }

  toJSON() {
    return JSON.stringify({ app: 'GEO_SC', version: 1, presets: this.items }, null, 2) + '\n';
  }

  persistLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.items));
    } catch {
      /* private mode */
    }
  }

  async persist() {
    this.persistLocal();
    try {
      const res = await fetch(FILE_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: this.toJSON() });
      this.fileState = res.ok ? 'project' : 'browser';
    } catch {
      this.fileState = 'browser';
    }
    return this.fileState;
  }
}
