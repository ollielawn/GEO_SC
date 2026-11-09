// Copy the GEO_SC website player, its engine and your exported scenes into one
// self-contained folder, ready to drop into a website repo.
//
//   npm run web                         → dist/geo-sc/
//   npm run web -- ../my-site/geo-sc    → straight into your website repo
//   npm run web -- <folder> --scene home --scene tour   (only some scenes)
//
// The folder holds everything the site needs; nothing in it refers back to
// GEO_SC. Run it again after changing the engine or exporting a new scene: it
// replaces only the files it wrote last time (listed in MANIFEST.json) and
// leaves anything else in the folder alone. It refuses to write into a folder
// that has other files but no MANIFEST.json, unless you add --force.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Must match ENGINE_FILES in js/webexport.js (same files, same order), so the
// fingerprint in VERSION matches the one stamped into exported scenes.
const ENGINE_FILES = ['renderer.js', 'shaders.js', 'math.js', 'backgrounds.js', 'effects.js', 'look.js'];
const PLAYER_FILES = ['player.js', ...ENGINE_FILES];
const SCENE_FILES = ['scene.json', 'logo.png', 'depth.png', 'still-wide.jpg', 'still-tall.jpg'];
const TEMPLATES = ['README.md', 'demo.html'];

function args(argv) {
  const out = { dest: null, force: false, scenes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--scene') out.scenes.push(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!out.dest) out.dest = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return out;
}

function sha256(buffers) {
  const h = createHash('sha256');
  for (const b of buffers) h.update(b);
  return h.digest('hex');
}

function gitCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', 'js'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${sha} (with uncommitted engine changes)` : sha;
  } catch {
    return null;
  }
}

async function main() {
  const opt = args(process.argv.slice(2));
  if (opt.help) {
    console.log('Usage: npm run web -- [destination folder] [--scene <name>]... [--force]');
    return;
  }
  const dest = resolve(root, opt.dest || 'dist/geo-sc');
  if (dest === root || root.startsWith(dest + sep)) throw new Error('The destination must be a new folder, not GEO_SC itself or a folder containing it.');

  // ---- safety: only ever replace what we wrote before
  let previous = [];
  if (existsSync(dest)) {
    if (!(await stat(dest)).isDirectory()) throw new Error(`${dest} exists and isn't a folder.`);
    const manifestPath = join(dest, 'MANIFEST.json');
    if (existsSync(manifestPath)) {
      previous = JSON.parse(await readFile(manifestPath, 'utf8')).files || [];
    } else if ((await readdir(dest)).length && !opt.force) {
      throw new Error(`${dest} already has files that weren't put there by this script. Pick an empty or new folder, or add --force.`);
    }
  }

  // ---- scenes
  const exportsDir = join(root, 'exports');
  const available = existsSync(exportsDir)
    ? (await readdir(exportsDir, { withFileTypes: true })).filter((d) => d.isDirectory() && existsSync(join(exportsDir, d.name, 'scene.json'))).map((d) => d.name).sort()
    : [];
  const wanted = opt.scenes.length ? opt.scenes : available;
  for (const s of wanted) if (!available.includes(s)) throw new Error(`No exported scene called "${s}" in exports/. Available: ${available.join(', ') || 'none'}.`);

  // ---- engine fingerprint
  const engine = await Promise.all(ENGINE_FILES.map((f) => readFile(join(root, 'js', f))));
  const version = sha256(engine);

  // ---- write
  const written = [];
  const target = async (rel) => {
    const file = join(dest, rel);
    await mkdir(dirname(file), { recursive: true });
    written.push(rel.split(sep).join('/'));
    return file;
  };
  const copy = async (rel, from) => copyFile(from, await target(rel));
  const put = async (rel, data) => writeFile(await target(rel), data);

  for (const rel of previous) {
    const file = resolve(dest, rel);
    if (file.startsWith(dest + sep)) await rm(file, { force: true });
  }
  for (const f of PLAYER_FILES) await copy(f, join(root, 'js', f));
  for (const f of TEMPLATES) await copy(f, join(root, 'scripts', 'web', f));
  await put('VERSION', `${version}\n${ENGINE_FILES.join(' ')}\n`);

  const warnings = [];
  const scenes = [];
  for (const s of wanted) {
    const dir = join(exportsDir, s);
    const scene = JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8'));
    for (const f of SCENE_FILES) {
      if (!existsSync(join(dir, f))) throw new Error(`exports/${s}/${f} is missing. Export the scene again from GEO_SC.`);
      await copy(join('scenes', s, f), join(dir, f));
    }
    if (scene.engine?.sha256 !== version) warnings.push(`Scene "${s}" was exported with a different engine version. Open it in GEO_SC and export it again, so it matches exactly.`);
    if (scene.unsupported?.length) warnings.push(`Scene "${s}" uses ${scene.unsupported.join(', ')}, which the website player doesn't draw.`);
    scenes.push({ name: s, preset: scene.preset, exported: scene.created });
  }

  const manifest = {
    note: 'Written by GEO_SC (npm run web). Re-run that to update this folder; edits here are overwritten.',
    created: new Date().toISOString(),
    geoScCommit: gitCommit(),
    engine: version,
    scenes,
    files: [...written, 'MANIFEST.json'].sort(),
  };
  await put('MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');

  // Tidy empty scene folders left behind by scenes that were removed.
  if (existsSync(join(dest, 'scenes'))) {
    for (const d of await readdir(join(dest, 'scenes'), { withFileTypes: true })) {
      const p = join(dest, 'scenes', d.name);
      if (d.isDirectory() && !(await readdir(p)).length) await rm(p, { recursive: true });
    }
  }

  const shown = relative(process.cwd(), dest) || '.';
  console.log(`GEO_SC player copied to ${shown}/`);
  console.log(`  engine ${version.slice(0, 12)}…, ${written.length} files`);
  console.log(`  scenes: ${scenes.map((s) => s.name).join(', ') || 'none (use "Export for website" in GEO_SC first)'}`);
  for (const w of warnings) console.warn(`  ! ${w}`);
  console.log(`Check it: serve the folder above it and open ${shown}/demo.html`);
}

main().catch((err) => {
  console.error(`npm run web: ${err.message}`);
  process.exit(1);
});
