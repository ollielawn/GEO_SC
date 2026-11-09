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
| Presets | **Save preset** (or `⌘S`) saves the current look: background, effects, motion, geometry, colours and camera angle. Export settings and pictures aren't included. Click a preset, or press `1`–`9`, to recall it. **Switching** sets how presets change: a cut, or a blend over 1 beat, 1 bar or 2 bars at your tempo. Seven starter looks are included. |
| Pictures, video and webcam | Up to four sources. **Add picture or video** takes images and video files (MP4, MOV, WebM); **Add camera** uses a webcam. Click a thumbnail (or press Space) to morph between them. Drag files onto the window or paste from the clipboard. Video and webcam get their depth from brightness, every frame. |
| Source | Where depth comes from (AI model, brightness or flat), flipping near and far, and removing a plain background. The background colour is sampled from the picture's corners. |
| Form | Particle count, dot size, how deep the 3D push is, and image size. |
| Auto motion | Motion that runs by itself, locked to a tempo (type it, or tap it with `B`). One cycle = the bars you pick. **Spin** (turns per cycle), **Tilt**, **Wobble** (a figure-eight per cycle), **Dolly** (zoom in and out per cycle), **Beat pulse** (depth and dot size punch on every beat), **Wave** and **Ripple** (travel one wavelength per bar) and **Twist** (swings once per cycle). |
| Drift and cursor | Drift noise, streamers that peel off along the wind, cursor push strength and **cursor size** (the ring shows its reach; it never appears in exports). |
| Scan | A band that sweeps through depth, across or down. Particles at the front flash the accent colour and get kicked; behind it they burn toward ink and recover. |
| Trails | Leaves fading copies of previous frames. |
| Geometry | Finds points in the picture (corners, edges, bright spots, dark spots or the nearest areas), joins them (nearest neighbours, a chain or hubs), marks them and labels them with what was actually measured: corner or edge strength (0–1), brightness (0–255), depth (0–1), live screen position or an index. Choose a font or drop in your own `.ttf`/`.otf`/`.woff2`. Points ride along with the particles. **Reveal with scan** makes them appear as the scan passes. |
| Background | A procedural texture behind the particles, each with its own settings: **Plain**; four film stocks, **35mm colour**, **16mm**, **Super 8** and **Black and white film** (realistic grain made of overlapping particles that changes every film frame, gate weave, flicker, density mottle, dust and hair, scratches, vignette, plus light leaks and gate edges on Super 8); **Digital noise**; **Magazine** (halftone, fibres, show-through, gloss); **Graph paper**; **CRT screen**; **VHS** (blank tape built like the signal: streaky noise, colour streaks, dropouts, tracking, head switching, line jitter, optional PLAY or camcorder on-screen display); **Gradient**. Trails fade toward the texture. |
| Effects | Post effects over everything, applied top to bottom. Each has an Amount and its own settings, and several follow the tempo. **Datamosh**, **Circuit bend**, **Low-res and JPEG**, **Retro palette**, **1-bit dither**, **ASCII terminal**, **RGB shift**, **Film stock** (35mm, 16mm, Super 8 or black and white: brightness-aware grain, halation, gate weave, flicker, dust, stock colour, lens softness), **VHS** (soft luma, low-bandwidth chroma smeared to the right, edge halos, line jitter, dropouts, tracking, head switching, on-screen display), **CRT** and **RGB phosphors** (a macro view of a picture tube: stripes, slots, dots or LCD subpixels whose glow grows with brightness, with bloom, line gaps, glow, misconvergence, camera angle and focus). |
| Tracking | Finds blobs in the source each frame by **brightness**, **colour** (a key colour and tolerance) or **motion** (difference from the last frame), and follows them with stable IDs. Settings for detail, softening, joining nearby pieces, smallest and largest blob (% of the frame), most blobs, smoothing, how long lost blobs are held, and latency (**Smooth** never waits on the GPU; **Locked** has no lag). Draws **boxes** (outline, filled, or **negative**: the picture inverted inside the box), centre marks, **labels** (ID, size, position) in the Geometry fonts, **links** between blob centres, and **edges** traced as lines. All of it saves with presets. |
| Look | Original, ink, negative or duotone colour; glow (additive blending); film grain. |

Sections fold up: click a section title.

On the canvas: drag to orbit, scroll to zoom, click to splash, double-click to reset the camera. Double-click any slider to reset it.

Shortcuts: `⌘S`/`Ctrl+S` save the look, `1`–`9` apply a preset, `K` tracking, `V` play/pause video, `F` fullscreen, `O` output window, `I` performance readout, `Space` next picture, `S` scan, `T` trails, `G` geometry, `B` tap tempo, `R` live record, `P` save still, `H` hide panel, `Esc` stop a render, `0` reset camera.

## Where presets are kept

Saved presets always go into your browser. When the app is running with `npm start`, they're also written to `presets/user.json` in the project folder: commit that file and your presets travel with the code, including to GitHub Pages. **Export presets** and **Import presets** move them between machines as a `.json` file.

## Video and webcam

When a video is showing, a bar under the picture has play/pause, a scrubber, speed, loop and **Tempo**, which stretches the loop to 1–16 bars so the video sits on your track's grid. For a webcam the bar has a camera picker and **Mirror**.

Exports and live recordings start a playing video from its beginning (bar 1 when tempo-synced), so the same settings always render the same clip; a paused video exports the frame it's on. Render steps through the video frame by frame and runs tracking on every frame, so the result matches what you saw. Webcams can't be stepped frame by frame, so use **Record live** for those.

## Live output (projector)

- **Output window** (`O`) opens a second window showing only the picture, fed live from the canvas. Drag it to the projector and press `F` there for fullscreen. Keep the main window visible: browsers slow down hidden tabs.
- **Fullscreen** (`F`) fills the screen with the picture alone.
- **Performance readout** (`I`) shows fps, CPU time per frame, tracking time and blob count. It never appears in exports.

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

**Export for website** writes `exports/<preset name>/`: every setting, the camera, the exact logo pixels, a 16-bit depth map and two fallback stills. A website player can then draw exactly the same look. See [docs/website-embed.md](docs/website-embed.md).

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
| `js/media.js` | Video files and webcams: playback, tempo sync, exact seeking for export |
| `js/tracking.js` | Blob tracking (connected components, stable IDs, smoothing), edge tracing, and drawing boxes, labels and lines |
| `output.html` | The clean output window |
| `docs/video-and-tracking.md` | Design note for video, webcam and tracking |
| `js/webexport.js` | Export for website: scene file, logo, 16-bit depth map, engine fingerprint |
| `docs/website-embed.md` | How to put the engine on a website (steps, plus a build spec for the website's Claude agent) |
| `js/presets.js` | Preset storage (browser + `presets/user.json`) and the starter looks |
| `serve.mjs` | A dependency-free local server that also saves presets into the project |
| `scripts/setup.mjs` | Vendors the AI runtime and model |

There are no front-end libraries. The renderer is plain WebGL2, so the only third-party code is the optional ONNX runtime for AI depth.

Settings are remembered in your browser's local storage.

## Ideas for next

- Audio reactive: load a track and drive splash, scan and drift from its kick, snare and highs, with the track muxed into the render.
- Remember custom fonts between visits.

## Credits

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
