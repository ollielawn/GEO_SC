// GEO_SC website player.
//
// Draws a scene exported from GEO_SC ("Export for website") into a canvas on a
// web page, using the same engine (renderer.js + look.js), so the look matches
// what you designed. It adapts to the canvas size: any shape, any screen.
//
//   import { mount } from './geo-sc/player.js';
//   const player = await mount(document.querySelector('#geo'), { scene: '/geo-sc/scenes/home/' });
//
// The canvas is sized by your CSS. Put the scene's still image underneath it:
// the player adds the class "is-ready" to the canvas once the first frame is
// drawn, and removes it if it ever stops (lost graphics context). If WebGL2
// isn't available, or the visitor prefers reduced motion, mount() returns null
// and the still stays.
//
// URL switches, for checking:  ?geo=off   don't start the player
//                              ?geo=exact no adaptations (full particle count,
//                                         no mobile scaling, no frame-rate guard)

import { Renderer } from './renderer.js';
import { DEFAULTS, DENSITY, MOBILE_SCALE, lookParams, portraitScale, stepClock } from './look.js';
import { BACKGROUNDS } from './backgrounds.js';

const OPTIONS = {
  scene: null, // URL of the scene folder (holding scene.json), or a scene object already loaded
  maxDpr: 2, // never draw more than this many pixels per CSS pixel
  pixelBudget: 2.5e6, // most canvas pixels drawn per frame (desktop retina screens get capped here)
  mobileScale: MOBILE_SCALE, // logo grows by up to this much on portrait screens (never wider than 90% of the canvas)
  minDensity: 300, // fewest particles across the logo when adapting to small or slow screens
  interactive: true, // cursor push on hover, burst on tap/click
  exact: false, // true: same particle count and scale as GEO_SC, no adaptations
  frameGuard: true, // step quality down on devices that can't keep up
  reducedMotion: 'still', // 'still': show the still for prefers-reduced-motion; 'play': ignore it
  form: false, // true: start with no particles; player.form() flies them in, like Space in GEO_SC
  formSeconds: 1.8, // how long forming takes (GEO_SC's morph time)
  formBurst: 0.35, // how far the particles scatter on the way in (GEO_SC's morph burst)
  onReady: null, // called after the first frame is drawn
};

const query = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('geo') : null;

// Read the 16-bit depth map exactly (no colour management, no premultiply).
export async function readDepthPNG(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const data = new Float32Array(bmp.width * bmp.height);
  for (let i = 0; i < data.length; i++) data[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 65535;
  const { width, height } = bmp;
  bmp.close?.(); // a closed bitmap reports 0×0, so the size is read first
  return { data, width, height };
}

export function supported() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GEO_SC player: ${url} (HTTP ${res.status})`);
  return res;
}

// Settings from the scene on top of the defaults, keeping only known keys of the right type.
function settingsFrom(scene) {
  const S = { ...DEFAULTS };
  for (const [k, v] of Object.entries(scene.settings || {})) if (k in DEFAULTS && typeof v === typeof DEFAULTS[k]) S[k] = v;
  if (!BACKGROUNDS.some((b) => b.id === S.bg)) S.bg = S.bg === 'film' ? 'film35' : 'plain';
  return S;
}

async function checkVersion(scene) {
  try {
    const mine = (await (await fetch(new URL('./VERSION', import.meta.url))).text()).trim().split(/\s+/)[0];
    const theirs = scene.engine?.sha256;
    if (mine && theirs && mine !== theirs) {
      console.warn(
        'GEO_SC player: this scene was exported from a different engine version than the one on this site. ' +
          'It will still play, but may not match GEO_SC exactly. Run `npm run web` in GEO_SC to copy the matching engine.',
      );
    }
  } catch {
    /* VERSION is optional */
  }
}

export async function mount(canvas, options = {}) {
  const o = { ...OPTIONS, ...options };
  if (query === 'off') return null;
  if (query === 'exact') o.exact = true;
  if (o.reducedMotion === 'still' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  if (!supported()) return null;

  // ---- load the scene
  let scene = o.scene;
  let base = '';
  if (typeof scene === 'string') {
    base = new URL(scene.endsWith('/') ? scene : `${scene}/`, location.href).href;
    scene = await (await fetchOk(new URL('scene.json', base))).json();
  }
  if (!scene || scene.kind !== 'website-scene') throw new Error('GEO_SC player: not a GEO_SC website scene');
  checkVersion(scene);
  const fileURL = (name) => (scene.embedded?.[name] ? scene.embedded[name] : new URL(name, base).href);
  const [logoBlob, depthBlob] = await Promise.all([
    fetchOk(fileURL(scene.files.logo)).then((r) => r.blob()),
    fetchOk(fileURL(scene.files.depth)).then((r) => r.blob()),
  ]);
  const [logo, depth] = await Promise.all([
    createImageBitmap(logoBlob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }),
    readDepthPNG(depthBlob),
  ]);

  const S = settingsFrom(scene);
  const src = scene.source;
  const camera = { yaw: scene.camera?.ty ?? 0, pitch: scene.camera?.tp ?? 0, zoom: scene.camera?.tz ?? 1 };
  // Start where the fallback stills were taken, so fading in from the still doesn't jump.
  const clock = { time: 0, scan: 0, spin: 0, ...(o.exact ? {} : scene.clock) };
  const mosh = { lastKeyIdx: -1 };
  // Forming: a morph from an empty copy of the image to the image itself.
  // t runs 0 to 1; until form() is called it stays at 0 (nothing showing).
  const forming = { on: !!o.form, t: 0, playing: false };
  const pointer = { nx: 0.5, ny: 0.5, over: false, burst: 0, world: [0, 0, 0] };

  // ---- quality state (the frame-rate guard steps this down)
  const q = { ss: S.smoothing === '2x' ? 2 : 1, densityMul: 1, dprCap: o.maxDpr, level: 0 };

  let renderer = null;
  let image = null;
  let running = false;
  let visible = true;
  let pageShown = !document.hidden;
  let raf = 0;
  let last = 0;
  let readyFired = false;
  let destroyed = false;
  let held = false; // paused by the page through pause()
  let lost = false;
  let cssW = 0;
  let cssH = 0;
  let devW = 0; // exact device pixels, when the browser reports them
  let devH = 0;

  function boot() {
    renderer = new Renderer(canvas);
    renderer.onEffectError = (id) => console.warn(`GEO_SC player: the ${id} effect couldn't start on this graphics card, so it's skipped.`);
    image = {
      color: renderer.colorTexture(logo),
      depth: renderer.depthTexture(depth.data, depth.width, depth.height),
      width: src.width,
      height: src.height,
      aspect: src.aspect,
      key: src.key,
      gpuDepth: false,
      mirror: false,
    };
    mosh.lastKeyIdx = -1;
    resize(true);
  }

  // ---- sizing
  function dpr() {
    return Math.min(window.devicePixelRatio || 1, o.exact ? Infinity : q.dprCap);
  }

  function resize(force = false) {
    if (!renderer || cssW < 1 || cssH < 1) return;
    let w, h;
    const d = dpr();
    // Exact device pixels when the browser reports them sensibly (some emulators don't).
    const real = window.devicePixelRatio || 1;
    if (devW && d === real && Math.abs(devW - cssW * real) <= 2 && Math.abs(devH - cssH * real) <= 2) {
      w = devW;
      h = devH;
    } else {
      w = Math.round(cssW * d);
      h = Math.round(cssH * d);
    }
    if (!o.exact && w * h > o.pixelBudget) {
      const k = Math.sqrt(o.pixelBudget / (w * h));
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    // Supersample only when it's affordable (the particle buffer is ss² times the canvas).
    const ss = o.exact ? q.ss : q.ss > 1 && w * h * 4 <= 8e6 ? 2 : 1;
    if (force || w !== renderer.width || h !== renderer.height || ss !== renderer.ss) {
      renderer.setSize(w, h, ss);
      if (!running) draw(); // keep a paused canvas correct after a resize
    }
  }

  const ro = new ResizeObserver((entries) => {
    const e = entries[entries.length - 1];
    const box = e.contentBoxSize?.[0];
    cssW = box ? box.inlineSize : e.contentRect.width;
    cssH = box ? box.blockSize : e.contentRect.height;
    const dev = e.devicePixelContentBoxSize?.[0];
    devW = dev ? dev.inlineSize : 0;
    devH = dev ? dev.blockSize : 0;
    resize();
  });
  try {
    ro.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    ro.observe(canvas);
  }

  // ---- adaptation to the frame
  function density() {
    const full = DENSITY[S.density];
    if (o.exact) return full;
    const fromSize = Math.round(0.8 * Math.sqrt(cssW * cssH));
    return Math.max(Math.min(o.minDensity, full), Math.min(full, Math.round(fromSize * q.densityMul)));
  }

  function scaleMul() {
    if (o.exact || !renderer) return 1;
    return portraitScale(S, renderer.width / renderer.height, o.mobileScale);
  }

  // ---- frame
  function frameParams() {
    const f = lookParams(S, {
      time: clock.time,
      scan: clock.scan,
      spin: clock.spin,
      cam: camera,
      mosh,
      density: density(),
      scaleMul: scaleMul(),
      splash: (zoom) => {
        const w = renderer.pointerToWorld(pointer.nx, pointer.ny, zoom);
        const follow = 1 - Math.exp(-(1 / 60) * 12);
        for (let i = 0; i < 2; i++) pointer.world[i] += (w[i] - pointer.world[i]) * follow;
        return { pos: pointer.world, amount: o.interactive ? S.splash * ((pointer.over ? 0.25 : 0) + pointer.burst * 1.4) : 0 };
      },
    });
    // Scatter: each particle thrown out in its own direction, as in GEO_SC's
    // morph burst. Not a saved setting; a page can set player.settings.scatter
    // live (say, start at 0.6 and ease to 0 for a cloud that settles).
    f.scatter = Math.max(0, +S.scatter || 0);
    if (forming.on) {
      // Same shape and depth as the image, but no colour: every particle starts invisible.
      f.imageA = { ...image, color: renderer.blank.color };
      f.imageB = image;
      f.morph = forming.t;
      f.morphBurst = o.formBurst;
    } else {
      f.imageA = image;
      f.imageB = image;
      f.morph = 0;
      f.morphBurst = 0.35;
    }
    Object.assign(f, renderer.matrices(f));
    return f;
  }

  function draw() {
    if (!renderer || lost || renderer.width < 1) return;
    renderer.render(frameParams());
    if (!readyFired) {
      readyFired = true;
      canvas.classList.add('is-ready');
      o.onReady?.();
    }
  }

  // Frame-rate guard: if frames take too long for two seconds running, step
  // quality down (supersampling, then particle count, then pixel density).
  const guard = { since: 0, frames: 0, total: 0, slow: 0 };
  function watch(ms, now) {
    if (o.exact || !o.frameGuard || q.level >= 5) return;
    if (!guard.since) guard.since = now;
    guard.frames++;
    guard.total += ms;
    if (now - guard.since < 1000) return;
    const avg = guard.total / guard.frames;
    guard.slow = avg > 20 ? guard.slow + 1 : 0;
    guard.since = now;
    guard.frames = guard.total = 0;
    if (guard.slow < 2) return;
    guard.slow = 0;
    q.level++;
    if (q.ss > 1) q.ss = 1;
    else if (q.densityMul > 0.5) q.densityMul *= 0.75;
    else if (q.dprCap > 1.5) q.dprCap = 1.5;
    else if (q.dprCap > 1) q.dprCap = 1;
    else q.level = 5;
    resize();
  }

  function loop(now) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    if (last) watch(now - last, now);
    last = now;
    stepClock(clock, S, dt);
    pointer.burst *= Math.exp(-dt * 2.5);
    if (forming.playing) {
      forming.t += dt / Math.max(0.05, o.formSeconds);
      if (forming.t >= 1) Object.assign(forming, { on: false, t: 0, playing: false });
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update() {
    const should = visible && pageShown && !held && !lost && !destroyed;
    if (should && !running) {
      running = true;
      last = 0; // no jump after being away
      guard.since = 0;
      guard.frames = guard.total = 0;
      raf = requestAnimationFrame(loop);
    } else if (!should && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    update();
  });
  io.observe(canvas);
  const onVis = () => {
    pageShown = !document.hidden;
    update();
  };
  document.addEventListener('visibilitychange', onVis);

  // ---- pointer: hover push and tap burst only, so the page still scrolls
  const prevTouch = canvas.style.touchAction;
  canvas.style.touchAction = 'pan-y';
  const where = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.nx = (e.clientX - r.left) / r.width;
    pointer.ny = (e.clientY - r.top) / r.height;
  };
  const onMove = (e) => {
    where(e);
    pointer.over = e.pointerType === 'mouse';
  };
  const onDown = (e) => {
    where(e);
    pointer.burst = 1;
  };
  const onLeave = () => (pointer.over = false);
  if (o.interactive) {
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', onLeave);
  }

  // ---- lost graphics context: show the still, rebuild when the browser gives it back
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    canvas.classList.remove('is-ready');
    readyFired = false;
    update();
  };
  const onRestored = () => {
    lost = false;
    boot();
    update();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  boot();
  update();
  if (!running) draw();

  return {
    scene,
    settings: S,
    pause() {
      held = true;
      update();
    },
    // Fly the particles in from nothing (start the page with { form: true }).
    // Calling it again replays it.
    form() {
      Object.assign(forming, { on: true, t: 0, playing: true });
      if (!running) draw();
    },
    resume() {
      held = false;
      update();
    },
    // For checking: the current quality level and canvas size.
    get stats() {
      return { width: renderer?.width, height: renderer?.height, ss: renderer?.ss, density: density(), scaleMul: scaleMul(), level: q.level, dpr: dpr() };
    },
    // Jump the clock (seconds) — used to compare against GEO_SC frame by frame.
    seek(t) {
      clock.time = 0;
      clock.scan = 0;
      clock.spin = 0;
      mosh.lastKeyIdx = -1;
      stepClock(clock, S, t);
      draw();
    },
    destroy() {
      destroyed = true;
      update();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.style.touchAction = prevTouch;
      canvas.classList.remove('is-ready');
      logo.close?.();
    },
  };
}
