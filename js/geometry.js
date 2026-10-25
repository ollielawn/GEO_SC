// Geometry overlay: finds feature points in a picture (corners, edges,
// bright or dark spots, depth peaks), links them with lines, and labels them
// with the values that were actually measured. Points ride along with the
// particles because their motion mirrors the vertex shader (shaders.js).

const ANALYSIS_LONG_SIDE = 256;

// ---------------------------------------------------------------- analysis

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function sampleBilinear(data, w, h, u, v) {
  const x = Math.min(w - 1, Math.max(0, u * w - 0.5));
  const y = Math.min(h - 1, Math.max(0, v * h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const b = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

// Measure everything once per picture + depth map.
export function analyse(source, depth) {
  const aspect = source.width / source.height;
  const w = aspect >= 1 ? ANALYSIS_LONG_SIDE : Math.max(8, Math.round(ANALYSIS_LONG_SIDE * aspect));
  const h = aspect >= 1 ? Math.max(8, Math.round(ANALYSIS_LONG_SIDE / aspect)) : ANALYSIS_LONG_SIDE;
  const [, ctx] = canvas2d(w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;

  // Sobel gradients → edge strength; structure tensor → Harris corner response.
  const ix = new Float32Array(n), iy = new Float32Array(n), edge = new Float32Array(n);
  const L = (x, y) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  let edgeMax = 1e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
      const i = y * w + x;
      ix[i] = gx;
      iy[i] = gy;
      edge[i] = Math.hypot(gx, gy);
      if (edge[i] > edgeMax) edgeMax = edge[i];
    }
  }
  const corner = new Float32Array(n);
  let cornerMax = 1e-9;
  const R = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sxx = 0, syy = 0, sxy = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -R; dx <= R; dx++) {
          const j = yy * w + Math.min(w - 1, Math.max(0, x + dx));
          sxx += ix[j] * ix[j];
          syy += iy[j] * iy[j];
          sxy += ix[j] * iy[j];
        }
      }
      const r = sxx * syy - sxy * sxy - 0.05 * (sxx + syy) ** 2;
      const i = y * w + x;
      corner[i] = Math.max(0, r);
      if (corner[i] > cornerMax) cornerMax = corner[i];
    }
  }
  for (let i = 0; i < n; i++) {
    edge[i] /= edgeMax;
    corner[i] = Math.sqrt(corner[i] / cornerMax); // sqrt spreads the range out
  }

  const dep = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) dep[y * w + x] = sampleBilinear(depth.data, depth.width, depth.height, (x + 0.5) / w, (y + 0.5) / h);
  }
  return { w, h, rgba, lum, edge, corner, depth: dep };
}

// ---------------------------------------------------------------- picking

const SCORE = {
  corners: (m, i) => m.corner[i],
  edges: (m, i) => m.edge[i],
  bright: (m, i) => m.lum[i],
  dark: (m, i) => 1 - m.lum[i],
  depth: (m, i) => m.depth[i],
};

export function pickPoints(m, { source, count, spacing, key, keyColor }) {
  const score = SCORE[source] || SCORE.corners;
  const { w, h, rgba } = m;
  const visible = (i) => {
    if (rgba[i * 4 + 3] < 128) return false;
    if (key <= 0.001) return true;
    const dr = rgba[i * 4] / 255 - keyColor[0], dg = rgba[i * 4 + 1] / 255 - keyColor[1], db = rgba[i * 4 + 2] / 255 - keyColor[2];
    return Math.sqrt(dr * dr + dg * dg + db * db) >= key + 0.03;
  };

  let max = 0;
  const s = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    s[i] = visible(i) ? score(m, i) : -1;
    if (s[i] > max) max = s[i];
  }
  const cands = [];
  const tie = (i) => ((Math.imul(i, 2654435761) >>> 0) / 4294967296) * 1e-4; // breaks ties on flat areas
  if (source === 'corners' || source === 'edges') {
    // Local maxima of the response.
    const floor = max * 0.08;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = s[i];
        if (v <= floor) continue;
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && s[i + dy * w + dx] > v) { isMax = false; break; }
        if (isMax) cands.push(i);
      }
    }
  } else {
    // Brightness and depth are often smooth, so take the top 30% of values
    // and let the spacing spread points across those regions.
    const vals = [];
    for (let i = 0; i < w * h; i++) if (s[i] >= 0) vals.push(s[i]);
    vals.sort((a, b) => a - b);
    const cut = vals.length ? vals[Math.floor(vals.length * 0.7)] : 0;
    for (let i = 0; i < w * h; i++) if (s[i] >= cut && s[i] > 0) cands.push(i);
  }
  cands.sort((a, b) => s[b] + tie(b) - (s[a] + tie(a)));

  const long = Math.max(w, h);
  const minD = spacing * long;
  const minD2 = minD * minD;
  const picked = [];
  for (const i of cands) {
    const x = i % w, y = (i / w) | 0;
    let ok = true;
    for (const p of picked) {
      const dx = p.px - x, dy = p.py - y;
      if (dx * dx + dy * dy < minD2) { ok = false; break; }
    }
    if (!ok) continue;
    picked.push({
      px: x,
      py: y,
      u: (x + 0.5) / w,
      v: (y + 0.5) / h,
      score: s[i],
      lum: m.lum[i],
      depth: m.depth[i],
      edge: m.edge[i],
      corner: m.corner[i],
    });
    if (picked.length >= count) break;
  }
  return picked;
}

export function buildLinks(points, { mode, k, maxLen, aspect }) {
  const links = [];
  if (mode === 'none' || points.length < 2) return links;
  const d = (a, b) => Math.hypot((a.u - b.u) * Math.max(1, aspect), (a.v - b.v) * Math.max(1, 1 / aspect));
  const seen = new Set();
  const add = (i, j) => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (i === j || seen.has(key)) return;
    seen.add(key);
    links.push([i, j]);
  };
  if (mode === 'nearest') {
    points.forEach((p, i) => {
      const near = points
        .map((q, j) => [j, d(p, q)])
        .filter(([j, dist]) => j !== i && dist <= maxLen)
        .sort((a, b) => a[1] - b[1])
        .slice(0, k);
      near.forEach(([j]) => add(i, j));
    });
  } else if (mode === 'chain') {
    const left = new Set(points.map((_, i) => i));
    let cur = 0;
    left.delete(0);
    while (left.size) {
      let best = -1, bd = Infinity;
      for (const j of left) {
        const dist = d(points[cur], points[j]);
        if (dist < bd) { bd = dist; best = j; }
      }
      if (bd <= maxLen) add(cur, best);
      left.delete(best);
      cur = best;
    }
  } else if (mode === 'hub') {
    const hubs = Math.min(points.length, Math.max(1, k));
    for (let i = hubs; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let h = 0; h < hubs; h++) {
        const dist = d(points[i], points[h]);
        if (dist < bd) { bd = dist; best = h; }
      }
      if (bd <= maxLen) add(i, best);
    }
  }
  return links;
}

// ---------------------------------------------------------------- motion mirror

function pcg(v) {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}
function hashCell(x, y, z) {
  return pcg((Math.imul(x >>> 0, 73856093) ^ Math.imul(y >>> 0, 19349663) ^ Math.imul(z >>> 0, 83492791)) >>> 0) / 4294967295;
}
const mix = (a, b, t) => a + (b - a) * t;
function vnoise(x, y, z) {
  const fx0 = Math.floor(x), fy0 = Math.floor(y), fz0 = Math.floor(z);
  let fx = x - fx0, fy = y - fy0, fz = z - fz0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const H = (a, b, c) => hashCell(fx0 + a, fy0 + b, fz0 + c);
  return mix(
    mix(mix(H(0, 0, 0), H(1, 0, 0), fx), mix(H(0, 1, 0), H(1, 1, 0), fx), fy),
    mix(mix(H(0, 0, 1), H(1, 0, 1), fx), mix(H(0, 1, 1), H(1, 1, 1), fx), fy),
    fz,
  );
}
function noise3(x, y, z) {
  return [
    vnoise(x, y, z) * 2 - 1,
    vnoise(x + 31.4, y + 17.2, z + 5.9) * 2 - 1,
    vnoise(x - 11.7, y + 43.1, z + 27.3) * 2 - 1,
  ];
}

// Same displacement as the vertex shader, for one point (without the
// per-particle randomness, which averages out).
function displace(p, d, f) {
  let [x, y, z] = p;
  const TAU = Math.PI * 2;
  if (f.twist > 0) {
    const a = f.twist * y * 1.5 * Math.sin(TAU * f.cyclePhase);
    const c = Math.cos(a), s = Math.sin(a);
    [x, z] = [c * x + s * z, -s * x + c * z];
  }
  if (f.wave > 0) {
    const dx = Math.cos(f.waveAngle), dy = Math.sin(f.waveAngle);
    z += Math.sin((x * dx + y * dy) * f.waveFreq * Math.PI - TAU * f.barPhase) * f.wave * 0.25;
  }
  if (f.ripple > 0) {
    const rr = Math.hypot(x, y);
    z += Math.sin(rr * f.rippleFreq * TAU - TAU * f.barPhase) * f.ripple * 0.2 * Math.exp(-rr * 0.6);
  }
  const n = noise3(x * 1.6, y * 1.6, z * 1.6 + f.time * 0.25 * f.speed);
  const amp = f.drift * 0.12 * (0.4 + (1 - d));
  x += n[0] * amp;
  y += n[1] * amp;
  z += n[2] * amp;
  const dvx = x - f.splashPos[0], dvy = y - f.splashPos[1];
  const s = f.splash * Math.exp(-(dvx * dvx + dvy * dvy) / (f.splashRadius * f.splashRadius));
  const len = Math.hypot(dvx, dvy) || 1;
  x += (dvx / len) * s * 0.35;
  y += (dvy / len) * s * 0.35;
  z += s * 0.08;
  return [x, y, z];
}

function project(view, proj, p, W, H) {
  const [x, y, z] = p;
  const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
  const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
  const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
  const cx = proj[0] * vx + proj[4] * vy + proj[8] * vz + proj[12];
  const cy = proj[1] * vx + proj[5] * vy + proj[9] * vz + proj[13];
  const cw = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15];
  if (cw <= 0.01) return null;
  return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H];
}

// ---------------------------------------------------------------- drawing

export const FONTS = {
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Times New Roman", Times, Georgia, serif',
  typewriter: '"Courier New", Courier, monospace',
  condensed: '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", sans-serif-condensed, sans-serif',
};

function fmtNum(v, dec) {
  return v.toFixed(dec);
}

function labelFor(p, i, mode, source, dec, screen) {
  switch (mode) {
    case 'value':
      if (source === 'bright' || source === 'dark') return String(Math.round(p.lum * 255));
      if (source === 'depth') return fmtNum(p.depth, dec);
      if (source === 'edges') return fmtNum(p.edge, dec);
      return fmtNum(p.corner, dec);
    case 'depth':
      return fmtNum(p.depth, dec);
    case 'brightness':
      return String(Math.round(p.lum * 255));
    case 'position':
      return `${Math.round(screen[0])},${Math.round(screen[1])}`;
    case 'index':
      return String(i + 1).padStart(2, '0');
    default:
      return '';
  }
}

function mark(ctx, kind, x, y, r) {
  switch (kind) {
    case 'dot':
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.35, y);
      ctx.moveTo(x + r * 0.35, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 0.35);
      ctx.moveTo(x, y + r * 0.35); ctx.lineTo(x, y + r);
      ctx.stroke();
      break;
    case 'square':
      ctx.strokeRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'bracket': {
      const a = r, b = r * 0.45;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * a, y + sy * (a - b));
        ctx.lineTo(x + sx * a, y + sy * a);
        ctx.lineTo(x + sx * (a - b), y + sy * a);
      }
      ctx.stroke();
      break;
    }
  }
}

export class GeometryLayer {
  constructor() {
    [this.canvas, this.ctx] = canvas2d(2, 2);
  }

  // Positions of one image's points this frame, with per-point opacity.
  place(points, plane, f, morphFrom, weight) {
    const out = [];
    for (const p of points) {
      const base = [(p.u - 0.5) * 2 * plane[0], (0.5 - p.v) * 2 * plane[1], (p.depth - 0.5) * f.depth];
      let pos = base;
      if (morphFrom) {
        const other = [(p.u - 0.5) * 2 * morphFrom.plane[0], (0.5 - p.v) * 2 * morphFrom.plane[1], (p.depth - 0.5) * f.depth];
        pos = base.map((b, i) => mix(other[i], b, morphFrom.t));
      }
      const world = displace(pos, p.depth, f);
      let a = weight;
      if (f.geoReveal && f.scan) {
        const coord = f.scanAxis === 0 ? p.depth : f.scanAxis === 1 ? p.u : p.v;
        const dd = f.scanPos - coord;
        a *= dd > 0 ? Math.exp(-dd / Math.max(0.05, f.scanBurn * 0.8)) : Math.exp(-((dd / 0.02) ** 2));
      }
      out.push({ p, world, a });
    }
    return out;
  }

  draw(sets, f, W, H) {
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const unit = Math.min(W, H) / 1080;
    const g = f.geo;
    ctx.lineWidth = g.lineWidth * unit * 1.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = g.color;
    ctx.fillStyle = g.color;
    const fontPx = Math.round(14 * g.textSize * unit);
    ctx.font = `${fontPx}px ${g.font}`;
    ctx.textBaseline = 'bottom';
    const r = 9 * g.markSize * unit;

    for (const set of sets) {
      if (!set || set.weight <= 0.001) continue;
      const placed = this.place(set.points, set.plane, f, set.morphFrom, set.weight);
      const screen = placed.map((q) => project(f.view, f.proj, q.world, W, H));

      for (const [i, j] of set.links) {
        const a = screen[i], b = screen[j];
        if (!a || !b) continue;
        const alpha = Math.min(placed[i].a, placed[j].a) * g.opacity;
        if (alpha < 0.01) continue;
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }

      placed.forEach((q, i) => {
        const s = screen[i];
        if (!s) return;
        const alpha = q.a * g.opacity;
        if (alpha < 0.01) return;
        ctx.globalAlpha = alpha;
        if (g.mark !== 'none') mark(ctx, g.mark, s[0], s[1], r);
        const text = labelFor(q.p, i, g.label, g.source, g.decimals, s);
        if (!text) return;
        const tx = s[0] + r + 3 * unit, ty = s[1] - r * 0.4;
        if (g.box) {
          const m = ctx.measureText(text);
          const pad = 3 * unit;
          ctx.fillStyle = g.boxColor;
          ctx.fillRect(tx - pad, ty - fontPx - pad * 0.5, m.width + pad * 2, fontPx + pad * 1.5);
          ctx.fillStyle = g.color;
        }
        ctx.fillText(text, tx, ty);
      });
    }
    ctx.globalAlpha = 1;
    return this.canvas;
  }
}
