# GEO_SC

Depth-particle visuals for INKRMN. Drop in a picture, and GEO_SC turns every pixel into a particle, pushes it into 3D using a depth map, then lets you scan, drift, splash and trail it, and record the result straight to video.

Everything runs in your browser on your own machine. No account, no server, no uploads.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```sh
npm start
```

Open <http://localhost:5173> in Chrome (or Safari). That's it. The brightness-based depth mode works straight away, and suits logos and flat graphics.

No Node? Any static server works, e.g. `python3 -m http.server 5173`. (Opening `index.html` by double-clicking won't work, because browsers block module and model loading from `file://`.)

## Turn on AI depth (one time)

AI depth uses **Depth Anything V2 Small**, a model that estimates how far away each part of a photo is. Set it up once:

```sh
npm install
npm run setup
```

This copies ONNX Runtime Web into `vendor/ort/` and downloads the model (about 27 MB) into `models/`. Then commit them:

```sh
git add vendor models
git commit -m "Vendor AI depth runtime and model"
```

After that the project is fully self-contained: it works offline and doesn't depend on npm, Hugging Face or anyone else staying online.

`npm start` serves the page with cross-origin isolation headers, which lets the model use several CPU cores. On other hosts it falls back to a single thread, which is slower but fine.

## Using it

| Area | What it does |
| --- | --- |
| Pictures | Up to four. Click a thumbnail (or press Space) to morph to it. Drag files onto the window or paste from the clipboard. |
| Source | Where depth comes from (AI model, brightness or flat), flipping near and far, and removing a plain background. The background colour is sampled from the picture's corners. |
| Form | Particle count, dot size, how deep the 3D push is, and image size. |
| Auto motion | Motion that runs by itself, locked to a tempo (type it, or tap it with `B`). One cycle = the bars you pick. **Spin** (turns per cycle), **Tilt**, **Wobble** (a figure-eight per cycle), **Dolly** (zoom in and out per cycle), **Beat pulse** (depth and dot size punch on every beat), **Wave** and **Ripple** (travel one wavelength per bar) and **Twist** (swings once per cycle). |
| Drift and cursor | Drift noise, streamers that peel off along the wind, cursor push strength and **cursor size** (the ring shows its reach; it never appears in exports). |
| Scan | A band that sweeps through depth, across or down. Particles at the front flash the accent colour and get kicked; behind it they burn toward ink and recover. |
| Trails | Leaves fading copies of previous frames. |
| Geometry | Finds points in the picture (corners, edges, bright spots, dark spots or the nearest areas), joins them (nearest neighbours, a chain or hubs), marks them and labels them with what was actually measured: corner or edge strength (0–1), brightness (0–255), depth (0–1), live screen position or an index. Choose a font or drop in your own `.ttf`/`.otf`/`.woff2`. Points ride along with the particles. **Reveal with scan** makes them appear as the scan passes. |
| Background | A procedural texture behind the particles, each with its own settings: **Plain**, **Receipt scan** (thermal lines, scanner streaks, fading, dust, bed shadow, creases), **Film grain** (grain size, flicker, dust and scratches, vignette, grain frame rate), **Digital noise** (luma and colour noise, pixel size, banding), **Magazine** (halftone screen, fibres, show-through from the other side, gloss), **Graph paper**, **CRT screen** (grille, slot or dot mask, scanlines, static), **VHS** (snow, tracking, colour bleed, wobble, head switching) and **Gradient**. Trails fade toward the texture. |
| Effects | Post effects over everything, applied top to bottom. Each has an Amount and its own settings, and several follow the tempo. **Datamosh** (smears old frames along the motion, with a clean frame every N beats), **Circuit bend** (slipped lines, channel swaps, bit crush, inverts and corrupt blocks, firing N times per beat), **Low-res and JPEG** (big pixels, colour depth, 8×8 blocks, colour smear), **Retro palette** (Game Boy, CGA, EGA, Mac 16, Teletext, Virtual Boy or your own colours, with dithering), **1-bit dither** (Bayer, noise, lines or halftone, in two colours of your choice), **ASCII terminal** (green, amber, white, original or your colours), **RGB shift** (with a kick on every beat), **VHS** and **CRT** (curvature, scanlines, mask, glow, vignette, flicker). |
| Look | Original, ink, negative or duotone colour; glow (additive blending); film grain. |

Sections fold up: click a section title.

On the canvas: drag to orbit, scroll to zoom, click to splash, double-click to reset the camera. Double-click any slider to reset it.

Shortcuts: `Space` next picture, `S` scan, `T` trails, `G` geometry, `B` tap tempo, `R` live record, `P` save still, `H` hide panel, `Esc` stop a render, `0` reset camera.

## Exporting

**Render** (the red button) makes the best-quality video. It draws every frame offline, so nothing is dropped however heavy the scene, and encodes H.264 at a high bitrate straight into an MP4. The canvas shows progress as it goes. Needs Chrome, Edge or Safari 17+.

**Record live** captures in real time with the browser's recorder, including whatever you do with the cursor. It's handy, but softer.

Export settings:

- **Shape**: Reel 9:16, Portrait 4:5, Square 1:1 or Wide 16:9.
- **Resolution**: 1080p or 4K.
- **Smoothing**: 2× supersampling draws the particles at double resolution and averages them down, so dots stay crisp without jagged edges. Applies at 1080p.
- **Frame rate**: 30 or 60.
- **Quality**: Standard, High or Maximum bitrate. Particle grain is hard to compress, so higher is noticeably cleaner.
- **Length**: seconds, or 1, 2 or 4 tempo cycles so camera motion ends where it started.

The clock restarts at the start of every export, so a given set of settings always renders the same clip.

**Save still** exports a PNG of the current frame at full resolution.

Instagram re-compresses everything you upload. Starting from a clean, high-bitrate file is still what keeps it sharp after that.

## How it works

```
picture ──► depth map ──► background + particles (trails buffer) ──► composite (+ geometry) ──► effect chain ──► canvas ──► video / PNG
```

| File | Role |
| --- | --- |
| `index.html`, `css/style.css` | The page and panel |
| `js/main.js` | Settings, panel, pictures, camera, the frame loop |
| `js/renderer.js` | WebGL2 setup, textures, the trails buffer, drawing |
| `js/shaders.js` | The GLSL. Every particle's position and colour is worked out from scratch each frame from its id, the picture, the depth map, the time and the settings. There's no simulation state, which keeps it fast and makes recordings repeatable. |
| `js/depth.js` | AI, brightness and flat depth |
| `js/backgrounds.js` | Background textures: their settings and the shader that draws them |
| `js/effects.js` | Post effects: their settings, shaders, retro palettes and the ASCII glyph strip |
| `js/geometry.js` | Feature detection (Sobel edges, Harris corners, brightness, depth), linking, labels, and a JS mirror of the shader motion so the overlay tracks the particles |
| `js/encoder.js` | Offline render: WebCodecs H.264 encoder plus a small MP4 writer |
| `js/recorder.js` | Live recording with MediaRecorder |
| `serve.mjs` | A dependency-free local server |
| `scripts/setup.mjs` | Vendors the AI runtime and model |

There are no front-end libraries. The renderer is plain WebGL2, so the only third-party code is the optional ONNX runtime for AI depth.

Settings are remembered in your browser's local storage.

## Ideas for next

- Audio reactive: load a track and drive splash, scan and drift from its kick, snare and highs, with the track muxed into the render.
- Saved looks: named presets you can switch between.
- Remember custom fonts between visits.

## Credits

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
