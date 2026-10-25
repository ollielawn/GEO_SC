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
| Motion | Drift noise, streamers that peel off along the wind, camera sway, and how hard the cursor pushes particles. |
| Scan | A band that sweeps through depth, across or down. Particles at the front flash the accent colour and get kicked; behind it they burn toward ink and recover. |
| Trails | Leaves fading copies of previous frames. |
| Look | Original, ink, negative or duotone colour; light or dark paper; glow (additive blending); film grain. |

On the canvas: drag to orbit, scroll to zoom, click to splash, double-click to reset the camera. Double-click any slider to reset it.

Shortcuts: `Space` next picture, `S` scan, `T` trails, `R` record, `P` save still, `H` hide panel, `0` reset camera.

## Exporting

Pick a size (Reel 9:16, Portrait 4:5, Square 1:1 or Wide 16:9) and a length, then press **Record**. The canvas renders at full output resolution whatever size it looks on screen, and the clock restarts when recording starts, so the scan sweep begins with the clip.

Chrome and Safari record MP4 (H.264), which Instagram accepts directly. Browsers that can only make WebM will say so when the file saves. On load, GEO_SC does a half-second test recording to find a format that really works.

**Save still** exports a PNG of the current frame at full resolution.

## How it works

```
picture ──► depth map ──► particles on the GPU ──► effects ──► trails buffer ──► canvas ──► video / PNG
```

| File | Role |
| --- | --- |
| `index.html`, `css/style.css` | The page and panel |
| `js/main.js` | Settings, panel, pictures, camera, the frame loop |
| `js/renderer.js` | WebGL2 setup, textures, the trails buffer, drawing |
| `js/shaders.js` | The GLSL. Every particle's position and colour is worked out from scratch each frame from its id, the picture, the depth map, the time and the settings. There's no simulation state, which keeps it fast and makes recordings repeatable. |
| `js/depth.js` | AI, brightness and flat depth |
| `js/recorder.js` | MediaRecorder video export |
| `serve.mjs` | A dependency-free local server |
| `scripts/setup.mjs` | Vendors the AI runtime and model |

There are no front-end libraries. The renderer is plain WebGL2, so the only third-party code is the optional ONNX runtime for AI depth.

Settings are remembered in your browser's local storage.

## Ideas for next

- Audio reactive: load a track and drive splash, scan and drift from its kick, snare and highs.
- Tracker overlays (links and marks between moving points).
- Frame-perfect offline export for heavy scenes that can't hold 60 fps live.
- Saved looks: named presets you can switch between.

## Credits

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
