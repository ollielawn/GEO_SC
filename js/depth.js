// Depth maps for GEO_SC.
//
//  ai     Depth Anything V2 Small, run locally with ONNX Runtime Web (WASM).
//         Needs the one-time `npm run setup` so the runtime and model live in
//         vendor/ and models/. Nothing is sent anywhere.
//  luma   Depth from brightness. Instant, no model. Great for flat graphics.
//  flat   No depth at all.
//
// Every function returns { data: Float32Array, width, height } with values in
// 0..1 where 1 = nearest to the camera.

const MODEL_URL = new URL('../models/depth-anything-v2-small.onnx', import.meta.url).href;
const ORT_DIR = new URL('../vendor/ort/', import.meta.url).href;
const INSTALL_INFO = new URL('../vendor/ai.json', import.meta.url).href; // written by `npm run setup`
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;
let availability = null;

// Is the model + runtime installed? Cached after the first check.
export function aiAvailable() {
  if (!availability) {
    availability = (async () => {
      try {
        const info = await (await fetch(INSTALL_INFO, { cache: 'no-store' })).json();
        if (info.installed && info.runtime) return { ok: true, runtime: ORT_DIR + info.runtime };
      } catch {
        /* treat as not installed */
      }
      return { ok: false, reason: 'setup' };
    })();
  }
  return availability;
}

function loadSession(onStatus) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const avail = await aiAvailable();
      if (!avail.ok) throw new Error('AI depth is not installed. Run "npm run setup" once, then reload.');
      onStatus?.('Loading depth model…');
      const ort = await import(/* @vite-ignore */ avail.runtime);
      ort.env.wasm.wasmPaths = ORT_DIR;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return { ort, session };
    })().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

function canvas2d(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// Normalise to 0..1 using the 2nd–98th percentile so a few outliers don't flatten everything.
function normalise(values) {
  const n = values.length;
  const sorted = Float32Array.from(values).sort();
  const lo = sorted[Math.floor(n * 0.02)];
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))];
  const span = hi - lo || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, (values[i] - lo) / span));
  return out;
}

function applyAlpha(depth, source, w, h) {
  const [c, ctx] = canvas2d(w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] < 128) depth[i] = 0;
  return depth;
}

export async function aiDepth(source, onStatus) {
  const { ort, session } = await loadSession(onStatus);
  onStatus?.('Reading depth…');

  // Keep roughly 518×518 worth of pixels, preserve aspect, sides multiple of 14.
  const aspect = source.width / source.height;
  const target = 518 * 518;
  const snap = (v) => Math.max(14 * 6, Math.round(v / 14) * 14);
  const h = snap(Math.sqrt(target / aspect));
  const w = snap(h * aspect);

  const [, ctx] = canvas2d(w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const plane = w * h;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let ch = 0; ch < 3; ch++) input[ch * plane + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  }

  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) };
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]];
  const dims = out.dims;
  const oh = dims[dims.length - 2];
  const ow = dims[dims.length - 1];
  const depth = normalise(out.data);
  return { data: applyAlpha(depth, source, ow, oh), width: ow, height: oh };
}

export function lumaDepth(source, invert = false) {
  const aspect = source.width / source.height;
  const long = 512;
  const w = aspect >= 1 ? long : Math.max(8, Math.round(long * aspect));
  const h = aspect >= 1 ? Math.max(8, Math.round(long / aspect)) : long;
  const [, ctx] = canvas2d(w, h);
  ctx.filter = 'blur(2px)';
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    raw[i] = invert ? l : 1 - l; // darker = nearer, like ink sitting on paper
  }
  const depth = normalise(raw);
  return { data: applyAlpha(depth, source, w, h), width: w, height: h };
}

export function flatDepth() {
  return { data: new Float32Array([0.5]), width: 1, height: 1 };
}

export function flip(d) {
  const data = new Float32Array(d.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 1 - d.data[i];
  return { ...d, data };
}
