// One-time setup for AI depth.
//   1. Copies ONNX Runtime Web (installed by `npm install`) into vendor/ort/
//   2. Downloads Depth Anything V2 Small (int8, ~27 MB) into models/
// Commit vendor/ and models/ afterwards and the app never needs the internet again.

import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortOut = join(root, 'vendor', 'ort');
const modelOut = join(root, 'models', 'depth-anything-v2-small.onnx');
const MODEL_SRC =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx';

async function copyRuntime() {
  if (!existsSync(ortDist)) {
    throw new Error('onnxruntime-web is not installed. Run "npm install" first.');
  }
  await mkdir(ortOut, { recursive: true });
  const files = await readdir(ortDist);
  // The ES module entry points plus the WASM binaries and their loaders.
  const wanted = files.filter(
    (f) =>
      (/^ort(\.wasm|\.all)?\.min\.mjs$/.test(f) || /^ort-wasm.*\.(wasm|mjs)$/.test(f)) && !f.endsWith('.map'),
  );
  for (const f of wanted) await cp(join(ortDist, f), join(ortOut, f));
  const licence = join(root, 'node_modules', 'onnxruntime-web', 'LICENSE');
  if (existsSync(licence)) await cp(licence, join(ortOut, 'LICENSE'));
  const runtime = ['ort.wasm.min.mjs', 'ort.min.mjs', 'ort.all.min.mjs'].find((f) => wanted.includes(f));
  if (!runtime) throw new Error('Could not find an ONNX Runtime entry file in node_modules/onnxruntime-web/dist.');
  console.log(`✓ ONNX Runtime Web → vendor/ort (${wanted.length} files, entry ${runtime})`);
  return runtime;
}

async function downloadModel() {
  if (existsSync(modelOut) && (await stat(modelOut)).size > 1_000_000) {
    console.log('✓ Depth model already in models/');
    return;
  }
  await mkdir(dirname(modelOut), { recursive: true });
  console.log('↓ Downloading Depth Anything V2 Small (int8)…');
  const res = await fetch(MODEL_SRC, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(modelOut, buf);
  console.log(`✓ Depth model → models/ (${(buf.length / 1e6).toFixed(1)} MB)`);
}

try {
  const runtime = await copyRuntime();
  await downloadModel();
  const info = { installed: true, runtime, model: 'depth-anything-v2-small.onnx' };
  await writeFile(join(root, 'vendor', 'ai.json'), JSON.stringify(info, null, 2) + '\n');
  console.log('\nDone. Run "npm start" and choose "AI model" under Depth.');
  console.log('Tip: commit vendor/ and models/ so this never needs repeating.');
} catch (err) {
  console.error('\n✗ ' + err.message);
  process.exit(1);
}
