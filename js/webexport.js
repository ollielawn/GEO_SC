// "Export for website": everything a website player needs to reproduce a
// look exactly, as one folder (exports/<name>/ when run with `npm start`),
// or as a single self-contained JSON file otherwise.
//
//   scene.json      every setting, the camera, source details, engine fingerprint
//   logo.png        the exact pixels GEO_SC renders from (after any downscale)
//   depth.png       the depth map, 16-bit: value = (R × 256 + G) / 65535
//   still-wide.jpg  1920×1080 fallback still
//   still-tall.jpg  1080×1920 fallback still
//
// The format is described in docs/website-embed.md (section 2.4).

// The engine files a website copies. Their combined SHA-256 lets the website
// check it has the same engine version as the export.
export const ENGINE_FILES = ['renderer.js', 'shaders.js', 'math.js', 'backgrounds.js', 'effects.js', 'depth.js'];

export async function engineHash() {
  const parts = await Promise.all(
    ENGINE_FILES.map(async (f) => new Uint8Array(await (await fetch(new URL(`./${f}`, import.meta.url), { cache: 'no-store' })).arrayBuffer())),
  );
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'));
}

// The logo exactly as GEO_SC holds it.
export async function sourcePNG(source) {
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  c.getContext('2d').drawImage(source, 0, 0);
  return canvasBlob(c);
}

// Depth map at 16 bits per value, packed into the red and green channels.
export async function depthPNG(depth) {
  const { data, width, height } = depth;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(Math.min(1, Math.max(0, data[i])) * 65535);
    img.data[i * 4] = v >> 8;
    img.data[i * 4 + 1] = v & 255;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasBlob(c);
}

// Reading it back, as a website player should (no colour conversion, no premultiply).
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
  return { data, width: bmp.width, height: bmp.height };
}

const blobToDataURL = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });

// Write the files into exports/<slug>/ through the local server. Falls back to
// one JSON file with the images embedded, for when the app isn't run with npm start.
export async function saveScene(slug, scene, files, download) {
  try {
    for (const [name, blob] of Object.entries(files)) {
      const res = await fetch(`exports/${slug}/${name}`, { method: 'PUT', body: blob });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    const res = await fetch(`exports/${slug}/scene.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene, null, 2) + '\n',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { where: 'project', path: `exports/${slug}/` };
  } catch {
    const embedded = { ...scene, embedded: {} };
    for (const [name, blob] of Object.entries(files)) embedded.embedded[name] = await blobToDataURL(blob);
    download(new Blob([JSON.stringify(embedded)], { type: 'application/json' }), `${slug}.geo-sc-scene.json`);
    return { where: 'download', path: `${slug}.geo-sc-scene.json` };
  }
}
