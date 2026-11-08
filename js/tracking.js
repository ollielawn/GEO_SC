// Live tracking: blobs from the analysis pass (see TRACK_FRAG in shaders.js),
// with stable IDs and smoothing, plus Sobel edges traced into lines.
// Everything here works in source-picture uv (0..1, v = 0 at the top); the
// overlay maps uv to the screen through the same motion as the particles.

import { buildLinks, mark } from './geometry.js';

// ---------------------------------------------------------------- mask clean-up

// Square max/min filters, done as two 1D passes.
function morph1D(src, w, h, r, horizontal, isMax) {
  const out = new Uint8Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      let v = isMax ? 0 : 1;
      for (let k = Math.max(0, i - r); k <= Math.min(len - 1, i + r); k++) {
        const s = horizontal ? src[l * w + k] : src[k * w + l];
        if (isMax ? s : !s) {
          v = isMax ? 1 : 0;
          break;
        }
      }
      out[horizontal ? l * w + i : i * w + l] = v;
    }
  }
  return out;
}

// Closing (grow then shrink) joins nearby fragments into one blob.
function closeMask(m, w, h, r) {
  const d = morph1D(morph1D(m, w, h, r, true, true), w, h, r, false, true);
  return morph1D(morph1D(d, w, h, r, true, false), w, h, r, false, false);
}

// ---------------------------------------------------------------- connected components

function components(mask, data, w, h) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      // Already-labelled 8-neighbours: W, NW, N, NE.
      const n1 = x > 0 ? labels[i - 1] : 0;
      const n2 = x > 0 && y > 0 ? labels[i - w - 1] : 0;
      const n3 = y > 0 ? labels[i - w] : 0;
      const n4 = x < w - 1 && y > 0 ? labels[i - w + 1] : 0;
      let lab = 0;
      for (const n of [n1, n2, n3, n4]) if (n && (!lab || n < lab)) lab = n;
      if (!lab) {
        lab = parent.length;
        parent.push(lab);
      } else {
        for (const n of [n1, n2, n3, n4]) if (n && n !== lab) union(n, lab);
      }
      labels[i] = lab;
    }
  }
  const stats = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!labels[i]) continue;
      const r = find(labels[i]);
      let s = stats.get(r);
      if (!s) stats.set(r, (s = { area: 0, sx: 0, sy: 0, sl: 0, x0: x, x1: x, y0: y, y1: y }));
      s.area++;
      s.sx += x;
      s.sy += y;
      s.sl += data[i * 4 + 3];
      if (x < s.x0) s.x0 = x;
      if (x > s.x1) s.x1 = x;
      if (y < s.y0) s.y0 = y;
      if (y > s.y1) s.y1 = y;
    }
  }
  return [...stats.values()].map((s) => ({
    area: s.area,
    pct: (s.area / (w * h)) * 100,
    cx: (s.sx / s.area + 0.5) / w,
    cy: (s.sy / s.area + 0.5) / h,
    u0: s.x0 / w,
    u1: (s.x1 + 1) / w,
    v0: s.y0 / h,
    v1: (s.y1 + 1) / h,
    lum: s.sl / s.area / 255,
  }));
}

// ---------------------------------------------------------------- edges

const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function traceEdges(data, w, h, o) {
  const n = w * h;
  const keep = new Uint8Array(n);
  const thr = o.edgeThresh * 255;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = data[i * 4 + 1];
      if (m < thr || m < 4) continue;
      // Thin to one pixel: keep only the peak across the edge.
      const a = (data[i * 4 + 2] / 255 - 0.5) * Math.PI * 2;
      const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
      if (m >= data[((y + dy) * w + x + dx) * 4 + 1] && m >= data[((y - dy) * w + x - dx) * 4 + 1]) keep[i] = 1;
    }
  }
  const seen = new Uint8Array(n);
  const lines = [];
  let budget = 8000; // keeps drawing cheap on busy pictures
  // Follow the edge, preferring to carry on in the same direction so lines stay smooth.
  const ORDER = [0, 1, -1, 2, -2, 3, -3, 4];
  const walk = (start, line) => {
    let cur = start;
    let dir = -1;
    for (;;) {
      const x = cur % w, y = (cur / w) | 0;
      let nextI = -1, nextDir = -1;
      for (let k = 0; k < 8; k++) {
        const d = dir < 0 ? k : (dir + ORDER[k] + 8) % 8;
        const xx = x + N8[d][0], yy = y + N8[d][1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (keep[j] && !seen[j]) {
          nextI = j;
          nextDir = d;
          break;
        }
      }
      if (nextI < 0) return;
      seen[nextI] = 1;
      line.push(nextI);
      cur = nextI;
      dir = nextDir;
    }
  };
  for (let i = 0; i < n && budget > 0; i++) {
    if (!keep[i] || seen[i]) continue;
    seen[i] = 1;
    const fwd = [i];
    walk(i, fwd);
    const back = [];
    walk(i, back);
    const chain = back.reverse().concat(fwd);
    if (chain.length < o.edgeMin) continue;
    const pts = [];
    for (let k = 0; k < chain.length; k += 2) {
      const j = chain[k];
      pts.push({ u: ((j % w) + 0.5) / w, v: (((j / w) | 0) + 0.5) / h, l: data[j * 4 + 3] / 255 });
    }
    const last = chain[chain.length - 1];
    pts.push({ u: ((last % w) + 0.5) / w, v: (((last / w) | 0) + 0.5) / h, l: data[last * 4 + 3] / 255 });
    lines.push(pts);
    budget -= pts.length;
  }
  return lines;
}

// ---------------------------------------------------------------- tracker

export class Tracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.edges = [];
    this.nextId = 1;
    this.ms = 0;
    this.processed = 0;
  }

  // read: { data, w, h } from the analysis pass. o: tracking settings.
  process(read, o) {
    const t0 = performance.now();
    const { data, w, h } = read;
    let mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4] > 127 ? 1 : 0;
    if (o.close > 0) mask = closeMask(mask, w, h, o.close);
    let blobs = components(mask, data, w, h).filter((b) => b.pct >= o.minSize && b.pct <= o.maxSize);
    blobs.sort((a, b) => b.area - a.area);
    blobs = blobs.slice(0, o.maxCount);
    this.match(blobs, o, w / h);
    this.edges = o.edges ? traceEdges(data, w, h, o) : [];
    this.ms = performance.now() - t0;
    this.processed++;
  }

  // Keep IDs stable: pair each blob with the nearest existing track.
  match(blobs, o, aspect) {
    const old = this.tracks;
    const pairs = [];
    old.forEach((t, ti) => {
      blobs.forEach((b, bi) => {
        const d = Math.hypot((t.cx - b.cx) * aspect, t.cy - b.cy);
        const gate = 0.05 + 1.5 * Math.sqrt(Math.max(t.pct, b.pct) / 100);
        if (d < gate) pairs.push([d, ti, bi]);
      });
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const usedT = new Set(), usedB = new Set();
    const s = Math.min(0.95, Math.max(0, o.smooth));
    for (const [, ti, bi] of pairs) {
      if (usedT.has(ti) || usedB.has(bi)) continue;
      usedT.add(ti);
      usedB.add(bi);
      const t = old[ti], b = blobs[bi];
      for (const k of ['cx', 'cy', 'u0', 'u1', 'v0', 'v1', 'lum', 'pct']) t[k] = t[k] * s + b[k] * (1 - s);
      t.missed = 0;
      t.age++;
    }
    const next = [];
    old.forEach((t, ti) => {
      if (!usedT.has(ti)) t.missed++;
      if (t.missed <= o.hold) next.push(t);
    });
    blobs.forEach((b, bi) => {
      if (!usedB.has(bi)) next.push({ id: this.nextId++, ...b, missed: 0, age: 1 });
    });
    next.sort((a, b) => a.id - b.id);
    this.tracks = next;
  }
}

// ---------------------------------------------------------------- drawing

// toScreen(u, v, depth) → [x, y] in output pixels, or null if behind the camera.
// depthAt(u, v, lum) → 0..1 depth for a point on the picture.
// Returns NEGATIVE boxes in output uv for the renderer to invert.
export function drawTracking(ctx, W, H, tracker, o, toScreen, depthAt) {
  const unit = Math.min(W, H) / 1080;
  const neg = [];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (o.edges && tracker.edges.length) {
    ctx.globalAlpha = o.edgeOpacity;
    ctx.strokeStyle = o.edgeColor;
    ctx.lineWidth = o.edgeWidth * unit * 1.5;
    ctx.beginPath();
    for (const line of tracker.edges) {
      let pen = false;
      for (const p of line) {
        const s = toScreen(p.u, p.v, depthAt(p.u, p.v, p.l));
        if (!s) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
        pen = true;
      }
    }
    ctx.stroke();
  }

  const shown = tracker.tracks.map((t) => {
    const d = depthAt(t.cx, t.cy, t.lum);
    const corners = [[t.u0, t.v0], [t.u1, t.v0], [t.u0, t.v1], [t.u1, t.v1]].map(([u, v]) => toScreen(u, v, d));
    const centre = toScreen(t.cx, t.cy, d);
    if (corners.some((c) => !c) || !centre) return null;
    const pad = o.pad * unit;
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    return {
      t,
      centre,
      x0: Math.min(...xs) - pad,
      y0: Math.min(...ys) - pad,
      x1: Math.max(...xs) + pad,
      y1: Math.max(...ys) + pad,
      alpha: t.missed ? 1 - t.missed / (o.hold + 1) : 1,
    };
  });
  const boxes = shown.filter(Boolean);

  if (o.links !== 'none' && boxes.length > 1) {
    const pts = boxes.map((b) => ({ u: b.t.cx, v: b.t.cy }));
    const links =
      o.links === 'all'
        ? pts.flatMap((_, i) => pts.slice(i + 1).map((__, j) => [i, i + 1 + j]))
        : buildLinks(pts, { mode: o.links, k: o.linkK, maxLen: 2, aspect: o.aspect });
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.lineWidth * unit * 1.2;
    for (const [i, j] of links) {
      ctx.globalAlpha = Math.min(boxes[i].alpha, boxes[j].alpha) * 0.85;
      ctx.beginPath();
      ctx.moveTo(boxes[i].centre[0], boxes[i].centre[1]);
      ctx.lineTo(boxes[j].centre[0], boxes[j].centre[1]);
      ctx.stroke();
    }
  }

  const fontPx = Math.round(15 * o.textSize * unit);
  ctx.font = `${fontPx}px ${o.font}`;
  ctx.textBaseline = 'alphabetic';
  for (const b of boxes) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    ctx.globalAlpha = b.alpha;
    if (o.style === 'outline') {
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth * unit * 1.5;
      ctx.strokeRect(b.x0, b.y0, w, h);
    } else if (o.style === 'filled') {
      ctx.globalAlpha = b.alpha * o.fillOpacity;
      ctx.fillStyle = o.color;
      ctx.fillRect(b.x0, b.y0, w, h);
      ctx.globalAlpha = b.alpha;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.lineWidth * unit;
      ctx.strokeRect(b.x0, b.y0, w, h);
    } else if (o.style === 'negative') {
      neg.push({ x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H });
    }
    if (o.centreMark !== 'none') {
      ctx.strokeStyle = o.color;
      ctx.fillStyle = o.color;
      ctx.lineWidth = o.lineWidth * unit * 1.2;
      mark(ctx, o.centreMark, b.centre[0], b.centre[1], 7 * unit);
    }
    const parts = [];
    if (o.labelId) parts.push(`#${String(b.t.id).padStart(2, '0')}`);
    if (o.labelSize) parts.push(`${b.t.pct.toFixed(b.t.pct < 10 ? 1 : 0)}%`);
    if (o.labelPos) parts.push(`${Math.round(b.centre[0])},${Math.round(b.centre[1])}`);
    if (!parts.length) continue;
    const text = parts.join('  ');
    const tw = ctx.measureText(text).width;
    const gap = 4 * unit;
    let tx = b.x0, ty = b.y0 - gap;
    if (ty - fontPx < 0) ty = b.y0 + fontPx + gap; // no room above: go inside
    if (tx + tw > W) tx = W - tw - gap;
    if (o.labelBox) {
      ctx.fillStyle = o.boxColor;
      ctx.fillRect(tx - gap, ty - fontPx - gap * 0.5, tw + gap * 2, fontPx + gap * 1.6);
    }
    ctx.fillStyle = o.color;
    ctx.fillText(text, tx, ty);
  }
  ctx.restore();
  return neg;
}
